import test from "node:test";
import assert from "node:assert/strict";
import { extractDeviceOcr, MAX_RECOGNITION_BLOCK_BYTES } from "../src/reader-support/device-ocr.mjs";

const recognition = {
  elements: [{
    label: "Hello world",
    type: "Text",
    words: [
      { label: "Hello", "bounding-box": { x: 10, y: 10, width: 40, height: 12 } },
      { label: "world", "bounding-box": { x: 55, y: 10, width: 35, height: 12 } },
    ],
  }],
};
const encoded = (value) => new TextEncoder().encode(btoa(JSON.stringify(value)));

test("extracts device recognition from the pinned base64 JSON block format", () => {
  assert.equal(extractDeviceOcr(encoded(recognition)), "Hello world");
});

test("unsupported, missing, malformed and out-of-shape recognition returns undefined", () => {
  assert.equal(extractDeviceOcr(undefined), undefined);
  assert.equal(extractDeviceOcr(new Uint8Array()), undefined);
  assert.equal(extractDeviceOcr(new TextEncoder().encode("not-base64")), undefined);
  assert.equal(extractDeviceOcr(encoded({ elements: "wrong shape" })), undefined);
  assert.equal(extractDeviceOcr(encoded({ elements: [{ type: "Text", label: "x", words: [] }] })), undefined);
});

test("recognition decoding rejects raw and decoded payloads beyond their caps", () => {
  assert.equal(extractDeviceOcr(new Uint8Array(MAX_RECOGNITION_BLOCK_BYTES + 1)), undefined);
  assert.equal(extractDeviceOcr(encoded({ elements: [{ type: "Text", label: "x".repeat(800_000), words: [{ label: "x", "bounding-box": { x: 0, y: 0, width: 1, height: 1 } }] }] })), undefined);
});
