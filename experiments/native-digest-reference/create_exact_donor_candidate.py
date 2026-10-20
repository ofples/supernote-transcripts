"""Private N6 experiment: append only the exact native Digest donor object.

This accepts only the fixed disposable 2026-10-20 before/after pair. It cannot
make new Digest IDs or edit personal notes. The output is a new file beneath
private/native-digest-inspection/candidates; it never overwrites a file.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import struct

from append_prototype import _append_revision, _current_page, _identity, _pack
from read_references import _objects, _tags, inspect

REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "private/device-evidence/2026-10-20/native-digest-reference-probe"
OUTPUTS = REPO / "private/native-digest-inspection/candidates"
BEFORE = EVIDENCE / "textbox-before.note"
AFTER = EVIDENCE / "digest-after.note"
BEFORE_SHA256 = "ce078d0de4e275afe3969ecfb6fa8ebbc b085951067c0163754086f95176ac40".replace(" ", "")
AFTER_SHA256 = "32cff8385e995cb7e09688e1100f1c8c6ec8e903ff01e3c1d1058c483bdcd31e"
FILE_ID = b"F20261020122119016268f3JImOPmFeX2"
PAGE_ID = "P20261020122119028417RKkalo3Gf2hw"
PAGE = 1
DONOR_INDEX = 3


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build() -> tuple[bytes, bytes, bytes]:
    before, after = BEFORE.read_bytes(), AFTER.read_bytes()
    if _sha(before) != BEFORE_SHA256 or _sha(after) != AFTER_SHA256:
        raise ValueError("Pinned disposable pair SHA-256 changed")
    before_identity, after_identity = _identity(before), _identity(after)
    if before_identity != after_identity or before_identity[1] != FILE_ID:
        raise ValueError("Format, FILE_ID or page order mismatch")
    if not after.startswith(before):
        raise ValueError("Native after-copy did not preserve before prefix")
    _, old_meta, old_total = _current_page(before, PAGE)
    _, new_meta, new_total = _current_page(after, PAGE)
    if _tags(old_meta).get("PAGEID") != PAGE_ID or _tags(new_meta).get("PAGEID") != PAGE_ID:
        raise ValueError("PAGEID mismatch")
    old_objects = [body for _, _, body in _objects(old_total, 0)]
    new_objects = [body for _, _, body in _objects(new_total, 0)]
    if len(old_objects) != 1 or len(new_objects) != 5:
        raise ValueError("Unexpected native object counts")
    donor = new_objects[DONOR_INDEX]
    if len(donor) < 12 or struct.unpack_from("<I", donor, 8)[0] != 100:
        raise ValueError("Donor is not a type-100 object")
    after_refs = inspect(after)
    if len(after_refs) != 1 or (after_refs[0].page, after_refs[0].object_index) != (PAGE, DONOR_INDEX):
        raise ValueError("Native after-copy does not have the expected Digest donor")
    if inspect(before):
        raise ValueError("Before-copy already has a Digest reference")
    proposed_total = struct.pack("<I", 2) + _pack(old_objects[0]) + _pack(donor)
    candidate = _append_revision(before, PAGE, proposed_total)
    _, candidate_meta, candidate_total = _current_page(candidate, PAGE)
    if not candidate.startswith(before) or candidate_total != proposed_total:
        raise ValueError("Candidate changed the before-copy prefix")
    expected_meta = dict(_tags(old_meta))
    actual_meta = dict(_tags(candidate_meta))
    expected_meta.pop("TOTALPATH", None)
    actual_meta.pop("TOTALPATH", None)
    if expected_meta != actual_meta:
        raise ValueError("Candidate changed page metadata beyond TOTALPATH")
    candidate_refs = inspect(candidate)
    if len(candidate_refs) != 1 or candidate_refs[0].digest_id != after_refs[0].digest_id:
        raise ValueError("Candidate Digest UID does not match native donor")
    candidate_objects = [body for _, _, body in _objects(candidate_total, 0)]
    if candidate_objects != [old_objects[0], donor]:
        raise ValueError("Candidate object bytes differ")
    # Every original bitmap/layer block remains in the complete preserved prefix.
    for tag in ("MAINLAYER", "BGLAYER", "LAYER1", "LAYER2", "LAYER3"):
        if _tags(candidate_meta).get(tag) != _tags(old_meta).get(tag):
            raise ValueError(f"Candidate changed {tag} pointer")
    return before, after, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(OUTPUTS.resolve()) or output.suffix.lower() != ".note":
        raise ValueError("Output must be a .note beneath the private candidates directory")
    before, after, candidate = build()
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream:
        stream.write(candidate)
    ref = inspect(candidate)[0]
    print(f"created={output} bytes={len(candidate)} sha256={_sha(candidate)}")
    print(f"preserved_before_bytes={len(before)} donor_after_sha256={_sha(after)} "
          f"page={ref.page} reference_object={ref.object_index} "
          f"digest_id_sha256={_sha(ref.digest_id.encode())}")


if __name__ == "__main__":
    main()
