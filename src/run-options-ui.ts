import type {
  Profile,
  PromptLibraryControls,
  SourceSelection,
  TranscriptionOptions,
} from "./types";
import type { PromptRef, PromptRevision, PromptScope } from "./prompt-library.mjs";

export interface PromptRevisionSelectOptions {
  container: HTMLElement;
  scope: PromptScope;
  controls?: PromptLibraryControls;
  value?: PromptRef;
  onChange: (value?: PromptRef) => void;
  label?: string;
}

export interface RunOptionsRenderOptions {
  container: HTMLElement;
  selection: SourceSelection;
  draft: TranscriptionOptions;
  profiles: readonly Profile[];
  promptLibrary?: PromptLibraryControls;
  /** False for a configured source whose saved destination must be preserved. */
  allowOutputOverride?: boolean;
  disabled?: boolean;
  /** Undefined values mean remove that option from the caller-owned draft. */
  onChange: (patch: Partial<TranscriptionOptions>) => void;
}

const promptKey = (ref: PromptRef) => JSON.stringify([ref.id, ref.revision]);
const samePrompt = (left?: PromptRef, right?: PromptRef) =>
  !!left && !!right && left.id === right.id && left.revision === right.revision;

function promptRevisions(controls: PromptLibraryControls, scope: PromptScope) {
  const snapshot = controls.getSnapshot();
  return {
    revisions: snapshot.revisions.filter((item) => item.scope === scope)
      .slice().sort((a, b) => a.name.localeCompare(b.name) || b.revision - a.revision),
    defaultRef: snapshot.defaults[scope],
  };
}

/** Render a native, exact-revision prompt selector. Empty selection inherits the saved default. */
export function renderPromptRevisionSelect(options: PromptRevisionSelectOptions): HTMLSelectElement | undefined {
  const { container, scope, controls, value, onChange } = options;
  const doc = container.ownerDocument;
  if (!controls) {
    const unavailable = doc.createElement("p");
    unavailable.className = "setting-item-description";
    unavailable.textContent = "Saved prompt templates are unavailable in this runtime.";
    container.append(unavailable);
    return undefined;
  }

  let revisions: PromptRevision[];
  let defaultRef: PromptRef | undefined;
  try {
    ({ revisions, defaultRef } = promptRevisions(controls, scope));
  } catch (error) {
    const unavailable = doc.createElement("p");
    unavailable.className = "setting-item-description";
    unavailable.setAttribute("role", "alert");
    unavailable.textContent = error instanceof Error
      ? `Saved ${scope} prompts could not be loaded: ${error.message}`
      : `Saved ${scope} prompts could not be loaded.`;
    container.append(unavailable);
    return undefined;
  }

  const label = doc.createElement("label");
  label.className = "setting-item-name";
  label.textContent = options.label ?? `${scope === "recognition" ? "Recognition" : "Cleanup"} prompt`;
  const select = doc.createElement("select");
  select.className = "dropdown";
  select.id = `st-prompt-revision-${crypto.randomUUID()}`;
  label.htmlFor = select.id;
  select.setAttribute("aria-label", label.textContent);
  const defaultOption = doc.createElement("option");
  defaultOption.value = "";
  const defaultRevision = defaultRef && revisions.find((item) => samePrompt(defaultRef, item));
  defaultOption.textContent = scope === "recognition"
    ? "Use profile instructions"
    : defaultRevision
      ? `Use saved default · ${defaultRevision.name} · v${defaultRevision.revision}`
      : "Use saved default prompt";
  select.append(defaultOption);

  for (const revision of revisions) {
    const option = doc.createElement("option");
    const ref = { id: revision.id, revision: revision.revision };
    option.value = promptKey(ref);
    option.textContent = `${revision.name} · v${revision.revision}${samePrompt(defaultRef, ref) ? " · default" : ""}`;
    select.append(option);
  }

  if (value && !revisions.some((item) => samePrompt(value, item))) {
    const missing = doc.createElement("option");
    missing.value = promptKey(value);
    missing.textContent = `Selected prompt revision unavailable · v${value.revision}`;
    select.append(missing);
    missing.selected = true;
  } else if (value) {
    select.value = promptKey(value);
  }

  select.addEventListener("change", () => {
    if (!select.value) {
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(select.value);
      const [id, revision] = Array.isArray(parsed) ? parsed : [];
      if (typeof id === "string" && Number.isSafeInteger(revision) &&
          revisions.some((item) => item.id === id && item.revision === revision))
        onChange({ id, revision });
      else if (value && samePrompt(value, parsePromptKey(select.value)))
        onChange(value);
      else onChange(undefined);
    } catch { onChange(undefined); }
  });

  const field = doc.createElement("div");
  field.className = "setting-item-control";
  field.append(label, select);
  container.append(field);
  return select;
}

