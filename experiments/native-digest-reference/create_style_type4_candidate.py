"""Private fixed-fixture probe adding native donor CSV style type 4.

Builds on the exact converted-textbox candidate. Changes only the first
decoded scalar of CSV field 13 from 0 to 4; all lengths and other bytes stay.
No device or original note is modified.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
from pathlib import Path
import struct

from append_prototype import _append_revision, _current_page, _pack
from create_exact_donor_candidate import OUTPUTS, PAGE, PAGE_ID, FILE_ID, _identity
from read_references import _objects, _tags, _textbox_csv, inspect

BASE = OUTPUTS / "n6-converted-textbox-only.note"
BASE_SHA256 = "78df778bfa5bf6ea23a6f856fe46cb7cf848313ed045d003e0bf8148f1548759"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build() -> tuple[bytes, bytes]:
    base = BASE.read_bytes()
    if _sha(base) != BASE_SHA256 or _identity(base)[1] != FILE_ID:
        raise ValueError("Pinned converted candidate changed")
    _, metadata, total = _current_page(base, PAGE)
    if _tags(metadata).get("PAGEID") != PAGE_ID:
        raise ValueError("PAGEID changed")
    objects = [body for _, _, body in _objects(total, 0)]
    refs = inspect(base)
    if len(objects) != 1 or len(refs) != 1 or refs[0].object_index != 0:
        raise ValueError("Expected one converted textbox reference")
    old = objects[0]
    csv = _textbox_csv(old)
    if csv is None:
        raise ValueError("Textbox CSV missing")
    fields = csv.split(b",")
    if len(fields) != 20:
        raise ValueError("Unexpected CSV field count")
    style = base64.b64decode(fields[13], validate=True)
    if not style.startswith(b"0,0,0,"):
        raise ValueError("Expected plain-text style type 0")
    changed_style = b"4" + style[1:]
    encoded = base64.b64encode(changed_style)
    if len(encoded) != len(fields[13]):
        raise ValueError("Style field length changed")
    start = old.find(csv)
    if start != 483 or struct.unpack_from("<I", old, start - 4)[0] != len(csv):
        raise ValueError("Unexpected CSV framing")
    index = csv.find(fields[13])
    if index < 0 or csv.find(fields[13], index + 1) >= 0:
        raise ValueError("Style field location ambiguous")
    field_start = start + index
    changed = old[:field_start] + encoded + old[field_start + len(encoded):]
    if len(changed) != len(old) or _textbox_csv(changed).split(b",")[13] != encoded:
        raise ValueError("Style-only mutation failed")
    diff = [i for i, (a, b) in enumerate(zip(old, changed)) if a != b]
    if not diff or min(diff) < field_start or max(diff) >= field_start + len(encoded):
        raise ValueError("Mutation changed bytes outside style field")
    new_total = struct.pack("<I", 1) + _pack(changed)
    candidate = _append_revision(base, PAGE, new_total)
    candidate_refs = inspect(candidate)
    if (not candidate.startswith(base) or len(candidate_refs) != 1
            or candidate_refs[0].digest_id != refs[0].digest_id):
        raise ValueError("Candidate readback failed")
    candidate_meta = _tags(_current_page(candidate, PAGE)[1])
    if any(candidate_meta.get(k) != v for k, v in _tags(metadata).items() if k != "TOTALPATH"):
        raise ValueError("Other page metadata changed")
    return base, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(OUTPUTS.resolve()) or output.suffix.lower() != ".note":
        raise ValueError("Output must be a .note beneath private candidates")
    base, candidate = build()
    with output.open("xb") as stream:
        stream.write(candidate)
    ref = inspect(candidate)[0]
    print(f"created={output} bytes={len(candidate)} sha256={_sha(candidate)}")
    print(f"preserved_base_bytes={len(base)} digest_id_sha256={_sha(ref.digest_id.encode())}")


if __name__ == "__main__":
    main()
