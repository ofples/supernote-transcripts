import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  setIcon,
} from "obsidian";
import type { Controller, FolderRule, Profile, QueueEstimate, Store } from "./types";
import {
  browserBreadcrumbs,
  browserEntryType,
  initialBrowserPath,
  isBrowserRoot,
  joinBrowserPath,
  normalizeBrowserPath,
  parentBrowserPath,
} from "./browser.mjs";
import { availableModalHeight } from "./viewport.mjs";
import { mergeProfileDrafts } from "./profile-draft.mjs";
import {
  endpointKey,
  priceFor,
  recognitionOutputAllowance,
  STANDARD_PRICES,
  type CostSettings,
  type Price,
} from "./cost";
import {
  AsyncActionGate,
  canRecoverTranscriptEdits,
  currentPageIssues,
  notebookPresentation,
  overviewPresentation,
  rollbackConfigEntry,
  rulePresentation,
  selectedForRule,
} from "./presentation.mjs";
import {
  excluded,
  literalExclusion,
  ruleFor,
  validateDestination,
  validateSource,
} from "./reconcile.mjs";

const ROOT = "/storage/emulated/0/Note";
const MODEL_OPTIONS = [
  ...new Set(STANDARD_PRICES.map((price) => price.model)),
];
const shortPath = (path: string) =>
  path === ROOT
    ? "Note"
    : path.startsWith(`${ROOT}/`)
      ? path.slice(ROOT.length + 1)
      : path;
const base = (path: string) =>
  path.replace(/\/+$/, "").split("/").pop() || "Notebook";
const friendlyModel = (model: string) =>
  model
    .replace(/^gpt-/i, "GPT-")
    .replace(
      /-([a-z])/g,
      (_match, letter: string) => ` ${letter.toUpperCase()}`,
    );
const QUALITY = ["fast", "balanced", "careful"] as const;
const qualityLabel = (quality: string) => ({ fast: "Fast", balanced: "Balanced", careful: "Careful" }[quality] ?? "Fast");
const qualitySummary = (quality: string) => ({
  fast: "Fast · lower latency and cost",
  balanced: "Balanced · everyday accuracy",
  careful: "Careful · more context for difficult pages",
}[quality] ?? "Fast · lower latency and cost");
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const el = (p: HTMLElement, tag: string, text?: string, classes?: string) => {
  const n = p.createEl(tag as any, { text });
  if (classes) n.addClass(...classes.split(/\s+/).filter(Boolean));
  return n;
};
const btn = (
  p: HTMLElement,
  text: string,
  fn: () => void,
  classes = "st-button st-text-button",
) => {
  const b = el(p, "button", text, classes) as HTMLButtonElement;
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
};
const safe = (p: Promise<unknown>) => p.catch((e) => new Notice(err(e)));
const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
const iconButton = (
  parent: HTMLElement,
  icon: string,
  label: string,
  action: () => void,
  classes = "",
) => {
  const button = btn(parent, "", action, `st-icon-button ${classes}`);
  button.setAttribute("aria-label", label);
  button.title = label;
  setIcon(button, icon);
  const desktop = button.closest(".st-fullscreen-modal.st-desktop");
  if (desktop) {
    const visibleLabel = classes.includes("st-back") ? "Back"
      : classes.includes("st-cost-head") ? "Costs"
      : classes.includes("st-head-action") ? "Settings"
      : classes.includes("st-close") ? "Close"
      : classes.includes("st-edit") ? "Configure"
      : classes.includes("st-source-pause") ? (/^Resume/i.test(label) ? "Resume" : "Pause")
      : /Do next/i.test(label) ? "Do next"
      : /^Resume/i.test(label) ? "Resume"
      : /^Pause/i.test(label) ? "Pause"
      : "";
    if (visibleLabel) el(button, "span", visibleLabel, "st-icon-button-label");
  }
  return button;
};
const aiOn = (c: Controller) =>
  (c as Controller & { aiEnabled?: boolean }).aiEnabled !== false;
const progressBar = (
  parent: HTMLElement,
  view: { total: number; ratio: number },
  label: string,
  small = true,
) => {
  if (!view.total) return;
  const track = el(
    parent,
    "div",
    undefined,
    `st-progress${small ? " st-small" : ""}`,
  );
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(Math.round(view.ratio * 100)));
  track.setAttribute("aria-label", label);
  el(track, "div", undefined, "st-progress-fill").style.width =
    `${view.ratio * 100}%`;
};

export function installUI(plugin: Plugin, c: Controller) {
  let active: MirrorsModal | undefined;
  const open = () => {
    if (active?.modalEl.isConnected) return;
    active = new MirrorsModal(plugin.app, c);
    active.open();
  };
  plugin.register(() => active?.close());
  plugin.addSettingTab(new SettingsTab(plugin.app, plugin, open));
  plugin.addCommand({ id: "open", name: "Open mirrors", callback: open });
  plugin.addCommand({
    id: "update",
    name: "Update mirrors",
    callback: () => safe(c.update()),
  });
  plugin.addCommand({
    id: "pause",
    name: "Pause mirror updates",
    callback: () => c.pause(),
  });
  plugin.addCommand({
    id: "retry",
    name: "Retry failed mirrors",
    callback: () => safe(c.retry()),
  });
  plugin.addRibbonIcon("scan-text", "Supernote Transcripts", open);
}

class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private open: () => void,
  ) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    this.containerEl.addClass("st-settings");
    el(this.containerEl, "h2", "Supernote Transcripts");
    btn(this.containerEl, "Open Mirrors", this.open, "st-button st-primary");
  }
}

type Screen =
  | "home"
  | "queue"
  | "force-update"
  | "notebook-selection"
  | "settings"
  | "editor"
  | "browser"
  | "detail"
  | "recovery"
  | "glossaries"
  | "costs"
  | "output-folders";
