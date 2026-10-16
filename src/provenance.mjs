/** Readable provenance is optional for historical results; never invent dates. */
export function validRecognition(value) {
  return !!value && ["api", "subscription"].includes(value.provider) &&
    typeof value.model === "string" && !!value.model.trim() && value.model.length <= 200 &&
    !/[\u0000-\u001f]/.test(value.model) && ["fast", "balanced", "careful"].includes(value.quality) &&
    typeof value.recognizedAt === "string" && Number.isFinite(Date.parse(value.recognizedAt)) &&
    [value.promptHash, value.glossaryHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x));
}
export function recognitionFields(value) {
  if (!validRecognition(value)) throw Error("Invalid page recognition metadata.");
  const { provider, model, quality, recognizedAt, promptHash, glossaryHash } = value;
  return { provider, model, quality, recognizedAt, promptHash, glossaryHash };
}
/** Provisional OCR never enters the successful AI cache or pending-page decisions. */
export function pageTextLayer(notebook, page) {
  const ai = notebook.pages[page.id], ocr = notebook.deviceOcr?.[page.id];
  if (ai?.fingerprint === page.fingerprint) return { text: ai.text, provisional: false, stale: false };
  if (ocr?.fingerprint === page.fingerprint && ocr.text?.trim()) return { text: ocr.text, provisional: true, stale: false };
  if (ai?.text) return { text: ai.text, provisional: false, stale: true };
  return { text: "", provisional: false, stale: false };
}
export function displayedPageText(notebook, page) {
  const layer = pageTextLayer(notebook, page), cleaned = notebook.cleanedPages?.[page.id];
  if (!layer.stale && cleaned?.fingerprint === page.fingerprint && cleaned.baseText === layer.text)
    return { ...layer, text: cleaned.text, cleaned: true };
  return { ...layer, cleaned: false };
}
