"""Structural regression tests for the offline native Digest reference experiment.

Only checked-in public .note fixtures are read. All append/corruption cases use
immutable bytes in memory; this file never writes notes or fixture artifacts.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
import re
import struct
import sys
import unittest


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))

import append_prototype as append  # noqa: E402
import read_references as reader  # noqa: E402


FIXTURES = (
    ("N5 20260016", REPO / "supernote-obsidian-plugin/supernote-typescript/tests/input/textbox-n5-20260016-digest.note", 5, 53),
    ("N6 RTR 20230015", REPO / "experiments/note-recognition/go-sn/testdata/20260318_154754 rtr one line plus one word plus digest.note", 1, 9),
    ("N6 standard 20230015", REPO / "experiments/note-recognition/go-sn/testdata/20260318_154108 std one line plus digest.note", 1, 2),
)

DIGEST_KEYS = {"digest_id", "digest_source", "digest_time"}
BASE64_RUN = re.compile(rb"[A-Za-z0-9+/]{24,}={0,2}")
PAGE_ID = re.compile(rb"<PAGEID:([^<>]*)>")
FILE_ID = re.compile(rb"<FILE_ID:([^<>]+)>")


def fixture_bytes(path: Path) -> bytes:
    if not path.is_file():
        raise AssertionError(f"Public fixture is missing: {path}")
    return path.read_bytes()


def current_total_path_offset(data: bytes, page: int) -> int:
    footer_offset = struct.unpack_from("<I", data, len(data) - 4)[0]
    footer = reader._tags(reader._block(data, footer_offset))
    page_offset = int(footer[f"PAGE{page}"])
    metadata = reader._tags(reader._block(data, page_offset))
    return int(metadata["TOTALPATH"])


def page_id_span(data: bytes, page: int) -> tuple[int, int]:
    footer_offset = struct.unpack_from("<I", data, len(data) - 4)[0]
    footer = reader._tags(reader._block(data, footer_offset))
    page_offset = int(footer[f"PAGE{page}"])
    metadata = reader._block(data, page_offset)
    match = PAGE_ID.search(metadata)
    if match is None:
        raise AssertionError(f"PAGE{page} has no PAGEID")
    return page_offset + 4 + match.start(1), match.end(1) - match.start(1)


def file_id_span(data: bytes) -> tuple[int, int]:
    match = FILE_ID.search(data[:2048])
    if match is None:
        raise AssertionError("Note header has no FILE_ID")
    return match.start(1), match.end(1) - match.start(1)


def decoded_digest_json_records(data: bytes) -> list[dict[str, str]]:
    """Independent whole-file diagnostic for the known stale-copy fixture."""
    found: list[dict[str, str]] = []
    for match in BASE64_RUN.finditer(data):
        try:
            payload = json.loads(base64.b64decode(match.group(), validate=True))
        except (ValueError, UnicodeDecodeError):
            continue
        if isinstance(payload, dict) and DIGEST_KEYS.issubset(payload):
            found.append({key: str(payload[key]) for key in DIGEST_KEYS})
    return found


def mutate_digest_json_byte(data: bytes, ref: reader.DigestReference) -> bytes:
    """Corrupt only the base64-encoded Digest JSON while retaining its length."""
    changed = bytearray(data)
    body = data[ref.object_offset : ref.object_offset + ref.object_size]
    for match in BASE64_RUN.finditer(body):
        try:
            payload = json.loads(base64.b64decode(match.group(), validate=True))
        except (ValueError, UnicodeDecodeError):
            continue
        if isinstance(payload, dict) and DIGEST_KEYS.issubset(payload):
            # Altering the first base64 symbol preserves framing but makes the
            # decoded JSON invalid, exercising tail validation instead of bounds.
            absolute = ref.object_offset + match.start()
            changed[absolute] = ord("f") if changed[absolute] != ord("f") else ord("e")
            return bytes(changed)
    raise AssertionError("Fixture Digest object has no decodable identity JSON")


def make_total_path(objects: list[bytes]) -> bytes:
    return struct.pack("<I", len(objects)) + b"".join(append._pack(obj) for obj in objects)


class ReachabilityTests(unittest.TestCase):
    def test_each_public_digest_fixture_has_one_reachable_reference(self) -> None:
        for label, path, expected_page, expected_index in FIXTURES:
            with self.subTest(fixture=label):
                refs = reader.inspect(fixture_bytes(path))
                self.assertEqual(len(refs), 1)
                self.assertEqual((refs[0].page, refs[0].object_index), (expected_page, expected_index))
                self.assertEqual(len(refs[0].digest_id), 32)
                self.assertEqual(refs[0].digest_source, "1")

    def test_unreachable_historical_record_is_not_counted_as_duplicate(self) -> None:
        _, path, _, _ = FIXTURES[2]
        data = fixture_bytes(path)
        reachable = reader.inspect(data)
        historical_and_current = decoded_digest_json_records(data)

        self.assertEqual(len(reachable), 1)
        self.assertEqual(len(historical_and_current), 2)
        self.assertEqual(historical_and_current[0]["digest_id"], reachable[0].digest_id)
        self.assertEqual(historical_and_current[1]["digest_id"], reachable[0].digest_id)


class MalformedInputTests(unittest.TestCase):
    def test_truncated_file_tail_is_rejected(self) -> None:
        data = fixture_bytes(FIXTURES[0][1])
        with self.assertRaisesRegex(ValueError, "tail"):
            reader.inspect(data[:-1])

    def test_current_total_path_block_cannot_claim_bytes_past_file(self) -> None:
        data = bytearray(fixture_bytes(FIXTURES[0][1]))
        total_offset = current_total_path_offset(data, FIXTURES[0][2])
        struct.pack_into("<I", data, total_offset, len(data))
        with self.assertRaisesRegex(ValueError, "exceeds the file"):
            reader.inspect(bytes(data))

    def test_total_path_object_length_cannot_escape_block(self) -> None:
        data = bytearray(fixture_bytes(FIXTURES[0][1]))
        total_offset = current_total_path_offset(data, FIXTURES[0][2])
        # Block prefix is 4 bytes, then TOTALPATH count, then first object size.
        struct.pack_into("<I", data, total_offset + 8, 0xFFFFFFFF)
        with self.assertRaisesRegex(ValueError, "exceeds its block"):
            reader.inspect(bytes(data))

    def test_malformed_digest_identity_tail_is_rejected(self) -> None:
        data = fixture_bytes(FIXTURES[0][1])
        refs = reader.inspect(data)
        self.assertEqual(len(refs), 1)
        malformed = mutate_digest_json_byte(data, refs[0])

        with self.assertRaises(ValueError):
            reader.inspect(malformed)


class AppendSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = fixture_bytes(FIXTURES[0][1])
        self.page = FIXTURES[0][2]
        _, _, self.original_total = append._current_page(self.source, self.page)
        self.original_objects = [body for _, _, body in reader._objects(self.original_total, 0)]

    def test_reappend_of_native_last_digest_preserves_prefix_and_exact_objects(self) -> None:
        self.assertTrue(self.original_objects)
        self.assertTrue(any(
            ref.page == self.page and ref.object_index == len(self.original_objects) - 1
            for ref in reader.inspect(self.source)
        ))

        stripped_total = make_total_path(self.original_objects[:-1])
        stripped = append._append_revision(self.source, self.page, stripped_total)
        restored = append.append_exact_last_object(stripped, self.source, self.page)

        self.assertTrue(restored.startswith(stripped))
        self.assertEqual(append._current_page(restored, self.page)[2], self.original_total)
        refs = reader.inspect(restored)
        self.assertEqual(len(refs), 1)
        self.assertEqual((refs[0].page, refs[0].object_index), (self.page, len(self.original_objects) - 1))

    def test_changed_page_id_is_rejected(self) -> None:
        added_total = make_total_path(self.original_objects + [self.original_objects[-1]])
        native_after = bytearray(append._append_revision(self.source, self.page, added_total))
        page_id_offset, page_id_length = page_id_span(native_after, self.page)
        native_after[page_id_offset + page_id_length - 1] = (
            ord("A") if native_after[page_id_offset + page_id_length - 1] != ord("A") else ord("B")
        )

        with self.assertRaisesRegex(ValueError, "PAGEID changed"):
            append.append_exact_last_object(self.source, bytes(native_after), self.page)

    def test_changed_file_id_is_rejected(self) -> None:
        added_total = make_total_path(self.original_objects + [self.original_objects[-1]])
        native_after = bytearray(append._append_revision(self.source, self.page, added_total))
        file_id_offset, file_id_length = file_id_span(native_after)
        native_after[file_id_offset + file_id_length - 1] = (
            ord("A") if native_after[file_id_offset + file_id_length - 1] != ord("A") else ord("B")
        )

        with self.assertRaisesRegex(ValueError, "FILE_ID"):
            append.append_exact_last_object(self.source, bytes(native_after), self.page)

    def test_changed_predecessor_is_rejected_even_when_a_digest_was_appended(self) -> None:
        changed_objects = list(self.original_objects)
        changed_first = bytearray(changed_objects[0])
        changed_first[0] ^= 1
        changed_objects[0] = bytes(changed_first)
        native_after = append._append_revision(
            self.source, self.page, make_total_path(changed_objects + [self.original_objects[-1]])
        )

        with self.assertRaisesRegex(ValueError, "unchanged predecessors"):
            append.append_exact_last_object(self.source, native_after, self.page)

    def test_non_digest_last_object_is_rejected(self) -> None:
        text_box = next(
            body for body in self.original_objects
            if len(body) >= 12 and struct.unpack_from("<I", body, 8)[0] == 200
        )
        native_after = append._append_revision(
            self.source, self.page, make_total_path(self.original_objects + [text_box])
        )

        with self.assertRaisesRegex(ValueError, "not type 100"):
            append.append_exact_last_object(self.source, native_after, self.page)


if __name__ == "__main__":
    unittest.main()
