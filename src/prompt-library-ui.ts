export type PromptScope = "recognition" | "cleanup";
export type PromptRef = { id: string; revision: number };
export type PromptRevision = { id: string; name: string; scope: PromptScope; text: string; revision: number; createdAt: string };
export type PromptDraft = Pick<PromptRevision, "id" | "name" | "scope" | "text">;
export type PromptLibrarySnapshot = {
  revisions: readonly PromptRevision[];
  defaults: { recognition?: PromptRef; cleanup?: PromptRef };
};

/** The host owns validation, immutable history, persistence and default selection. */
export interface PromptLibraryPort {
  getSnapshot(): PromptLibrarySnapshot;
  save(draft: PromptDraft, expectedRevision: number): Promise<void>;
  duplicate(ref: PromptRef, name: string): Promise<void>;
  setDefault(scope: PromptScope, ref?: PromptRef): Promise<void>;
}

const scopeLabel = (scope: PromptScope) => scope === "recognition" ? "Recognition" : "Cleanup";
const sameRef = (a: PromptRef | undefined, b: PromptRef | undefined) => !!a && !!b && a.id === b.id && a.revision === b.revision;
const makeId = () => globalThis.crypto.randomUUID().toLowerCase();
const focusControl = (root: HTMLElement, selector: string) => (root.querySelector(selector) as HTMLElement | null)?.focus();

/** Settings editor for immutable prompt revisions and future-use defaults. */
export class PromptLibraryView {
  private promptScope: PromptScope = "recognition";
  private selected?: PromptRef;
  private draft?: PromptDraft;
  private expectedRevision = 0;
  private busy = false;
  private message = "";
  private duplicateName = "";

  constructor(private readonly contentEl: HTMLElement, private readonly port: PromptLibraryPort, private readonly actionsEl: HTMLElement) {
    this.render();
  }

  private snapshot() {
    return this.port.getSnapshot();
  }

  private selectedRevision(snapshot = this.snapshot()) {
    return this.selected
      ? snapshot.revisions.find(item => item.id === this.selected?.id && item.revision === this.selected?.revision)
      : undefined;
  }

