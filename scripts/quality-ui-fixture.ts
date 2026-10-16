import { Plugin, Notice } from "obsidian";
import { installUI } from "../src/ui";
import { DEFAULT_COST_SETTINGS } from "../src/cost";

/** Isolated desktop UI fixture. It has no reader, network client, or vault writer. */
export default class QualityUIFixture extends Plugin {
  async onload() {
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((fn) => fn());
    const general = {
      id: "general", name: "General", model: "gpt-6.1-sol",
      endpoint: "https://api.openai.com/v1/responses",
      prompt: "Fixture instructions", glossaries: [], quality: "balanced" as const,
    };
    const custom = {
      ...general, id: "fixture-careful", name: "Demo instructions", quality: "careful" as const,
    };
    const source = "C:/Quality UI Fixture/Demo.note";
    const config: any = {
      version: 1, profiles: [general, custom],
      rules: [{ id: "quality-source", enabled: true, source, output: "Fixture Output", recursive: false, exclude: [], profileId: custom.id }],
      intervalMinutes: 5, batchPages: 1,
    };
    const store: any = { version: 1, notebooks: {}, queue: [], history: [] };
    const settings: any = { ...DEFAULT_COST_SETTINGS, prices: [] };
    const totals = { spentUsd: 0, heldUsd: 0, requests: 0, pages: 0 };
    const costs: any = {
      startedAt: new Date().toISOString(), settings,
      day: { ...totals }, month: { ...totals }, run: { ...totals }, total: { ...totals },
      notebooks: [], models: [], recent: [], unconfirmed: 0,
    };
    const controller: any = {
      platform: "desktop", concurrency: 4, provider: "subscription",
      subscriptionStatus: { connected: false, status: "Isolated fixture" },
      subscriptionUsage: {
        requests: 5, pages: 7, inputTokens: 1250, outputTokens: 470, unconfirmed: 1,
        todayRequests: 2, dailyLimit: 30, day: "2026-10-14",
        bySource: [
          { source: "Demo.note", model: "gpt-6.1-sol", requests: 3, pages: 4, inputTokens: 800, outputTokens: 300 },
          { source: "Journal.note", model: "gpt-5.6-sol", requests: 2, pages: 3, inputTokens: 450, outputTokens: 170 },
        ],
      },
      showPageHeadings: false, queueView: { waiting: [], paused: [], attention: [] },
      queueEstimate: () => ({ pages: 0, requests: 0, samples: 0, provisional: true }),
      config, store, costs,
      progress: { stage: "Ready", detail: "Fixture is idle", checked: 0, total: 0, recognized: 0, reused: 0, pending: 0, running: false, paused: false },
      apiKey: "", autoEnabled: false, aiEnabled: false,
      saveCalls: 0,
      saveConfig: async () => { controller.saveCalls++; emit(); },
      subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
      listSharedMirrors: async () => [{ id: "quality-source", name: "Demo mirror" }],
      listModels: async () => [{ id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }],
      listNotebookChoices: async () => [],
      saveCostSettings: async (next: any) => { costs.settings = next; emit(); },
      resolveUnconfirmedCosts: async () => {},
      prioritizeNotebook: async () => {}, excludeNotebook: async () => {},
      setSourcePaused: async () => {}, setNotebookPaused: async () => {},
      update: async () => { throw new Error("Fixture blocks recognition"); },
      pause: () => {}, resume: async () => {}, retry: async () => {},
      retryPage: async () => {}, skipPage: async () => {}, retryNotebook: async () => {},
      connectSubscription: async () => new Notice("Fixture only"),
      finishSubscriptionLogin: async () => new Notice("Fixture only"),
      disconnectSubscription: async () => new Notice("Fixture only"),
      preview: async () => { throw new Error("Preview disabled in fixture"); },
      manual: async () => { throw new Error("Recognition disabled in fixture"); },
      openOutput: async () => {},
      previewTranscriptRecovery: async () => { throw new Error("Recovery disabled in fixture"); },
      resolveTranscriptConflict: async () => { throw new Error("Recovery disabled in fixture"); },
    };
    (window as any).__qualityUIFixture = controller;
    this.register(() => { delete (window as any).__qualityUIFixture; });
    installUI(this, controller);
  }
}
