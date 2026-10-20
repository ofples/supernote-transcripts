"""Compare disposable before/after .note copies for one native Digest creation.

Reports structure and hashes only. It never writes a .note file.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import struct

from read_references import _block, _objects, _tags, inspect


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _layout(data: bytes) -> tuple[dict[str, str], dict[int, dict[str, str]]]:
    if len(data) < 32 or data[-8:-4] != b"tail":
        raise ValueError("Missing .note tail")
    footer = _tags(_block(data, struct.unpack_from("<I", data, len(data) - 4)[0]))
    pages = {}
    for key, value in footer.items():
        if re.fullmatch(r"PAGE[1-9][0-9]*", key):
            pages[int(key[4:])] = _tags(_block(data, int(value)))
    return footer, pages


def compare(before: bytes, after: bytes) -> list[str]:
    old_footer, old_pages = _layout(before)
    new_footer, new_pages = _layout(after)
    old_refs, new_refs = inspect(before), inspect(after)
    lines = [f"before bytes={len(before)} sha256={_sha(before)}",
             f"after bytes={len(after)} sha256={_sha(after)}",
             f"after preserves complete before prefix={after.startswith(before)}",
             f"pages before={sorted(old_pages)} after={sorted(new_pages)}",
             f"digest reference count before={len(old_refs)} after={len(new_refs)}"]
    old_ids = {ref.digest_id for ref in old_refs}
    for ref in new_refs:
        if ref.digest_id not in old_ids:
            lines.append(f"new ref page={ref.page} object={ref.object_index} "
                         f"size={ref.object_size} id_sha256={_sha(ref.digest_id.encode())}")
    for key in sorted(set(old_footer) | set(new_footer)):
        if old_footer.get(key) != new_footer.get(key):
            lines.append(f"footer changed {key}")
    for page in sorted(set(old_pages) | set(new_pages)):
        old_meta, new_meta = old_pages.get(page, {}), new_pages.get(page, {})
        for key in sorted(set(old_meta) | set(new_meta)):
            if old_meta.get(key) != new_meta.get(key):
                lines.append(f"page {page} metadata changed {key}")
        for label, data, meta in (("before", before, old_meta), ("after", after, new_meta)):
            offset = int(meta.get("TOTALPATH", "0"))
            if not offset:
                continue
            body = _block(data, offset)
            objects = list(_objects(body, offset))
            lines.append(f"page {page} {label} TOTALPATH objects={len(objects)} "
                         f"body_bytes={len(body)} sha256={_sha(body)}")
            if label == "after" and page in old_pages:
                old_offset = int(old_meta.get("TOTALPATH", "0"))
                old_objects = list(_objects(_block(before, old_offset), old_offset)) if old_offset else []
                stable = min(len(old_objects), len(objects))
                unchanged = sum(old_objects[i][2] == objects[i][2] for i in range(stable))
                lines.append(f"page {page} existing object positions unchanged={unchanged}/{stable}")
                changed = [i for i in range(stable) if old_objects[i][2] != objects[i][2]]
                for i in changed[:12]:
                    old_body, new_body = old_objects[i][2], objects[i][2]
                    old_type = struct.unpack_from("<I", old_body, 8)[0] if len(old_body) >= 12 else "short"
                    new_type = struct.unpack_from("<I", new_body, 8)[0] if len(new_body) >= 12 else "short"
                    lines.append(f"page {page} changed object={i} "
                                 f"type={old_type}->{new_type} "
                                 f"size={len(old_body)}->{len(new_body)} "
                                 f"sha256={_sha(old_body)}->{_sha(new_body)}")
                if len(changed) > 12:
                    lines.append(f"page {page} additional changed objects={len(changed) - 12}")
                for i in range(stable, len(objects)):
                    body = objects[i][2]
                    kind = struct.unpack_from("<I", body, 8)[0] if len(body) >= 12 else "short"
                    lines.append(f"page {page} added object={i} type={kind} "
                                 f"size={len(body)} sha256={_sha(body)}")
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    for line in compare(args.before.read_bytes(), args.after.read_bytes()):
        print(line)


if __name__ == "__main__":
    main()
