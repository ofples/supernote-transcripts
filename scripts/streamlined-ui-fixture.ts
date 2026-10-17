import type { Plugin } from "obsidian";
import { installUI } from "../src/ui";
import { DEFAULT_COST_SETTINGS } from "../src/cost";

declare const FIXTURE_PLATFORM: "desktop" | "nomad";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const makeState = (source: string, ruleId: string, total: number, ready: number, status: string, paused = false, issue = false) => {
  const desired = Array.from({ length: total }, (_, index) => ({ id: `page-${index + 1}`, number: index + 1, fingerprint: `fixture-${source}-${index + 1}` }));
  const pages = Object.fromEntries(desired.slice(0, ready).map((page) => [page.id, { fingerprint: page.fingerprint, text: `Synthetic transcript for page ${page.number}.`, recipe: "fixture", number: page.number }]));
  return {
    id: `state-${source}`, source, ruleId, output: `Fixture Output/${source.split("/").at(-1)?.replace(/\.note$/i, "")}.md`, revision: "fixture-revision", order: desired.map((page) => page.id), desired, pages, status, paused,
    ...(issue ? { pageIssues: { [desired.at(-1)!.id]: { fingerprint: desired.at(-1)!.fingerprint, number: desired.at(-1)!.number, status: "failed", kind: "incomplete", reason: "The synthetic response stopped before the page finished.", attempts: 1, updatedAt: "2026-10-15T00:00:00.000Z" } } } : {}),
  };
};