  private render() {
    const root = this.contentEl;
    root.empty();
    this.actionsEl.empty();
    let snapshot: PromptLibrarySnapshot;
    try {
      snapshot = this.snapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The saved prompt library could not be loaded.";
      root.createEl("h2", { text: "Prompt library needs attention" });
      root.createEl("p", { text: message, attr: { role: "alert", "aria-live": "assertive" } });
      const retry = root.createEl("button", { text: "Try again" });
      retry.type = "button";
      retry.addEventListener("click", () => this.render());
      retry.focus();
      return;
    }
    const selectorRow = root.createDiv({ cls: "st-prompt-selectors" });
    const scopeLabelEl = selectorRow.createEl("label", { text: "Category" });
    const scopeSelect = scopeLabelEl.createEl("select", { attr: { "aria-label": "Prompt category" } });
    for (const scope of ["recognition", "cleanup"] as const) scopeSelect.createEl("option", { value: scope, text: scopeLabel(scope) });
    scopeSelect.value = this.promptScope;
    scopeSelect.disabled = this.busy;
    scopeSelect.addEventListener("change", () => {
      this.promptScope = scopeSelect.value as PromptScope;
      this.selected = undefined;
      this.draft = undefined;
      this.expectedRevision = 0;
      this.message = "";
      this.render();
      focusControl(this.contentEl, "select[aria-label='Prompt category']");
    });

    const revisions = snapshot.revisions.filter(item => item.scope === this.promptScope).slice().sort((a, b) => a.name.localeCompare(b.name) || b.revision - a.revision);
    const defaultRef = snapshot.defaults[this.promptScope];
    const revisionLabel = selectorRow.createEl("label", { text: `Saved ${this.promptScope} revisions` });
    const revisionSelect = revisionLabel.createEl("select", { attr: { "aria-label": `Saved ${this.promptScope} revisions` } });
    revisionSelect.createEl("option", { value: "", text: "Choose a saved revision" });
    for (const revision of revisions) {
      const ref = { id: revision.id, revision: revision.revision };
      const mark = sameRef(defaultRef, ref) ? " · default" : "";
      revisionSelect.createEl("option", { value: JSON.stringify([revision.id, revision.revision]), text: `${revision.name} · v${revision.revision}${mark}` });
    }
    if (this.selected) revisionSelect.value = JSON.stringify([this.selected.id, this.selected.revision]);
    revisionSelect.disabled = this.busy;
    revisionSelect.addEventListener("change", () => {
      let selected: unknown;
      try { selected = JSON.parse(revisionSelect.value); } catch { selected = undefined; }
      const [id, revision] = Array.isArray(selected) ? selected : [];
      this.selected = typeof id === "string" && Number.isSafeInteger(revision) ? { id, revision } : undefined;
      this.loadSelection();
      this.render();
      focusControl(this.contentEl, "input[aria-label='Prompt name']");
    });

    const currentDefault = defaultRef && snapshot.revisions.find(item => item.id === defaultRef.id && item.revision === defaultRef.revision);
    if (revisions.length) root.createEl("p", { text: currentDefault ? `Default ${this.promptScope}: ${currentDefault.name} · v${currentDefault.revision}` : `No ${this.promptScope} prompt default is selected.`, cls: "st-caption" });

    root.createEl("h2", { text: this.selected ? "Edit revision" : "New prompt", cls: "st-section-heading" });
    const nameLabel = root.createEl("label", { text: "Prompt name" });
    const name = nameLabel.createEl("input", { attr: { type: "text", maxlength: "80", "aria-label": "Prompt name" } });
    name.value = this.draft?.name ?? "";
    name.disabled = this.busy;
    name.addEventListener("input", () => {
      this.ensureDraft();
      this.draft!.name = name.value;
      refreshSave();
    });

    const textLabel = root.createEl("label", { text: "Prompt text" });
    const text = textLabel.createEl("textarea", { attr: { rows: "12", maxlength: "20000", "aria-label": "Prompt text" } });
    text.value = this.draft?.text ?? "";
    text.disabled = this.busy;
    text.spellcheck = true;
    text.addEventListener("input", () => {
      this.ensureDraft();
      this.draft!.text = text.value;
      refreshSave();
    });

    const actions = root.createDiv({ cls: "st-prompt-actions" });
    const create = actions.createEl("button", { text: "New prompt" });
    create.type = "button";
    create.hidden = !this.selected;
    create.disabled = this.busy;
    create.addEventListener("click", () => {
      this.selected = undefined;
      this.draft = { id: makeId(), name: "", scope: this.promptScope, text: "" };
      this.expectedRevision = 0;
      this.message = "";
      this.render();
      focusControl(this.contentEl, "input[aria-label='Prompt name']");
    });
    const save = this.actionsEl.createEl("button", {
      text: this.selected ? "Save as new revision" : "Create prompt",
      cls: "st-button st-primary",
    });
    save.type = "button";
    const refreshSave = () => {
      save.disabled = this.busy || !this.draft?.name.trim() || !this.draft.text.trim();
    };
    refreshSave();
    save.addEventListener("click", () => { void this.saveDraft(); });

    const defaults = root.createDiv({ cls: "st-prompt-actions" });
    defaults.hidden = !this.selected && !defaultRef;
    const setDefault = defaults.createEl("button", { text: `Use as ${this.promptScope.toLowerCase()} default` });
    setDefault.type = "button";
    setDefault.disabled = this.busy || !this.selected || sameRef(defaultRef, this.selected);
    setDefault.addEventListener("click", () => { void this.changeDefault(this.selected); });
    const resetDefault = defaults.createEl("button", { text: "Reset default" });
    resetDefault.type = "button";
    resetDefault.disabled = this.busy || !defaultRef;
    resetDefault.addEventListener("click", () => { void this.changeDefault(undefined); });

    const duplicateRow = root.createDiv({ cls: "st-prompt-actions st-prompt-duplicate" });
    duplicateRow.hidden = !this.selected;
    const duplicateLabel = duplicateRow.createEl("label", { text: "Duplicate as" });
    const duplicateName = duplicateLabel.createEl("input", { attr: { type: "text", maxlength: "80", "aria-label": "Duplicate prompt name" } });
    duplicateName.value = this.duplicateName;
    duplicateName.disabled = this.busy || !this.selectedRevision(snapshot);
    const duplicate = duplicateRow.createEl("button", { text: "Duplicate selected revision" });
    duplicate.type = "button";
    duplicate.disabled = this.busy || !this.selected || !this.duplicateName.trim();
    duplicateName.addEventListener("input", () => {
      this.duplicateName = duplicateName.value;
      duplicate.disabled = this.busy || !this.selected || !this.duplicateName.trim();
    });
    duplicate.addEventListener("click", () => { void this.duplicateSelected(); });

    if (this.message) root.createEl("p", { text: this.message, attr: { role: "status", "aria-live": "polite" } });
  }