class MirrorsModal extends Modal {
  private readonly actionGate = new AsyncActionGate();
  private configSaveQueue: Promise<void> = Promise.resolve();
  private pendingConfigSaves = 0;
  private formControlState?: Array<[HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, boolean]>;
  private off?: () => void;
  private screen: Screen = "home";
  private detailReturnScreen: "home" | "queue" = "home";
  private settingsReturnScreen: Screen = "home";
  private body!: HTMLElement;
  private footer!: HTMLElement;
  private heading!: HTMLElement;
  private back!: HTMLButtonElement;
  private headAction!: HTMLButtonElement;
  private summary?: HTMLElement;
  private rows?: HTMLElement;
  private expandedRules = new Set<string>();
  private detailLive?: HTMLElement;
  private pageIssuesLive?: HTMLElement;
  private notebookRetryQueued = new Set<string>();
  private updateButton?: HTMLButtonElement;
  private forceUpdateSource = "";
  private forceUpdateReturnScreen: Screen = "home";
  private forceUpdateRecognizeAll = false;
  private forceUpdateBusy = false;
  private forceUpdateEstimateElement?: HTMLElement;
  private costLive?: HTMLElement;
  private costDraft?: CostSettings;
  private costReturnScreen: "home" | "queue" | "settings" = "home";
  private outputPickerPath = "";
  private outputFolderSearch = "";
  private outputFolderName = "";
  private editorRule?: FolderRule;
  private editorProfile?: Profile;
  private editorBaseId = "";
  private editorUsesGeneral = true;
  private prompt = "";
  private glossaries: string[] = [];
  private modelDraft = "";
  private endpointDraft = "";
  private qualityDraft: "fast" | "balanced" | "careful" = "fast";
  private settingsDraft?: {
    apiKey: string;
    aiEnabled: boolean;
    autoEnabled: boolean;
    profiles: Profile[];
    intervalMinutes: number;
    provider: "api" | "subscription";
    concurrency: number;
    showPageHeadings: boolean;
    pairingAddress: string;
    pairingCode: string;
  };
  private settingsProfilesBaseline: Profile[] = [];
  private browserPath = ROOT;
  private browserRootPath = ROOT;
  private sourcePathDraft = "";
  private browserToken = 0;
  private browserError = "";
  private browserFrom: "add" | "edit" = "add";
  private glossaryBefore: string[] = [];
  private selectedSource = "";
  private selectedRule = "";
  private recoveryPreview?: {
    source: string;
    current: string;
    generated: string;
    output: string;
    revision: string;
  };
  private recoveryError = "";
  private recoveryBusy = false;
  private recoveryWaitingForIdle = false;
  private recoveryResult?: { action: "replace" | "keep"; backup?: string; output: string };
  private notebookChoices: {
    source: string;
    relative: string;
    existingTranscripts: string[];
  }[] = [];
  private notebookSelectionRule?: FolderRule;
  private transcriptSuggestions = new Set<string>();
  private showTranscriptSuggestions = false;
  private findExistingTranscripts = false;
  private selectionExcludeBefore: string[] = [];
  private notebookChoicesLoaded = false;
  private selectionToken = 0;
  private visualViewport?: VisualViewport;
  private viewportResize?: () => void;
  private keyboardObserver?: MutationObserver;
  private viewWindow?: Window;
  private keyboardHiddenHeight = 0;
  private range = "";
  private outdatedOnly = false;
  private cleanupBusySource = "";
  private cleanupSaveCopy = false;
  private get displayStore(): Store {
    return this.c.displayStore ?? this.c.store;
  }
  constructor(
    app: App,
    private c: Controller,
  ) {
    super(app);
    this.modalEl.addClass("st-fullscreen-modal");
    this.modalEl.querySelector(".modal-close-button")?.remove();
    this.modalEl.querySelector(":scope > .modal-header-button")?.remove();
  }
  onOpen() {
    const c = this.c as Controller & { platform?: "desktop" | "nomad" };
    this.modalEl.classList.toggle("st-desktop", c.platform === "desktop");
    const shell = el(this.contentEl, "div", undefined, "st-shell");
    const head = el(shell, "header", undefined, "st-header");
    this.back = iconButton(
      head,
      "arrow-left",
      "Back",
      () => this.goBack(),
      "st-back",
    );
    this.heading = el(head, "h1", "Mirrors");
    this.heading.id = `st-title-${crypto.randomUUID()}`;
    this.modalEl.setAttribute("aria-labelledby", this.heading.id);
    const costs = iconButton(
      head,
      "dollar-sign",
      "Costs",
      () => this.openCosts(),
      "st-cost-head",
    );
    costs.classList.add("st-cost-head");
    this.headAction = iconButton(
      head,
      "settings",
      "Settings",
      () => this.screen === "settings" ? this.goBack() : this.showSettings(),
      "st-head-action",
    );
    iconButton(head, "x", "Close mirrors", () => this.close(), "st-close");
    this.body = el(shell, "main", undefined, "st-body");
    this.footer = el(shell, "footer", undefined, "st-footer");
    this.render();
    this.off = this.c.subscribe(() => this.refreshLive());
    const viewWindow = this.modalEl.ownerDocument.defaultView ?? window;
    const viewDocument = this.modalEl.ownerDocument;
    this.viewWindow = viewWindow;
    this.visualViewport = viewWindow.visualViewport ?? undefined;
    this.keyboardHiddenHeight = viewWindow.innerHeight;
    this.viewportResize = () => {
      const viewport = Math.min(this.visualViewport?.height ?? viewWindow.innerHeight, viewWindow.innerHeight);
      const keyboard = c.platform === "nomad"
        ? Math.max(0, parseFloat(viewWindow.getComputedStyle(viewDocument.documentElement).getPropertyValue("--keyboard-height")) || 0)
        : 0;
      if (!keyboard) this.keyboardHiddenHeight = viewWindow.innerHeight;
      const height = availableModalHeight(viewport, this.keyboardHiddenHeight, keyboard);
      this.modalEl.style.setProperty("--st-visual-height", `${height}px`);
      if (keyboard) viewWindow.requestAnimationFrame(() => {
        const focused = viewDocument.activeElement;
        if (focused instanceof viewWindow.HTMLElement && this.body.contains(focused))
          focused.scrollIntoView({ block: "nearest" });
      });
    };
    this.viewportResize();
    this.visualViewport?.addEventListener("resize", this.viewportResize);
    viewWindow.addEventListener("resize", this.viewportResize);
    this.keyboardObserver = new viewWindow.MutationObserver(() => this.viewportResize?.());
    this.keyboardObserver.observe(viewDocument.documentElement, { attributes: true, attributeFilter: ["style"] });
  }
  onClose() {
    if (this.viewportResize) {
      this.visualViewport?.removeEventListener("resize", this.viewportResize);
      this.viewWindow?.removeEventListener("resize", this.viewportResize);
    }
    this.keyboardObserver?.disconnect();
    this.off?.();
    this.contentEl.empty();
  }
  close() {
    if (this.pendingConfigSaves) {
      new Notice("Wait for the configuration save to finish before closing.");
      return;
    }
    super.close();
  }
  private goHome() {
    if (this.pendingConfigSaves) return;
    this.screen = "home";
    this.render();
  }
  private async openOutputAndClose(path: string) {
    await this.c.openOutput(path);
    this.close();
  }
  private saveConfigQueued() {
    const save = () => this.c.saveConfig();
    const pending = this.configSaveQueue.then(save, save);
    this.pendingConfigSaves++;
    this.configSaveQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending.finally(() => this.pendingConfigSaves--);
  }
  private setFormControlsDisabled(disabled: boolean) {
    if (disabled) {
      if (this.formControlState) return;
      const controls = Array.from(
        this.modalEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          "button, input, textarea, select",
        ),
      );
      this.formControlState = controls.map((control) => [control, control.disabled]);
      for (const [control] of this.formControlState) control.disabled = true;
      return;
    }
    for (const [control, wasDisabled] of this.formControlState ?? [])
      if (control.isConnected) control.disabled = wasDisabled;
    this.formControlState = undefined;
  }
  private goBack() {
    if (this.pendingConfigSaves) return;
    if (this.screen === "costs") {
      this.costDraft = JSON.parse(JSON.stringify(this.c.costs.settings));
      this.screen = this.costReturnScreen;
    } else if (this.screen === "output-folders") {
      this.screen = "editor";
    } else if (this.screen === "notebook-selection") {
      if (this.notebookSelectionRule)
        this.notebookSelectionRule.exclude = [...this.selectionExcludeBefore];
      this.screen = "editor";
    } else if (this.screen === "glossaries") {
      this.glossaries = this.glossaryBefore;
      this.screen = "editor";
    } else if (this.screen === "browser" && this.browserFrom === "edit")
      this.screen = "editor";
    else if (this.screen === "recovery") this.screen = "detail";
    else if (this.screen === "detail") this.screen = this.detailReturnScreen;
    else if (this.screen === "settings") {
      this.settingsDraft = undefined;
      this.screen = this.settingsReturnScreen;
    }
    else this.screen = "home";
    this.render();
  }
  private showSettings() {
    this.settingsReturnScreen = this.screen === "settings" ? "home" : this.screen;
    const controller = this.c as Controller & {
      provider?: "api" | "subscription";
      concurrency?: number;
    };
    const profilesSnapshot = this.c.config.profiles.map((p) => ({
      ...p,
      glossaries: [...p.glossaries],
    }));
    this.settingsProfilesBaseline = profilesSnapshot.map((p) => ({
      ...p,
      glossaries: [...p.glossaries],
    }));
    this.settingsDraft = {
      apiKey: this.c.apiKey,
      aiEnabled: aiOn(this.c),
      autoEnabled: this.c.autoEnabled,
      profiles: profilesSnapshot.map((p) => ({
        ...p,
        glossaries: [...p.glossaries],
      })),
      intervalMinutes: this.c.config.intervalMinutes,
      provider: controller.provider ?? "api",
      concurrency: controller.concurrency ?? 1,
      showPageHeadings: this.c.config.showPageHeadings === true,
      pairingAddress: "",
      pairingCode: "",
    };
    this.screen = "settings";
    this.render();
  }
  private render() {
    this.back.hidden = this.screen === "home";
    this.headAction.hidden = false;
    const inSettings = this.screen === "settings";
    this.headAction.classList.toggle("is-active", inSettings);
    this.headAction.setAttribute("aria-pressed", String(inSettings));
    this.headAction.setAttribute("aria-label", inSettings ? "Close settings" : "Settings");
    this.headAction.title = inSettings ? "Close settings" : "Settings";
    this.headAction.querySelectorAll(".st-icon-button-label").forEach((label) => label.remove());
    setIcon(this.headAction, "settings");
    if (this.isDesktop()) el(this.headAction, "span", "Settings", "st-icon-button-label");
    const costHead =
      this.modalEl.querySelector<HTMLButtonElement>(".st-cost-head");
    if (costHead)
      costHead.hidden = !["home", "queue", "settings"].includes(this.screen);
    this.modalEl.classList.toggle(
      "st-home",
      ["home", "queue"].includes(this.screen),
    );
    setText(
      this.heading,
      this.screen === "home"
        ? "Transcripts"
        : this.screen === "settings"
          ? "Settings"
          : this.screen === "queue"
            ? "Queue"
            : this.screen === "force-update"
              ? "Force update"
            : this.screen === "notebook-selection"
              ? "Select notebooks"
              : this.screen === "editor"
                ? "Source settings"
                : this.screen === "browser"
                  ? "Choose source"
                  : this.screen === "glossaries"
                    ? "Glossaries"
                    : this.screen === "costs"
                      ? "Costs"
                      : this.screen === "output-folders"
                        ? "Choose output folder"
                        : this.screen === "recovery"
                          ? "Edited transcript"
                        : "Notebook",
    );
    this.body.empty();
    this.footer.empty();
    this.footer.hidden = false;
    this.summary = undefined;
    this.rows = undefined;
    this.detailLive = undefined;
    this.pageIssuesLive = undefined;
    this.costLive = undefined;
    this.updateButton = undefined;
    if (this.screen === "home") this.renderHome();
    else if (this.screen === "queue") this.renderQueue();
    else if (this.screen === "force-update") this.renderForceUpdate();
    else if (this.screen === "notebook-selection")
      void this.renderNotebookSelection();
    else if (this.screen === "settings") this.renderSettings();
    else if (this.screen === "browser") void this.renderBrowser();
    else if (this.screen === "glossaries") void this.renderGlossaryPicker();
    else if (this.screen === "costs") this.renderCosts();
    else if (this.screen === "output-folders") void this.renderOutputFolders();
    else if (this.screen === "editor") this.renderEditor();
    else if (this.screen === "recovery") this.renderRecovery();
    else this.renderDetail();
  }
  private refreshLive() {
    if (this.screen === "home") this.refreshHome();
    else if (this.screen === "queue") this.refreshQueue();
    else if (this.screen === "detail") {
      this.refreshDetail();
      const state = this.displayStore.notebooks[this.selectedSource];
      if (state) this.refreshPageIssues(state);
    }
    else if (this.screen === "recovery") {
      if (this.c.progress.running && !this.recoveryWaitingForIdle) {
        this.recoveryWaitingForIdle = true;
        this.render();
      } else if (!this.c.progress.running && this.recoveryWaitingForIdle) {
        this.recoveryWaitingForIdle = false;
        void this.loadRecoveryPreview(this.selectedSource);
      }
    }
    else if (this.screen === "costs") this.refreshCosts();
    else if (this.screen === "settings") {
      const controller = this.c as Controller & {
        subscriptionStatus?: { connected: boolean; needsSignIn?: boolean; pairingPending?: boolean; status: string; email?: string };
        subscriptionPairing?: { code: string; addresses: string[]; status: string; expiresAt: number };
      };
      const status = controller.subscriptionStatus;
      const pairing = controller.subscriptionPairing;
      const state = `${status?.connected ? "connected" : "disconnected"}|${status?.needsSignIn ? "needs-sign-in" : "ready"}|${status?.pairingPending ? "pairing-pending" : "no-pending-pairing"}|${status?.status ?? ""}|${status?.email ?? ""}|${pairing ? `${pairing.status}|${pairing.addresses.join(",")}|${pairing.expiresAt}` : "no-pairing"}`;
      const connection = this.body.querySelector<HTMLElement>(".st-settings-connection");
      if (connection?.dataset.subscriptionState !== state) {
        this.render();
      } else if (controller.subscriptionPairing) {
        const pairingStatus = this.body.querySelector<HTMLElement>(".st-pairing-status");
        if (pairingStatus)
          setText(pairingStatus, controller.subscriptionPairing.status || "Waiting for the Nomad to connect…");
      } else if (this.body.querySelector(".st-pairing-card")) {
        this.render();
      }
    }
  }
  private renderHome() {
    this.renderDesktopTabs("sources");
    this.summary = el(this.body, "section", undefined, "st-summary-live");
    this.rows = el(this.body, "section", undefined, "st-rule-list st-sources-list");
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(
      actions,
      "+ Add source",
      () => {
        this.browserFrom = "add";
        this.browserRootPath = this.isDesktop()
          ? this.initialDesktopBrowserPath()
          : ROOT;
        this.browserPath = this.browserRootPath;
        this.sourcePathDraft = "";
        this.browserError = "";
        this.screen = "browser";
        this.render();
      },
      "st-button st-text-button",
    );
    this.updateButton = btn(
      actions,
      "Update",
      () => this.updateClick(),
      "st-button st-primary st-update",
    );
    this.refreshHome();
  }
  private renderDesktopTabs(active: "mirrors" | "sources" | "queue") {
    const nav = el(this.body, "nav", undefined, "st-desktop-tabs st-view-tabs");
    nav.setAttribute("aria-label", "Transcript sections");
    const mirrors = btn(
      nav,
      "Sources",
      () => this.goHome(),
      `st-desktop-tab st-view-tab${active === "mirrors" || active === "sources" ? " is-active" : ""}`,
    );
    if (active === "mirrors" || active === "sources") mirrors.setAttribute("aria-current", "page");
    const queue = btn(
      nav,
      "Queue",
      () => {
        this.screen = "queue";
        this.render();
      },
      `st-desktop-tab st-view-tab${active === "queue" ? " is-active" : ""}`,
    );
    if (active === "queue") queue.setAttribute("aria-current", "page");
  }
  private updateClick() {
    const p = this.c.progress;
    if (p.stateBlocked) {
      new Notice(this.stateBlockedMessage());
      return;
    }
    if (p.running && !p.paused) this.c.pause();
    else if (p.paused) safe(this.c.resume());
    else safe(this.c.update());
  }
  private openCosts() {
    this.costReturnScreen =
      this.screen === "settings"
        ? "settings"
        : this.screen === "queue"
          ? "queue"
          : "home";
    this.costDraft = JSON.parse(JSON.stringify(this.c.costs.settings));
    this.screen = "costs";
    this.render();
  }
  private refreshHome() {
    if (!this.summary || !this.rows) return;
    const scroll = this.body.scrollTop;
    const model = overviewPresentation({
      config: this.c.config,
      store: this.displayStore,
      progress: this.c.progress,
      autoEnabled: this.c.autoEnabled,
      provider: this.c.provider,
      aiEnabled: this.c.aiEnabled,
    });
    const multipleSources =
      this.c.config.rules.filter((r) => r.enabled).length > 1;
    const states = Object.values(this.displayStore.notebooks);
    const summaryKey = JSON.stringify([
      model,
      multipleSources,
      this.c.progress.stage,
      this.c.progress.running,
      this.c.progress.paused,
      this.c.progress.stateBlocked,
      (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked,
      this.c.queueView.working?.source,
      this.c.progress.detail,
      this.c.progress.renderingContext,
      this.c.progress.checked,
      this.c.progress.total,
      this.c.progress.stage,
    ]);
    if (this.summary.dataset.key !== summaryKey) {
      this.summary.dataset.key = summaryKey;
      this.summary.empty();
      this.summary.classList.add("st-summary-status");
      el(this.summary, "strong", model.label, "st-summary-title");
      const active = this.c.queueView.working;
      const budgetReason = this.c.progress.budgetBlocked;
      const executionReason = (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked;
      el(
        this.summary,
        "p",
        budgetReason
          ? "Recognition is paused; review Costs to continue."
          : executionReason
            ? "Recognition is paused; review settings to continue."
            : active
          ? `${base(active.source).replace(/\.note$/i, "")} · ${active.stage}${active.number ? ` · page ${active.number}${active.total ? ` of ${active.total}` : ""}` : ""}`
          : model.caption,
        "st-caption",
      );
      const blockerReason = budgetReason || executionReason;
      if (blockerReason) {
        const reason = el(this.summary, "details", undefined, "st-home-blocker-details");
        el(reason, "summary", "Why recognition is paused");
        el(reason, "p", blockerReason, "st-caption");
      }
      if (multipleSources)
        progressBar(this.summary, model, "Pages ready", false);
    }
    const rules = this.c.config.rules;
    const key = JSON.stringify([
      [...this.expandedRules].sort(),
      rules.map((rule) => [
        rule.id,
        rule.enabled,
        rule.paused,
        rulePresentation(rule, states),
        states
          .filter((s) => selectedForRule(rule, s))
          .map((s) => {
            const view = notebookPresentation(s);
            return [
              s.source,
              s.status,
              s.paused,
              s.error,
              view.ready,
              view.total,
              view.pending,
              view.label,
              view.caption,
            ];
          }),
      ]),
      this.c.progress.budgetBlocked,
      this.c.progress.stateBlocked,
      (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked,
      (this.c as Controller & { sharedSettingsIssues?: unknown }).sharedSettingsIssues,
    ]);
    if (this.rows.dataset.key !== key) {
      const inactiveOpen =
        this.rows.querySelector<HTMLDetailsElement>(".st-inactive")?.open ??
        false;
      const active = document.activeElement as HTMLElement | null;
      const focusId = active?.dataset.configId;
      const focusNotebook = active?.dataset.notebookId;
      this.rows.dataset.key = key;
      this.rows.empty();
      if (this.c.progress.stateBlocked)
        this.renderStateBlockedNotice(this.rows);
      const enabled = rules.filter((r) => r.enabled),
        inactive = rules.filter((r) => !r.enabled);
      if (!enabled.length && !inactive.length)
        el(this.rows, "p", "Add a notebook or folder to begin.", "st-empty");
      for (const rule of enabled) {
        const matching = states.filter((s) => selectedForRule(rule, s));
        this.renderRuleRow(
          rule,
          rulePresentation(rule, states),
          matching.map((s) => s.source),
        );
      }
      if (inactive.length) {
        const details = el(this.rows, "details", undefined, "st-inactive");
        (details as HTMLDetailsElement).open = inactiveOpen;
        el(details, "summary", `Inactive sources (${inactive.length})`);
        for (const rule of inactive) {
          const matching = states.filter((s) => selectedForRule(rule, s));
          this.renderRuleRow(
            rule,
            rulePresentation(rule, states),
            matching.map((s) => s.source),
            details,
          );
        }
      }
      if (focusId)
        this.rows
          .querySelector<HTMLButtonElement>(
            `[data-config-id="${CSS.escape(focusId)}"]`,
          )
          ?.focus({ preventScroll: true });
      if (focusNotebook)
        this.rows
          .querySelector<HTMLButtonElement>(
            `[data-notebook-id="${CSS.escape(focusNotebook)}"]`,
          )
          ?.focus({ preventScroll: true });
    }
    if (this.updateButton) {
      setText(this.updateButton, this.actionLabel());
      this.updateButton.disabled =
        !!this.c.progress.stateBlocked ||
        (this.c.progress.running && this.c.progress.paused) ||
        (!this.c.progress.running && aiOn(this.c) && (
          !!this.c.progress.budgetBlocked ||
          !!(this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked
        ));
    }
    this.renderQueueBlockerAction(this.summary);
    this.body.scrollTop = scroll;
  }
  private queueCopy(parent: HTMLElement, source: string) {
    const copy = el(parent, "div", undefined, "st-queue-copy");
    const heading = el(copy, "div", undefined, "st-source-heading");
    el(heading, "strong", base(source).replace(/\.note$/i, ""));
    const q = this.c.queueView;
    const sources = [
      q.working?.source,
      ...q.waiting,
      ...q.paused,
      ...q.attention,
    ].filter(Boolean);
    if (
      sources.some(
        (s) =>
          s !== source && base(s!).toLowerCase() === base(source).toLowerCase(),
      )
    )
      el(
        heading,
        "span",
        shortPath(source.slice(0, source.lastIndexOf("/"))),
        "st-source-parent",
      );
    return copy;
  }
  private queueProgress(copy: HTMLElement, source: string) {
    const state = this.displayStore.notebooks[source];
    if (!state) return;
    const view = notebookPresentation(state);
    el(
      copy,
      "p",
      view.total
        ? `${view.ready} of ${view.total} pages ready · ${view.pending} remaining`
        : "Awaiting page check",
      "st-caption",
    );
    const reason = this.forceUpdateReason(state, view.reason);
    if (reason)
      el(copy, "p", reason, "st-caption st-attention-reason");
    progressBar(copy, view, `${base(source)} pages ready`);
  }
  private renderForceUpdateAction(parent: HTMLElement, state: Controller["store"]["notebooks"][string]) {
    if (!this.canForceUpdate(state)) return;
    const force = btn(parent, "Force update", () => this.openForceUpdate(state.source), "st-button st-text-button st-force-update-action");
    force.disabled = !this.c.forceUpdate || !!this.c.progress.running || !!this.c.progress.stateBlocked || !!this.c.progress.budgetBlocked || !!this.c.progress.executionBlocked;
    force.setAttribute("aria-label", `Force update ${base(state.source)}`);
  }
  private renderQueueBlockerAction(parent: HTMLElement) {
    const existing = parent.querySelector<HTMLButtonElement>(".st-blocker-action");
    const blockedByBudget = !!this.c.progress.budgetBlocked;
    const blockedByExecution = !!(this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked;
    const expectedKey = blockedByBudget
      ? "blocker:costs"
      : blockedByExecution
        ? "blocker:settings"
        : undefined;
    if (existing?.dataset.queueKey === expectedKey) return;
    existing?.remove();
    if (blockedByBudget) {
      const action = btn(
        parent,
        "Review Costs",
        () => this.openCosts(),
        "st-button st-text-button st-blocker-action",
      );
      action.dataset.queueKey = "blocker:costs";
    } else if (blockedByExecution) {
      const action = btn(
        parent,
        "Review settings",
        () => this.showSettings(),
        "st-button st-text-button st-blocker-action",
      );
      action.dataset.queueKey = "blocker:settings";
    }
  }
  private renderQueue() {
    this.renderDesktopTabs("queue");
    this.summary = el(this.body, "section", undefined, "st-queue-live");
    const actions = el(this.footer, "div", undefined, "st-actions");
    this.updateButton = btn(
      actions,
      this.actionLabel(),
      () => this.updateClick(),
      "st-button st-primary st-update",
    );
    this.refreshQueue();
  }
  private refreshQueue() {
    if (!this.summary) return;
    const q = this.c.queueView;
    if (!q) return;
    const pageAttention = Object.values(this.displayStore.notebooks)
      .filter((state) => {
        const rule = this.c.config.rules.find((candidate) => candidate.id === state.ruleId);
        return !!rule?.enabled && selectedForRule(rule, state) &&
          currentPageIssues(state).some((issue) => issue.status !== "skipped");
      })
      .map((state) => state.source);
    const attentionSources = [...new Set([...q.attention, ...pageAttention])]
      .filter((source) => {
        const state = this.displayStore.notebooks[source];
        return !state || notebookPresentation(state).attention;
      });
    const key = JSON.stringify([
      q,
      (this.c as Controller & { provider?: string }).provider,
      (this.c as Controller & { queueEstimate?: (source?: string) => unknown }).queueEstimate?.(),
      this.c.progress.activePage,
      this.c.progress.activePages,
      this.c.progress.running,
      this.c.progress.paused,
      this.c.progress.budgetBlocked,
      this.c.progress.stateBlocked,
      (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked,
      this.c.progress.detail,
      Object.values(this.displayStore.notebooks).map((s) => [
        s.source,
        notebookPresentation(s),
        s.paused,
        this.c.config.rules.find((r) => r.id === s.ruleId)?.paused,
      ]),
    ]);
    if (this.summary.dataset.key !== key) {
      const scroll = this.body.scrollTop;
      const openSections = new Set(
        Array.from(
          this.summary.querySelectorAll<HTMLDetailsElement>("details[open]"),
        ).map((d) => d.dataset.queueSection ?? d.className),
      );
      const focusKey = (document.activeElement as HTMLElement | null)?.dataset
        .queueKey;
      this.summary.dataset.key = key;
      this.summary.empty();
      if (this.c.progress.stateBlocked)
        this.renderStateBlockedNotice(this.summary);
      const overview = el(this.summary, "section", undefined, "st-queue-overview");
      const globalStatus = this.c.progress.stage === "Checking notebook pages"
        ? `Checking notebooks · ${this.c.progress.checked} of ${this.c.progress.total}`
        : this.c.progress.budgetBlocked
        ? ((this.c as Controller & { provider?: string }).provider === "subscription" ? "Usage limit reached" : "Spending paused")
        : (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked
          ? "Recognition paused"
          : this.c.progress.paused && !q.working
            ? "Updates paused"
            : q.working
        ? this.c.progress.paused
          ? `Finishing current page · ${base(q.working.source).replace(/\.note$/i, "")}`
          : `Working on ${base(q.working.source).replace(/\.note$/i, "")}`
        : q.waiting.length
          ? `${q.waiting.length} ${q.waiting.length === 1 ? "notebook" : "notebooks"} waiting`
          : q.paused.length
            ? "All remaining work is paused"
            : attentionSources.length
              ? `${attentionSources.length} ${attentionSources.length === 1 ? "notebook needs" : "notebooks need"} attention`
              : "No pending work";
      el(overview, "strong", globalStatus, "st-queue-status");
      el(
        overview,
        "p",
        `Waiting ${q.waiting.length} · Paused ${q.paused.length} · Needs attention ${attentionSources.length}`,
        "st-caption st-queue-counts",
      );
      this.renderQueueEstimate(overview);
      this.renderQueueEstimateInfo(overview);
      const blockerReason = this.c.progress.budgetBlocked ||
        (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked;
      if (blockerReason) {
        const reason = el(overview, "details", undefined, "st-queue-blocker-details");
        reason.dataset.queueSection = "blocker reason";
        el(reason, "summary", "Why recognition is paused");
        el(reason, "p", blockerReason, "st-error st-caption");
        reason.open = openSections.has(reason.dataset.queueSection);
      }
      this.renderQueueBlockerAction(overview);
      if (q.working) el(this.summary, "h2", "Working now", "st-section-heading");
      if (q.working) {
        const row = el(
          this.summary,
          "article",
          undefined,
          "st-queue-row st-working",
        );
        const copy = this.queueCopy(row, q.working.source);
        el(
          copy,
          "p",
          `${q.working.stage}${q.working.number ? ` · page ${q.working.number}${q.working.total ? ` of ${q.working.total}` : ""}` : ""}`,
          "st-caption",
        );
        const contextPage = this.c.progress.renderingContext && this.c.progress.activePage?.source === q.working.source
          ? String(this.c.progress.activePage.number)
          : this.c.progress.detail.match(/(?:^|[—–-]\s*)context page\s+(\d+)\b/i)?.[1];
        if (contextPage)
          el(copy, "p", `Context page ${contextPage}`, "st-caption st-context-page");
        const activePages = this.c.progress.activePages ?? [];
        const activeSource = this.c.progress.activePage?.source;
        if (
          (activePages.length > 1 || (activePages.length === 1 && q.working.number === undefined)) &&
          (!activeSource || activeSource === q.working.source)
        ) {
          const pageText = activePages.join(", ");
          el(
            copy,
            "p",
            `${activePages.length} ${activePages.length === 1 ? "page" : "pages"} in progress${activeSource === q.working.source ? ` · pages ${pageText}` : ""}`,
            "st-caption st-active-pages",
          );
        }
        this.queueProgress(copy, q.working.source);
        const cleanupInProgress = /cleanup/i.test(q.working.stage);
        if (cleanupInProgress) {
          const cleanupEstimate = (this.c as Controller & { cleanupEstimate?: (source: string) => QueueEstimate }).cleanupEstimate?.(q.working.source);
          const estimate = cleanupEstimate
            ? `${cleanupEstimate.pages} pages · ${cleanupEstimate.requests} request${cleanupEstimate.requests === 1 ? "" : "s"}`
            : "one text-only request";
          el(copy, "p", `Document cleanup · saved transcript text only · ${estimate}`, "st-caption st-cleanup-progress");
        } else {
          this.renderQueueEstimate(copy, q.working.source);
        }
        const state = this.displayStore.notebooks[q.working.source];
        if (state) {
          const pausing =
            !!state.paused ||
            !!this.c.config.rules.find((r) => r.id === state.ruleId)?.paused;
          if (pausing)
            el(
              copy,
              "p",
              "Finishing the current page, then pausing",
              "st-caption",
            );
          const pause = iconButton(
            row,
            "pause",
            pausing
              ? "Pausing after current page"
              : `Pause ${base(q.working.source)}`,
            () => safe(this.c.setNotebookPaused(q.working!.source, true)),
          );
          pause.disabled = pausing;
          pause.dataset.queueKey = `pause:${q.working.source}`;
        }
      }
      if (q.waiting.length) el(this.summary, "h2", "Up next", "st-section-heading st-queue-heading");
      else if (!q.working && !q.paused.length && !attentionSources.length) el(this.summary, "p", "No pending pages.", "st-empty");
      for (const source of q.waiting) {
        const row = el(this.summary, "article", undefined, "st-queue-row");
        const copy = this.queueCopy(row, source);
        this.queueProgress(copy, source);
        this.renderQueueEstimate(copy, source);
        const controls = el(row, "div", undefined, "st-queue-controls");
        const prioritize = iconButton(
          controls,
          "arrow-up-to-line",
          `Do next: ${base(source)}`,
          () => safe(this.c.prioritizeNotebook(source)),
        );
        prioritize.dataset.queueKey = `next:${source}`;
        const pause = iconButton(
          controls,
          "pause",
          `Pause ${base(source)}`,
          () => safe(this.c.setNotebookPaused(source, true)),
        );
        pause.dataset.queueKey = `pause:${source}`;
      }
      this.queueSection(this.summary, "Paused", q.paused, true);
      this.queueSection(
        this.summary,
        "Needs attention",
        attentionSources,
        false,
      );
      for (const detail of Array.from(
        this.summary.querySelectorAll<HTMLDetailsElement>(
          "details[data-queue-section]",
        ),
      ))
        detail.open = openSections.has(detail.dataset.queueSection ?? detail.className);
      const estimateInfo = this.summary.querySelector<HTMLDetailsElement>(".st-queue-estimate-info");
      if (estimateInfo) estimateInfo.open = openSections.has(estimateInfo.className);
      if (focusKey)
        this.summary
          .querySelector<HTMLElement>(
            `[data-queue-key="${CSS.escape(focusKey)}"]`,
          )
          ?.focus({ preventScroll: true });
      this.body.scrollTop = scroll;
    }
    if (this.updateButton) {
      setText(this.updateButton, this.actionLabel());
      this.updateButton.disabled =
        !!this.c.progress.stateBlocked ||
        (this.c.progress.running && this.c.progress.paused) ||
        (!this.c.progress.running && aiOn(this.c) && (
          !!this.c.progress.budgetBlocked ||
          !!(this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked
        ));
    }
  }
  private queueSection(
    parent: HTMLElement,
    title: string,
    sources: string[],
    resume: boolean,
  ) {
    if (!sources.length) return;
    const details = el(parent, "details", undefined, "st-queue-collapsed");
    details.dataset.queueSection = title;
    el(details, "summary", `${title} (${sources.length})`);
    for (const source of sources) {
      const row = el(details, "div", undefined, "st-queue-row");
      const state = this.displayStore.notebooks[source];
      const copy = this.queueCopy(row, source);
      this.queueProgress(copy, source);
      this.renderQueueEstimate(copy, source);
      if (resume) {
        const inheritedPause = !!this.c.config.rules.find(
          (r) => r.id === state?.ruleId,
        )?.paused;
        if (inheritedPause) {
          el(copy, "p", "Resume folder to continue", "st-caption");
          const rule = this.c.config.rules.find((r) => r.id === state?.ruleId);
          if (rule) {
            const resumeFolder = btn(
              row,
              "Resume folder",
              () => {
                if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
                safe(this.c.setSourcePaused(rule.id, false));
              },
              "st-button st-text-button st-folder-pause-action",
            );
            resumeFolder.disabled = !!this.c.progress.stateBlocked;
            resumeFolder.dataset.queueKey = `folder-pause:${rule.id}`;
          }
        }
        const resumeButton = iconButton(
          row,
          "play",
          `Resume ${base(source)}`,
          () => {
            if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
            safe(this.c.setNotebookPaused(source, false));
          },
        );
        resumeButton.disabled = inheritedPause || !!this.c.progress.stateBlocked;
        resumeButton.dataset.queueKey = `resume:${source}`;
      } else if (state) {
        const issues = currentPageIssues(state).filter((issue) => issue.status !== "skipped");
        const actionLabel = canRecoverTranscriptEdits(state)
          ? "Resolve edits"
          : issues.length
            ? "Review pages"
            : "Review notebook";
        const open = btn(
          row,
          actionLabel,
          () => {
            this.selectedRule = state.ruleId;
            this.selectedSource = source;
            this.detailReturnScreen = "queue";
            if (canRecoverTranscriptEdits(state)) this.openRecovery(source);
            else {
              this.screen = "detail";
              this.render();
            }
          },
          canRecoverTranscriptEdits(state)
            ? "st-button st-text-button st-recovery-action"
            : "st-button st-text-button",
        );
        open.dataset.queueKey = `review:${source}`;
        this.renderForceUpdateAction(row, state);
      }
    }
  }
  private renderQueueEstimate(parent: HTMLElement, source?: string) {
    const controller = this.c as Controller & {
      provider?: "api" | "subscription";
      queueEstimate?: (source?: string) => {
        pages: number;
        usd?: number;
        reservationUsd?: number;
        samples: number;
        provisional: boolean;
        seconds?: number;
        requests: number;
      };
    };
    const estimate = controller.queueEstimate?.(source);
    if (!estimate || estimate.pages <= 0) return;
    const pieces = source
      ? []
      : [`${estimate.pages} page${estimate.pages === 1 ? "" : "s"}`];
    if (controller.provider === "subscription") {
      pieces.push(`${estimate.requests} request${estimate.requests === 1 ? "" : "s"}`);
      if (estimate.seconds !== undefined && Number.isFinite(estimate.seconds))
        pieces.push(`about ${this.duration(estimate.seconds)}`);
      el(parent, "p", `${source ? "Estimate" : "Eligible work estimate"}: ${pieces.join(" · ")}`, "st-caption st-queue-estimate");
      return;
    }
    if (estimate.usd !== undefined && Number.isFinite(estimate.usd))
      pieces.push(`about $${estimate.usd.toFixed(4)}`);
    else if (source) pieces.push("cost unavailable");
    el(parent, "p", `${source ? "Estimate" : "Eligible work estimate"}: ${pieces.join(" · ")}`, "st-caption st-queue-estimate");
  }
  private renderQueueEstimateInfo(parent: HTMLElement) {
    const controller = this.c as Controller & {
      provider?: "api" | "subscription";
      queueEstimate?: (source?: string) => {
        pages: number; usd?: number; reservationUsd?: number; samples: number;
        provisional: boolean; seconds?: number; requests: number;
      };
    };
    const estimate = controller.queueEstimate?.();
    if (!estimate || estimate.pages <= 0) return;
    const details = el(parent, "details", undefined, "st-queue-estimate-info");
    el(details, "summary", "About this estimate");
    if (controller.provider === "subscription") {
      el(details, "p", "Forecasts eligible work after you press Update or Resume. Individually paused or blocked notebooks are excluded. Spending or execution limits can still stop requests. Page and request counts are tracked by this plugin. ChatGPT manages plan allowance; no dollar charge is estimated.", "st-caption st-estimate-note");
      return;
    }
    const sample = `${estimate.samples} recent comparable page${estimate.samples === 1 ? "" : "s"}`;
    el(details, "p", `Forecasts eligible work after you press Update or Resume. Individually paused or blocked notebooks are excluded. Spending or execution limits can still stop requests. ${estimate.provisional ? "Provisional; " : ""}Based on ${sample}. Estimates are not bills.`, "st-caption st-estimate-note");
    if (estimate.reservationUsd !== undefined && Number.isFinite(estimate.reservationUsd) && estimate.reservationUsd > 0)
      el(details, "p", `Conservative budget reservation: $${estimate.reservationUsd.toFixed(4)}.`, "st-caption st-reservation-note");
  }
  private duration(seconds: number) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  }
  private actionLabel() {
    const p = this.c.progress;
    if (p.stateBlocked) return "Saved state unavailable";
    if (p.running && !p.paused) return "Pause";
    if (p.running && p.paused) return "Pausing…";
    if (p.budgetBlocked)
      return (this.c as Controller & { provider?: string }).provider === "subscription"
        ? "Usage limit reached"
        : "Spending paused";
    if ((p as typeof p & { executionBlocked?: string }).executionBlocked)
      return "Recognition paused";
    if (!aiOn(this.c)) return "Check now";
    if (p.paused) return "Resume";
    return aiOn(this.c) ? "Update" : "Check now";
  }
  private stateBlockedMessage() {
    return "Saved plugin state is blocked. Restore the plugin state backup, then reload Obsidian. Update cannot repair saved-state storage.";
  }
  private isRecognitionVersionConflict(state: Controller["store"]["notebooks"][string]) {
    return /shared transcript recognition versions differ/i.test(state.error ?? "");
  }
  private canForceUpdate(state: Controller["store"]["notebooks"][string]) {
    return state.status === "failed" || state.status === "conflict" ||
      /wait for (?:shared )?(?:results|synchronization)|another device.*(?:updat|claim)|shared notebook claim/i.test(state.error ?? "");
  }
  private forceUpdateReason(state: Controller["store"]["notebooks"][string] | undefined, fallback?: string) {
    if (!state) return fallback;
    if (this.isRecognitionVersionConflict(state))
      return "Recognition versions differ. Use Force update to choose this device’s saved results, or keep the current transcript.";
    if (/shared transcript results have not arrived or conflict with local results|shared transcript results.*(?:not arrived|conflict)/i.test(state.error ?? ""))
      return "Shared recognition needs review. Check Sync or use Force update to choose this device’s saved results.";
    return fallback;
  }
  private openForceUpdate(source: string) {
    if (!this.c.forceUpdate) return new Notice("Force update is not available in this runtime yet.");
    this.forceUpdateSource = source;
    this.forceUpdateReturnScreen = this.screen;
    this.forceUpdateRecognizeAll = false;
    this.forceUpdateBusy = false;
    this.screen = "force-update";
    this.render();
  }
  private renderForceUpdate() {
    const state = this.displayStore.notebooks[this.forceUpdateSource];
    const root = el(this.body, "section", undefined, "st-force-update");
    el(root, "h2", "Use this device’s saved results", "st-section-heading");
    if (!state) {
      el(root, "p", "This notebook is no longer available in saved state.", "st-caption st-attention-reason");
    } else {
      const rule = this.c.config.rules.find((item) => item.id === state.ruleId);
      const profile = this.c.config.profiles.find((item) => item.id === rule?.profileId);
      const settings = [profile?.model ? friendlyModel(profile.model) : "Model unavailable", profile?.quality ? qualityLabel(profile.quality) : "Fast"].join(" · ");
      el(root, "p", settings, "st-caption st-force-update-settings");
      el(root, "p", "This run bypasses shared claims and the Sync wait for this notebook only. It uses the original notebook and recognition settings saved on this device. It can duplicate requests or replace newer transcript text. Before running, the plugin backs up the current Markdown transcript and cached recognition. Provider budgets, authentication, and storage checks still apply.", "st-caption st-force-update-warning");
      el(root, "p", "Matching cached pages are reused by default. Already queued re-recognition requests remain queued.", "st-caption");
      this.forceUpdateEstimateElement = el(root, "p", "", "st-caption st-queue-estimate st-force-update-estimate");
      this.updateForceUpdateEstimate(state);
      this.toggle(root, "Re-recognize every page", this.forceUpdateRecognizeAll, (value) => {
        this.forceUpdateRecognizeAll = value;
        this.updateForceUpdateEstimate(state);
        if (this.forceUpdateRunButton) this.forceUpdateRunButton.disabled = this.forceUpdateDisabled();
      }, "Off reuses matching cached pages and their saved recognition.");
    }
    const reason = this.forceUpdateDisabledReason();
    if (reason) el(root, "p", reason, "st-caption st-attention-reason");
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(actions, "Cancel", () => {
      this.forceUpdateSource = "";
      this.screen = this.forceUpdateReturnScreen;
      this.render();
    }, "st-button st-text-button");
    this.forceUpdateRunButton = btn(actions, this.forceUpdateBusy ? "Forcing update…" : "Force update", () => void this.runForceUpdate(), "st-button st-primary");
    this.forceUpdateRunButton.disabled = this.forceUpdateDisabled();
  }
  private forceUpdateRunButton?: HTMLButtonElement;
  private updateForceUpdateEstimate(state: Controller["store"]["notebooks"][string]) {
    if (!this.forceUpdateEstimateElement) return;
    this.forceUpdateEstimateElement.hidden = false;
    try {
      const estimate = this.c.forceUpdateEstimate?.(state.source, this.forceUpdateRecognizeAll) ??
        (this.forceUpdateRecognizeAll
          ? this.c.reprocessEstimate?.(state.source, `1-${state.desired.length}`, false) ??
            (this.c as Controller & { queueEstimate(source?: string, pages?: number[]): QueueEstimate }).queueEstimate(state.source, state.desired.map((page) => page.number))
          : this.c.queueEstimate(state.source));
      const parts = [`${estimate.pages} page${estimate.pages === 1 ? "" : "s"}`, `${estimate.requests} request${estimate.requests === 1 ? "" : "s"}`];
      if (this.c.provider === "subscription" && estimate.seconds !== undefined) parts.push(`about ${this.duration(estimate.seconds)}`);
      if (this.c.provider === "api" && estimate.usd !== undefined) parts.push(`about $${estimate.usd.toFixed(4)}`);
      if (estimate.provisional) parts.push("provisional estimate");
      setText(this.forceUpdateEstimateElement, `Estimated remaining work: ${parts.join(" · ")}`);
    } catch {
      this.forceUpdateEstimateElement.hidden = true;
    }
  }
  private forceUpdateDisabledReason() {
    const p = this.c.progress;
    if (!this.displayStore.notebooks[this.forceUpdateSource]) return "Notebook state is unavailable.";
    if (!this.c.forceUpdate) return "Force update is not available in this runtime yet.";
    if (p.stateBlocked) return this.stateBlockedMessage();
    if (p.running) return "Wait for active requests to finish before forcing an update.";
    if (p.budgetBlocked) return p.budgetBlocked;
    if (p.executionBlocked) return p.executionBlocked;
    if (this.forceUpdateRecognizeAll && !aiOn(this.c)) return "Turn on AI recognition before re-recognizing every page.";
    if (this.forceUpdateBusy) return "Force update is running.";
    return "";
  }
  private forceUpdateDisabled() { return !!this.forceUpdateDisabledReason(); }
  private async runForceUpdate() {
    const source = this.forceUpdateSource;
    const controller = this.c;
    if (!source || !controller.forceUpdate || this.forceUpdateDisabled()) return;
    const action = this.actionGate.run(`force-update:${source}`, async () => {
      this.forceUpdateBusy = true;
      if (this.forceUpdateRunButton) this.forceUpdateRunButton.disabled = true;
      try {
        const result = await controller.forceUpdate!(source, { reRecognizeAll: this.forceUpdateRecognizeAll });
        new Notice(result.backup ? `Force update completed. Previous transcript backed up to ${result.backup}` : "Force update completed.");
        this.forceUpdateSource = "";
        this.forceUpdateBusy = false;
        this.screen = "home";
        this.render();
        this.refreshHome();
      } catch (error) {
        this.forceUpdateBusy = false;
        new Notice(`Could not force update this notebook: ${err(error)}`);
        this.render();
      }
    });
    if (action) await action;
  }
  private renderStateBlockedNotice(parent: HTMLElement) {
    const notice = el(parent, "aside", undefined, "st-error st-state-blocked");
    el(notice, "strong", "Saved state needs recovery");
    if (this.c.progress.stateBlocked)
      el(notice, "p", this.c.progress.stateBlocked, "st-caption");
    el(notice, "p", this.stateBlockedMessage(), "st-caption");
  }
  private renderSharedSettingsConflict(parent: HTMLElement, ruleId: string) {
    const controller = this.c as Controller & {
      sharedSettingsIssues?: Array<{ ruleId: string; name: string; fields: string[]; reason: string }>;
      resolveSharedSettings?: (ruleId: string, choice: "local" | "remote") => Promise<void>;
      refreshSharedSettings?: () => Promise<void>;
    };
    const issues = controller.sharedSettingsIssues?.filter((issue) => issue.ruleId === ruleId) ?? [];
    if (!issues.length) return;
    const alert = el(parent, "aside", undefined, "st-shared-settings-conflict");
    const fieldLabels: Record<string, string> = {
      "profile.model": "Model",
      "profile.quality": "Recognition quality",
      "profile.prompt": "Instructions",
      "profile.glossaries": "Reference files",
      "profile.endpoint": "API endpoint",
      output: "Output folder",
      recursive: "Include subfolders",
      exclude: "Excluded notebooks",
      "settings history": "Settings history",
    };
    for (const issue of issues) {
      const hasConflict = issue.fields.length > 0;
      el(alert, "strong", `${hasConflict ? "Settings conflict" : "Settings need attention"} · ${issue.name}`);
      const fields = issue.fields.map((field) => fieldLabels[field] ?? field);
      el(alert, "p", `${fields.length ? `${fields.join(", ")} · ` : ""}${issue.reason}`, "st-caption");
    }
    const actions = el(alert, "div", undefined, "st-conflict-actions");
    const conflicts = issues.filter((issue) => issue.fields.length > 0);
    if (issues.some((issue) => issue.fields.length === 0)) {
      const retry = btn(actions, "Retry Sync", () => {
        if (!controller.refreshSharedSettings) return;
        retry.disabled = true;
        void controller.refreshSharedSettings().then(() => this.refreshHome()).catch((error) => {
          new Notice("Could not sync settings: " + err(error));
          retry.disabled = false;
        });
      }, "st-button st-text-button");
      retry.disabled = !controller.refreshSharedSettings;
    }
    if (!conflicts.length) return;
    const resolving = !controller.resolveSharedSettings;
    let local: HTMLButtonElement;
    let remote: HTMLButtonElement;
    const resolve = (choice: "local" | "remote", button: HTMLButtonElement) => {
      if (!controller.resolveSharedSettings) return;
      local.disabled = remote.disabled = true;
      void controller.resolveSharedSettings(ruleId, choice).then(() => this.refreshHome()).catch((error) => {
        new Notice("Could not resolve settings conflict: " + err(error));
        local.disabled = remote.disabled = false;
      });
      button.blur();
    };
    local = btn(actions, "Keep this device", () => resolve("local", local), "st-button st-text-button");
    remote = btn(actions, "Use synced settings", () => resolve("remote", remote), "st-button st-text-button");
    local.disabled = remote.disabled = resolving;
  }
  private renderRuleRow(
    rule: FolderRule,
    view: any,
    stateSources: string[],
    parent?: HTMLElement,
  ) {
    const isNotebook = rule.source.toLowerCase().endsWith(".note");
    const row = el(parent ?? this.rows!, "article", undefined, "st-rule-row");
    const title = isNotebook
      ? base(rule.source).replace(/\.note$/i, "")
      : base(rule.source);
    const heading = el(row, "div", undefined, "st-source-heading");
    const glyph = el(heading, "span", undefined, "st-source-icon");
    glyph.setAttribute("aria-hidden", "true");
    setIcon(glyph, isNotebook ? "file-text" : "folder");
    el(heading, "strong", title, "st-rule-source");
    if (
      isNotebook &&
      stateSources.length &&
      this.c.queueView.working?.source === stateSources[0]
    )
      el(heading, "span", "Working", "st-working-badge");
    if (
      this.c.config.rules.some(
        (r) =>
          r.id !== rule.id &&
          base(r.source).toLowerCase() === base(rule.source).toLowerCase(),
      )
    )
      el(
        heading,
        "span",
        shortPath(rule.source.slice(0, rule.source.lastIndexOf("/"))),
        "st-source-parent",
      );
    const meta = el(row, "div", undefined, "st-row-meta");
    el(meta, "p", view.caption, "st-caption");
    this.renderSharedSettingsConflict(row, rule.id);
    const reason = this.forceUpdateReason(stateSources.length ? this.displayStore.notebooks[stateSources[0]] : undefined, view.reason);
    if (reason && reason !== view.caption)
      el(meta, "p", reason, "st-caption st-attention-reason");
    progressBar(row, view, `${shortPath(rule.source)} pages ready`);
    const controls = el(row, "div", undefined, "st-row-controls");
    const recoverySources = stateSources.filter((source) =>
      canRecoverTranscriptEdits(this.displayStore.notebooks[source]),
    );
    if (recoverySources.length)
      btn(
        controls,
        recoverySources.length > 1
          ? `Resolve ${recoverySources.length} edits`
          : "Resolve edits",
        () => this.openRecovery(recoverySources[0]),
        "st-button st-text-button st-recovery-action",
      );
    const issueSource = stateSources.find((source) =>
      currentPageIssues(this.displayStore.notebooks[source]).some((issue) => issue.status !== "skipped"),
    );
    if (issueSource)
      btn(
        controls,
        "Review pages",
        () => {
          this.selectedRule = this.displayStore.notebooks[issueSource].ruleId;
          this.selectedSource = issueSource;
          this.detailReturnScreen = "home";
          this.screen = "detail";
          this.render();
        },
        "st-button st-text-button st-review-pages",
      );
    if (isNotebook && stateSources.length) {
      const state = this.displayStore.notebooks[stateSources[0]];
      this.renderForceUpdateAction(controls, state);
      const paused = !!(rule.paused || state?.paused);
      const pause = iconButton(
        controls,
        paused ? "play" : "pause",
        `${paused ? "Resume" : "Pause"} ${title}`,
        () => {
          if (paused && this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
          safe(
            rule.paused
              ? this.c.setSourcePaused(rule.id, false)
              : state?.paused
                ? this.c.setNotebookPaused(stateSources[0], false)
                : this.c.setSourcePaused(rule.id, true),
          );
        },
        "st-source-pause",
      );
      pause.dataset.notebookId = stateSources[0];
      pause.disabled = !!this.c.progress.stateBlocked && paused;
    } else {
      const pause = iconButton(
        controls,
        rule.paused ? "play" : "pause",
        `${rule.paused ? "Resume" : "Pause"} ${title}`,
        () => safe(this.c.setSourcePaused(rule.id, !rule.paused)),
        "st-source-pause",
      );
      pause.dataset.configId = `${rule.id}:pause`;
      pause.disabled = !!this.c.progress.stateBlocked && !!rule.paused;
    }
    const configure = iconButton(
      controls,
      "sliders-horizontal",
      `Configure ${title}`,
      () => this.openEditor(rule),
      "st-edit",
    );
    configure.dataset.configId = rule.id;
    if (isNotebook && stateSources.length)
      this.makeNotebookOpenable(row, rule.id, stateSources[0]);
    else {
      row.setAttribute("role", "group");
      if (!isNotebook && stateSources.length) {
        const expanded = this.expandedRules.has(rule.id);
        const disclosure = iconButton(
          controls,
          expanded ? "chevron-down" : "chevron-right",
          `${expanded ? "Collapse" : "Expand"} ${title}`,
          () => {
            if (this.expandedRules.has(rule.id))
              this.expandedRules.delete(rule.id);
            else this.expandedRules.add(rule.id);
            this.refreshHome();
          },
          "st-folder-toggle",
        );
        disclosure.dataset.configId = `${rule.id}:expand`;
        if (expanded) {
          const children = el(
            parent ?? this.rows!,
            "section",
            undefined,
            "st-folder-contents",
          );
          children.dataset.ruleId = rule.id;
          el(children, "p", "Choose a notebook or use its actions below.", "st-caption st-folder-instruction");
          for (const source of stateSources) {
            const state = this.displayStore.notebooks[source];
            if (state) this.renderNotebookRow(children, rule, state);
          }
        }
      }
    }
  }
  private renderNotebookRow(
    parent: HTMLElement,
    rule: FolderRule,
    state: Controller["store"]["notebooks"][string],
  ) {
    const row = el(
      parent,
      "article",
      undefined,
      "st-rule-row st-notebook-child",
    );
    const title = base(state.source).replace(/\.note$/i, "");
    const heading = el(row, "div", undefined, "st-source-heading");
    const glyph = el(heading, "span", undefined, "st-source-icon");
    glyph.setAttribute("aria-hidden", "true");
    setIcon(glyph, "file-text");
    el(heading, "strong", title, "st-rule-source");
    if (this.c.queueView.working?.source === state.source)
      el(heading, "span", "Working", "st-working-badge");
    if (
      Object.values(this.displayStore.notebooks).some(
        (s) =>
          s.source !== state.source &&
          s.ruleId === rule.id &&
          selectedForRule(rule, s) &&
          base(s.source).toLowerCase() === base(state.source).toLowerCase(),
      )
    )
      el(
        heading,
        "span",
        shortPath(state.source.slice(0, state.source.lastIndexOf("/"))),
        "st-source-parent",
      );
    const view = notebookPresentation(
      rule.paused ? { ...state, paused: true } : state,
    );
    const meta = el(row, "div", undefined, "st-row-meta");
    el(meta, "p", view.caption, "st-caption");
    const reason = this.forceUpdateReason(state, view.reason);
    if (reason && reason !== view.caption)
      el(meta, "p", reason, "st-caption st-attention-reason");
    progressBar(row, view, `${shortPath(state.source)} pages ready`);
    const controls = el(row, "div", undefined, "st-row-controls");
    this.renderForceUpdateAction(controls, state);
    const pause = iconButton(
      controls,
      state.paused ? "play" : "pause",
      `${state.paused ? "Resume" : "Pause"} ${title}`,
      () => {
        if (state.paused && this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
        safe(this.c.setNotebookPaused(state.source, !state.paused));
      },
      "st-source-pause",
    );
    pause.dataset.notebookId = state.source;
    if (rule.paused) {
      pause.disabled = true;
      pause.setAttribute(
        "aria-label",
        `Resume ${base(rule.source)} to continue ${title}`,
      );
    }
    if (this.c.progress.stateBlocked && state.paused) pause.disabled = true;
    if (canRecoverTranscriptEdits(state))
      btn(
        controls,
        "Resolve edits",
        () => this.openRecovery(state.source),
        "st-button st-text-button st-recovery-action",
      );
    if (currentPageIssues(state).some((issue) => issue.status !== "skipped"))
      btn(
        controls,
        "Review pages",
        () => {
          this.selectedRule = state.ruleId;
          this.selectedSource = state.source;
          this.detailReturnScreen = "home";
          this.screen = "detail";
          this.render();
        },
        "st-button st-text-button st-review-pages",
      );
    this.renderDocumentActions(row, state, true);
    this.makeNotebookOpenable(row, rule.id, state.source);
  }
  private makeNotebookOpenable(
    row: HTMLElement,
    ruleId: string,
    source: string,
  ) {
    const open = () => {
      this.selectedRule = ruleId;
      this.selectedSource = source;
      this.detailReturnScreen = "home";
      this.screen = "detail";
      this.render();
    };
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.addEventListener("click", (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("button,input,select,textarea,label,summary,a,details")) open();
    });
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.target === row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        open();
      }
    });
  }
  private openRecovery(source: string) {
    const state = this.displayStore.notebooks[source];
    if (!state || !canRecoverTranscriptEdits(state)) return;
    this.selectedRule = state.ruleId;
    this.selectedSource = source;
    this.recoveryPreview = undefined;
    this.recoveryResult = undefined;
    this.recoveryError = "";
    this.recoveryBusy = false;
    this.recoveryWaitingForIdle = false;
    this.screen = "recovery";
    this.render();
    void this.loadRecoveryPreview(source);
  }
  private async loadRecoveryPreview(source: string) {
    if (this.c.progress.running) {
      this.recoveryWaitingForIdle = true;
      this.recoveryBusy = false;
      this.recoveryError = "";
      this.render();
      return;
    }
    this.recoveryWaitingForIdle = false;
    const controller = this.c as Controller & {
      previewTranscriptRecovery?: (source: string) => Promise<{
        current: string;
        generated: string;
        output: string;
        revision: string;
      }>;
    };
    if (!controller.previewTranscriptRecovery) {
      this.recoveryError = "Edit recovery is unavailable in this plugin version.";
      this.render();
      return;
    }
    this.recoveryBusy = true;
    this.recoveryError = "";
    this.render();
    try {
      const preview = await controller.previewTranscriptRecovery(source);
      if (this.screen !== "recovery" || this.selectedSource !== source) return;
      this.recoveryPreview = { source, ...preview };
    } catch (error) {
      if (this.screen !== "recovery" || this.selectedSource !== source) return;
      this.recoveryError = err(error);
    } finally {
      if (this.screen === "recovery" && this.selectedSource === source) {
        this.recoveryBusy = false;
        this.render();
      }
    }
  }
  private async resolveRecovery(action: "replace" | "keep") {
    const preview = this.recoveryPreview;
    if (!preview || this.recoveryBusy) return;
    if (this.c.progress.stateBlocked) {
      this.recoveryError = this.stateBlockedMessage();
      this.render();
      return;
    }
    const controller = this.c as Controller & {
      resolveTranscriptConflict?: (
        source: string,
        action: "replace" | "keep",
        expectedCurrent: string,
        expectedRevision?: string,
      ) => Promise<{ backup?: string; output: string }>;
    };
    if (!controller.resolveTranscriptConflict) {
      this.recoveryError = "Edit recovery is unavailable in this plugin version.";
      this.render();
      return;
    }
    this.recoveryBusy = true;
    this.recoveryError = "";
    this.render();
    try {
      const result = await controller.resolveTranscriptConflict(
        preview.source,
        action,
        preview.current,
        preview.revision,
      );
      this.recoveryResult = { action, ...result };
      this.recoveryPreview = undefined;
    } catch (error) {
      this.recoveryError = err(error);
      this.recoveryPreview = undefined;
    } finally {
      this.recoveryBusy = false;
      if (this.screen === "recovery") this.render();
    }
  }
  private openEditor(rule: FolderRule) {
    this.editorRule = JSON.parse(JSON.stringify(rule));
    this.editorProfile =
      this.c.config.profiles.find((p) => p.id === rule.profileId) ??
      this.c.config.profiles[0];
    this.editorBaseId = this.editorProfile?.id ?? "";
    this.editorUsesGeneral = this.editorBaseId === (this.c.config.profiles.find((p) => p.id === "general")?.id ?? "general");
    this.prompt = this.editorProfile?.prompt ?? "";
    this.glossaries = [...(this.editorProfile?.glossaries ?? [])];
    this.modelDraft = this.editorProfile?.model ?? "";
    this.endpointDraft = this.editorProfile?.endpoint ?? "";
    this.qualityDraft = QUALITY.includes(this.editorProfile?.quality as any) ? this.editorProfile!.quality! : "fast";
    this.screen = "editor";
    this.render();
  }
  private renderEditor() {
    const r = this.editorRule;
    if (!r) return;
    const root = el(this.body, "section", undefined, "st-form");
    const settingsIssues = (this.c as Controller & { sharedSettingsIssues?: Array<{ ruleId: string; name: string; fields: string[]; reason: string }> }).sharedSettingsIssues?.filter((issue) => issue.ruleId === r.id) ?? [];
    if (settingsIssues.length) {
      const notice = el(root, "aside", undefined, "st-shared-settings-conflict st-conflict-form-note");
      el(notice, "strong", "Synced settings need review");
      el(notice, "p", "Close this form, then resolve the conflict on the source row. This keeps the current form draft intact.", "st-caption");
    }
    const sourceSection = el(root, "section", undefined, "st-form-section st-source-section");
    el(sourceSection, "h2", "Source", "st-section-heading");
    const sourceHeader = el(sourceSection, "header", undefined, "st-source-header");
    el(sourceHeader, "p", base(r.source).replace(/\.note$/i, ""), "st-caption st-source-title");
    const source = el(sourceHeader, "div", undefined, "st-source-choice");
    el(source, "p", this.sourceLabel(r.source), "st-caption st-source-path");
    btn(
      source,
      "Change",
      () => {
        this.browserFrom = "edit";
        this.browserRootPath = this.isDesktop()
          ? this.initialDesktopBrowserPath(r.source)
          : ROOT;
        this.browserPath = this.browserRootPath;
        this.sourcePathDraft = "";
        this.browserError = "";
        this.screen = "browser";
        this.render();
      },
      "st-button st-text-button",
    );
    this.toggle(sourceHeader, "Mirror this source", r.enabled, (v) => (r.enabled = v), "Turn off to keep saved transcripts but stop future updates.");

    if (!r.source.toLowerCase().endsWith(".note")) {
      const whatToMirror = el(sourceSection, "div", undefined, "st-source-scope");
      this.toggle(
        whatToMirror,
        "Include subfolders",
        r.recursive,
        (v) => (r.recursive = v),
      );
      const selection = el(whatToMirror, "div", undefined, "st-selection-choice");
      el(selection, "p", "Choose which notebooks in this folder are included.", "st-caption");
      btn(
        selection,
        "Select notebooks",
        () => this.openNotebookSelection(r),
        "st-button st-text-button",
      );
      const exclusions = el(sourceSection, "div", undefined, "st-source-exclusions");
      this.textarea(
        exclusions,
        "Excluded paths or patterns",
        r.exclude.join("\n"),
        (v) => { r.exclude = v.split(/\n/).map((x) => x.trim()).filter(Boolean); },
        "One relative path or pattern per line, for example 25*.note",
      );
    }
    const sharedMirrorField = el(sourceSection, "div", undefined, "st-shared-mirror-field");
    void this.renderSharedMirrors(sharedMirrorField, r);

    const outputSection = el(root, "section", undefined, "st-form-section st-output-section");
    el(outputSection, "h2", "Markdown", "st-section-heading");
    const outputChoice = el(outputSection, "div", undefined, "st-output-choice");
    const outputFolderInput = this.text(
      outputChoice,
      "Output folder",
      r.output,
      (v) => (r.output = v),
      "Choose a vault folder or enter a new path.",
    );
    const outputField = outputFolderInput.closest<HTMLElement>(".st-field");
    outputField?.classList.add("st-output-folder-field");
    const outputControls = el(outputField ?? outputChoice, "div", undefined, "st-output-folder-controls");
    outputControls.append(outputFolderInput);
    btn(
      outputControls,
      "Choose folder",
      () => {
        this.outputPickerPath = "";
        this.outputFolderSearch = "";
        this.outputFolderName = "";
        this.browserError = "";
        this.screen = "output-folders";
        this.render();
      },
      "st-button st-text-button",
    );
    const transcription = el(root, "section", undefined, "st-form-section st-recognition-section");
    el(transcription, "h2", "Recognition", "st-section-heading");
    const ruleWithAutomatic = r as FolderRule & { autoRecognize?: boolean };
    this.toggle(
      transcription,
      "Automatically recognize new and changed pages",
      ruleWithAutomatic.autoRecognize !== false,
      (value) => { ruleWithAutomatic.autoRecognize = value; },
      this.c.autoEnabled
        ? "Automatic updates are enabled on this device. Turn this off for manual updates only."
        : "Automatic updates are off on this device. Manual Update remains available.",
    );
    const sourceProfile = el(transcription, "section", undefined, "st-source-profile-mode");
    this.toggle(
      sourceProfile,
      "Use source-specific recognition settings",
      !this.editorUsesGeneral,
      (value) => {
        if (value) {
          this.editorUsesGeneral = false;
        } else {
          const general = this.c.config.profiles.find((profile) => profile.id === "general");
          if (!general) return new Notice("The General recognition profile is unavailable.");
          this.editorUsesGeneral = true;
          this.editorProfile = general;
          this.editorBaseId = general.id;
          this.prompt = general.prompt;
          this.glossaries = [...general.glossaries];
          this.modelDraft = general.model;
          this.endpointDraft = general.endpoint;
          this.qualityDraft = general.quality ?? "fast";
        }
        this.render();
      },
      "Off uses your default model, quality and reference files.",
    );
    const sourceOverrides = el(sourceProfile, "div", undefined, "st-source-profile-overrides");
    this.modelPicker(sourceOverrides, "Model", this.modelDraft, (v) => (this.modelDraft = v));
    this.qualitySlider(sourceOverrides, this.qualityDraft, (value) => { this.qualityDraft = value; });
    this.text(
      sourceOverrides,
      "Responses API endpoint",
      this.endpointDraft,
      (v) => (this.endpointDraft = v),
    );
    const instructions = el(
      transcription,
      "section",
      undefined,
      "st-instructions st-guidance-section",
    );
    this.textarea(
      instructions,
      "Instructions",
      this.prompt,
      (v) => (this.prompt = v),
    );
    const glossary = el(instructions, "div", undefined, "st-glossary-section");
    const gl = el(glossary, "div", undefined, "st-glossary-list");
    if (this.glossaries.length) this.showGlossaries(gl);
    btn(
      glossary,
      "Choose reference files",
      () => this.openGlossaryPicker(),
      "st-button st-text-button",
    );

    if (this.editorUsesGeneral) {
      sourceOverrides.classList.add("st-inactive");
      (Array.from(sourceOverrides.querySelectorAll("input, select, textarea, button")) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>).forEach((control) => { control.disabled = true; });
      instructions.classList.add("st-inactive");
      (Array.from(instructions.querySelectorAll("input, select, textarea, button")) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>).forEach((control) => { control.disabled = true; });
    }

    const sourceState = this.displayStore.notebooks[r.source];
    if (r.source.toLowerCase().endsWith(".note") && sourceState) {
      const notebookActions = el(root, "section", undefined, "st-form-section st-notebook-actions");
      el(notebookActions, "h2", "Notebook actions", "st-section-heading");
      if (this.sourceEditorDraftDirty())
        el(notebookActions, "p", "Save source settings before running notebook actions.", "st-caption st-actions-draft-note");
      else this.renderDocumentActions(notebookActions, sourceState, true);
    }

    const management = el(root, "div", undefined, "st-source-management-action");
    btn(
      management,
      "Remove source",
      () => this.removeRule(),
      "st-button st-danger",
    );
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(actions, "Cancel", () => this.goHome(), "st-button st-text-button");
    btn(actions, "Save", () => void this.saveRule(), "st-button st-primary");
  }
  private sourceEditorDraftDirty() {
    const draft = this.editorRule;
    if (!draft) return false;
    const saved = this.c.config.rules.find((rule) => rule.id === draft.id);
    if (!saved || JSON.stringify(draft) !== JSON.stringify(saved)) return true;
    const generalId = this.c.config.profiles.find((profile) => profile.id === "general")?.id ?? "general";
    if (this.editorBaseId !== saved.profileId || this.editorUsesGeneral !== (saved.profileId === generalId)) return true;
    const profile = this.c.config.profiles.find((item) => item.id === this.editorBaseId);
    return !profile ||
      this.prompt !== profile.prompt ||
      JSON.stringify(this.glossaries) !== JSON.stringify(profile.glossaries) ||
      this.modelDraft !== profile.model ||
      this.endpointDraft !== profile.endpoint ||
      this.qualityDraft !== (profile.quality ?? "fast");
  }
  private async renderSharedMirrors(parent: HTMLElement, rule: FolderRule) {
    const controller = this.c as Controller & {
      listSharedMirrors?: () => Promise<{ id: string; name: string }[]>;
    };
    if (!controller.listSharedMirrors) return;
    const originalSharedId = this.c.config.rules.find((item) => item.id === rule.id)?.sharedId ?? "";
    try {
      const mirrors = await controller.listSharedMirrors();
      if (!parent.isConnected || this.screen !== "editor") return;
      const field = el(parent, "div", undefined, "st-field");
      const label = el(field, "label", "Shared mirror");
      const select = el(field, "select") as HTMLSelectElement;
      select.id = `st-shared-mirror-${crypto.randomUUID()}`;
      label.htmlFor = select.id;
      const fresh = el(select, "option", "Create a new shared mirror") as HTMLOptionElement;
      fresh.value = "";
      for (const mirror of mirrors) {
        const option = el(select, "option", mirror.name) as HTMLOptionElement;
        option.value = mirror.id;
      }
      select.value = rule.sharedId ?? "";
      this.help(field, "Link this local source to a shared logical mirror across your devices. Keep each device's Obsidian configuration folder separate; syncing one profile can overwrite local source paths, settings, and queue state. Shared Data and Markdown transcripts are the cross-device content.", "Shared mirror");
      const consequence = el(field, "small", "Saving to a different existing mirror replaces this source’s recognition profile, folder selection and exclusions with the shared versions. Local edits to those settings may be discarded.", "st-shared-mirror-warning");
      consequence.hidden = !select.value || select.value === originalSharedId;
      select.addEventListener("change", () => {
        rule.sharedId = select.value || undefined;
        consequence.hidden = !select.value || select.value === originalSharedId;
      });
      parent.append(field);
    } catch (error) {
      if (parent.isConnected)
        el(parent, "p", `Shared mirror catalog unavailable: ${err(error)}`, "st-caption st-error");
    }
  }
  private openNotebookSelection(rule: FolderRule) {
    this.notebookSelectionRule = rule;
    this.notebookChoices = [];
    this.notebookChoicesLoaded = false;
    this.transcriptSuggestions.clear();
    this.showTranscriptSuggestions = false;
    this.findExistingTranscripts = false;
    this.selectionExcludeBefore = [...rule.exclude];
    this.screen = "notebook-selection";
    this.render();
  }
  private async renderNotebookSelection() {
    const rule = this.notebookSelectionRule;
    if (!rule) return;
    const token = ++this.selectionToken;
    const root = el(
      this.body,
      "section",
      undefined,
      "st-form st-notebook-selection",
    );
    el(
      root,
      "p",
      "Choose the notebooks this folder source should include.",
      "st-caption",
    );
    const discovery = el(root, "div", undefined, "st-selection-actions");
    btn(
      discovery,
      "Find existing transcripts",
      () => {
        this.showTranscriptSuggestions = true;
        this.findExistingTranscripts = true;
        void this.loadNotebookChoices(rule, true);
      },
      "st-button st-text-button",
    );
    if (this.showTranscriptSuggestions)
      el(
        root,
        "p",
        "Basename matches are suggestions only. Existing transcripts may be partial or ambiguous; none are imported.",
        "st-caption",
      );
    const list = el(root, "div", undefined, "st-selection-list");
    const error = el(root, "p", "", "st-error");
    if (this.showTranscriptSuggestions)
      btn(
        root,
        "Apply suggestions to draft",
        () => {
          for (const relative of this.transcriptSuggestions) {
            const pattern = literalExclusion(relative);
            if (!rule.exclude.includes(pattern)) rule.exclude.push(pattern);
          }
          this.transcriptSuggestions.clear();
          this.render();
        },
        "st-button st-text-button",
      );
    const draw = () => {
      if (token !== this.selectionToken) return;
      list.empty();
      for (const choice of this.notebookChoices) {
        const normalized = (value: string) =>
          value.trim().replace(/^\/+|\/+$/g, "");
        const pattern = literalExclusion(choice.relative);
        const patternExcluded = excluded(
          choice.source,
          rule.source,
          rule.exclude.filter((x) => normalized(x) !== pattern),
        );
        const label = el(
          list,
          "label",
          undefined,
          "st-check-row st-notebook-choice",
        );
        label.title = choice.source;
        const copy = el(label, "span", undefined, "st-file-name");
        el(copy, "span", base(choice.source).replace(/\.note$/i, ""));
        el(copy, "small", choice.relative);
        if (patternExcluded) el(copy, "small", "Excluded by source pattern");
        const input = el(label, "input") as HTMLInputElement;
        input.type = "checkbox";
        input.checked = !excluded(choice.source, rule.source, rule.exclude);
        input.disabled = patternExcluded;
        input.addEventListener("change", () => {
          if (input.checked)
            rule.exclude = rule.exclude.filter(
              (x) => normalized(x) !== pattern,
            );
          else if (!rule.exclude.includes(pattern)) rule.exclude.push(pattern);
        });
        if (
          this.showTranscriptSuggestions &&
          choice.existingTranscripts.length
        ) {
          const suggest = el(
            list,
            "label",
            undefined,
            "st-check-row st-transcript-suggestion",
          );
          const text = el(suggest, "span", undefined, "st-file-name");
          el(text, "span", "Possible existing transcript");
          for (const path of choice.existingTranscripts)
            el(text, "small", path);
          const pick = el(suggest, "input") as HTMLInputElement;
          pick.type = "checkbox";
          pick.checked = this.transcriptSuggestions.has(choice.relative);
          pick.addEventListener("change", () =>
            pick.checked
              ? this.transcriptSuggestions.add(choice.relative)
              : this.transcriptSuggestions.delete(choice.relative),
          );
        }
      }
      if (!this.notebookChoices.length)
        el(list, "p", "No notebooks found in this source.", "st-empty");
    };
    const controller = this.c;
    try {
      if (!this.notebookChoicesLoaded) {
        const choices = await controller.listNotebookChoices(
          rule,
          this.findExistingTranscripts,
        );
        if (
          token !== this.selectionToken ||
          this.screen !== "notebook-selection" ||
          this.notebookSelectionRule !== rule
        )
          return;
        this.notebookChoices = choices;
        this.notebookChoicesLoaded = true;
      }
      draw();
    } catch (e) {
      if (
        token === this.selectionToken &&
        this.screen === "notebook-selection" &&
        this.notebookSelectionRule === rule
      )
        setText(error, err(e));
    }
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(
      actions,
      "Cancel",
      () => {
        rule.exclude = [...this.selectionExcludeBefore];
        this.screen = "editor";
        this.render();
      },
      "st-button st-text-button",
    );
    btn(
      actions,
      "Done",
      () => {
        this.screen = "editor";
        this.render();
      },
      "st-button st-primary",
    );
  }
  private async loadNotebookChoices(rule: FolderRule, findExisting: boolean) {
    const controller = this.c;
    const token = ++this.selectionToken;
    try {
      const choices = await controller.listNotebookChoices(rule, findExisting);
      if (
        token !== this.selectionToken ||
        this.screen !== "notebook-selection" ||
        this.notebookSelectionRule !== rule
      )
        return;
      this.notebookChoices = choices;
      this.notebookChoicesLoaded = true;
      this.render();
    } catch (e) {
      if (
        token === this.selectionToken &&
        this.screen === "notebook-selection" &&
        this.notebookSelectionRule === rule
      )
        new Notice(err(e));
    }
  }
  private async saveRule() {
    const r = this.editorRule,
      p = this.editorProfile;
    if (!r || !p) return;
    const pending = this.actionGate.run(`source-save:${r.id}`, async () => {
      this.setFormControlsDisabled(true);
      const priorRuleIndex = this.c.config.rules.findIndex((x) => x.id === r.id);
      const priorRule = priorRuleIndex < 0
        ? undefined
        : { ...this.c.config.rules[priorRuleIndex], exclude: [...this.c.config.rules[priorRuleIndex].exclude] };
      let customProfileId: string | undefined;
      let priorProfileIndex = -1;
      let priorProfile: Profile | undefined;
      let writtenProfile: Profile | undefined;
      try {
        r.source = validateSource(r.source);
        r.output = validateDestination(r.output.trim());
        const generalProfileId = this.c.config.profiles.find((profile) => profile.id === "general")?.id ?? "general";
        const custom =
          this.prompt !== p.prompt ||
          JSON.stringify(this.glossaries) !== JSON.stringify(p.glossaries) ||
          this.modelDraft !== p.model ||
          this.endpointDraft !== p.endpoint ||
          this.qualityDraft !== (p.quality ?? "fast") ||
          (!this.editorUsesGeneral && this.editorBaseId === generalProfileId);
        if (custom) {
          const profile = {
            ...p,
            id: `rule-${r.id}`,
            name: `${base(r.source)} instructions`,
            prompt: this.prompt,
            glossaries: [...this.glossaries],
            model: this.modelDraft,
            endpoint: this.endpointDraft,
            quality: this.qualityDraft,
          };
          writtenProfile = profile;
          customProfileId = profile.id;
          priorProfileIndex = this.c.config.profiles.findIndex((x) => x.id === profile.id);
          const existing = priorProfileIndex < 0 ? undefined : this.c.config.profiles[priorProfileIndex];
          priorProfile = existing
            ? { ...existing, glossaries: [...existing.glossaries] }
            : undefined;
          if (priorProfileIndex < 0) this.c.config.profiles.push(profile);
          else this.c.config.profiles[priorProfileIndex] = profile;
          r.profileId = profile.id;
        } else r.profileId = this.editorBaseId;
        const i = this.c.config.rules.findIndex((x) => x.id === r.id);
        if (i < 0) this.c.config.rules.push(r);
        else this.c.config.rules[i] = r;
        await this.saveConfigQueued();
        new Notice("Source saved");
        this.goHome();
      } catch (e) {
        rollbackConfigEntry(this.c.config.rules, r.id, r, priorRule, priorRuleIndex);
        if (customProfileId)
          rollbackConfigEntry(
            this.c.config.profiles,
            customProfileId,
            writtenProfile,
            priorProfile,
            priorProfileIndex,
          );
        new Notice(err(e));
      } finally {
        this.setFormControlsDisabled(false);
      }
    });
    if (pending) await pending;
  }
  private removeRule() {
    const r = this.editorRule;
    if (!r) return;
    const pending = this.actionGate.run(`source-save:${r.id}`, async () => {
      this.setFormControlsDisabled(true);
      const i = this.c.config.rules.findIndex((x) => x.id === r.id);
      if (i < 0) {
        this.setFormControlsDisabled(false);
        return;
      }
      const [removed] = this.c.config.rules.splice(i, 1);
      try {
        await this.saveConfigQueued();
        this.goHome();
      } catch (error) {
        rollbackConfigEntry(this.c.config.rules, removed.id, undefined, removed, i);
        new Notice(err(error));
      } finally {
        this.setFormControlsDisabled(false);
      }
    });
    if (pending) safe(pending);
  }
  private addSource(path: string) {
    const duplicate = this.c.config.rules.find((r) => r.source === path);
    if (duplicate) {
      this.openEditor(duplicate);
      return;
    }
    const p =
      this.c.config.profiles.find((x) => x.id === "general") ??
      this.c.config.profiles[0];
    if (!p) {
      new Notice("No default model is configured.");
      return;
    }
    const r: FolderRule = {
      id: crypto.randomUUID(),
      enabled: true,
      source: path,
      output: "Supernote Transcripts/Transcripts",
      recursive: !path.toLowerCase().endsWith(".note"),
      exclude: [],
      profileId: p.id,
    };
    this.editorRule = r;
    this.editorProfile = p;
    this.editorBaseId = p.id;
    this.editorUsesGeneral = p.id === (this.c.config.profiles.find((profile) => profile.id === "general")?.id ?? "general");
    this.prompt = p.prompt;
    this.glossaries = [...p.glossaries];
    this.modelDraft = p.model;
    this.endpointDraft = p.endpoint;
      this.qualityDraft = p.quality ?? "fast";
    this.screen = "editor";
    this.render();
  }
  private async quickAddSource(path: string) {
    let source: string;
    try {
      source = validateSource(path, this.isDesktop() ? "desktop" : "nomad");
    } catch (error) {
      new Notice(err(error));
      return;
    }
    const key = `mirror-add:${normalizeBrowserPath(source)}`;
    const pending = this.actionGate.run(key, async () => {
      const exact = this.c.config.rules.find((rule) => {
        try {
          return normalizeBrowserPath(rule.source) === normalizeBrowserPath(source);
        } catch {
          return rule.source === source;
        }
      });
      if (exact) {
        if (this.screen === "browser") {
          this.browserError = "This source is already mirrored. Configure it from Sources.";
          this.render();
        }
        return;
      }
      const profile =
        this.c.config.profiles.find((item) => item.id === "general") ??
        this.c.config.profiles[0];
      if (!profile) {
        new Notice("No default model is configured.");
        return;
      }
      const rule: FolderRule = {
        id: crypto.randomUUID(),
        enabled: true,
        source,
        output: "Supernote Transcripts/Transcripts",
        recursive: !source.toLowerCase().endsWith(".note"),
        exclude: [],
        profileId: profile.id,
      };
      this.setFormControlsDisabled(true);
      this.c.config.rules.push(rule);
      try {
        await this.saveConfigQueued();
        if (this.screen === "browser") {
          this.browserError = "Mirror added. Configure it from Sources.";
          this.render();
        }
        new Notice("Mirror added. No pages were processed.");
      } catch (error) {
        rollbackConfigEntry(this.c.config.rules, rule.id, rule, undefined);
        if (this.screen === "browser") {
          this.browserError = err(error);
          this.render();
        }
        new Notice(err(error));
      } finally {
        this.setFormControlsDisabled(false);
      }
    });
    if (pending) await pending;
  }
  private async renderBrowser() {
    const token = ++this.browserToken;
    const root = el(this.body, "section", undefined, "st-browser");
    if (this.isDesktop()) {
      const breadcrumbs = el(root, "nav", undefined, "st-browser-breadcrumbs");
      breadcrumbs.setAttribute("aria-label", "Source folder path");
      const crumbs = browserBreadcrumbs(this.browserPath);
      for (const [index, crumb] of crumbs.entries()) {
        if (index) el(breadcrumbs, "span", "›", "st-browser-separator");
        if (index === crumbs.length - 1) {
          const current = el(breadcrumbs, "span", crumb.label, "st-browser-current");
          current.setAttribute("aria-current", "location");
        } else
          btn(
            breadcrumbs,
            crumb.label,
            () => {
              this.browserPath = crumb.path;
              this.browserError = "";
              this.render();
            },
            "st-browser-crumb",
          );
      }
    } else el(root, "p", this.sourceLabel(this.browserPath), "st-breadcrumb");
    el(
      root,
      "p",
      this.browserFrom === "add"
        ? "Open a folder to browse. Select a notebook row to configure it; Mirror actions add immediately with defaults."
        : "Choose a folder or notebook, then Save on the previous screen to apply the source change.",
      "st-caption st-browser-help",
    );
    if (this.isDesktop()) {
      const path = this.text(
        root,
        "Source path",
        this.sourcePathDraft,
        (v) => (this.sourcePathDraft = v),
        "Enter a folder or .note path on this computer or in a synced folder.",
      );
      path.placeholder = "C:/Notes/Supernote or /home/name/Notes/Supernote";
      const pathActions = el(root, "div", undefined, "st-browser-path-actions");
      const pathAction = btn(pathActions, "Open folder", () => {
        const value = this.sourcePathDraft.trim();
        if (!value) {
          this.browserError = "Enter a folder or notebook path first.";
          this.render();
          return;
        }
        if (value.toLowerCase().endsWith(".note")) {
          if (this.browserFrom === "add") void this.quickAddSource(value);
          else this.chooseFile(value);
        } else this.browseTypedPath();
      }, "st-button st-text-button");
      const updatePathAction = () => {
        const isNotebook = this.sourcePathDraft.trim().toLowerCase().endsWith(".note");
        setText(
          pathAction,
          isNotebook
            ? this.browserFrom === "add" ? "Mirror notebook" : "Use notebook"
            : "Open folder",
        );
      };
      path.addEventListener("input", updatePathAction);
      updatePathAction();
    }
    const actions = el(this.footer, "div", undefined, "st-actions");
    if (this.browserFrom === "add")
      el(actions, "small", "Uses your default recognition settings. Configure each source afterward.", "st-caption st-browser-action-note");
    btn(
      actions,
      this.browserFrom === "add" ? "Mirror this folder" : "Choose this folder",
      () => {
        if (this.browserFrom === "add")
          void this.quickAddSource(this.browserPath);
        else this.chooseFolder();
      },
      "st-button st-primary",
    );
    if (
      this.browserPath !== this.browserRootPath &&
      !isBrowserRoot(this.browserPath)
    )
      btn(
        root,
        "Parent folder",
        () => {
          this.browserPath = this.isDesktop()
            ? parentBrowserPath(this.browserPath)
            : this.parentSourcePath(this.browserPath);
          this.render();
        },
        "st-button st-text-button",
      );
    const error = el(root, "p", this.browserError, "st-error");
    const list = el(root, "div", undefined, "st-browser-list");
    try {
      const fs = this.isDesktop()
        ? require("fs").promises
        : (this.app.vault.adapter as any).fs;
      if (!fs?.readdir || (!this.isDesktop() && !fs?.stat))
        throw new Error(
          this.isDesktop()
            ? "Local folder browsing is unavailable. Enter an absolute path instead."
            : "Android folder browsing is unavailable.",
        );
      const entries = (this.isDesktop()
        ? await fs.readdir(this.browserPath, { withFileTypes: true })
        : await fs.readdir(this.browserPath)) as (
        | string
        | {
            name: string;
            type?: string;
            isDirectory?: () => boolean;
            isFile?: () => boolean;
          }
      )[];
      const mapped = await Promise.all(
        entries.map(async (item) => {
          const name = typeof item === "string" ? item : item.name;
          if (!name || name.startsWith(".") || name === "." || name === "..")
            return null;
          const path = this.isDesktop()
            ? joinBrowserPath(this.browserPath, name)
            : `${this.browserPath.replace(/\/$/, "")}/${name}`;
          let type = typeof item === "string" ? undefined : item.type;
          if (!this.isDesktop()) {
            try {
              type = type ?? (await fs.stat(path)).type;
            } catch {
              /* Unknown non-note entries are hidden. */
            }
          }
          const entryType = browserEntryType(item, type);
          if (!entryType) return null;
          return { name, path, type: entryType };
        }),
      );
      if (token !== this.browserToken || this.screen !== "browser") return;
      const visible = mapped.filter(Boolean) as {
        name: string;
        path: string;
        type: string | undefined;
      }[];
      visible.sort(
        (a, b) =>
          Number(b.type === "directory") - Number(a.type === "directory") ||
          a.name.localeCompare(b.name),
      );
      for (const entry of visible) {
        const directory = entry.type === "directory";
        const desktop = this.isDesktop();
        const hasMirrorAction = this.browserFrom === "add";
        const parentRule = ruleFor(entry.path, this.c.config.rules);
        const directRule = this.c.config.rules.find((rule) => {
          try {
            return normalizeBrowserPath(rule.source) === normalizeBrowserPath(entry.path);
          } catch {
            return rule.source === entry.path;
          }
        });
        const parentSource = parentRule?.source.replace(/\/+$/, "");
        const relative = parentSource && entry.path.startsWith(`${parentSource}/`)
          ? entry.path.slice(parentSource.length + 1)
          : "";
        const parentIncludesEntry = !!parentRule &&
          !excluded(entry.path, parentRule.source, parentRule.exclude) &&
          (directory
            ? parentRule.recursive
            : parentRule.recursive || !relative.includes("/"));
        const mirroredBy = directRule ?? (parentIncludesEntry ? parentRule : undefined);
        const row = hasMirrorAction
          ? el(list, "div", undefined, "st-browser-entry-row")
          : list;
        const button = btn(
          row,
          "",
          () => {
            if (!directory) return this.chooseFile(entry.path);
            this.browserPath = entry.path;
            this.browserError = "";
            this.render();
          },
          desktop ? "st-browser-entry" : "st-browser-entry",
        );
        button.title = entry.path;
        const glyph = el(button, "span", undefined, "st-source-icon");
        glyph.setAttribute("aria-hidden", "true");
        setIcon(glyph, directory ? "folder" : "file-text");
        if (desktop) {
          const copy = el(button, "span", undefined, "st-browser-entry-copy");
          el(copy, "span", entry.name.replace(/\.note$/i, ""), "st-browser-entry-name");
          el(
            copy,
            "small",
            directory
              ? mirroredBy
                ? `Folder · ${mirroredBy.source === entry.path ? "already mirrored" : `mirrored by ${base(mirroredBy.source)}`}`
                : "Folder · browse or mirror"
              : mirroredBy
                ? `Supernote notebook · ${mirroredBy.source === entry.path ? "already mirrored" : `mirrored by ${base(mirroredBy.source)}`}`
                : "Supernote notebook · select or mirror",
            "st-browser-entry-status",
          );
        } else el(button, "span", entry.name.replace(/\.note$/i, ""));
        const arrow = el(button, "span", undefined, "st-entry-arrow");
        arrow.setAttribute("aria-hidden", "true");
        setIcon(arrow, "chevron-right");
        if (hasMirrorAction) {
          const action = btn(
            row,
            mirroredBy ? "Configure" : "Mirror",
            () => {
              if (mirroredBy) {
                this.openEditor(mirroredBy);
                return;
              }
              void this.quickAddSource(entry.path);
            },
            `st-button st-browser-source-action ${mirroredBy ? "st-browser-configure" : "st-browser-mirror"}`,
          );
          if (!mirroredBy) setText(action, "Mirror");
          else action.setAttribute("aria-current", "true");
          action.title = mirroredBy
            ? `Configure ${base(mirroredBy.source)}`
            : `Add ${entry.name.replace(/\.note$/i, "")} as a mirror`;
        }
      }
      if (!visible.length)
        el(list, "p", "No notebooks or folders here.", "st-empty");
    } catch (e) {
      if (token === this.browserToken && this.screen === "browser")
        setText(error, err(e));
    }
  }
  private async renderOutputFolders() {
    const token = ++this.browserToken;
    const root = el(
      this.body,
      "section",
      undefined,
      "st-browser st-output-browser",
    );
    const breadcrumbs = el(root, "nav", undefined, "st-browser-breadcrumbs");
    breadcrumbs.setAttribute("aria-label", "Output folder path");
    const parts = this.outputPickerPath.split("/").filter(Boolean);
    const crumb = btn(breadcrumbs, "Vault", () => {
      this.outputPickerPath = "";
      this.render();
    }, "st-browser-crumb");
    crumb.setAttribute("aria-current", parts.length ? "false" : "location");
    for (let index = 0; index < parts.length; index++) {
      el(breadcrumbs, "span", "›", "st-browser-separator");
      const path = parts.slice(0, index + 1).join("/");
      const item = index === parts.length - 1
        ? el(breadcrumbs, "span", parts[index], "st-browser-current")
        : btn(breadcrumbs, parts[index], () => { this.outputPickerPath = path; this.render(); }, "st-browser-crumb");
      if (index === parts.length - 1) item.setAttribute("aria-current", "location");
    }
    const search = this.input(root, "Find a folder", this.outputFolderSearch, "search", (value) => { this.outputFolderSearch = value; });
    search.placeholder = "Filter folders in this location";
    const newFolder = el(root, "div", undefined, "st-new-folder");
    const newFolderInput = this.input(newFolder, "New folder name", this.outputFolderName, "text", (value) => { this.outputFolderName = value; });
    newFolderInput.placeholder = "Create in the current location";
    btn(newFolder, "Create folder", () => { void this.createOutputFolder(); }, "st-button st-text-button");
    el(newFolder, "small", "Creating a folder writes it to this vault immediately.", "st-caption");
    const error = el(root, "p", this.browserError, "st-error");
    const list = el(root, "div", undefined, "st-browser-list");
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(
      actions,
      "Cancel",
      () => {
        this.screen = "editor";
        this.render();
      },
      "st-button st-text-button",
    );
    const choose = btn(
      actions,
      "Choose this folder",
      () => {
        if (!this.outputPickerPath || !this.editorRule) return;
        this.editorRule.output = this.outputPickerPath;
        this.screen = "editor";
        this.render();
      },
      "st-button st-primary",
    );
    choose.disabled = !this.outputPickerPath;
    choose.title = this.outputPickerPath
      ? "Use this existing vault folder"
      : "Choose a folder inside the vault";
    let allFolders: string[] = [];
    const drawFolders = (folders: string[]) => {
      list.empty();
      const query = this.outputFolderSearch.trim().toLocaleLowerCase();
      const visibleFolders = folders.filter((folder) => {
        const path = !this.outputPickerPath || folder.startsWith(`${this.outputPickerPath}/`)
          ? folder
          : `${this.outputPickerPath}/${folder}`;
        const name = path.slice(path.lastIndexOf("/") + 1) || path;
        return !query || name.toLocaleLowerCase().includes(query) || path.toLocaleLowerCase().includes(query);
      });
      for (const folder of visibleFolders) {
        const path = !this.outputPickerPath || folder.startsWith(`${this.outputPickerPath}/`)
          ? folder
          : `${this.outputPickerPath}/${folder}`;
        const name = path.slice(path.lastIndexOf("/") + 1) || path;
        const entry = btn(
          list,
          "",
          () => { this.outputPickerPath = path; this.outputFolderSearch = ""; this.render(); },
          "st-browser-entry",
        );
        const glyph = el(entry, "span", undefined, "st-source-icon");
        glyph.setAttribute("aria-hidden", "true");
        setIcon(glyph, "folder");
        el(entry, "span", name, "st-browser-entry-name");
        const arrow = el(entry, "span", undefined, "st-entry-arrow");
        arrow.setAttribute("aria-hidden", "true");
        setIcon(arrow, "chevron-right");
      }
      if (!visibleFolders.length)
        el(list, "p", query ? "No matching folders here." : "No existing subfolders here. You can create one above.", "st-empty");
    };
    search.addEventListener("input", () => drawFolders(allFolders));
    try {
      const result = await this.app.vault.adapter.list(this.outputPickerPath);
      if (token !== this.browserToken || this.screen !== "output-folders")
        return;
      allFolders = [...new Set(result.folders)]
        .filter(
          (folder) => !folder.split("/").some((part) => part.startsWith(".")),
        )
        .sort((a, b) => a.localeCompare(b));
      drawFolders(allFolders);
    } catch (e) {
      if (token === this.browserToken && this.screen === "output-folders")
        setText(error, `Could not list vault folders: ${err(e)}`);
    }
  }
  private async createOutputFolder() {
    const name = this.outputFolderName.trim();
    const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name);
    if (!name || name === "." || name === ".." || /[<>:"|?*\\/\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || name.startsWith(".") || windowsReserved) {
      this.browserError = "Enter a normal folder name without slashes, hidden-folder prefixes, or reserved path characters.";
      this.render();
      return;
    }
    const path = [this.outputPickerPath, name].filter(Boolean).join("/");
    try {
      validateDestination(path);
      if (this.app.vault.getAbstractFileByPath(path))
        throw new Error("A file or folder with that name already exists here.");
      await this.app.vault.createFolder(path);
      if (this.screen !== "output-folders") return;
      this.outputPickerPath = path;
      this.outputFolderName = "";
      this.outputFolderSearch = "";
      this.browserError = "";
      this.render();
    } catch (error) {
      if (this.screen !== "output-folders") return;
      this.browserError = `Could not create folder: ${err(error)}`;
      this.render();
    }
  }
  private chooseFolder() {
    if (this.browserFrom === "add") this.addSource(this.browserPath);
    else if (this.editorRule) {
      this.editorRule.source = this.browserPath;
      this.renderEditorScreen();
    }
  }
  private isDesktop() {
    return (this.c as Controller & { platform?: string }).platform === "desktop";
  }
  private sourceLabel(path: string) {
    return !this.isDesktop() ? shortPath(path) : path || "Computer";
  }
  private parentSourcePath(path: string) {
    if (path === "/") return path;
    const parent = path.slice(0, path.lastIndexOf("/"));
    return parent || "/";
  }
  private initialDesktopBrowserPath(preferredSource?: string) {
    const adapter = this.app.vault.adapter as any;
    let vaultPath = "";
    try {
      vaultPath =
        (typeof adapter.getBasePath === "function" && adapter.getBasePath()) ||
        adapter.basePath ||
        "";
    } catch {
      vaultPath = adapter.basePath || "";
    }
    if (!vaultPath) {
      try {
        vaultPath = require("process").cwd();
      } catch {
        vaultPath = "/";
      }
    }
    const source =
      preferredSource ?? this.c.config.rules.find((rule) => rule.enabled)?.source;
    return initialBrowserPath(source ? [source] : [], vaultPath);
  }
  private browseTypedPath() {
    try {
      const path = normalizeBrowserPath(this.sourcePathDraft);
      if (path.toLowerCase().endsWith(".note")) {
        this.browserError = "This is a notebook file. Use this path to select the notebook.";
      } else {
        this.browserPath = path;
        this.browserError = "";
      }
    } catch (error) {
      this.browserError = err(error);
    }
    this.render();
  }
  private chooseFile(path: string) {
    try {
      path = this.isDesktop()
        ? normalizeBrowserPath(path.trim())
        : path.trim().replace(/\\/g, "/").replace(/\/$/, "");
    } catch (error) {
      new Notice(err(error));
      return;
    }
    if (!path) {
      new Notice("Enter a source path first.");
      return;
    }
    if (this.browserFrom === "add") this.addSource(path);
    else if (this.editorRule) {
      this.editorRule.recursive = path.toLowerCase().endsWith(".note") ? false : this.editorRule.source.toLowerCase().endsWith(".note") ? true : this.editorRule.recursive;
      this.editorRule.source = path;
      this.renderEditorScreen();
    }
  }
  private renderEditorScreen() {
    this.screen = "editor";
    this.render();
  }
  private openGlossaryPicker() {
    this.glossaryBefore = [...this.glossaries];
    this.screen = "glossaries";
    this.render();
  }
  private async renderGlossaryPicker() {
    const root = el(this.body, "section", undefined, "st-form");
    const search = this.input(root, "Find a glossary", "", "search", () => {});
    search.placeholder = "Search file names";
    const list = el(root, "div", undefined, "st-glossary-picker");
    try {
      const files = await this.listVaultTextFiles();
      if (this.screen !== "glossaries") return;
      const draw = () => {
        list.empty();
        const matches = files.filter((file) =>
          file.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
        );
        for (const file of matches) {
          const label = el(list, "label", undefined, "st-check-row");
          label.title = file;
          const name = el(label, "span", undefined, "st-file-name");
          el(name, "span", base(file));
          const parent = file.slice(0, file.lastIndexOf("/"));
          if (file.includes("/")) el(name, "small", parent);
          const input = el(label, "input") as HTMLInputElement;
          input.type = "checkbox";
          input.checked = this.glossaries.includes(file);
          input.addEventListener("change", () => {
            this.glossaries = input.checked
              ? [...new Set([...this.glossaries, file])]
              : this.glossaries.filter((x) => x !== file);
          });
        }
        if (!matches.length) el(list, "p", "No matching files", "st-empty");
      };
      search.addEventListener("input", draw);
      draw();
    } catch (e) {
      el(list, "p", `Could not list vault files: ${err(e)}`, "st-error");
    }
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(
      actions,
      "Cancel",
      () => {
        this.glossaries = this.glossaryBefore;
        this.renderEditorScreen();
      },
      "st-button st-text-button",
    );
    btn(
      actions,
      "Done",
      () => this.renderEditorScreen(),
      "st-button st-primary",
    );
  }
  private async listVaultTextFiles() {
    const found: string[] = [];
    const walk = async (path: string, depth: number) => {
      if (depth > 16) return;
      const result = await this.app.vault.adapter.list(path);
      for (const file of result.files)
        if (/\.(txt|md)$/i.test(file)) found.push(file);
      for (const folder of result.folders)
        if (!folder.split("/").some((part) => part.startsWith(".")))
          await walk(folder, depth + 1);
    };
    await walk("", 0);
    return found.sort();
  }
  private showGlossaries(parent: HTMLElement) {
    parent.empty();
    for (const file of this.glossaries) {
      const row = el(parent, "div", undefined, "st-glossary-row");
      const name = el(row, "span", base(file));
      name.title = file;
      iconButton(
        row,
        "minus",
        `Remove ${base(file)}`,
        () => {
          this.glossaries = this.glossaries.filter((x) => x !== file);
          this.showGlossaries(parent);
        },
        "st-mini-button",
      );
    }
  }
  private renderSettings() {
    const d = this.settingsDraft;
    if (!d) return;
    const root = el(this.body, "section", undefined, "st-form");
    const connection = el(root, "section", undefined, "st-settings-section st-settings-connection");
    el(connection, "h2", "Connection", "st-section-heading");
    const controller = this.c as Controller & {
      provider?: "api" | "subscription";
      concurrency?: number;
      subscriptionStatus?: { connected: boolean; needsSignIn?: boolean; pairingPending?: boolean; status: string; email?: string };
      connectSubscription?: () => Promise<void>;
      finishSubscriptionLogin?: () => Promise<void>;
      cancelSubscriptionPairing?: () => Promise<void>;
      disconnectSubscription?: () => Promise<void>;
      platform?: "desktop" | "nomad";
      subscriptionPairing?: { code: string; addresses: string[]; status: string; expiresAt: number };
      startSubscriptionPairing?: () => Promise<void>;
      stopSubscriptionPairing?: () => Promise<void>;
      pairSubscriptionDesktop?: (address: string, code: string) => Promise<void>;
      discoverSubscriptionDesktops?: () => Promise<{address: string}[]>;
      subscriptionUsage?: { requests: number; pages: number; inputTokens: number; outputTokens: number; unconfirmed: number };
    };
    const runSubscriptionAction = (action?: () => Promise<void>) =>
      safe(Promise.resolve().then(() => action?.call(this.c)).then(() => {
        if (this.screen === "settings") this.render();
      }));
    this.select(
      connection,
      "Provider",
      d.provider,
      [
        ["api", "API (pay per request)"],
        ["subscription", "ChatGPT subscription"],
      ],
      (value) => {
        d.provider = value as "api" | "subscription";
        this.render();
      },
      "Choose which account or key handles recognition.",
    );
    if (d.provider === "api") {
      this.input(
        connection,
        "API key",
        d.apiKey,
        "password",
        (v) => (d.apiKey = v),
        "Stored on this device",
      );
    } else {
      const status = controller.subscriptionStatus;
      const isDesktop = controller.platform === "desktop";
      const pairing = controller.subscriptionPairing;
      connection.dataset.subscriptionState = `${status?.connected ? "connected" : "disconnected"}|${status?.needsSignIn ? "needs-sign-in" : "ready"}|${status?.pairingPending ? "pairing-pending" : "no-pending-pairing"}|${status?.status ?? ""}|${status?.email ?? ""}|${pairing ? `${pairing.status}|${pairing.addresses.join(",")}|${pairing.expiresAt}` : "no-pairing"}`;
      el(
        connection,
        "p",
        status?.needsSignIn
          ? status.status
          : status?.connected
          ? `Connected${status.email ? ` as ${status.email}` : ""}`
          : status?.status || "Not connected.",
        "st-caption st-subscription-status",
      );

      if (isDesktop) {
        const startPairing = btn(
          connection,
          pairing ? "Pairing in progress" : "Connect a Nomad",
          () => {
            if (!pairing) void runSubscriptionAction(controller.startSubscriptionPairing);
          },
          "st-button st-text-button st-pairing-start",
        );
        startPairing.disabled = Boolean(pairing) || !controller.startSubscriptionPairing;
        if (pairing) {
          const card = el(connection, "section", undefined, "st-pairing-card");
          el(card, "h3", "Connect from your Nomad", "st-pairing-heading");
          el(card, "p", "Keep desktop Obsidian open and connect from Nomad on the same Wi-Fi.", "st-caption st-pairing-guidance");
          const addresses = el(card, "div", undefined, "st-pairing-addresses");
          el(addresses, "span", pairing.addresses.length === 1 ? "Address" : "Addresses", "st-pairing-label");
          if (pairing.addresses.length) {
            const list = el(addresses, "ul", undefined, "st-pairing-address-list");
            for (const address of pairing.addresses) {
              const item = el(list, "li");
              const row = el(item, "div", undefined, "st-pairing-address-row");
              el(row, "code", address, "st-pairing-address");
              const copyAddress = btn(row, "Copy", () => {
                const clipboard = card.ownerDocument.defaultView?.navigator.clipboard;
                if (!clipboard) {
                  new Notice("Clipboard access is unavailable. Select and copy the address instead.");
                  return;
                }
                void clipboard.writeText(address).then(
                  () => new Notice("Desktop address copied."),
                  () => new Notice("Could not copy the address. Select and copy it instead."),
                );
              }, "st-button st-secondary st-pairing-address-copy");
              copyAddress.setAttribute("aria-label", `Copy desktop address ${address}`);
              copyAddress.title = `Copy desktop address ${address}`;
            }
          } else {
            el(addresses, "p", "Waiting for a local network address…", "st-caption");
          }
          el(card, "span", "Pairing code", "st-pairing-label");
          const codeRow = el(card, "div", undefined, "st-pairing-code-row");
          const formattedCode = pairing.code.replace(/[\s-]/g, "").match(/.{1,4}/g)?.join("-") ?? pairing.code;
          el(codeRow, "code", formattedCode, "st-pairing-code");
          const copy = btn(codeRow, "Copy code", () => {
            const clipboard = card.ownerDocument.defaultView?.navigator.clipboard;
            if (!clipboard) {
              new Notice("Clipboard access is unavailable. Select and copy the code instead.");
              return;
            }
            void clipboard.writeText(pairing.code).then(
              () => new Notice("Pairing code copied."),
              () => new Notice("Could not copy the code. Select and copy it instead."),
            );
          }, "st-button st-text-button st-pairing-copy");
          copy.setAttribute("aria-label", "Copy pairing code");
          el(card, "p", pairing.status || "Waiting for the Nomad to connect…", "st-caption st-pairing-status");
          if (pairing.expiresAt > 0) {
            const remaining = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
            el(card, "p", remaining ? `Code expires in about ${Math.ceil(remaining / 60)} minutes.` : "This pairing code has expired.", "st-caption st-pairing-expiry");
          }
          btn(
            card,
            "Cancel pairing",
            () => void runSubscriptionAction(controller.stopSubscriptionPairing),
            "st-button st-text-button st-pairing-cancel",
          );
        }
      }

      if (status?.connected) {
        btn(
          connection,
          "Disconnect ChatGPT account",
          () => runSubscriptionAction(controller.disconnectSubscription),
          "st-button st-text-button",
        );
      }
      if (controller.platform === "nomad" && (!status?.connected || status.needsSignIn)) {
        const pairingSection = el(connection, "section", undefined, "st-nomad-pairing");
        el(pairingSection, "h3", "Sign in from desktop", "st-pairing-heading");
        el(pairingSection, "p", "Start “Connect a Nomad” on desktop, then discover its address and enter its pairing code. Keep both devices on the same Wi-Fi.", "st-caption st-pairing-guidance");
        const addressInput = this.input(
          pairingSection,
          "Desktop address",
          d.pairingAddress,
          "url",
          (value) => (d.pairingAddress = value),
          "Use one of the addresses shown in desktop Obsidian.",
        );
        addressInput.autocomplete = "off";
        addressInput.inputMode = "url";
        if(controller.discoverSubscriptionDesktops){
          const originalField=addressInput.parentElement!;
          const field=el(pairingSection,"div",undefined,"st-field");
          originalField.replaceWith(field);
          while(originalField.firstChild)field.appendChild(originalField.firstChild);
          addressInput.id=`st-pairing-address-${crypto.randomUUID()}`;
          const caption=field.querySelector("span")!;
          const label=el(field,"label",caption.textContent??"Desktop address");
          label.htmlFor=addressInput.id;caption.replaceWith(label);
          const row=el(field,"div",undefined,"st-pairing-discover-row");
          row.appendChild(addressInput);
          const results=el(pairingSection,"div",undefined,"st-pairing-discovery-results");
          results.setAttribute("aria-live","polite");
          const find=btn(row,"Discover",()=>{
            find.disabled=true;find.textContent="Finding…";results.empty();
            void controller.discoverSubscriptionDesktops!.call(this.c).then(found=>{
              if(this.settingsDraft!==d||!addressInput.isConnected)return;
              const addresses=[...new Set(found.map(c=>c.address))];
              if(addresses.length===1){
                addressInput.value=d.pairingAddress=addresses[0];
                el(results,"p","Desktop found. Enter its pairing code below.","st-caption");
              }else if(addresses.length){
                el(results,"p","Choose a desktop address:","st-caption");
                for(const address of addresses)btn(results,address,()=>{
                  addressInput.value=d.pairingAddress=address;results.empty();
                  el(results,"p","Address selected. Enter its pairing code below.","st-caption");
                },"st-button st-text-button");
              }else el(results,"p","No active desktop found. Start pairing on desktop and wait for Obsidian Sync, then try again—or enter its address manually.","st-caption");
            }).catch(error=>{
              if(this.settingsDraft===d&&addressInput.isConnected)el(results,"p",err(error),"st-caption");
            }).finally(()=>{find.disabled=false;find.textContent="Discover";});
          },"st-button st-text-button st-pairing-discover");
          find.setAttribute("aria-label","Discover");
        }
        const codeInput = this.input(
          pairingSection,
          "Pairing code",
          d.pairingCode,
          "text",
          (value) => (d.pairingCode = value),
          "Enter the code shown on desktop; spaces and hyphens are allowed.",
        );
        codeInput.autocomplete = "one-time-code";
        codeInput.autocapitalize = "characters";
        codeInput.spellcheck = false;
        const connect = btn(
          pairingSection,
          "Connect",
          () => {
            const address = d.pairingAddress.trim();
            const code = d.pairingCode.replace(/[\s-]+/g, "");
            if (!address || !code) {
              new Notice("Enter the desktop address and pairing code.");
              return;
            }
            void runSubscriptionAction(async () => {
              await controller.pairSubscriptionDesktop?.call(this.c, address, code);
            });
          },
          "st-button st-primary st-pairing-connect",
        );
        connect.disabled = !controller.pairSubscriptionDesktop;
      }
      if (!status?.connected || status.needsSignIn) {
        const signInActions = el(connection, "div", undefined, "st-signin-actions");
        btn(
          signInActions,
          "Finish sign-in",
          () => runSubscriptionAction(controller.finishSubscriptionLogin),
          "st-button st-text-button",
        );
        if (controller.platform === "nomad" && status?.pairingPending) {
          btn(
            signInActions,
            "Cancel sign-in",
            () => runSubscriptionAction(controller.cancelSubscriptionPairing),
            "st-button st-text-button st-cancel-pairing-signin",
          );
        }
        if (isDesktop) {
          btn(
            connection,
            status?.needsSignIn ? "Reconnect ChatGPT account" : "Connect ChatGPT account",
            () => runSubscriptionAction(controller.connectSubscription),
            "st-button st-text-button",
          );
        } else {
          const browserSignin = el(connection, "div", undefined, "st-connection-details st-advanced-connection");
          this.help(browserSignin, "Use browser sign-in if desktop pairing is unavailable.", "Browser sign-in");
          btn(
            browserSignin,
            status?.needsSignIn ? "Reconnect ChatGPT account" : "Connect ChatGPT account",
            () => runSubscriptionAction(controller.connectSubscription),
            "st-button st-text-button",
          );
        }
      }
      const information = el(connection, "div", undefined, "st-connection-details");
      this.help(information, "ChatGPT manages plan allowance; this plugin tracks local attempts and cannot show remaining quota.", "Subscription allowance details");
      const manage = el(information, "a", "Manage subscription usage") as HTMLAnchorElement;
      manage.href = "https://chatgpt.com/#settings/Subscription";
      manage.target = "_blank";
      manage.rel = "noopener noreferrer";
      manage.addClass("st-manage-usage");
    }
    btn(
      connection,
      "Costs and limits",
      () => this.openCosts(),
      "st-button st-text-button",
    );

    const runBehavior = el(root, "section", undefined, "st-form-section st-settings-section st-run-behavior");
    el(runBehavior, "h2", "Updates", "st-section-heading");
    this.toggle(
      runBehavior,
      "AI recognition",
      d.aiEnabled,
      (v) => (d.aiEnabled = v),
      d.provider === "subscription" ? "Switch on when ready. Requests use your ChatGPT allowance." : "Switch on when ready. Requests use API credit.",
    );
    this.toggle(
      runBehavior,
      "Automatic catch-up",
      d.autoEnabled,
      (v) => (d.autoEnabled = v),
      "Runs while Obsidian is active",
    );
    this.number(runBehavior, "Simultaneous requests", d.concurrency, 1, 32, (v) => (d.concurrency = v));
    this.number(runBehavior, "Check interval (minutes)", d.intervalMinutes, 1, 60, (v) => (d.intervalMinutes = v));
    const general = d.profiles.find((p) => p.id === "general") ?? d.profiles[0];
    if (general) {
      const defaults = el(root, "section", undefined, "st-form-section st-settings-section st-recognition-defaults");
      el(defaults, "h2", "Recognition", "st-section-heading");
      el(defaults, "p", "Used by sources without custom recognition settings.", "st-caption st-section-help");
      this.modelPicker(defaults, "Default model", general.model, (v) => (general.model = v));
      this.qualitySlider(defaults, general.quality ?? "fast", (value) => { general.quality = value; });
      this.text(defaults, "Responses API endpoint", general.endpoint, (v) => (general.endpoint = v), "Use the provider Responses API endpoint.");
    }
    const presentation = el(root, "section", undefined, "st-form-section st-settings-section st-settings-presentation");
    el(presentation, "h2", "Appearance", "st-section-heading");
    this.toggle(
      presentation,
      "Show page headings in transcripts",
      d.showPageHeadings,
      (v) => (d.showPageHeadings = v),
      "Presentation only; changing this does not run recognition again.",
    );
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(
      actions,
      "Cancel",
      () => {
        this.settingsDraft = undefined;
        this.goBack();
      },
      "st-button st-text-button",
    );
    btn(
      actions,
      "Save",
      () => {
        const pending = this.actionGate.run("settings-save", async () => {
          this.setFormControlsDisabled(true);
          const controller = this.c as Controller & {
            aiEnabled: boolean;
            provider: "api" | "subscription";
            concurrency: number;
          };
          let nextProfiles: Profile[];
          try {
            nextProfiles = mergeProfileDrafts(
              this.c.config.profiles,
              this.settingsProfilesBaseline,
              d.profiles,
            );
          } catch (error) {
            new Notice(err(error));
            this.setFormControlsDisabled(false);
            return;
          }
          const previous = {
            apiKey: this.c.apiKey,
            aiEnabled: controller.aiEnabled,
            autoEnabled: this.c.autoEnabled,
            provider: controller.provider,
            concurrency: controller.concurrency,
            profiles: this.c.config.profiles,
            intervalMinutes: this.c.config.intervalMinutes,
            showPageHeadings: this.c.showPageHeadings,
          };
          const appliedProfiles = JSON.stringify(nextProfiles);
          this.c.apiKey = d.apiKey;
          controller.aiEnabled = d.aiEnabled;
          this.c.autoEnabled = d.autoEnabled;
          controller.provider = d.provider;
          controller.concurrency = d.concurrency;
          this.c.config.profiles = nextProfiles;
          this.c.config.intervalMinutes = d.intervalMinutes;
          this.c.showPageHeadings = d.showPageHeadings;
          try {
            await this.saveConfigQueued();
            this.settingsDraft = undefined;
            this.goBack();
          } catch (error) {
            if (this.c.apiKey === d.apiKey) this.c.apiKey = previous.apiKey;
            if (controller.aiEnabled === d.aiEnabled) controller.aiEnabled = previous.aiEnabled;
            if (this.c.autoEnabled === d.autoEnabled) this.c.autoEnabled = previous.autoEnabled;
            if (controller.provider === d.provider) controller.provider = previous.provider;
            if (controller.concurrency === d.concurrency) controller.concurrency = previous.concurrency;
            if (JSON.stringify(this.c.config.profiles) === appliedProfiles)
              this.c.config.profiles = previous.profiles;
            if (this.c.config.intervalMinutes === d.intervalMinutes)
              this.c.config.intervalMinutes = previous.intervalMinutes;
            if (this.c.showPageHeadings === d.showPageHeadings)
              this.c.showPageHeadings = previous.showPageHeadings;
            new Notice(err(error));
          } finally {
            this.setFormControlsDisabled(false);
          }
        });
        if (pending) safe(pending);
      },
      "st-button st-primary",
    );
  }
  private renderCosts() {
    const root = el(this.body, "section", undefined, "st-cost-screen");
    const controller = this.c as Controller & {
      provider?: "api" | "subscription";
      subscriptionUsage?: {
        requests: number;
        pages: number;
        inputTokens: number;
        outputTokens: number;
        unconfirmed: number;
        todayRequests?: number;
        dailyLimit?: number;
        day?: string;
      };
    };
    if (controller.provider === "subscription") {
      el(root, "h2", "Subscription activity", "st-section-heading");
      const usage = controller.subscriptionUsage;
      if (usage) {
        el(root, "p", "All tracked activity since tracking began", "st-caption");
        el(root, "p", `${usage.pages} pages · ${usage.requests} request attempts`, "st-summary-title");
        el(root, "p", `${usage.inputTokens.toLocaleString()} input tokens · ${usage.outputTokens.toLocaleString()} output tokens reported`, "st-caption");
        if (usage.unconfirmed)
          el(root, "p", `${usage.unconfirmed} interrupted attempt${usage.unconfirmed === 1 ? " is" : "s are"} already counted toward the local request limit.`, "st-caption");
        if (usage.todayRequests !== undefined && usage.dailyLimit !== undefined)
          el(root, "p", `Today (UTC): ${usage.todayRequests} of ${usage.dailyLimit} attempts (local limit)`, "st-summary-title");
        if (usage.bySource?.length) {
          const breakdown = el(root, "details", undefined, "st-subscription-breakdown");
          el(breakdown, "summary", "Activity by note and model");
          const appendRows = (title: string, rows: { name: string; requests: number; pages: number; inputTokens: number; outputTokens: number }[]) => {
            el(breakdown, "h3", title, "st-field-heading");
            for (const row of rows) {
              const item = el(breakdown, "div", undefined, "st-cost-row");
              el(item, "span", row.name, "st-cost-row-name");
              el(item, "span", `${row.requests} requests · ${row.pages} completed pages`);
              el(item, "small", `${row.inputTokens.toLocaleString()} input / ${row.outputTokens.toLocaleString()} output tokens`);
            }
          };
          const aggregate = (key: "source" | "model", label: (key: string) => string) => {
            const grouped = new Map<string, { requests: number; pages: number; inputTokens: number; outputTokens: number }>();
            for (const row of usage.bySource!) {
              const groupKey = row[key];
              const total = grouped.get(groupKey) ?? { requests: 0, pages: 0, inputTokens: 0, outputTokens: 0 };
              total.requests += row.requests;
              total.pages += row.pages;
              total.inputTokens += row.inputTokens;
              total.outputTokens += row.outputTokens;
              grouped.set(groupKey, total);
            }
            return [...grouped].map(([groupKey, totals]) => ({ name: label(groupKey), ...totals }));
          };
          appendRows("By note", aggregate("source", (source) => source));
          appendRows("By model", aggregate("model", friendlyModel));
        }
      } else {
        el(root, "p", "No subscription request activity has been reported yet.", "st-caption");
      }
      el(root, "p", "Request counts are tracked locally; token totals come from provider-reported responses. ChatGPT manages plan allowance. This plugin does not show remaining quota or dollar charges.", "st-caption");
      const manage = el(root, "a", "Manage subscription usage") as HTMLAnchorElement;
      manage.href = "https://chatgpt.com/#settings/Subscription";
      manage.target = "_blank";
      manage.rel = "noopener noreferrer";
      manage.addClass("st-manage-usage");
      const settings: CostSettings = this.costDraft ?? JSON.parse(JSON.stringify(this.c.costs.settings));
      this.costDraft = settings;
      this.number(root, "Daily request limit", settings.dailyRequests, 0, 100000, (value) => (settings.dailyRequests = value));
      const actions = el(this.footer, "div", undefined, "st-actions");
      btn(actions, "Cancel", () => this.goBack(), "st-button st-text-button");
      btn(actions, "Save", () => safe(this.c.saveCostSettings(settings).then(() => this.goBack())), "st-button st-primary");
      return;
    }
    this.costLive = el(root, "section", undefined, "st-cost-live");
    this.refreshCosts();
    const settings: CostSettings =
      this.costDraft ?? JSON.parse(JSON.stringify(this.c.costs.settings));
    this.costDraft = settings;
    const endpointId = (value: string) => {
      try {
        return endpointKey(value);
      } catch {
        return value;
      }
    };
    const standard = el(root, "section", undefined, "st-standard-pricing");
    el(standard, "h2", "Model pricing", "st-section-heading");
    el(standard, "p", "Built-in rates verified 6 October 2026", "st-caption");
    const configuredPricing = new Map<
      string,
      { endpoint: string; model: string }
    >();
    for (const profile of this.c.config.profiles)
      configuredPricing.set(
        `${endpointId(profile.endpoint)}\n${profile.model}`,
        { endpoint: profile.endpoint, model: profile.model },
      );
    for (const { endpoint, model } of configuredPricing.values()) {
      let effective: Price | undefined;
      try {
        effective = priceFor(endpoint, model, settings);
      } catch {
        /* Missing rates are shown below. */
      }
      const override = settings.prices.some(
        (p) =>
          endpointId(p.endpoint) === endpointId(endpoint) && p.model === model,
      );
      el(
        standard,
        "p",
        effective
          ? `${friendlyModel(model)} · ${override ? "Custom" : "Standard"} · $${effective.input} input / $${effective.cached} cached / $${effective.cacheWrite} cache write / $${effective.output} output per million tokens`
          : `${friendlyModel(model)} · No rate set · recognition blocked`,
        effective ? "st-caption" : "st-error",
      );
    }
    if (!configuredPricing.size)
      el(standard, "p", "No models configured.", "st-caption");
    const details = el(root, "details", undefined, "st-cost-settings");
    el(details, "summary", "Limits and model pricing");
    el(
      details,
      "p",
      "Limits apply to new recognition requests. A zero limit stops recognition.",
      "st-caption",
    );
    this.currencyInput(
      details,
      "Daily spending limit (USD)",
      settings.dailyUsd,
      (v) => (settings.dailyUsd = v),
    );
    this.currencyInput(
      details,
      "Monthly spending limit (USD)",
      settings.monthlyUsd,
      (v) => (settings.monthlyUsd = v),
    );
    this.currencyInput(
      details,
      "Per update spending limit (USD)",
      settings.runUsd,
      (v) => (settings.runUsd = v),
    );
    this.number(
      details,
      "Daily request limit",
      settings.dailyRequests,
      0,
      100000,
      (v) => (settings.dailyRequests = v),
    );
    this.number(
      details,
      "Output allowance per page",
      settings.maxOutputTokens,
      256,
      4096,
      (v) => (settings.maxOutputTokens = v),
    );
    el(details, "p", "Grouped requests multiply this allowance by their target page count. Balanced and Careful apply 4,096 and 8,192 token request floors. Reasoning tokens use this output allowance.", "st-caption");
    const pricing = el(details, "details", undefined, "st-pricing");
    el(pricing, "summary", "Customize pricing");
    el(
      pricing,
      "p",
      "Rates are USD per million tokens. Verify your provider's rates before changing them. Missing rates block recognition.",
      "st-caption",
    );
    const configured = new Map<string, { endpoint: string; model: string }>();
    for (const profile of this.c.config.profiles) {
      const key = `${endpointId(profile.endpoint)}\n${profile.model}`;
      configured.set(key, { endpoint: profile.endpoint, model: profile.model });
    }
    for (const price of settings.prices) {
      const key = `${endpointId(price.endpoint)}\n${price.model}`;
      configured.set(key, { endpoint: price.endpoint, model: price.model });
    }
    for (const standard of STANDARD_PRICES) {
      if (
        this.c.config.profiles.some(
          (p) => p.model === standard.model && p.endpoint === standard.endpoint,
        )
      ) {
        const key = `${endpointId(standard.endpoint)}\n${standard.model}`;
        configured.set(key, {
          endpoint: standard.endpoint,
          model: standard.model,
        });
      }
    }
    for (const { endpoint, model } of configured.values()) {
      const key = `${endpointId(endpoint)}\n${model}`;
      let current: Price | undefined;
      try {
        current = priceFor(endpoint, model, settings);
      } catch {
        current = undefined;
      }
      const override = settings.prices.find(
        (p) =>
          endpointId(p.endpoint) === endpointId(endpoint) && p.model === model,
      );
      const initial = override ?? current;
      const group = el(pricing, "section", undefined, "st-price-editor");
      el(group, "h3", friendlyModel(model), "st-field-heading");
      el(group, "p", endpoint, "st-caption");
      el(
        group,
        "p",
        current
          ? override
            ? "Custom rate"
            : "Standard rate"
          : "No rate set · recognition blocked",
        current ? "st-caption" : "st-error",
      );
      if (
        override &&
        STANDARD_PRICES.some(
          (p) =>
            p.model === model &&
            endpointId(p.endpoint) === endpointId(endpoint),
        )
      )
        btn(
          group,
          "Restore standard pricing",
          () => {
            const scroll = this.body.scrollTop;
            const open = Array.from(
              this.body.querySelectorAll<HTMLDetailsElement>("details[open]"),
            ).map((d) => d.querySelector("summary")?.textContent ?? "");
            settings.prices = settings.prices.filter(
              (p) =>
                !(
                  endpointId(p.endpoint) === endpointId(endpoint) &&
                  p.model === model
                ),
            );
            this.render();
            for (const detail of Array.from(
              this.body.querySelectorAll<HTMLDetailsElement>("details"),
            ))
              if (
                open.includes(
                  detail.querySelector("summary")?.textContent ?? "",
                )
              )
                detail.open = true;
            this.body.scrollTop = scroll;
            Array.from(
              this.body.querySelectorAll<HTMLElement>(".st-price-editor"),
            )
              .find((item) => item.dataset.priceKey === key)
              ?.querySelector<HTMLButtonElement>(".st-restore-price")
              ?.focus({ preventScroll: true });
          },
          "st-button st-text-button st-restore-price",
        );
      const values: Record<string, number> = {
        input: initial?.input ?? NaN,
        cached: initial?.cached ?? NaN,
        cacheWrite: initial?.cacheWrite ?? NaN,
        output: initial?.output ?? NaN,
        longThreshold: initial?.longThreshold ?? NaN,
        longInputMultiplier: initial?.longInputMultiplier ?? NaN,
        longOutputMultiplier: initial?.longOutputMultiplier ?? NaN,
      };
      const fields: [string, keyof Price, number, string][] = [
        ["Input", "input", 0, "USD per million tokens"],
        ["Cached input", "cached", 0, "USD per million tokens"],
        ["Cache write", "cacheWrite", 0, "USD per million tokens"],
        ["Output", "output", 0, "USD per million tokens"],
        ["Long context threshold", "longThreshold", 1, "Input tokens"],
        ["Long input multiplier", "longInputMultiplier", 1, "Multiplier"],
        ["Long output multiplier", "longOutputMultiplier", 1, "Multiplier"],
      ];
      for (const [label, field, min, unit] of fields) {
        const input = this.input(
          group,
          `${label} (${unit})`,
          Number.isFinite(values[field]) ? String(values[field]) : "",
          "number",
          (raw) => {
            values[field] = raw.trim() ? Number(raw) : NaN;
            let price = settings.prices.find(
              (p) =>
                endpointId(p.endpoint) === endpointId(endpoint) &&
                p.model === model,
            );
            if (!price) {
              price = {
                endpoint,
                model,
                input: NaN,
                cached: NaN,
                cacheWrite: NaN,
                output: NaN,
                longThreshold: NaN,
                longInputMultiplier: NaN,
                longOutputMultiplier: NaN,
              };
              settings.prices.push(price);
            }
            Object.assign(price, values);
          },
        );
        input.step = field === "longThreshold" ? "1" : "any";
        input.min = String(min);
        if (!Number.isFinite(values[field])) input.placeholder = "Required";
      }
      group.dataset.priceKey = key;
    }
    const actions = el(this.footer, "div", undefined, "st-actions");
    btn(
      actions,
      "Cancel",
      () => {
        this.costDraft = JSON.parse(JSON.stringify(this.c.costs.settings));
        this.screen = this.costReturnScreen;
        this.render();
      },
      "st-button st-text-button",
    );
    btn(
      actions,
      "Save",
      () => {
        safe(
          this.c.saveCostSettings(settings).then(() => {
            this.costDraft = JSON.parse(JSON.stringify(this.c.costs.settings));
            this.screen = this.costReturnScreen;
            this.render();
          }),
        );
      },
      "st-button st-primary",
    );
  }
  private refreshCosts() {
    const root = this.costLive;
    if (!root) return;
    const snap = this.c.costs;
    const key = JSON.stringify(snap);
    if (root.dataset.key === key) return;
    const scroll = this.body.scrollTop;
    const focusAction = (document.activeElement as HTMLElement | null)?.dataset
      .costAction;
    const openBreakdowns = new Set(
      Array.from(
        root.querySelectorAll<HTMLDetailsElement>(".st-cost-breakdown[open]"),
      ).map((details) => details.dataset.breakdown),
    );
    root.dataset.key = key;
    root.empty();
    el(root, "h2", "Spending", "st-section-heading");
    if (snap.issue) el(root, "p", snap.issue, "st-error");
    this.costBudget(root, "Today", snap.day, snap.settings.dailyUsd);
    this.costBudget(root, "This month", snap.month, snap.settings.monthlyUsd);
    const lifetime = el(root, "section", undefined, "st-cost-lifetime");
    el(lifetime, "h3", "Tracked estimate", "st-field-heading");
    el(
      lifetime,
      "p",
      `${this.costMoney(snap.total.spentUsd)} · ${snap.total.pages} ${snap.total.pages === 1 ? "page" : "pages"} recognized · ${snap.total.requests} requests`,
      "st-summary-title",
    );
    el(
      lifetime,
      "p",
      `Local estimate · Tracking since ${new Date(snap.startedAt).toLocaleDateString()} · Earlier usage excluded`,
      "st-caption",
    );
    if (snap.total.heldUsd > 0)
      el(
        lifetime,
        "p",
        `${this.costMoney(snap.total.heldUsd)} held for pending or unconfirmed requests`,
        "st-caption",
      );
    if (snap.unconfirmed) {
      el(
        lifetime,
        "p",
        `Counts the full reserved amount as spent.`,
        "st-caption",
      );
      const resolve = btn(
        lifetime,
        "Count held amount",
        () => safe(this.c.resolveUnconfirmedCosts()),
        "st-button st-text-button st-held-button",
      );
      resolve.dataset.costAction = "resolve-held";
    }
    this.costBreakdown(
      root,
      "By notebook",
      snap.notebooks.map((x) => ({
        name: base(x.source).replace(/\.note$/i, ""),
        parent: shortPath(x.source.slice(0, x.source.lastIndexOf("/"))),
        ...x,
      })),
    );
    this.costBreakdown(
      root,
      "By model",
      snap.models.map((x) => ({ name: friendlyModel(x.model), ...x })),
    );
    root
      .querySelectorAll<HTMLDetailsElement>(".st-cost-breakdown")
      .forEach((details) => {
        details.open = openBreakdowns.has(details.dataset.breakdown);
      });
    if (focusAction)
      root
        .querySelector<HTMLElement>(
          `[data-cost-action="${CSS.escape(focusAction)}"]`,
        )
        ?.focus({ preventScroll: true });
    this.body.scrollTop = scroll;
  }
  private costBudget(
    parent: HTMLElement,
    title: string,
    totals: { spentUsd: number; heldUsd: number; requests: number },
    limit: number,
  ) {
    const section = el(parent, "section", undefined, "st-cost-budget");
    const label = el(section, "div", undefined, "st-cost-budget-heading");
    el(label, "strong", title);
    el(
      label,
      "span",
      limit > 0
        ? `${this.costMoney(totals.spentUsd + totals.heldUsd)} of ${this.costMoney(limit)}`
        : "$0.00 limit · Recognition blocked",
    );
    const track = el(section, "div", undefined, "st-progress st-cost-bar");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute(
      "aria-label",
      `${title} spending including held requests`,
    );
    const ratio =
      limit > 0 ? Math.min(1, (totals.spentUsd + totals.heldUsd) / limit) : 0;
    el(track, "div", undefined, "st-progress-fill").style.width =
      `${ratio * 100}%`;
    track.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    el(
      section,
      "p",
      `${this.costMoney(totals.spentUsd)} spent · ${this.costMoney(totals.heldUsd)} held · ${totals.requests} requests`,
      "st-caption",
    );
  }
  private costBreakdown(
    parent: HTMLElement,
    title: string,
    rows: (Record<string, any> & {
      name: string;
      spentUsd: number;
      heldUsd: number;
      pages: number;
      requests: number;
    })[],
  ) {
    const details = el(parent, "details", undefined, "st-cost-breakdown");
    details.dataset.breakdown = title;
    const summary = el(details, "summary", title);
    summary.dataset.costAction = `breakdown-${title.toLowerCase().replace(/\s+/g, "-")}`;
    if (!rows.length) {
      el(details, "p", "No tracked requests yet", "st-caption");
      return;
    }
    for (const row of rows) {
      const item = el(details, "div", undefined, "st-cost-row");
      const label = el(item, "div", undefined, "st-cost-row-name");
      el(label, "strong", row.name);
      if (row.parent) el(label, "small", row.parent);
      el(
        item,
        "span",
        `${this.costMoney(row.spentUsd)} spent · ${this.costMoney(row.heldUsd)} held`,
        "st-caption",
      );
      el(item, "small", `${row.pages} pages · ${row.requests} requests`);
    }
  }
  private costMoney(value: number) {
    return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
  }
  private renderDetail() {
    const states = Object.values(this.displayStore.notebooks).filter(
      (s) => s.ruleId === this.selectedRule,
    );
    if (!states.length) {
      this.goHome();
      return;
    }
    if (!states.some((s) => s.source === this.selectedSource))
      this.selectedSource = states[0].source;
    const select = el(this.body, "label", undefined, "st-field");
    el(select, "span", "Notebook");
    const choose = el(select, "select") as HTMLSelectElement;
    for (const s of states) {
      const op = el(choose, "option", shortPath(s.source)) as HTMLOptionElement;
      op.value = s.source;
    }
    choose.value = this.selectedSource;
    choose.addEventListener("change", () => {
      this.selectedSource = choose.value;
      this.render();
    });
    this.detailLive = el(this.body, "section", undefined, "st-detail-live");
    this.pageIssuesLive = el(this.body, "section", undefined, "st-page-issues");
    this.refreshPageIssues(this.displayStore.notebooks[this.selectedSource]);
    this.refreshDetail();
    const controls = el(this.body, "section", undefined, "st-detail-controls");
    const state = this.displayStore.notebooks[this.selectedSource];
    btn(
      this.footer,
      "Open transcript",
      () => safe(this.openOutputAndClose(state.output)),
      "st-button st-primary",
    );
    this.renderDocumentActions(controls, state);
    const previewDetails = el(controls, "details", undefined, "st-detail-preview");
    el(previewDetails, "summary", "Preview a page");
    const previewRange = this.input(
      previewDetails,
      "Page number",
      this.range.split(/[,-]/)[0] ?? "",
      "number",
      () => {},
      "Page to preview",
    );
    btn(previewDetails, "Preview", () => {
      const n = Number(previewRange.value);
      if (!Number.isInteger(n) || n < 1)
        return new Notice("Enter a page number or range.");
      safe(
        this.c
          .preview(state.source, n)
          .then((image) => new ImageModal(this.app, image).open()),
      );
    });
    btn(
      controls,
      "Exclude notebook from this source",
      () => {
        safe(this.c.excludeNotebook(state.source).then(() => this.goHome()));
      },
      "st-button st-text-button",
    );
    const technical = el(controls, "details", undefined, "st-notebook-technical");
    el(technical, "summary", "Technical details");
    el(technical, "p", `Source: ${state.source}`, "st-caption");
    el(technical, "p", `Output: ${state.output}`, "st-caption");
    el(
      technical,
      "p",
      `Revision ${state.revision || "not indexed"} · saved ${state.lastSaved || "never"}`,
      "st-caption",
    );
    const recognitionHistory = el(technical, "details", undefined, "st-recognition-history");
    el(recognitionHistory, "summary", "Page recognition history");
    const recognizedPages = state.desired.filter((page) => {
      const saved = state.pages[page.id];
      return saved?.fingerprint === page.fingerprint && !!saved.recognition;
    });
    if (recognizedPages.length) {
      const list = el(recognitionHistory, "ul", undefined, "st-recognition-history-list");
      for (const page of recognizedPages) {
        const metadata = state.pages[page.id].recognition!;
        const date = Number.isNaN(Date.parse(metadata.recognizedAt))
          ? metadata.recognizedAt
          : new Date(metadata.recognizedAt).toLocaleString();
        el(
          list,
          "li",
          `Page ${page.number}: ${metadata.model} · ${metadata.provider} · ${metadata.quality} · ${date}`,
          "st-caption",
        );
      }
    } else {
      el(recognitionHistory, "p", "No saved page recognition details yet.", "st-caption");
    }
    const deviceOcrPages = Object.values(state.deviceOcr ?? {}).filter((page) =>
      state.desired.some((descriptor) => descriptor.fingerprint === page.fingerprint),
    ).length;
    if (deviceOcrPages) {
      el(technical, "p", `Device OCR is available for ${deviceOcrPages} page${deviceOcrPages === 1 ? "" : "s"}; it is separate from saved AI recognition.`, "st-caption");
    }
  }
  private renderDocumentActions(parent: HTMLElement, state: Controller["store"]["notebooks"][string], compact = false) {
    const controls = el(parent, "section", undefined, `st-document-actions${compact ? " st-document-actions-compact" : ""}`);
    const operationController = this.c as Controller & {
      cleanupDocument?: (source: string, options?: { saveCopy?: boolean }) => Promise<void>;
      cleanupEstimate?: (source: string) => QueueEstimate;
      reprocessPages?: (source: string, range: string, outdatedOnly?: boolean) => Promise<void>;
    };
    if (this.canForceUpdate(state)) {
      const forceSection = el(controls, "section", undefined, "st-detail-task st-force-update-task");
      el(forceSection, compact ? "h3" : "h2", "Force update", "st-section-heading");
      el(forceSection, "p", this.forceUpdateReason(state, "This notebook needs attention before its next update."), "st-caption st-attention-reason");
      btn(forceSection, "Force update", () => this.openForceUpdate(state.source), "st-button st-text-button st-force-update-action");
    }
    const cleanupSection = el(controls, "section", undefined, "st-detail-task st-cleanup-task");
    const cleanupTitle = el(cleanupSection, "div", undefined, "st-document-action-title");
    el(cleanupTitle, compact ? "h3" : "h2", "Clean up document", "st-section-heading");
    this.help(cleanupTitle, "Clean formatting and transcription errors across the complete document, preserving your wording. One text-only request, with high reasoning where supported.", "Clean up document");
    const cleanupMetadata = (state as typeof state & { cleanup?: { updatedAt?: string; model?: string; quality?: string; stale?: boolean } }).cleanup;
    if (cleanupMetadata) {
      const when = cleanupMetadata.updatedAt ? new Date(cleanupMetadata.updatedAt).toLocaleString() : "date unavailable";
      const details = [cleanupMetadata.model, cleanupMetadata.quality, when].filter(Boolean).join(" · ");
      el(cleanupSection, "p", `Previous cleanup${cleanupMetadata.stale ? " · source text changed" : ""}: ${details}`, "st-caption");
    }
    const cleanupEstimate = operationController.cleanupEstimate?.(state.source);
    if (cleanupEstimate && cleanupEstimate.pages > 0) {
      const parts = [`${cleanupEstimate.pages} page${cleanupEstimate.pages === 1 ? "" : "s"}`, `${cleanupEstimate.requests} request${cleanupEstimate.requests === 1 ? "" : "s"}`];
      if ((this.c as Controller & { provider?: string }).provider === "subscription") {
        if (cleanupEstimate.seconds !== undefined) parts.push(`about ${this.duration(cleanupEstimate.seconds)}`);
        const usage = this.c.subscriptionUsage;
        const left = Math.max(0, usage.dailyLimit - usage.todayRequests);
        parts.push(`${left} of ${usage.dailyLimit} plugin requests left today`);
      } else {
        if (cleanupEstimate.usd !== undefined) parts.push(`about $${cleanupEstimate.usd.toFixed(4)}`);
        if (cleanupEstimate.reservationUsd !== undefined && cleanupEstimate.reservationUsd > 0)
          parts.push(`up to $${cleanupEstimate.reservationUsd.toFixed(4)} reserved`);
      }
      el(cleanupSection, "p", `Estimated cleanup: ${parts.join(" · ")}${cleanupEstimate.provisional ? " · provisional" : ""}`, "st-caption st-queue-estimate");
    }
    if ((this.c as Controller & { provider?: string }).provider === "subscription") {
    } else {
      const limits = this.c.costs.settings;
      const spent = this.c.costs.day.spentUsd + this.c.costs.day.heldUsd;
      const monthTotal = this.c.costs.month.spentUsd + this.c.costs.month.heldUsd;
      el(cleanupSection, "p", `API budget: $${spent.toFixed(4)} of $${limits.dailyUsd.toFixed(2)} today · ${this.c.costs.day.requests}/${limits.dailyRequests} requests today · $${monthTotal.toFixed(4)} of $${limits.monthlyUsd.toFixed(2)} this month · $${limits.runUsd.toFixed(2)} run cap.`, "st-caption");
    }
    this.toggle(
      cleanupSection,
      "Save cleaned text as a separate copy",
      this.cleanupSaveCopy,
      (value) => { this.cleanupSaveCopy = value; },
      "Off replaces the current transcript after preserving its previous version in history.",
    );
    const cleanupButton = btn(cleanupSection, this.cleanupBusySource === state.source ? "Cleaning up…" : "Clean up document", () => { void this.runDocumentCleanup(state.source); }, "st-button st-primary");
    const cleanupReady=state.desired.length>0&&state.desired.every(p=>state.pages[p.id]?.fingerprint===p.fingerprint);
    cleanupButton.disabled = !operationController.cleanupDocument || !!this.c.progress.stateBlocked || !aiOn(this.c) || this.c.progress.running || !cleanupReady || this.cleanupBusySource === state.source;
    if(!cleanupReady)el(cleanupSection,"p","Recognize all pages before cleanup.","st-caption");
    if (!operationController.cleanupDocument)
      el(cleanupSection, "p", "Document cleanup is not available in this runtime yet.", "st-caption st-inactive");
    else if (!aiOn(this.c))
      el(cleanupSection, "p", "Turn on AI recognition in Settings before requesting cleanup.", "st-caption st-inactive");
    else if (this.c.progress.stateBlocked)
      el(cleanupSection, "p", this.stateBlockedMessage(), "st-caption st-attention-reason");

    const reprocessSection = el(controls, "section", undefined, "st-detail-task st-reprocess-task");
    const reprocessTitle = el(reprocessSection, "div", undefined, "st-document-action-title");
    el(reprocessTitle, compact ? "h3" : "h2", "Re-recognize pages", "st-section-heading");
    this.help(reprocessTitle, "Choose page numbers or ranges. This explicit action sends the selected page images for recognition and may use provider credit.", "Re-recognize pages");
    let updateSelectionEstimate=()=>{};
    const range = this.input(
      reprocessSection,
      "Pages",
      this.range,
      "text",
      (v) => {this.range = v;updateSelectionEstimate();},
      "1, 3-5, 12",
    );
    range.placeholder = "For example: 1, 3-5, 12";
    this.toggle(
      reprocessSection,
      "Only pages with outdated recognition",
      this.outdatedOnly,
      (value) => { this.outdatedOnly = value;updateSelectionEstimate(); },
      "When off, every selected page is recognized again.",
    );
    const selectionEstimate=el(reprocessSection,"p",undefined,"st-caption st-selection-estimate");
    updateSelectionEstimate=()=>{
      try {
        const estimate=this.c.reprocessEstimate?.(state.source,this.range,this.outdatedOnly);
        setText(selectionEstimate,estimate?`${estimate.pages} selected pages · ${estimate.requests} requests${this.c.provider==="api"&&estimate.usd!==undefined?` · about $${estimate.usd.toFixed(4)}`:""}${estimate.provisional?" · provisional estimate":""}`:"Enter pages to estimate this operation.");
      }catch(error){setText(selectionEstimate,err(error));}
    };
    updateSelectionEstimate();
    const reprocessButton = btn(reprocessSection, aiOn(this.c) ? "Re-recognize selected pages" : "AI recognition is off", () => {
      if (this.screen === "editor" && this.sourceEditorDraftDirty())
        return new Notice("Save source settings before running notebook actions.");
      if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
      if (!this.range.trim()&&!this.outdatedOnly) return new Notice("Enter one or more page numbers or ranges.");
      if (!operationController.reprocessPages) return new Notice("Page re-recognition is not available in this runtime yet.");
      safe(operationController.reprocessPages(state.source, this.range, this.outdatedOnly));
    }, "st-button st-primary");
    reprocessButton.disabled = !operationController.reprocessPages || !!this.c.progress.stateBlocked || !aiOn(this.c) || this.c.progress.running;

  }
  private async runDocumentCleanup(source: string) {
    if (this.screen === "editor" && this.editorRule?.source === source && this.sourceEditorDraftDirty()) {
      new Notice("Save source settings before running notebook actions.");
      return;
    }
    const controller = this.c as Controller & {
      cleanupDocument?: (source: string, options?: { saveCopy?: boolean }) => Promise<void>;
    };
    if (!controller.cleanupDocument) {
      new Notice("Document cleanup is not available in this runtime yet.");
      return;
    }
    if (this.c.progress.stateBlocked) {
      new Notice(this.stateBlockedMessage());
      return;
    }
    if (!aiOn(this.c)) {
      new Notice("Turn on AI recognition in Settings before requesting cleanup.");
      return;
    }
    if (this.cleanupBusySource) return;
    this.cleanupBusySource = source;
    if (this.screen === "detail" && this.selectedSource === source) this.render();
    try {
      await controller.cleanupDocument(source, { saveCopy: this.cleanupSaveCopy });
      new Notice(this.cleanupSaveCopy ? "Cleaned transcript saved as a separate copy." : "Transcript cleanup completed; the previous version is in history.");
    } catch (error) {
      new Notice(`Could not clean up this transcript: ${err(error)}. Review the source and budget, then retry.`);
    } finally {
      if (this.cleanupBusySource === source) this.cleanupBusySource = "";
      if (this.screen === "detail" && this.selectedSource === source) this.render();
    }
  }
  private refreshPageIssues(state: Controller["store"]["notebooks"][string]) {
    const root = this.pageIssuesLive;
    if (!root) return;
    const issues = currentPageIssues(state);
    const failedCount = issues.filter((issue) => issue.status !== "skipped").length;
    const skippedCount = issues.length - failedCount;
    const partial = (state as typeof state & { status: string }).status === "partial";
    const legacyFailure = state.legacyPageFailure;
    const executionIssue = state.executionIssue;
    const retryQueued = this.notebookRetryQueued.has(state.source) && ["queued", "partial"].includes(state.status);
    const key = JSON.stringify([issues, partial, legacyFailure, executionIssue, retryQueued, this.c.progress.running, this.c.progress.paused, this.c.progress.stateBlocked]);
    if (root.dataset.key === key) return;
    root.dataset.key = key;
    root.empty();
    root.hidden = !issues.length && !partial && !legacyFailure && !executionIssue && !retryQueued;
    if (root.hidden) return;
    const sourceHeld = executionIssue?.scope === "source";
    const sourceChanged = !!executionIssue && /notebook (?:content )?changed/i.test(executionIssue.reason);
    const issueHeading = [
      failedCount ? `${failedCount} ${failedCount === 1 ? "page needs" : "pages need"} attention` : "",
      skippedCount ? `${skippedCount} ${skippedCount === 1 ? "page skipped" : "pages skipped"}` : "",
    ].filter(Boolean).join(" · ");
    el(root, "h2", issueHeading || (executionIssue ? "Source needs attention" : legacyFailure ? "Notebook needs attention" : "Ready to continue"), "st-section-heading");
    const issueCaption = failedCount && skippedCount
      ? "Other pages continue automatically. Retry failed pages; skipped pages stay omitted until retried."
      : failedCount
        ? "Other pages continue automatically. Retry or skip each failed page when ready."
        : skippedCount
          ? "These pages are intentionally omitted. Retry a page to add it back to the queue."
          : sourceHeld
            ? sourceChanged
              ? "Save the notebook, then retry this notebook."
              : "Review this source’s settings, then retry this notebook."
            : legacyFailure
              ? "This earlier failure does not identify a page. Retry the notebook to continue safely."
              : executionIssue
                ? "Check provider and model settings before retrying this notebook."
                : "The selected pages are queued. Continue when ready.";
    el(root, "p", issueCaption, "st-caption");
    if (executionIssue?.reason) {
      const reason = String(executionIssue.reason).replace(/\s+/g, " ").trim();
      el(root, "p", reason.length > 220 ? `${reason.slice(0, 217)}…` : reason, "st-caption st-attention-reason");
    }
    if (sourceHeld && !sourceChanged) {
      const rule = this.c.config.rules.find((item) => item.id === state.ruleId);
      if (rule)
        btn(root, "Configure source", () => this.openEditor(rule), "st-button st-text-button");
    }
    if (legacyFailure || executionIssue) {
      const retryNotebook = btn(root, "Retry notebook", () => {
        if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
        safe(this.c.retryNotebook(state.source).then(() => {
        this.notebookRetryQueued.add(state.source);
        this.refreshPageIssues(this.displayStore.notebooks[state.source]);
      }));
      }, "st-button st-text-button");
      retryNotebook.disabled = this.c.progress.running || !!this.c.progress.stateBlocked;
    }
    for (const issue of issues) {
      const row = el(root, "article", undefined, "st-page-issue");
      const copy = el(row, "div", undefined, "st-page-issue-copy");
      el(copy, "strong", `Page ${issue.number}${issue.status === "skipped" ? " · skipped" : ""}`);
      const reason = String(issue.reason || this.pageIssueFallback(issue.kind)).replace(/\s+/g, " ").trim();
      el(copy, "p", reason.length > 220 ? `${reason.slice(0, 217)}…` : reason, "st-caption");
      const actions = el(row, "div", undefined, "st-page-issue-actions");
      const retryPage = btn(actions, "Retry", () => {
        if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
        const controller = this.c as Controller & { retryPage?: (source: string, pageId: string) => Promise<void> };
        if (!controller.retryPage) return;
        const pending = this.actionGate.run(
          `page-action:${state.source}:${issue.id}`,
          () => controller.retryPage!(state.source, issue.id),
        );
        if (!pending) return;
        retryPage.disabled = true;
        safe(pending.finally(() => {
          this.refreshPageIssuesAfterAction(state.source);
        }));
      }, "st-button st-text-button");
      retryPage.disabled = this.c.progress.running || !!this.c.progress.stateBlocked;
      if (issue.status !== "skipped")
        {
          const skipPage = btn(actions, "Skip", () => {
          if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
          const controller = this.c as Controller & { skipPage?: (source: string, pageId: string) => Promise<void> };
          if (!controller.skipPage) return;
          const pending = this.actionGate.run(
            `page-action:${state.source}:${issue.id}`,
            () => controller.skipPage!(state.source, issue.id),
          );
          if (!pending) return;
          skipPage.disabled = true;
          safe(pending.finally(() => {
            this.refreshPageIssuesAfterAction(state.source);
          }));
        }, "st-button st-text-button");
          skipPage.disabled = this.c.progress.running || !!this.c.progress.stateBlocked;
        }
    }
    if (this.c.progress.paused || retryQueued) {
      const continueButton = btn(
        root,
        "Continue remaining pages",
        () => {
          if (this.c.progress.stateBlocked) return new Notice(this.stateBlockedMessage());
          safe(this.c.progress.paused ? this.c.resume() : this.c.update());
        },
        "st-button st-primary",
      );
      continueButton.disabled = this.c.progress.running || !!legacyFailure || !!executionIssue || !!this.c.progress.stateBlocked;
      if (this.c.progress.running)
        el(root, "p", "Wait for active requests to finish before continuing.", "st-caption");
    }
  }
  private refreshPageIssuesAfterAction(source: string) {
    if (this.screen !== "detail" || this.selectedSource !== source) return;
    const state = this.displayStore.notebooks[source];
    if (!state || !this.pageIssuesLive) return;
    // The prior render may have created a disabled button before the action
    // rejected. Force a fresh DOM render, but only in the same detail view.
    this.pageIssuesLive.dataset.key = "";
    this.refreshPageIssues(state);
  }
  private renderRecovery() {
    const state = this.displayStore.notebooks[this.selectedSource];
    const root = el(this.body, "section", undefined, "st-recovery");
    el(root, "h2", "Resolve edited transcript", "st-section-heading");
    if (this.c.progress.stateBlocked)
      this.renderStateBlockedNotice(root);
    if (
      !state ||
      (!this.recoveryResult && !canRecoverTranscriptEdits(state))
    ) {
      el(root, "p", "This transcript no longer has a recoverable edit conflict.", "st-caption");
      btn(this.footer, "Back to notebook", () => {
        this.screen = "detail";
        this.render();
      }, "st-button st-primary");
      return;
    }
    el(root, "p", "Your transcript contains edits that differ from the saved mirror. Choose how to preserve them.", "st-caption");
    el(root, "p", "Recovery uses saved recognition only. It does not send an AI request. Pages without cached results remain incomplete.", "st-caption st-recovery-note");
    if (this.recoveryWaitingForIdle) {
      el(root, "p", "Wait for active requests to finish before recovering this transcript. Pausing stops new requests; current requests finish first.", "st-caption st-recovery-note");
      if (this.c.progress.running && !this.c.progress.paused)
        btn(root, "Pause updates", () => {
          this.c.pause();
          this.render();
        }, "st-button st-text-button");
      else
        el(root, "p", "Updates are paused while active requests finish.", "st-caption");
    }
    if (this.recoveryResult) {
      const result = el(root, "section", undefined, "st-recovery-result");
      if (this.recoveryResult.action === "replace") {
        el(result, "p", "Saved recognition was restored to the mirror.", "st-summary-title");
        if (this.recoveryResult.backup) {
          el(result, "p", `Your edited version was backed up at ${this.recoveryResult.backup}`, "st-caption");
          btn(result, "Open backup", () => safe(this.openOutputAndClose(this.recoveryResult!.backup!)), "st-button st-text-button");
        }
      } else {
        el(result, "p", "Your edits remain at the original path. A new mirror was created.", "st-summary-title");
      }
      el(result, "p", `Mirror: ${this.recoveryResult.output}`, "st-caption st-recovery-path");
      btn(result, "Open mirror", () => safe(this.openOutputAndClose(this.recoveryResult!.output)), "st-button st-text-button");
      btn(this.footer, "Back to notebook", () => {
        this.screen = "detail";
        this.render();
      }, "st-button st-primary");
      return;
    }
    const preview = !this.recoveryWaitingForIdle && this.recoveryPreview?.source === state.source
      ? this.recoveryPreview
      : undefined;
    if (this.recoveryWaitingForIdle) {
      // Keep recovery actions hidden until the worker has gone idle.
    } else if (preview) {
      const path = el(root, "p", undefined, "st-caption st-recovery-path");
      el(path, "strong", "Current mirror: ");
      el(path, "span", preview.output);
      const compare = el(root, "details", undefined, "st-recovery-compare");
      el(compare, "summary", "Compare versions");
      const versions = el(compare, "div", undefined, "st-recovery-versions");
      const current = el(versions, "section", undefined, "st-recovery-version");
      el(current, "h3", "Your edited version");
      el(current, "pre", preview.current, "st-recovery-text");
      const generated = el(versions, "section", undefined, "st-recovery-version");
      el(generated, "h3", "Saved recognition");
      el(generated, "pre", preview.generated, "st-recovery-text");
    } else if (this.recoveryBusy) {
      el(root, "p", "Loading the edited transcript and saved recognition…", "st-caption");
    } else if (this.recoveryError) {
      el(root, "p", this.recoveryError, "st-error st-recovery-error");
      btn(root, "Reload comparison", () => void this.loadRecoveryPreview(state.source), "st-button st-text-button");
    } else {
      el(root, "p", "The transcript preview is not available.", "st-caption");
      btn(root, "Load comparison", () => void this.loadRecoveryPreview(state.source), "st-button st-text-button");
    }
    if (this.recoveryError && preview)
      el(root, "p", this.recoveryError, "st-error st-recovery-error");
    const actions = el(this.footer, "div", undefined, "st-actions st-recovery-actions");
    const cancel = btn(actions, "Cancel", () => {
      this.screen = "detail";
      this.render();
    }, "st-button st-text-button");
    cancel.disabled = this.recoveryBusy;
    const enabled = !!preview && !this.recoveryBusy && !this.c.progress.running && !this.c.progress.stateBlocked;
    const keep = btn(actions, "Keep edits · create new mirror", () => void this.resolveRecovery("keep"), "st-button st-text-button");
    keep.disabled = !enabled;
    const replace = btn(actions, "Back up edits and restore mirror", () => void this.resolveRecovery("replace"), "st-button st-primary");
    replace.disabled = !enabled;
  }
  private refreshDetail() {
    const state = this.displayStore.notebooks[this.selectedSource],
      root = this.detailLive;
    if (!state || !root) return;
    const view = notebookPresentation(state);
    const active = (
      this.c.progress as typeof this.c.progress & {
        activePage?: { source: string; number: number; total: number };
      }
    ).activePage;
    const label =
      this.c.progress.stage === "Waiting for AI" &&
      active?.source === state.source
        ? "Waiting for AI"
        : view.label;
    const caption =
      active?.source === state.source
        ? `Recognizing page ${active.number} of ${active.total} · ${view.ready} pages ready`
        : view.caption;
    const key = JSON.stringify([
      label,
      caption,
      view.ratio,
      this.forceUpdateReason(state, view.reason),
      currentPageIssues(state),
      state.error,
      (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked,
    ]);
    if (root.dataset.key === key) return;
    const scroll = this.body.scrollTop;
    root.dataset.key = key;
    root.empty();
    el(root, "p", label, "st-summary-title");
    el(root, "p", caption, "st-caption");
    const reason = this.forceUpdateReason(state, view.reason);
    if (reason)
      el(root, "p", reason, "st-caption st-attention-reason");
    if (state.error) {
      const diagnostics = el(root, "details", undefined, "st-notebook-diagnostics");
      el(diagnostics, "summary", "Notebook diagnostics");
      el(diagnostics, "p", state.error, "st-error st-attention-detail");
    }
    const blocked = (this.c.progress as typeof this.c.progress & { executionBlocked?: string }).executionBlocked;
    if (blocked) el(root, "p", `Recognition paused · ${blocked}`, "st-caption st-attention-reason");
    if (canRecoverTranscriptEdits(state))
      btn(root, "Resolve edits", () => this.openRecovery(state.source), "st-button st-text-button st-recovery-action");
    if (view.total) {
      const track = el(root, "div", undefined, "st-progress");
      const fill = el(track, "div", undefined, "st-progress-fill");
      fill.style.width = `${view.ratio * 100}%`;
    }
    this.body.scrollTop = scroll;
  }
  private pageIssueFallback(kind: string) {
    const messages: Record<string, string> = {
      render: "Could not render this page.",
      transport: "Connection interrupted.",
      incomplete: "The response did not finish.",
      refusal: "The model declined this page.",
      empty_response: "No transcript text was returned.",
      missing_terminal: "The response did not finish.",
      provider: "The provider could not complete this page.",
      unknown: "Recognition did not finish.",
    };
    return messages[kind] ?? messages.unknown;
  }
  private input(
    parent: HTMLElement,
    label: string,
    value: string,
    type: string,
    change: (v: string) => void,
    help?: string,
  ) {
    const f = el(parent, "div", undefined, "st-field");
    const title = el(f, "label", label);
    const i = el(f, "input") as HTMLInputElement;
    i.type = type;
    i.value = value;
    i.id = "st-input-" + Math.random().toString(36).slice(2);
    title.htmlFor = i.id;
    i.addEventListener("input", () => change(i.value));
    if (help) this.help(f, help, label);
    return i;
  }
  private select(
    parent: HTMLElement,
    label: string,
    value: string,
    options: [string, string][],
    change: (value: string) => void,
    help?: string,
  ) {
    const field = el(parent, "div", undefined, "st-field");
    const title = el(field, "label", label);
    const select = el(field, "select") as HTMLSelectElement;
    select.id = "st-select-" + Math.random().toString(36).slice(2);
    title.htmlFor = select.id;
    for (const [optionValue, optionLabel] of options) {
      const option = el(select, "option", optionLabel) as HTMLOptionElement;
      option.value = optionValue;
    }
    select.value = value;
    select.addEventListener("change", () => change(select.value));
    if (help) this.help(field, help, label);
    return select;
  }
  private modelPicker(
    parent: HTMLElement,
    label: string,
    model: string,
    change: (model: string) => void,
  ) {
    const field = el(parent, "div", undefined, "st-field st-model-picker");
    const title = el(field, "label", label);
    const select = el(field, "select") as HTMLSelectElement;
    select.id = "st-model-" + Math.random().toString(36).slice(2);
    title.htmlFor = select.id;
    const models = [...MODEL_OPTIONS];
    for (const optionModel of models) {
      const option = el(select, "option", friendlyModel(optionModel)) as HTMLOptionElement;
      option.value = optionModel;
    }
    const customOption = el(select, "option", "Custom…") as HTMLOptionElement;
    customOption.value = "__custom__";
    const isCustom = !MODEL_OPTIONS.includes(model);
    select.value = isCustom ? "__custom__" : model;
    const custom = el(field, "input") as HTMLInputElement;
    custom.type = "text";
    custom.autocomplete = "off";
    custom.spellcheck = false;
    custom.placeholder = "Enter model name";
    custom.value = isCustom ? model : "";
    custom.hidden = !isCustom;
    select.addEventListener("change", () => {
      custom.hidden = select.value !== "__custom__";
      if (select.value !== "__custom__") change(select.value);
      else {
        custom.focus();
        change(custom.value);
      }
    });
    custom.addEventListener("input", () => change(custom.value.trim()));
    this.help(field, "Choose a listed model or enter the exact model name supplied by your provider.", label);
    return select;
  }
  private qualitySlider(parent: HTMLElement, quality: "fast" | "balanced" | "careful", change: (value: "fast" | "balanced" | "careful") => void) {
    const field = el(parent, "div", undefined, "st-field st-quality-field st-quality-control");
    el(field, "span", "Recognition quality");
    const slider = el(field, "input") as HTMLInputElement;
    slider.type = "range";
    slider.min = "0";
    slider.max = "2";
    slider.step = "1";
    slider.value = String(Math.max(0, QUALITY.indexOf(quality)));
    slider.setAttribute("aria-label", "Recognition quality");
    slider.setAttribute("aria-valuetext", qualityLabel(quality));
    const labels = el(field, "div", undefined, "st-quality-labels");
    QUALITY.forEach((item) => el(labels, "span", qualityLabel(item)));
    const summary = el(field, "p", qualitySummary(quality), "st-quality-summary");
    slider.addEventListener("input", () => {
      const value = QUALITY[Number(slider.value)] ?? "fast";
      slider.setAttribute("aria-valuetext", qualityLabel(value));
      setText(summary, qualitySummary(value));
      change(value);
    });
  }
  private text(
    parent: HTMLElement,
    label: string,
    value: string,
    change: (v: string) => void,
    help?: string,
  ) {
    return this.input(parent, label, value, "text", change, help);
  }
  private textarea(
    parent: HTMLElement,
    label: string,
    value: string,
    change: (v: string) => void,
    help?: string,
  ) {
    const f = el(parent, "div", undefined, "st-field");
    const title = el(f, "label", label);
    const i = el(f, "textarea") as HTMLTextAreaElement;
    i.id = "st-textarea-" + Math.random().toString(36).slice(2);
    title.htmlFor = i.id;
    i.value = value;
    i.rows = 5;
    i.addEventListener("input", () => change(i.value));
    if (help) this.help(f, help, label);
    return i;
  }
  private number(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
  ) {
    return this.input(
      parent,
      label,
      String(value),
      "number",
      (v) => {
        const n = Number(v);
        if (Number.isInteger(n) && n >= min && n <= max) change(n);
      },
      `${min}–${max}`,
    );
  }
  private currencyInput(
    parent: HTMLElement,
    label: string,
    value: number,
    change: (n: number) => void,
  ) {
    const input = this.input(parent, label, String(value), "number", (raw) => {
      if (!raw.trim()) {
        change(Number.NaN);
        return;
      }
      const n = Number(raw);
      change(Number.isFinite(n) && n >= 0 && n <= 100000 ? n : Number.NaN);
    });
    input.min = "0";
    input.max = "100000";
    input.step = "0.01";
    return input;
  }
  private toggle(
    parent: HTMLElement,
    label: string,
    value: boolean,
    change: (v: boolean) => void,
    help?: string,
  ) {
    const f = el(parent, "div", undefined, "st-check-row");
    const title = el(f, "label", label, "st-check-label");
    const i = el(f, "input") as HTMLInputElement;
    i.type = "checkbox";
    i.checked = value;
    const id = `st-toggle-${Math.random().toString(36).slice(2)}`;
    i.id = id;
    title.htmlFor = id;
    i.addEventListener("change", () => change(i.checked));
    if (help) this.help(f, help, label);
    return i;
  }
  private help(parent: HTMLElement, text: string, label: string) {
    const helpButton = btn(parent, "?", () => {}, "st-button st-help-button");
    helpButton.setAttribute("aria-label", "Help: " + label);
    helpButton.setAttribute("aria-expanded", "false");
    const panel = el(parent, "small", text, "st-help-text");
    const panelId = "st-help-" + Math.random().toString(36).slice(2);
    panel.id = panelId;
    panel.hidden = true;
    helpButton.setAttribute("aria-controls", panelId);
    helpButton.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      helpButton.setAttribute("aria-expanded", String(!panel.hidden));
    });
  }
}

class ImageModal extends Modal {
  constructor(
    app: App,
    private src: string,
  ) {
    super(app);
    this.modalEl.addClass("st-preview-modal");
  }
  onOpen() {
    el(this.contentEl, "h2", "Preview");
    const image = this.contentEl.createEl("img", {
      attr: { src: this.src, alt: "Rendered notebook page" },
    });
    image.addClass("st-preview-image");
  }
  onClose() {
    this.contentEl.empty();
  }
}