export default class StreamlinedUIFixture {
  async onload() {
    const root = FIXTURE_PLATFORM === "desktop" ? "C:/UX Fixture/Notes" : "/storage/emulated/0/Note/UX Fixture/Notes";
    const journal = `${root}/Journal`;
    const research = `${root}/Research`;
    const paths = {
      working: `${journal}/Reflection.note`,
      waitingA: `${journal}/Weekly.note`,
      waitingB: `${research}/Reflection.note`,
      paused: `${research}/Paused.note`,
      attention: `${research}/Failed.note`,
    };
    const general = { id: "general", name: "General", model: "gpt-6.1-sol", endpoint: "https://api.openai.com/v1/responses", prompt: "General fixture instructions.", glossaries: [] as string[], quality: "balanced" as const };
    const researchProfile = { id: "research-profile", name: "Research", model: "gpt-5.6-sol", endpoint: "https://api.openai.com/v1/responses", prompt: "Research fixture instructions.", glossaries: ["Reference/Fixture glossary.md"], quality: "fast" as const };
    const config: any = {
      version: 1,
      profiles: [general, researchProfile],
      rules: [
        { id: "journal-source", enabled: true, source: journal, output: "Fixture Output/Journal", recursive: true, exclude: [], profileId: general.id },
        { id: "research-source", enabled: true, source: research, output: "Fixture Output/Research", recursive: true, exclude: [], profileId: researchProfile.id },
      ],
      intervalMinutes: 5, batchPages: 1, continuous: false,
    };
    const states: any = {
      [paths.working]: makeState(paths.working, "journal-source", 6, 2, "queued"),
      [paths.waitingA]: makeState(paths.waitingA, "journal-source", 5, 1, "queued"),
      [paths.waitingB]: makeState(paths.waitingB, "research-source", 4, 0, "queued"),
      [paths.paused]: makeState(paths.paused, "research-source", 3, 1, "queued", true),
      [paths.attention]: makeState(paths.attention, "research-source", 3, 1, "partial", false, true),
    };
    const store: any = {
      version: 1, notebooks: states, history: [],
      queue: [
        { source: paths.waitingA, force: false, priority: 1 },
        { source: paths.working, force: false, priority: 0 },
        { source: paths.waitingB, force: false, priority: 3 },
        { source: paths.paused, force: false, priority: 2 },
      ],
    };
    const settings: any = { ...DEFAULT_COST_SETTINGS, prices: [] };
    const totals = { spentUsd: 0.0182, heldUsd: 0.004, requests: 4, pages: 7 };
    const costs: any = {
      startedAt: "2026-10-15T00:00:00.000Z", settings,
      day: { ...totals }, month: { ...totals }, run: { ...totals }, total: { ...totals },
      notebooks: [], models: [], recent: [], unconfirmed: 1,
    };
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((listener) => listener());
    const counters: any = {
      saveConfig: 0, saveCostSettings: 0, update: 0, pause: 0, resume: 0,
      prioritize: [] as string[], sourcePause: [] as { id: string; paused: boolean }[],
      notebookPause: [] as { source: string; paused: boolean }[], retry: [] as string[],
      retryPage: [] as { source: string; pageId: string }[], skipPage: [] as { source: string; pageId: string }[],
      connectSubscription: 0, disconnectSubscription: 0, finishSubscriptionLogin: 0,
      cancelSubscriptionPairing: 0,
      startSubscriptionPairing: 0, stopSubscriptionPairing: 0,
      pairSubscriptionDesktop: [] as { address: string; code: string }[],
      discoverSubscriptionDesktops: 0,
    };
    const actionOrder = () => [...store.queue].sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0));
    const controller: any = {
      platform: FIXTURE_PLATFORM,
      provider: "api",
      concurrency: FIXTURE_PLATFORM === "desktop" ? 4 : 1,
      showPageHeadings: false,
      config, store, costs, progress: {
        stage: "Waiting for AI", detail: "Synthetic fixture is paused before generation.", checked: 5, total: 21, recognized: 0, reused: 7, pending: 14,
        running: true, paused: false, activeSource: paths.working,
        activePage: { source: paths.working, number: 3, total: 6 }, activePages: [3],
      },
      apiKey: "fixture-only-key", aiEnabled: false, autoEnabled: false,
      subscriptionStatus: { connected: true, status: "Synthetic fixture account" },
      subscriptionPairing: undefined as undefined | { code: string; addresses: string[]; status: string; expiresAt: number },
      discoveryResults: [] as { address: string }[],
      discoveryError: undefined as string | undefined,
      discoveryDeferred: false,
      discoveryResolve: undefined as undefined | ((value: { address: string }[]) => void),
      subscriptionUsage: {
        requests: 12, pages: 18, inputTokens: 3200, outputTokens: 1100, unconfirmed: 1,
        todayRequests: 3, dailyLimit: 30, day: "2026-10-15",
        bySource: [
          { source: "Reflection.note", model: "gpt-6.1-sol", requests: 5, pages: 8, inputTokens: 1800, outputTokens: 600 },
          { source: "Weekly.note", model: "gpt-5.6-sol", requests: 7, pages: 10, inputTokens: 1400, outputTokens: 500 },
        ],
      },
      subscriptionAccount: { tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh" }, config: copy(config) },
      actionCounters: counters,
      notify: emit,
      setProvider(provider: "api" | "subscription") { controller.provider = provider; emit(); },
      connectSubscription: async () => { counters.connectSubscription++; emit(); },
      disconnectSubscription: async () => { counters.disconnectSubscription++; emit(); },
      finishSubscriptionLogin: async () => { counters.finishSubscriptionLogin++; emit(); },
      cancelSubscriptionPairing: async () => {
        counters.cancelSubscriptionPairing++;
        controller.subscriptionStatus = { ...controller.subscriptionStatus, pairingPending: false, status: "Sign-in cancelled." };
        emit();
      },
      startSubscriptionPairing: async () => {
        counters.startSubscriptionPairing++;
        controller.subscriptionPairing = {
          code: "23456789ABCDEFGHJKLM",
          addresses: ["192.168.1.40:19457", "10.0.0.8:19457"],
          status: "Waiting for the Nomad to connect…",
          expiresAt: Date.now() + 600000,
        };
        emit();
      },
      stopSubscriptionPairing: async () => {
        counters.stopSubscriptionPairing++;
        controller.subscriptionPairing = undefined;
        emit();
      },
      pairSubscriptionDesktop: async (address: string, code: string) => {
        counters.pairSubscriptionDesktop.push({ address, code });
        emit();
      },
      discoverSubscriptionDesktops: async () => {
        counters.discoverSubscriptionDesktops++;
        if (controller.discoveryDeferred) return await new Promise<{ address: string }[]>((resolve) => { controller.discoveryResolve = resolve; });
        if (controller.discoveryError) throw new Error(controller.discoveryError);
        return copy(controller.discoveryResults);
      },
      resolveDiscovery(value: { address: string }[]) { controller.discoveryResolve?.(copy(value)); controller.discoveryResolve = undefined; },
      setSubscriptionStatus(status: any) { controller.subscriptionStatus = status; emit(); },
      get queueView() {
        const waiting = actionOrder().filter((task: any) => task.source !== paths.working && !controller.isPaused(task.source)).map((task: any) => task.source);
        const paused = actionOrder().filter((task: any) => task.source !== paths.working && controller.isPaused(task.source)).map((task: any) => task.source);
        return { working: controller.progress.running ? { source: paths.working, stage: "Waiting for AI", number: 3, total: 6 } : undefined, waiting, paused, attention: [paths.attention] };
      },
      isPaused(source: string) {
        const state = store.notebooks[source];
        const rule = config.rules.find((item: any) => item.id === state?.ruleId);
        return !!(state?.paused || rule?.paused);
      },
      queueEstimate(source?: string) {
        const state = source ? store.notebooks[source] : undefined;
        const pages = state ? Math.max(0, state.desired.length - Object.keys(state.pages).length) : 14;
        return controller.provider === "subscription"
          ? { pages, requests: Math.max(1, Math.ceil(pages / 3)), seconds: 240, samples: 8, provisional: false }
          : { pages, requests: Math.max(1, Math.ceil(pages / 2)), usd: 0.0127, reservationUsd: 0.019, samples: 8, provisional: false };
      },
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
      saveConfig: async () => { counters.saveConfig++; emit(); },
      saveCostSettings: async (next: any) => { counters.saveCostSettings++; costs.settings = copy(next); emit(); },
      resolveUnconfirmedCosts: async () => { costs.unconfirmed = 0; emit(); },
      listModels: async () => [
        { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
        { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
        { id: "gpt-6-luna", name: "GPT-6 Luna" },
      ],
      listSharedMirrors: async () => [{ id: "fixture-journal", name: "Fixture journal" }, { id: "fixture-research", name: "Fixture research" }],
      listNotebookChoices: async (rule: any) => Object.values(states).filter((state: any) => state.source.startsWith(`${rule.source}/`)).map((state: any) => ({ source: state.source, relative: state.source.slice(rule.source.length + 1), existingTranscripts: [] })),
      prioritizeNotebook: async (source: string) => {
        counters.prioritize.push(source);
        const max = Math.max(0, ...store.queue.map((task: any) => task.priority ?? 0));
        const task = store.queue.find((item: any) => item.source === source);
        if (task) task.priority = max + 1;
        emit();
      },
      setSourcePaused: async (id: string, paused: boolean) => {
        counters.sourcePause.push({ id, paused });
        const rule = config.rules.find((item: any) => item.id === id);
        if (rule) rule.paused = paused;
        emit();
      },
      setNotebookPaused: async (source: string, paused: boolean) => {
        counters.notebookPause.push({ source, paused });
        if (store.notebooks[source]) store.notebooks[source].paused = paused;
        emit();
      },
      excludeNotebook: async () => { throw new Error("Excluded in synthetic fixture."); },
      update: async () => { counters.update++; throw new Error("Synthetic fixture blocks all recognition."); },
      pause() { counters.pause++; controller.progress.paused = true; controller.progress.running = false; emit(); },
      resume: async () => { counters.resume++; controller.progress.paused = false; controller.progress.running = false; emit(); },
      retry: async () => { counters.retry.push("all"); emit(); },
      retryNotebook: async (source: string) => { counters.retry.push(source); emit(); },
      retryPage: async (source: string, pageId: string) => { counters.retryPage.push({ source, pageId }); delete store.notebooks[source]?.pageIssues?.[pageId]; store.notebooks[source].status = "queued"; emit(); },
      skipPage: async (source: string, pageId: string) => { counters.skipPage.push({ source, pageId }); const issue = store.notebooks[source]?.pageIssues?.[pageId]; if (issue) issue.status = "skipped"; emit(); },
      preview: async () => { throw new Error("Preview disabled in the synthetic fixture."); },
      manual: async () => { throw new Error("Recognition disabled in the synthetic fixture."); },
      openOutput: async () => { throw new Error("Vault access disabled in the synthetic fixture."); },
    };
    const mockFolders: Record<string, { folders: string[]; files: string[] }> = {
      "": { folders: ["Fixture Output", "Reference"], files: [] },
      "Fixture Output": { folders: ["Journal", "Research"], files: [] },
      "Reference": { folders: [], files: ["Reference/Fixture glossary.md"] },
    };
    const mockEntries = (path: string) => {
      const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
      const names: Record<string, Array<{ name: string; kind: "directory" | "file" }>> = {
        [root]: [{ name: "Journal", kind: "directory" }, { name: "Research", kind: "directory" }],
        [journal]: [{ name: "Reflection.note", kind: "file" }, { name: "Weekly.note", kind: "file" }],
        [research]: [{ name: "Reflection.note", kind: "file" }, { name: "Paused.note", kind: "file" }, { name: "Failed.note", kind: "file" }],
        [`${root}/Journal`]: [{ name: "Reflection.note", kind: "file" }, { name: "Weekly.note", kind: "file" }],
        [`${root}/Research`]: [{ name: "Reflection.note", kind: "file" }, { name: "Paused.note", kind: "file" }, { name: "Failed.note", kind: "file" }],
      };
      return (names[normalized] ?? []).map((item) => ({ name: item.name, isDirectory: () => item.kind === "directory", isFile: () => item.kind === "file" }));
    };
    const adapter: any = {
      basePath: FIXTURE_PLATFORM === "desktop" ? "C:/UX Fixture Vault" : root,
      async list(path: string) { return copy(mockFolders[path.replace(/^\//, "")] ?? { folders: [], files: [] }); },
      fs: { async readdir(path: string) { return mockEntries(path); }, async stat(path: string) { return { type: path.toLowerCase().endsWith(".note") ? "file" : "directory" }; } },
    };
    const app: any = {
      vault: {
        adapter,
        getName: () => "Streamlined UI Fixture",
        getAbstractFileByPath(path: string) {
          const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
          return Object.prototype.hasOwnProperty.call(mockFolders, normalized) ? { path: normalized, type: "folder" } : null;
        },
        async createFolder(path: string) {
          const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
          if (!normalized || Object.prototype.hasOwnProperty.call(mockFolders, normalized)) throw new Error("A file or folder with that name already exists here.");
          const slash = normalized.lastIndexOf("/"), parent = slash < 0 ? "" : normalized.slice(0, slash), name = normalized.slice(slash + 1);
          const parentEntry = mockFolders[parent];
          if (!parentEntry) throw new Error("Parent folder is unavailable in the synthetic fixture.");
          parentEntry.folders.push(name);
          mockFolders[normalized] = { folders: [], files: [] };
        },
      },
      commands: { executeCommandById: () => false },
    };
    const commands = new Map<string, { callback: () => void }>();
    const registered: Array<() => void> = [];
    const plugin: any = {
      app,
      register(disposer: () => void) { registered.push(disposer); },
      addSettingTab() {},
      addCommand(command: any) { commands.set(command.id, command); },
      addRibbonIcon() {},
    };
    (window as any).__bootStreamlinedFixture = async () => {
      installUI(plugin as Plugin, controller);
      commands.get("open")?.callback();
      (window as any).__streamlinedFixture = { controller, commands, paths, registered, platform: FIXTURE_PLATFORM, app };
      return (window as any).__streamlinedFixture;
    };
    (window as any).__streamlinedFixtureNotices = [];
  }
}