  private loadSelection() {
    const selected = this.selectedRevision();
    if (!selected) {
      this.draft = undefined;
      this.expectedRevision = 0;
      return;
    }
    this.draft = { id: selected.id, name: selected.name, scope: selected.scope, text: selected.text };
    const latest = this.snapshot().revisions.filter(item => item.id === selected.id).reduce((value, item) => Math.max(value, item.revision), 0);
    this.expectedRevision = latest;
  }

  private ensureDraft() {
    if (!this.draft) this.draft = { id: makeId(), name: "", scope: this.promptScope, text: "" };
  }

  private async saveDraft() {
    if (!this.draft || this.busy) return;
    this.draft.scope = this.promptScope;
    const draft = { ...this.draft };
    this.busy = true;
    this.message = "Saving…";
    this.render();
    try {
      await this.port.save(draft, this.expectedRevision);
      const revisions = this.snapshot().revisions;
      const saved = revisions.filter(item => item.id === draft.id).reduce<PromptRevision | undefined>((latest, item) => !latest || item.revision > latest.revision ? item : latest, undefined);
      this.selected = saved ? { id: saved.id, revision: saved.revision } : undefined;
      this.draft = saved ? { id: saved.id, name: saved.name, scope: saved.scope, text: saved.text } : draft;
      this.expectedRevision = saved?.revision ?? this.expectedRevision + 1;
      this.message = "Saved as a new immutable revision.";
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Could not save this prompt. Your draft is still here.";
    } finally {
      this.busy = false;
      this.render();
      focusControl(this.contentEl, "textarea[aria-label='Prompt text']");
    }
  }

  private async duplicateSelected() {
    if (!this.selected || this.busy) return;
    const ref = { ...this.selected };
    const before = this.snapshot();
    const beforeIds = new Set(before.revisions.map(item => item.id));
    this.busy = true;
    this.message = "Duplicating…";
    this.render();
    try {
      await this.port.duplicate(ref, this.duplicateName.trim());
      const snapshot = this.snapshot();
      const createdIds = new Set(snapshot.revisions.filter(item => !beforeIds.has(item.id) && item.scope === this.promptScope && item.name === this.duplicateName.trim()).map(item => item.id));
      const duplicate = createdIds.size === 1
        ? snapshot.revisions.filter(item => createdIds.has(item.id)).reduce<PromptRevision | undefined>((latest, item) => !latest || item.revision > latest.revision ? item : latest, undefined)
        : undefined;
      this.selected = duplicate ? { id: duplicate.id, revision: duplicate.revision } : undefined;
      this.draft = duplicate ? { id: duplicate.id, name: duplicate.name, scope: duplicate.scope, text: duplicate.text } : undefined;
      this.expectedRevision = duplicate?.revision ?? 0;
      this.duplicateName = "";
      this.message = "Created a separate prompt with a new history.";
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Could not duplicate this prompt.";
    } finally {
      this.busy = false;
      this.render();
      focusControl(this.contentEl, "select[aria-label^='Saved']");
    }
  }

  private async changeDefault(ref?: PromptRef) {
    if (this.busy) return;
    this.busy = true;
    this.message = "Updating default…";
    this.render();
    try {
      await this.port.setDefault(this.promptScope, ref);
      this.message = ref ? "Default updated for future requests." : "Default reset. Existing requests and saved results are unchanged.";
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Could not update the default.";
    } finally {
      this.busy = false;
      this.render();
      focusControl(this.contentEl, "select[aria-label^='Saved']");
    }
  }
}
