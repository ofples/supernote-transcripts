import { extractParagraphs } from "supernote-typescript";

// supernote-typescript@0.7.1 reads RECOGNTEXT as a length-prefixed block
// whose content is UTF-8 base64 JSON: { elements: IRecognitionElement[] }.
// Keep limits well below StreamingFile's general per-block ceiling.
export const MAX_RECOGNITION_BLOCK_BYTES = 1024 * 1024;
const MAX_RECOGNITION_JSON_BYTES = 768 * 1024;
const MAX_RECOGNITION_ELEMENTS = 5000;
const MAX_RECOGNITION_WORDS = 20000;
const MAX_RECOGNIZED_TEXT_CHARS = 24 * 1024;

export function extractDeviceOcr(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_RECOGNITION_BLOCK_BYTES) return undefined;
    const encoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!encoded || encoded.length > Math.ceil(MAX_RECOGNITION_JSON_BYTES * 4 / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return undefined;
    const binary = atob(encoded);
    if (binary.length === 0 || binary.length > MAX_RECOGNITION_JSON_BYTES) return undefined;
    const jsonBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.elements) || parsed.elements.length > MAX_RECOGNITION_ELEMENTS) return undefined;
    let wordCount = 0;
    for (const element of parsed.elements) {
      if (!element || typeof element !== "object" || Array.isArray(element) || typeof element.type !== "string" || typeof element.label !== "string" || !Array.isArray(element.words)) return undefined;
      wordCount += element.words.length;
      if (wordCount > MAX_RECOGNITION_WORDS || element.words.some((word) => !word || typeof word.label !== "string")) return undefined;
    }
    const text = extractParagraphs(parsed.elements);
    if (typeof text !== "string" || !text.trim() || text.length > MAX_RECOGNIZED_TEXT_CHARS) return undefined;
    return text;
  } catch {
    return undefined;
  }
}
