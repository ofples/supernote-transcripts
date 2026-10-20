"""Offline, in-memory proof of one appended native Digest TOTALPATH object.

This is a narrow format experiment. It cannot infer a new object's opaque
fields or safely edit a personal .note. No .note file is written by this tool.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import struct

from read_references import _block, _objects, _tags, inspect

TAG = re.compile(rb"<([^:<>]+):([^<>]*)>")
FORMAT = re.compile(rb"^(?:note|mark)SN_FILE_VER_[0-9]+")
FILE_ID = re.compile(rb"<FILE_ID:([^<>]+)>")


def _pack(body: bytes) -> bytes:
    if len(body) >= 2**32:
        raise ValueError("block too large")
    return struct.pack("<I", len(body)) + body


def _replace_tag(body: bytes, key: str, value: int) -> bytes:
    matches = [match for match in TAG.finditer(body) if match.group(1) == key.encode()]
    if len(matches) != 1:
        raise ValueError(f"Expected one {key} tag, found {len(matches)}")
    match = matches[0]
    return body[:match.start()] + f"<{key}:{value}>".encode() + body[match.end():]


def _current_page(data: bytes, page: int) -> tuple[bytes, bytes, bytes]:
    if not data.startswith((b"noteSN_FILE_VER_", b"markSN_FILE_VER_")):
        raise ValueError("Unrecognized .note signature")
    if len(data) < 32 or data[-8:-4] != b"tail":
        raise ValueError("Missing .note tail")
    footer = _block(data, struct.unpack_from("<I", data, len(data) - 4)[0])
    page_meta = _block(data, int(_tags(footer)[f"PAGE{page}"]))
    total_path = _block(data, int(_tags(page_meta)["TOTALPATH"]))
    return footer, page_meta, total_path


def _identity(data: bytes) -> tuple[bytes, bytes, tuple[str, ...]]:
    version = FORMAT.match(data)
    file_id = FILE_ID.search(data[:2048])
    if version is None or file_id is None:
        raise ValueError("Missing format version or FILE_ID")
    footer = _block(data, struct.unpack_from("<I", data, len(data) - 4)[0])
    page_order = tuple(key for key in _tags(footer) if re.fullmatch(r"PAGE[1-9][0-9]*", key))
    return version.group(), file_id.group(1), page_order


def _append_revision(data: bytes, page: int, total_path: bytes) -> bytes:
    footer, page_meta, _ = _current_page(data, page)
    total_offset = len(data)
    total_block = _pack(total_path)
    new_meta = _replace_tag(page_meta, "TOTALPATH", total_offset)
    page_offset = total_offset + len(total_block)
    page_block = _pack(new_meta)
    new_footer = _replace_tag(footer, f"PAGE{page}", page_offset)
    footer_offset = page_offset + len(page_block)
    result = data + total_block + page_block + _pack(new_footer) + b"tail" + struct.pack("<I", footer_offset)
    if not result.startswith(data) or _current_page(result, page)[2] != total_path:
        raise ValueError("Append-only readback failed")
    return result


def append_exact_last_object(before: bytes, native_after: bytes, page: int) -> bytes:
    """Append one native-created object only if all prior objects are identical."""
    if _identity(before) != _identity(native_after):
        raise ValueError("Format, FILE_ID, or page order changed")
    _, old_meta, old_total = _current_page(before, page)
    _, new_meta, new_total = _current_page(native_after, page)
    if _tags(old_meta).get("PAGEID") != _tags(new_meta).get("PAGEID"):
        raise ValueError("PAGEID changed")
    old_objects = [body for _, _, body in _objects(old_total, 0)]
    new_objects = [body for _, _, body in _objects(new_total, 0)]
    if len(new_objects) != len(old_objects) + 1 or new_objects[:-1] != old_objects:
        raise ValueError("Expected exactly one appended object and unchanged predecessors")
    added = new_objects[-1]
    if len(added) < 12 or struct.unpack_from("<I", added, 8)[0] != 100:
        raise ValueError("New object is not type 100")
    result = _append_revision(before, page, new_total)
    old_ids = {r.digest_id for r in inspect(before)}
    added_refs = [r for r in inspect(result) if r.digest_id not in old_ids]
    if len(added_refs) != 1 or added_refs[0].page != page:
        raise ValueError("Expected one newly reachable Digest ID")
    return result


def self_test(source: bytes, page: int) -> None:
    """Remove a fixture's last Digest object, then append it back in memory."""
    _, _, total = _current_page(source, page)
    objects = [body for _, _, body in _objects(total, 0)]
    if not objects or not any(r.object_index == len(objects) - 1 and r.page == page for r in inspect(source)):
        raise ValueError("Fixture's last TOTALPATH object must be the Digest reference")
    stripped_total = struct.pack("<I", len(objects) - 1) + b"".join(_pack(body) for body in objects[:-1])
    stripped = _append_revision(source, page, stripped_total)
    restored = append_exact_last_object(stripped, source, page)
    if _current_page(restored, page)[2] != total:
        raise ValueError("TOTALPATH did not round-trip exactly")
    if not restored.startswith(stripped):
        raise ValueError("Stripped note prefix changed")
    print(f"in-memory roundtrip OK: page={page}, original_objects={len(objects)}, "
          f"restored_refs={len(inspect(restored))}, appended_bytes={len(restored) - len(stripped)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--page", type=int, required=True)
    args = parser.parse_args()
    self_test(args.fixture.read_bytes(), args.page)


if __name__ == "__main__":
    main()
