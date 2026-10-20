"""Private fixed-fixture probe: one type-4 Digest object on the blank page.

Uses the exact disposable blank note and exact style-type4 object. The output
is a new private file only; no device or original note is modified. It tests
whether the native Source action can find a reference without a page bitmap.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import struct

from append_prototype import _identity, _pack, _replace_tag
from create_exact_donor_candidate import EVIDENCE, FILE_ID, OUTPUTS, PAGE, PAGE_ID
from read_references import _block, _objects, _tags, inspect

BLANK = EVIDENCE / "baseline.note"
BLANK_SHA256 = "938c33caea03e5694e61f418bcbca833be5025293e1a8df2eabdd3a439344c8e"
STYLE4 = OUTPUTS / "n6-converted-style-type4.note"
STYLE4_SHA256 = "d1afaa4269bb4a519c784d592615eb923b1cd8a8451bee5bf86ea36723664366"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _footer_page(data: bytes) -> tuple[bytes, bytes]:
    if len(data) < 32 or data[-8:-4] != b"tail":
        raise ValueError("Missing .note tail")
    footer = _block(data, struct.unpack_from("<I", data, len(data) - 4)[0])
    page = _block(data, int(_tags(footer)[f"PAGE{PAGE}"]))
    return footer, page


def build() -> tuple[bytes, bytes]:
    blank, style4 = BLANK.read_bytes(), STYLE4.read_bytes()
    if _sha(blank) != BLANK_SHA256 or _sha(style4) != STYLE4_SHA256:
        raise ValueError("Pinned blank/style4 SHA-256 changed")
    if _identity(blank) != _identity(style4) or _identity(blank)[1] != FILE_ID:
        raise ValueError("Format, FILE_ID or page order changed")
    blank_footer, blank_meta = _footer_page(blank)
    style_footer, style_meta = _footer_page(style4)
    bm, sm = _tags(blank_meta), _tags(style_meta)
    if bm.get("PAGEID") != PAGE_ID or sm.get("PAGEID") != PAGE_ID:
        raise ValueError("PAGEID changed")
    if (bm.get("TOTALPATH") != "0" or bm.get("PAGETEXTBOX") != "0"
            or bm.get("DISABLE") != "none"):
        raise ValueError("Blank page is not empty")
    if inspect(blank):
        raise ValueError("Blank note already has a reference")
    style_total = _block(style4, int(sm["TOTALPATH"]))
    objects = [body for _, _, body in _objects(style_total, 0)]
    style_refs = inspect(style4)
    if len(objects) != 1 or len(style_refs) != 1 or style_refs[0].object_index != 0:
        raise ValueError("Style4 donor is not a single reference")
    anchor = objects[0]
    if struct.unpack_from("<I", anchor, 315)[0] != 0x34 or struct.unpack_from("<I", anchor, 319)[0] != 4:
        raise ValueError("Anchor operation/type changed")
    new_total = struct.pack("<I", 1) + _pack(anchor)
    total_offset = len(blank)
    total_block = _pack(new_total)
    meta = _replace_tag(blank_meta, "TOTALPATH", total_offset)
    meta = _replace_tag(meta, "PAGETEXTBOX", 1)
    meta_offset = total_offset + len(total_block)
    footer = _replace_tag(blank_footer, f"PAGE{PAGE}", meta_offset)
    footer_offset = meta_offset + len(_pack(meta))
    candidate = blank + total_block + _pack(meta) + _pack(footer) + b"tail" + struct.pack("<I", footer_offset)
    result_footer, result_meta = _footer_page(candidate)
    result_tags = _tags(result_meta)
    if (not candidate.startswith(blank) or result_tags.get("PAGETEXTBOX") != "1"
            or result_tags.get("DISABLE") != "none"
            or _block(candidate, int(result_tags["TOTALPATH"])) != new_total):
        raise ValueError("Blank candidate readback failed")
    for tag in ("MAINLAYER", "BGLAYER", "LAYER1", "LAYER2", "LAYER3"):
        if result_tags.get(tag) != bm.get(tag):
            raise ValueError(f"Blank bitmap/layer pointer changed: {tag}")
    for key, value in bm.items():
        if key not in ("TOTALPATH", "PAGETEXTBOX") and result_tags.get(key) != value:
            raise ValueError(f"Unexpected page tag change: {key}")
    if any(_tags(result_footer).get(k) != v for k, v in _tags(blank_footer).items() if k != f"PAGE{PAGE}"):
        raise ValueError("Other footer tags changed")
    refs = inspect(candidate)
    if len(refs) != 1 or refs[0].digest_id != style_refs[0].digest_id:
        raise ValueError("Blank candidate Digest UID differs")
    return blank, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(OUTPUTS.resolve()) or output.suffix.lower() != ".note":
        raise ValueError("Output must be a .note beneath private candidates")
    blank, candidate = build()
    with output.open("xb") as stream:
        stream.write(candidate)
    ref = inspect(candidate)[0]
    print(f"created={output} bytes={len(candidate)} sha256={_sha(candidate)}")
    print(f"preserved_blank_bytes={len(blank)} page={ref.page} "
          f"digest_id_sha256={_sha(ref.digest_id.encode())}")


if __name__ == "__main__":
    main()
