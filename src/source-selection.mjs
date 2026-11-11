import { normalizeBrowserPath } from "./browser.mjs";
import { excluded, mirrorPath, ruleFor, validateDestination, validateSource } from "./reconcile.mjs";
import { resolvePromptVersion } from "./prompt-library.mjs";
import { snapshotRecognitionProfile, validRecognitionRun } from "./run-settings.mjs";

/** @typedef {import("./types").FolderRule} FolderRule */
/** @typedef {{rule: FolderRule, file?: string}} ConfiguredSourceScope */
/**
 * @typedef {{
 *   platform: "desktop" | "nomad",
 *   config: () => import("./types").ConfigV1,
 *   reader: Pick<import("./types").ReadOnlySource, "list" | "supportsDocument" | "documentFormat">,
 *   notebook: (path: string) => import("./types").NotebookState | undefined,
 *   defaultOutput: string,
 *   localId: (path: string) => Promise<string>,
 * }} SelectionPorts
 */

/**
 * @param {import("./types").SourceSelection} selection
 * @param {import("./types").ConfigV1} config
 * @param {"desktop" | "nomad"} platform
 * @param {string} defaultOutput
 * @param {() => string} newId
 * @returns {{status: import("./types").SourceRegistration["status"], rule: FolderRule}}
 */
export function planSourceRegistration(selection, config, platform, defaultOutput, newId) {
  const source = validateSource(selection.path, platform);
  const kind = /\.note$/i.test(source) ? "file" : "folder";
  if (selection.kind !== kind) throw Error("Choose a .note notebook or a folder.");
  const sourceKey = normalizeBrowserPath(source);
  const exact = config.rules.find(rule => {
    try { return normalizeBrowserPath(rule.source) === sourceKey; }
    catch { return rule.source === source; }
  });
  if (exact) return { status: "existing", rule: exact };
  const owner = ruleFor(source, config.rules);
  const child = kind === "folder" && config.rules.find(rule => rule.enabled && rule.source.startsWith(source + "/"));
  if (owner || child) return { status: "overlap", rule: owner || child };
  const profile = config.profiles.find(item => item.id === "general") ?? config.profiles[0];
  if (!profile) throw Error("No default model is configured.");
  return { status: "added", rule: {
    id: newId(), enabled: true, source, output: validateDestination(config.defaultOutput ?? defaultOutput),
    recursive: kind === "folder", exclude: [], profileId: profile.id, autoRecognize: false,
  } };
}

/**
 * @param {string} source
 * @param {FolderRule | undefined} rule
 */
export function sourceIncluded(source, rule) {
  if (!rule || excluded(source, rule.source, rule.exclude)) return false;
  const relative = source.slice(rule.source.length + 1);
  return rule.recursive || rule.source.endsWith(".note") || !relative.includes("/");
}

/**
 * Resolve the user selection before any source reads or queue writes.
 * @param {{source?: string, ruleId?: string}} target
 * @param {FolderRule[]} rules
 * @param {"desktop" | "nomad"} platform
 * @returns {ConfiguredSourceScope}
 */
export function configuredRecognitionScope(target, rules, platform) {
  const exact = typeof target?.source === "string";
  const folder = typeof target?.ruleId === "string";
  if (exact === folder) throw Error("Choose exactly one notebook or source folder.");
  if (exact) {
    const file = validateSource(target.source, platform);
    if (!/\.note$/i.test(file)) throw Error("Choose one .note notebook for Recognize now.");
    const rule = ruleFor(file, rules);
    if (!rule || !sourceIncluded(file, rule))
      throw Error("This notebook is excluded from the current source selection.");
    return { rule, file };
  }
  const rule = rules.find(item => item.id === target.ruleId && item.enabled);
  if (!rule) throw Error("Choose an enabled source folder.");
  return { rule };
}

/**
 * Inventory the selected scope through the host's read-only reader.
 * Recheck source ownership against current settings after the async listing.
 * @param {ConfiguredSourceScope} scope
 * @param {Pick<import("./types").ReadOnlySource, "list">} reader
 * @param {() => FolderRule[]} currentRules
 * @param {(path: string) => string | undefined} outputOverride
 * @returns {Promise<import("./types").SourceEntry[]>}
 */
export async function listConfiguredRecognition(scope, reader, currentRules, outputOverride) {
  const { file, rule } = scope;
  const listed = file ? await reader.list(file, false, [])
    : await reader.list(rule.source, rule.recursive, rule.exclude);
  const rules = currentRules();
  return listed.flatMap(item => {
    if (!/\.note$/i.test(item.path) || (file && item.path !== file)) return [];
    const owner = ruleFor(item.path, rules);
    if (owner?.id !== rule.id || !sourceIncluded(item.path, owner)) return [];
    return [{
      ...item,
      relative: item.path.split("/").pop(),
      ruleId: owner.id,
      profileId: owner.profileId,
      output: outputOverride(item.path) ?? mirrorPath(item.path, owner),
    }];
  });
}

