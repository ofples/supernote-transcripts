export class Plugin {
  constructor(app) {
    this.app = app;
    this.manifest = { id: "nomad-transcripts", name: "Supernote Transcripts" };
  }
  async loadData() {
    return this.app.data ?? null;
  }
  async saveData(data) {
    this.app.data = data;
  }
  registerDomEvent() {}
  registerInterval() {}
  register() {}
  registerObsidianProtocolHandler(action, callback) {
    this.protocolHandlers ??= new Map();
    this.protocolHandlers.set(action, callback);
  }
  addCommand() {}
  addRibbonIcon() {}
  addSettingTab() {}
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
}
export class MarkdownRenderChild {}
export class TFile {}
export const MarkdownRenderer = { render: async () => {} };
export const editorInfoField = undefined;
export const editorLivePreviewField = undefined;
export const Platform = { get isAndroidApp(){return globalThis.__desktop!==true;} };
export class Notice {}
export async function requestUrl(request) {
  if (request.url.endsWith("/input_tokens"))
    return globalThis.__tokenCount
      ? globalThis.__tokenCount(request)
      : {
          status: 200,
          json: { object: "response.input_tokens", input_tokens: 100 },
        };
  const result = await globalThis.__response(request);
  if (
    !globalThis.__omitUsage &&
    result.status < 400 &&
    result.json &&
    !result.json.usage
  )
    result.json.usage = {
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 110,
    };
  return result;
}
