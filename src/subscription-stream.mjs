import { EMPTY_PAGE_TEXT } from "./prompts.mjs";

/** A page response failure is distinct from an execution/account stop. */
export class RecognitionFailure extends Error {
  /** @param {string} kind @param {string} reason
   * @param {{usage?:any,response?:any,outcomeKnown?:boolean,scope?:string,code?:string}} options */
  constructor(kind, reason, options = {}) {
    super(reason); this.name = "RecognitionFailure"; this.kind = kind;
    this.usage = options.usage; this.response = options.response;
    this.outcomeKnown = options.outcomeKnown === true;
    this.scope = options.scope ?? "page"; this.fatal = this.scope !== "page";
    this.code = options.code;
  }
}
/** @param {any} error @returns {error is RecognitionFailure} */
export const isRecognitionFailure = error => error?.name === "RecognitionFailure" && typeof error.kind === "string" && typeof error.scope === "string";
export const isEmptyPage = text => typeof text === "string" && text.trim() === EMPTY_PAGE_TEXT;
export function normalizePageText(text) {
  if (typeof text !== "string" || !text.trim()) throw new RecognitionFailure("empty_response", "The completed response had no transcription text. Retry this page or skip it; an empty response is not proof of a blank page.");
  return text.trim();
}
const codeOf = value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
export function providerFailure(status, data) {
  const code = codeOf(data?.error?.code ?? data?.code);
  const detail = code ? ` (${code})` : "";
  const options = { code, response: data, usage: data?.usage, outcomeKnown: true };
  if (/invalid_model|model_not_found|model_not_available|model_not_supported|unsupported_model/.test(code))
    return new RecognitionFailure("provider", `The selected model is unavailable${detail}. Choose a supported model and retry this notebook.`, { ...options, scope: "source" });
  if (/rate_limit|quota|usage_limit|billing_hard_limit|insufficient_credit/.test(code) || status === 429 || status === 402)
    return new RecognitionFailure("provider", `The provider's rate or account usage limit stopped recognition${detail}. Wait or check your account before continuing.`, { ...options, scope: "batch" });
  if (status === 401 || status === 403 || /invalid_api_key|authentication|account_deactivated|token_expired/.test(code))
    return new RecognitionFailure("provider", `The provider did not authorize recognition${detail}. Reconnect or check your credentials.`, { ...options, scope: "batch" });
  if (/content_policy|content_filter/.test(code))
    return new RecognitionFailure("refusal", `The provider declined this page${detail}. Review its instructions, retry it explicitly, or skip it.`, options);
  if (/invalid_image|image_parse|unsupported_image/.test(code))
    return new RecognitionFailure("render", `The provider rejected this page image${detail}. Retry it explicitly or skip it.`, options);
  if (status === 400 || status === 404 || status === 422)
    return new RecognitionFailure("provider", `The provider rejected this notebook's request configuration (HTTP ${status})${detail}. Check its model and endpoint before retrying.`, { ...options, scope: "source" });
  return new RecognitionFailure("provider", `The provider could not complete this page${status ? ` (HTTP ${status})` : ""}${detail}. Retry it explicitly or skip it.`, options);
}
function terminalFailure(response, fallback) {
  if (response?.status === "incomplete" || fallback === "incomplete") {
    const reason = codeOf(response?.incomplete_details?.reason ?? "unknown_reason");
    return new RecognitionFailure("incomplete", `The response did not finish (${reason}). Partial text was not saved; retry this page explicitly or skip it.`,
      { response, usage: response?.usage, outcomeKnown: true, code: reason });
  }
  return providerFailure(undefined, response);
}
export function completedResponse(response, streamedText = "", streamRefusal = false) {
  if (response?.status === "incomplete" || response?.status === "failed") throw terminalFailure(response, response.status);
  if (response?.status !== "completed") throw new RecognitionFailure("missing_terminal", "The response did not confirm completion. No text was saved; retry this page explicitly or skip it.");
  const content = (Array.isArray(response.output) ? response.output : []).flatMap(o => Array.isArray(o?.content) ? o.content : []);
  if (streamRefusal || content.some(c => c?.type === "refusal"))
    throw new RecognitionFailure("refusal", "The model declined to transcribe this page. Review its instructions, retry it explicitly, or skip it.", { response, usage: response.usage, outcomeKnown: true });
  const canonical = content.filter(c => c?.type === "output_text" && typeof c.text === "string").map(c => c.text).join("\n");
  try { return { text: normalizePageText(canonical || streamedText), usage: response.usage, ...(typeof response.model === "string" && response.model.length <= 200 ? {model:response.model} : {}) }; }
  catch (error) { throw new RecognitionFailure("empty_response", error.message, { response, usage: response.usage, outcomeKnown: true }); }
}
export function catalogModels(catalog) {
  const rows = Array.isArray(catalog?.models) ? catalog.models : Array.isArray(catalog?.data) ? catalog.data : [];
  return rows.filter(m => m && (!m.visibility || m.visibility === "list")).map(m => ({ slug: m.slug ?? m.id, name: m.display_name ?? m.id ?? m.slug })).filter(m => typeof m.slug === "string" && m.slug && typeof m.name === "string");
}
export function completedText(body) {
  if (typeof body !== "string") throw new RecognitionFailure("missing_terminal", "Subscription stream did not complete with text. Retry this page explicitly or skip it.");
  let text = "", terminal, refused = false;
  for (const block of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    let event;
    try { event = JSON.parse(data); }
    catch { throw new RecognitionFailure("transport", "The subscription stream contained invalid data. Retry this page explicitly or skip it."); }
    if (!event || typeof event !== "object") throw new RecognitionFailure("transport", "Invalid subscription stream event.");
    if (event.type === "response.incomplete") throw terminalFailure(event.response, "incomplete");
    if (event.type === "response.failed" || event.type === "error") throw providerFailure(undefined, event.response ?? event);
    if (terminal) {
      if (event.type === "response.completed") throw new RecognitionFailure("transport", "Ambiguous subscription completion. Retry this page explicitly or skip it.");
      continue;
    }
    if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") refused = true;
    if (event.type === "response.output_text.delta") {
      if (typeof event.delta !== "string") throw new RecognitionFailure("transport", "Invalid subscription text delta.");
      text += event.delta;
    }
    if (event.type === "response.completed") terminal = event.response;
  }
  if (!terminal) throw new RecognitionFailure("missing_terminal", "Subscription stream did not confirm completion. No text was saved; retry this page explicitly or skip it.");
  return completedResponse(terminal, text, refused);
}