function parsePromptKey(value: string): PromptRef | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    const [id, revision] = Array.isArray(parsed) ? parsed : [];
    return typeof id === "string" && Number.isSafeInteger(revision) ? { id, revision } : undefined;
  } catch { return undefined; }
}

/** Render optional per-run overrides while leaving ownership of the draft with the caller. */
export function renderRunOptions(options: RunOptionsRenderOptions): HTMLDetailsElement {
  const { container, selection, draft, profiles, onChange } = options;
  const doc = container.ownerDocument;
  const details = doc.createElement("details");
  details.className = "st-run-options";
  const summary = doc.createElement("summary");
  summary.textContent = "Run options";
  details.append(summary);

  const patch = <K extends keyof TranscriptionOptions>(key: K, value: TranscriptionOptions[K] | undefined) =>
    onChange({ [key]: value } as Pick<TranscriptionOptions, K>);

  if (selection.kind === "folder") {
    const recursion = doc.createElement("div");
    recursion.className = "setting-item-control";
    const label = doc.createElement("label");
    label.className = "setting-item-name";
    label.textContent = "Folder contents";
    const select = doc.createElement("select");
    select.className = "dropdown";
    select.setAttribute("aria-label", "Folder contents");
    select.disabled = options.disabled === true;
    for (const [value, text] of [["", "Use source default"], ["true", "Include subfolders"], ["false", "Only this folder"]]) {
      const item = doc.createElement("option");
      item.value = value;
      item.textContent = text;
      select.append(item);
    }
    select.value = draft.recursive === undefined ? "" : String(draft.recursive);
    select.addEventListener("change", () => patch("recursive", select.value === "" ? undefined : select.value === "true"));
    recursion.append(label, select);
    details.append(recursion);
  }

  if (options.allowOutputOverride) {
    const destination = doc.createElement("div");
    destination.className = "setting-item-control";
    const label = doc.createElement("label");
    label.className = "setting-item-name";
    label.textContent = "Transcript folder";
    const input = doc.createElement("input");
    input.className = "text-input";
    input.type = "text";
    input.value = draft.output ?? "";
    input.placeholder = "Use the default folder";
    input.disabled = options.disabled === true;
    input.setAttribute("aria-label", "Transcript folder inside this vault");
    input.addEventListener("input", () => patch("output", input.value.trim() || undefined));
    const help = doc.createElement("p");
    help.className = "setting-item-description";
    help.textContent = "Optional folder inside this vault. Leave blank to use the default destination.";
    destination.append(label, input, help);
    details.append(destination);
  }

  const profileField = doc.createElement("div");
  profileField.className = "setting-item-control";
  const profileLabel = doc.createElement("label");
  profileLabel.className = "setting-item-name";
  profileLabel.textContent = "Recognition profile";
  const profileSelect = doc.createElement("select");
  profileSelect.className = "dropdown";
  profileSelect.setAttribute("aria-label", "Recognition profile");
  const defaultProfile = doc.createElement("option");
  defaultProfile.value = "";
  defaultProfile.textContent = "Use default profile";
  profileSelect.append(defaultProfile);
  for (const profile of profiles) {
    const item = doc.createElement("option");
    item.value = profile.id;
    item.textContent = profile.name;
    profileSelect.append(item);
  }
  profileSelect.value = draft.profileId ?? "";
  profileSelect.disabled = options.disabled === true;
  profileSelect.addEventListener("change", () => patch("profileId", profileSelect.value || undefined));
  profileField.append(profileLabel, profileSelect);
  details.append(profileField);

  const promptField = doc.createElement("div");
  promptField.className = "st-run-options-prompt";
  renderPromptRevisionSelect({ container: promptField, scope: "recognition", controls: options.promptLibrary,
    value: draft.prompt, onChange: (prompt) => patch("prompt", prompt) });
  promptField.querySelectorAll("select").forEach((select) => { select.disabled = options.disabled === true; });
  details.append(promptField);
  container.append(details);
  return details;
}
