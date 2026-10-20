"""Private N6 probe: convert the existing textbox to a Digest in place.

Uses only the fixed disposable before/after pair. It changes the old textbox's
observed operation/type and terminal CSV identity, preserving its original
geometry, label, style and short suffix. It writes a new private file only.
Native Notes readback is unproved; this is not a general .note writer.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct

from append_prototype import _append_revision, _current_page, _identity, _pack
from create_exact_donor_candidate import (
    AFTER, AFTER_SHA256, BEFORE, BEFORE_SHA256, FILE_ID, OUTPUTS, PAGE, PAGE_ID,
)
from read_references import _objects, _tags, _textbox_csv, inspect


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build() -> tuple[bytes, bytes]:
    before, after = BEFORE.read_bytes(), AFTER.read_bytes()
    if _sha(before) != BEFORE_SHA256 or _sha(after) != AFTER_SHA256:
        raise ValueError("Pinned disposable pair SHA-256 changed")
    if _identity(before) != _identity(after) or _identity(before)[1] != FILE_ID:
        raise ValueError("Format, FILE_ID or page order changed")
    _, before_meta, before_total = _current_page(before, PAGE)
    _, after_meta, after_total = _current_page(after, PAGE)
    if (_tags(before_meta).get("PAGEID") != PAGE_ID
            or _tags(after_meta).get("PAGEID") != PAGE_ID):
        raise ValueError("PAGEID changed")
    old_objects = [body for _, _, body in _objects(before_total, 0)]
    native_objects = [body for _, _, body in _objects(after_total, 0)]
    native_refs = inspect(after)
    if (len(old_objects) != 1 or len(native_objects) != 5 or len(native_refs) != 1
            or (native_refs[0].page, native_refs[0].object_index) != (PAGE, 3)):
        raise ValueError("Unexpected fixed N6 pair shape")
    old, donor = old_objects[0], native_objects[3]
    if (struct.unpack_from("<I", old, 315)[0] != 0x1e
            or struct.unpack_from("<I", old, 319)[0] != 1
            or struct.unpack_from("<I", donor, 315)[0] != 0x34
            or struct.unpack_from("<I", donor, 319)[0] != 4):
        raise ValueError("Unexpected textbox operation/type fields")
    old_csv, donor_csv = _textbox_csv(old), _textbox_csv(donor)
    if old_csv is None or donor_csv is None:
        raise ValueError("Textbox CSV missing")
    old_fields, donor_fields = old_csv.split(b","), donor_csv.split(b",")
    if len(old_fields) != 20 or len(donor_fields) != 20:
        raise ValueError("Unexpected CSV field count")
    if base64.b64decode(old_fields[-2], validate=True) != b"none":
        raise ValueError("Original textbox already has identity data")
    identity = json.loads(base64.b64decode(donor_fields[-2], validate=True))
    if (identity.get("digest_id") != native_refs[0].digest_id
            or str(identity.get("digest_time")) != native_refs[0].digest_time):
        raise ValueError("Donor JSON does not match native reference")
    replaced_fields = list(old_fields)
    replaced_fields[-2] = donor_fields[-2]
    new_csv = b",".join(replaced_fields)
    start = old.find(old_csv)
    if start != 483 or struct.unpack_from("<I", old, start - 4)[0] != len(old_csv):
        raise ValueError("Unexpected textbox CSV framing")
    new_object = (old[:315] + struct.pack("<II", 0x34, 4) + old[323:start - 4]
                  + struct.pack("<I", len(new_csv)) + new_csv + old[start + len(old_csv):])
    if len(new_object) != len(old) + len(new_csv) - len(old_csv):
        raise ValueError("Converted textbox length mismatch")
    if new_object[start + len(new_csv):] != old[start + len(old_csv):]:
        raise ValueError("Original textbox suffix changed")
    proposed_total = struct.pack("<I", 1) + _pack(new_object)
    candidate = _append_revision(before, PAGE, proposed_total)
    refs = inspect(candidate)
    if (not candidate.startswith(before) or len(refs) != 1
            or refs[0].object_index != 0
            or refs[0].digest_id != native_refs[0].digest_id):
        raise ValueError("Converted candidate readback failed")
    candidate_meta = _tags(_current_page(candidate, PAGE)[1])
    if any(candidate_meta.get(k) != v for k, v in _tags(before_meta).items() if k != "TOTALPATH"):
        raise ValueError("Page metadata changed beyond TOTALPATH")
    return before, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(OUTPUTS.resolve()) or output.suffix.lower() != ".note":
        raise ValueError("Output must be a .note beneath private candidates")
    before, candidate = build()
    with output.open("xb") as stream:
        stream.write(candidate)
    ref = inspect(candidate)[0]
    print(f"created={output} bytes={len(candidate)} sha256={_sha(candidate)}")
    print(f"preserved_before_bytes={len(before)} object={ref.object_index} "
          f"digest_id_sha256={_sha(ref.digest_id.encode())}")


if __name__ == "__main__":
    main()
