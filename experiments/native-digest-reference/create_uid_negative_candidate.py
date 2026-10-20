"""Private fixed-fixture negative probe: change only the donor Digest ID field.

Requires the exact disposable donor-only candidate. It writes one new private
file with an alternate 32-hex ID that has no Knowledge provider row. It is not
a general UID writer and does not touch the device or any original note.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import struct

from append_prototype import _append_revision, _current_page, _pack
from create_exact_donor_candidate import OUTPUTS, PAGE, PAGE_ID, FILE_ID, _identity
from read_references import _objects, _tags, _textbox_csv, inspect

POSITIVE = OUTPUTS / "n6-exact-donor3-only.note"
POSITIVE_SHA256 = "21a1a74bea7252725a329b887aa29d925c812de2134b056e692f7bd2c3b65556"
HEX32 = re.compile(r"[0-9a-f]{32}\Z")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build() -> tuple[bytes, bytes]:
    positive = POSITIVE.read_bytes()
    if _sha(positive) != POSITIVE_SHA256:
        raise ValueError("Pinned positive candidate SHA-256 changed")
    if _identity(positive)[1] != FILE_ID:
        raise ValueError("FILE_ID changed")
    _, old_meta, old_total = _current_page(positive, PAGE)
    if _tags(old_meta).get("PAGEID") != PAGE_ID:
        raise ValueError("PAGEID changed")
    objects = [body for _, _, body in _objects(old_total, 0)]
    refs = inspect(positive)
    if len(objects) != 2 or len(refs) != 1 or (refs[0].page, refs[0].object_index) != (PAGE, 1):
        raise ValueError("Expected exactly one donor reference at object 1")
    original_uid = refs[0].digest_id
    if HEX32.fullmatch(original_uid) is None:
        raise ValueError("Unexpected donor UID shape")
    alternate_uid = ("f" if original_uid[0] != "f" else "e") + original_uid[1:]
    donor = objects[1]
    csv = _textbox_csv(donor)
    if csv is None:
        raise ValueError("Donor CSV missing")
    fields = csv.split(b",")
    encoded = fields[-2]
    decoded = base64.b64decode(encoded, validate=True)
    identity = json.loads(decoded)
    if identity.get("digest_id") != original_uid or decoded.count(original_uid.encode()) != 1:
        raise ValueError("Donor JSON UID mismatch")
    changed_json = decoded.replace(original_uid.encode(), alternate_uid.encode())
    changed_encoded = base64.b64encode(changed_json)
    if len(changed_encoded) != len(encoded):
        raise ValueError("Encoded Digest identity length changed")
    field_offset = donor.find(encoded, donor.find(csv))
    if field_offset < 0 or donor.find(encoded, field_offset + 1) >= 0:
        raise ValueError("Digest identity field is ambiguous")
    changed_donor = donor[:field_offset] + changed_encoded + donor[field_offset + len(encoded):]
    if len(changed_donor) != len(donor):
        raise ValueError("Donor size changed")
    changed_positions = [i for i, (a, b) in enumerate(zip(donor, changed_donor)) if a != b]
    if not changed_positions or min(changed_positions) < field_offset or max(changed_positions) >= field_offset + len(encoded):
        raise ValueError("Bytes outside the encoded Digest identity changed")
    new_total = struct.pack("<I", 2) + _pack(objects[0]) + _pack(changed_donor)
    negative = _append_revision(positive, PAGE, new_total)
    new_objects = [body for _, _, body in _objects(_current_page(negative, PAGE)[2], 0)]
    new_refs = inspect(negative)
    if (not negative.startswith(positive) or new_objects != [objects[0], changed_donor]
            or len(new_refs) != 1 or new_refs[0].digest_id != alternate_uid
            or new_refs[0].digest_time != refs[0].digest_time):
        raise ValueError("Negative candidate readback differs")
    new_meta = _tags(_current_page(negative, PAGE)[1])
    old_fields = _tags(old_meta)
    if any(new_meta.get(k) != v for k, v in old_fields.items() if k != "TOTALPATH"):
        raise ValueError("Other page metadata changed")
    return positive, negative


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(OUTPUTS.resolve()) or output.suffix.lower() != ".note":
        raise ValueError("Output must be a .note beneath private candidates")
    positive, negative = build()
    with output.open("xb") as stream:
        stream.write(negative)
    original_uid, alternate_uid = inspect(positive)[0].digest_id, inspect(negative)[0].digest_id
    print(f"created={output} bytes={len(negative)} sha256={_sha(negative)}")
    print(f"positive_prefix_bytes={len(positive)} uid_before_sha256={_sha(original_uid.encode())} "
          f"uid_after_sha256={_sha(alternate_uid.encode())}")


if __name__ == "__main__":
    main()
