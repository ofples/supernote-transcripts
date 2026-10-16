import { Plugin, Notice } from "obsidian";
import { installUI } from "../src/ui";
import { CostBook } from "../src/cost";
import Runtime from "../src/runtime";
import { AndroidReadOnlySource } from "../src/reader";
import { excluded, ruleFor, relativeToRule } from "../src/reconcile.mjs";
// Device UI harness: copies state into memory. It never runs the real worker,
// saves vault files, stores a key or calls an AI provider.
export default class UIFixture extends Plugin {
  async onload() {
    const real = (this.app as any).plugins.plugins["nomad-transcripts"];
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((fn) => fn());
    const storage = new Map<string, string>();
    const book = new CostBook(
      {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
      "isolated-costs",
    );
    book.beginRun();
    const c: any = {
      config: JSON.parse(JSON.stringify(real.config)),
      store: JSON.parse(JSON.stringify(real.store)),
      progress: {
        stage: "Ready",
        detail: "",
        checked: 1,
        total: 1,
        recognized: 0,
        reused: 0,
        pending: 1,
        running: false,
        paused: false,
      },
      platform: "nomad",
      provider: "api",
      concurrency: 1,
      subscriptionStatus: {connected:false,status:"Isolated preview",email:undefined},
      subscriptionUsage: {requests:0,pages:0,inputTokens:0,outputTokens:0,unconfirmed:0,todayRequests:0,dailyLimit:30,day:"2026-10-14"},
      pageIssueActions: [] as Array<{action:string;source:string;pageId:string}>,
      showPageHeadings: real.showPageHeadings,
      listSharedMirrors: async () => c.config.rules.map((r:any)=>({id:r.sharedId??r.id,name:r.source.replace(/\\/g,"/").split("/").pop()})),
      listModels: async () => [{id:"gpt-6.1-sol",name:"GPT 6.1 Sol"},{id:"gpt-5.6-sol",name:"GPT 5.6 Sol"}],
      accountActionCalls: {connect:0,finish:0,disconnect:0},
      connectSubscription: function() {
        if (this !== c) throw Error("Account action lost controller context");
        this.accountActionCalls.connect++;
        return Promise.resolve();
      },
      finishSubscriptionLogin: function() {
        if (this !== c) throw Error("Account action lost controller context");
        this.accountActionCalls.finish++;
        this.subscriptionStatus = {connected:true,status:"Isolated connected session"};
        return Promise.resolve();
      },
      disconnectSubscription: function() {
        if (this !== c) throw Error("Account action lost controller context");
        this.accountActionCalls.disconnect++;
        this.subscriptionStatus = {connected:false,status:"Isolated disconnected session"};
        return Promise.resolve();
      },
      queueEstimate: (source?:string) => ({pages:36,requests:36,usd:0.09,reservationUsd:0.01,samples:20,provisional:false,seconds:90}),
      apiKey: "",
      autoEnabled: false,
      aiEnabled: false,
      app: this.app,
      sourceSelected: (source: string) => {
        const rule = ruleFor(source, c.config.rules);
        return !!rule && !excluded(source, rule.source, rule.exclude);
      },
      sourcePaused: (source: string) => {
        const rule = ruleFor(source, c.config.rules);
        return (
          !c.sourceSelected(source) ||
          rule?.paused ||
          c.store.notebooks[source]?.paused
        );
      },
      get queueView() {
        return Object.getOwnPropertyDescriptor(
          Runtime.prototype,
          "queueView",
        )!.get!.call(c);
      },
      listNotebookChoices: async (rule: any, findExisting = false) =>
        Runtime.prototype.listNotebookChoices.call(
          {
            app: this.app,
            reader: () =>
              new AndroidReadOnlySource((this.app.vault.adapter as any).fs),
          } as any,
          rule,
          findExisting,
        ),
      prioritizeNotebook: async (source: string) => {
        const task = c.store.queue.find((t: any) => t.source === source);
        if (task)
          task.priority =
            Math.max(0, ...c.store.queue.map((t: any) => t.priority ?? 0)) + 1;
        emit();
      },
      excludeNotebook: async (source: string) => {
        const rule = ruleFor(source, c.config.rules);
        if (rule) {
          rule.exclude.push(relativeToRule(source, rule));
          c.store.notebooks[source].status = "excluded";
          c.store.queue = c.store.queue.filter((t: any) => t.source !== source);
        }
        emit();
      },
      get costs() {
        return book.snapshot();
      },
      saveCostSettings: async (settings: any) => {
        book.saveSettings(settings);
        emit();
      },
      resolveUnconfirmedCosts: async () => {
        book.resolveUnconfirmed();
        emit();
      },
      setSourcePaused: async (id: string, paused: boolean) => {
        c.config.rules.find((r: any) => r.id === id).paused = paused;
        emit();
      },
      setNotebookPaused: async (source: string, paused: boolean) => {
        c.store.notebooks[source].paused = paused;
        emit();
      },
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      saveConfig: async () => emit(),
      update: async () => {
        c.progress.running = true;
        emit();
        c.progress.running = false;
        emit();
      },
      pause: () => {
        c.progress.paused = true;
        emit();
      },
      resume: async () => {
        c.progress.paused = false;
        emit();
      },
      retry: async () => emit(),
      retryPage: async (source: string, pageId: string) => {
        c.pageIssueActions.push({action:"retry",source,pageId});
        const state = c.store.notebooks[source];
        if (state?.pageIssues?.[pageId]) delete state.pageIssues[pageId];
        emit();
      },
      skipPage: async (source: string, pageId: string) => {
        c.pageIssueActions.push({action:"skip",source,pageId});
        const issue = c.store.notebooks[source]?.pageIssues?.[pageId];
        if (issue) issue.status = "skipped";
        emit();
      },
      manual: async () => new Notice("Isolated UI test: no AI request"),
      preview: async () => {
        throw Error("Preview disabled in this isolated UI test");
      },
      openedOutputs: [] as string[],
      openOutput: async (path: string) => {
        c.openedOutputs.push(path);
        new Notice("Isolated UI test: no note opened");
      },
    };
    const recoverySource = "/storage/emulated/0/Note/UI Fixture/Edited.note";
    const recoveryRuleId = "ui-recovery-fixture";
    const recoveryCurrent = [
      "---",
      "nomad_transcripts: true",
      "---",
      "",
      "# Edited fixture transcript",
      "",
      "A user correction that must be preserved or explicitly backed up.",
    ].join("\n");
    const recoveryGenerated = [
      "---",
      "nomad_transcripts: true",
      "---",
      "",
      "# Saved recognition",
      "",
      "Page 1 saved text: Cached fixture text.",
      "",
      "Page 2: No saved recognition yet.",
    ].join("\n");
    const recoveryState: any = {
      id: "ui-recovery-fixture",
      source: recoverySource,
      ruleId: recoveryRuleId,
      output: "Supernote Transcripts/UI Fixture/Edited.md",
      revision: "fixture-revision",
      order: ["1", "2"],
      desired: [
        { id: "1", number: 1, fingerprint: "fixture-fingerprint-1" },
        { id: "2", number: 2, fingerprint: "fixture-fingerprint-2" },
      ],
      pages: {
        "1": {
          fingerprint: "fixture-fingerprint-1",
          text: "Cached fixture text.",
          recipe: "",
          number: 1,
        },
      },
      status: "conflict",
      pageIssues: {
        "2": {
          fingerprint: "fixture-fingerprint-2",
          number: 2,
          status: "failed",
          kind: "incomplete",
          reason: "The response did not finish. Retry when ready, or skip this page.",
          attempts: 1,
          updatedAt: "2026-10-14T00:00:00.000Z",
        },
      },
      error: "Generated transcript was manually edited. Preserve those changes before retrying.",
      forcePending: [],
      priorityPages: [],
    };
    c.config.rules.push({
      id: recoveryRuleId,
      enabled: true,
      source: recoverySource,
      output: "Supernote Transcripts/UI Fixture",
      recursive: false,
      exclude: [],
      profileId: c.config.profiles[0]?.id ?? "ui-fixture-profile",
    });
    c.store.notebooks[recoverySource] = recoveryState;
    c.recoveryFixture = {
      source: recoverySource,
      current: recoveryCurrent,
      generated: recoveryGenerated,
      revision: "fixture-revision-1",
      previewCalls: 0,
      actions: [] as Array<{ action: string; expectedCurrent: string; expectedRevision?: string }>,
    };
    c.previewTranscriptRecovery = async (source: string) => {
      if (source !== recoverySource) throw Error("Unknown isolated recovery fixture.");
      c.recoveryFixture.previewCalls++;
      return {
        current: c.recoveryFixture.current,
        generated: c.recoveryFixture.generated,
        output: recoveryState.output,
        revision: c.recoveryFixture.revision,
      };
    };
    c.resolveTranscriptConflict = async (
      source: string,
      action: "replace" | "keep",
      expectedCurrent: string,
      expectedRevision?: string,
    ) => {
      if (source !== recoverySource) throw Error("Unknown isolated recovery fixture.");
      c.recoveryFixture.actions.push({ action, expectedCurrent, expectedRevision });
      if (expectedCurrent !== c.recoveryFixture.current)
        throw Error("Transcript changed since preview. Reload comparison before recovering.");
      if (expectedRevision !== undefined && expectedRevision !== c.recoveryFixture.revision)
        throw Error("Source changed since preview. Reload comparison before recovering.");
      if (action === "replace") {
        c.recoveryFixture.current = c.recoveryFixture.generated;
        recoveryState.status = "current";
        delete recoveryState.error;
        emit();
        return {
          backup: `${recoveryState.output}.backup-fixture`,
          output: recoveryState.output,
        };
      }
      const output = "Supernote Transcripts/UI Fixture/Edited (new mirror).md";
      recoveryState.output = output;
      recoveryState.status = "current";
      delete recoveryState.error;
      emit();
      return { output };
    };
    (window as any).__transcriptUIFixture = c;
    (window as any).__transcriptCostFixture = book;
    this.register(() => {
      delete (window as any).__transcriptUIFixture;
      delete (window as any).__transcriptCostFixture;
    });
    installUI(this, c);
  }
}
