"""Read native Digest references from a Supernote .note file without editing it.

This recognizes the observed N5/N6 TOTALPATH representation. It is an
experiment, not a writer or a general .note format implementation.
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import struct

TAGS = re.compile(rb"<([^:<>]+):([^<>]*)>")


@dataclass(frozen=True)
class DigestReference:
    page: int
    object_index: int
    object_offset: int
    object_size: int
    digest_id: str
    digest_source: str
    digest_time: str


def _block(data: bytes, offset: int) -> bytes:
    if offset < 24 or offset + 4 > len(data):
        raise ValueError(f"Block offset {offset} is outside the file")
    size = struct.unpack_from("<I", data, offset)[0]
    end = offset + 4 + size
    if end > len(data):
        raise ValueError(f"Block at {offset} exceeds the file")
    return data[offset + 4 : end]


def _tags(body: bytes) -> dict[str, str]:
    return {key.decode("ascii"): value.decode("utf-8") for key, value in TAGS.findall(body)}


def _objects(total_path: bytes, file_offset: int):
    if len(total_path) < 8:
        raise ValueError("TOTALPATH is too short")
    expected = struct.unpack_from("<I", total_path, 0)[0]
    pos = 4
    for index in range(expected):
        if pos + 4 > len(total_path):
            raise ValueError("TOTALPATH object size is missing")
        size = struct.unpack_from("<I", total_path, pos)[0]
        pos += 4
        if pos + size > len(total_path):
            raise ValueError("TOTALPATH object exceeds its block")
        yield index, file_offset + 4 + pos, total_path[pos : pos + size]
        pos += size
    if pos != len(total_path):
        raise ValueError("TOTALPATH object count does not consume its block")


def _textbox_csv(body: bytes) -> bytes | None:
    """Find the observed length-prefixed CSV and `none` trailer in a type-100 object."""
    for start in range(256, len(body) - 12):
        size = struct.unpack_from("<I", body, start)[0]
        end = start + 4 + size
        if (size < 20 or end + 8 > len(body) or body[end - 1] != ord(",")
                or body[end : end + 8] != b"\x04\x00\x00\x00none"):
            continue
        candidate = body[start + 4 : end]
        if candidate.count(b",") >= 18 and all(c < 128 for c in candidate):
            return candidate
    return None


def _digest_data(body: bytes) -> dict[str, str] | None:
    csv = _textbox_csv(body)
    if csv is None:
        return None
    fields = csv.split(b",")
    encoded = fields[-2]  # Final nonempty CSV field; the last field is empty.
    try:
        decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Malformed type-100 textbox tail") from error
    if decoded == "none":
        return None
    try:
        payload = json.loads(decoded)
    except ValueError as error:
        raise ValueError("Malformed Digest identity JSON") from error
    if not isinstance(payload, dict) or not all(
        key in payload for key in ("digest_id", "digest_source", "digest_time")
    ):
        raise ValueError("Type-100 textbox tail lacks Digest identity")
    return {key: str(payload[key]) for key in ("digest_id", "digest_source", "digest_time")}


def inspect(data: bytes) -> list[DigestReference]:
    if not data.startswith((b"noteSN_FILE_VER_", b"markSN_FILE_VER_")):
        raise ValueError("Unrecognized .note signature")
    if len(data) < 32 or data[-8:-4] != b"tail":
        raise ValueError("Missing .note tail")
    footer_offset = struct.unpack_from("<I", data, len(data) - 4)[0]
    footer = _tags(_block(data, footer_offset))
    result: list[DigestReference] = []
    for name, page_offset in footer.items():
        if not re.fullmatch(r"PAGE[1-9][0-9]*", name):
            continue
        page = int(name[4:])
        metadata = _tags(_block(data, int(page_offset)))
        total_path_offset = int(metadata.get("TOTALPATH", "0"))
        if not total_path_offset:
            continue
        total_path = _block(data, total_path_offset)
        for index, object_offset, body in _objects(total_path, total_path_offset):
            if len(body) < 216 or struct.unpack_from("<I", body, 8)[0] != 100:
                continue
            payload = _digest_data(body)
            if payload is not None:
                result.append(DigestReference(page, index, object_offset, len(body),
                    payload["digest_id"], payload["digest_source"], payload["digest_time"]))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("note", type=Path)
    args = parser.parse_args()
    refs = inspect(args.note.read_bytes())
    for ref in refs:
        # Avoid printing private Digest identifiers or notebook text by default.
        digest_hash = hashlib.sha256(ref.digest_id.encode()).hexdigest()[:12]
        print(f"page={ref.page} object={ref.object_index} offset={ref.object_offset} "
              f"size={ref.object_size} digest_id_sha256={digest_hash} "
              f"source={ref.digest_source}")
    print(f"references={len(refs)}")


if __name__ == "__main__":
    main()