/** @param {string} source @param {FolderRule[]} rules */
export function hasConfiguredScope(source, rules) {
  return rules.some(rule => source === rule.source || source.startsWith(rule.source.replace(/\/+$/, "") + "/"));
}

/**
 * Plan an explicit selection without creating a mirror rule or mutating the queue.
 * @param {import("./types").SourceSelection} selection
 * @param {import("./types").TranscriptionOptions} options
 * @param {SelectionPorts} ports
 * @returns {Promise<import("./types").SourceEntry[]>}
 */
export async function listTranscriptionSelection(selection, options, ports) {
  const path = validateSource(selection.path, ports.platform);
  const isDocument = value => ports.reader.supportsDocument?.(value) ?? /\.note$/i.test(value);
  const file = selection.kind === "file";
  if ((!file && selection.kind !== "folder") || file !== isDocument(path))
    throw Error("Choose a supported notebook or a folder.");
  const config = ports.config();
  const rulesAtStart = JSON.stringify(config.rules);
  const checkRules = () => {
    if (JSON.stringify(ports.config().rules) !== rulesAtStart)
      throw Error("Source settings changed while checking this selection. Choose Transcribe again.");
  };
  const scope = ruleFor(path, config.rules);
  const recursive = !file && (options.recursive ?? scope?.recursive ?? false);
  const files = await ports.reader.list(path, recursive, []);
  checkRules();
  const profile = config.profiles.find(item => item.id === "general") ?? config.profiles[0];
  const destinations = new Map();
  const entries = new Map();
  for (const item of files) {
    const source = validateSource(item.path, ports.platform);
    if (!isDocument(source) || (file ? source !== path : !source.startsWith(path + "/"))) continue;
    const relative = file ? source.split("/").pop() : source.slice(path.length + 1);
    if (!recursive && relative.includes("/")) continue;
    const owner = ruleFor(source, config.rules);
    if (owner ? !sourceIncluded(source, owner) : hasConfiguredScope(source, config.rules)) continue;
    const documentFormat = ports.reader.documentFormat?.(source);
    if (owner && documentFormat && documentFormat !== "supernote") continue;
    const saved = ports.notebook(source);
    const unboundOutput = `${options.output ?? config.defaultOutput ?? ports.defaultOutput}/${relative.replace(/\.[^/.]+$/, "")}.md`;
    const output = owner ? saved?.outputOverride ?? mirrorPath(source, owner)
      : saved && (saved.publishedHash || options.output === undefined) ? saved.output : unboundOutput;
    validateDestination(output);
    const outputKey = output.toLocaleLowerCase();
    const collision = destinations.get(outputKey);
    if (collision && collision !== source)
      throw Error("Two selected notebooks would use the same transcript. Choose separate sources or destinations.");
    destinations.set(outputKey, source);
    const profileId = owner?.profileId ?? saved?.oneTime?.profileId ?? profile?.id;
    if (!profileId) throw Error("No default model is configured.");
    entries.set(source, {
      ...item, path: source, relative, output, profileId,
      ruleId: owner?.id ?? (saved?.oneTime ? saved.ruleId : await ports.localId(source)),
      ...(owner ? {} : { oneTime: true }),
      ...(documentFormat && documentFormat !== "supernote" ? { documentFormat } : {}),
    });
  }
  checkRules();
  return [...entries.values()];
}

/**
 * Prepare a scoped request for the host's canonical durable queue.
 * @param {import("./types").SourceSelection} selection
 * @param {import("./types").TranscriptionOptions} options
 * @param {SelectionPorts & {
 *   reservedOutput: (path: string) => boolean,
 *   savedRun?: (path: string) => import("./types").RecognitionRun | undefined,
 *   admit: (entries: import("./types").SourceEntry[]) => Promise<void>,
 * }} ports
 */
export async function submitTranscriptionSelection(selection, options, ports) {
  const entries = await listTranscriptionSelection(selection, options, ports);
  const config = ports.config();
  const prompt = resolvePromptVersion(config.promptLibrary ?? [], options.prompt, "recognition");
  for (const entry of entries) {
    if (!!entry.documentFormat === /\.note$/i.test(entry.path))
      throw Error("The selected source has no valid document format.");
    if (ports.reservedOutput(entry.output))
      throw Error("Choose a transcript folder outside the plugin's support data.");
    const savedRun = ports.savedRun?.(entry.path);
    if (savedRun) entry.run = savedRun;
    else if (options.profileId !== undefined || prompt) {
      const profile = snapshotRecognitionProfile(config.profiles, options.profileId ?? entry.profileId);
      if (prompt) profile.prompt = prompt.text;
      const run = { profile, ...(prompt ? { prompt: { id: prompt.id, revision: prompt.revision } } : {}) };
      if (!validRecognitionRun(run))
        throw Error("The selected run profile cannot be saved safely. Review its model, endpoint, instructions and references.");
      entry.run = run;
    }
  }
  await ports.admit(entries);
}
