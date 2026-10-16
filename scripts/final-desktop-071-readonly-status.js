(() => {
  const fs = require("fs");
  const crypto = require("crypto");
  const p = app.plugins.plugins["nomad-transcripts"];
  const backupPath = "C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/backup-before-0.7.1-desktop/state-b.json";
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const before = backup.store;
  const after = p.store;
  const pageFields = ["source", "output", "desired", "pages", "publishedHash", "lastSaved", "history"];
  const notebooks = Object.keys(before.notebooks).map((source) => {
    const old = before.notebooks[source];
    const current = after.notebooks[source];
    return {
      name: source.replace(/\\/g, "/").split("/").pop(),
      pageFieldsUnchanged: !!current && pageFields.every((key) => JSON.stringify(old[key]) === JSON.stringify(current[key])),
      desiredPages: current?.desired?.length ?? 0,
      cachedPages: Object.keys(current?.pages ?? {}).length,
      status: current?.status ?? "missing",
      sharedConflict: typeof current?.error === "string" && /shared transcript/i.test(current.error),
      queued: after.queue.some((entry) => entry.source === source),
      stateDeltaFields: current ? [...new Set([...Object.keys(old), ...Object.keys(current)])].filter((key) => JSON.stringify(old[key]) !== JSON.stringify(current[key])) : ["missing"],
    };
  });
  const vault = p.app.vault;
  const configHash = (data) => crypto.createHash("sha256").update(data).digest("hex");
  const rules = p.config.rules.map((rule) => ({
    id: rule.id,
    source: String(rule.source).replace(/\\/g, "/").split("/").pop(),
    profileId: rule.profileId,
    sharedIdPresent: !!rule.sharedId,
    recursive: !!rule.recursive,
    excludeCount: rule.exclude?.length ?? 0,
  }));
  const satsangRule = p.config.rules.find((rule) => rule.id === "satsang");
  const profile = satsangRule && p.config.profiles.find((item) => item.id === satsangRule.profileId);
  const docs = [globalThis.document, globalThis.activeDocument].filter((doc, i, all) => doc?.querySelector && all.indexOf(doc) === i);
  const ownModal = docs.map((doc) => doc.querySelector(".st-fullscreen-modal")).find(Boolean);
  if (ownModal?.querySelector("h1")?.textContent === "Choose source") {
    const close = ownModal.querySelector('[aria-label="Close mirrors"]');
    close?.click();
  }
  const result = {
    version: p.manifest.version,
    platform: p.platform,
    initialized: !p.initializing,
    connected: !!p.subscriptionStatus.connected,
    idle: !p.task && !p.progress.running,
    paused: !!p.progress.paused,
    aiEnabled: !!p.aiEnabled,
    autoEnabled: !!p.autoEnabled,
    callsThisRun: p.callsThisRun ?? 0,
    stateBlocked: !!p.stateStorageIssue || !!p.progress.stateBlocked,
    durableStoreGeneration: before.generation ?? null,
    durableQueueCount: before.queue?.length ?? 0,
    currentQueueCount: after.queue?.length ?? 0,
    notebooks,
    configDir: vault.configDir,
    coreSyncEnabled: !!vault.getConfig("sync"),
    rules,
    satsangProfile: profile ? { id: profile.id, name: profile.name, model: profile.model, promptLength: profile.prompt?.length ?? 0, glossaries: (profile.glossaries ?? []).map((path) => String(path).replace(/\\/g, "/").split("/").pop()) } : null,
    satsangUsesDedicatedProfile: !!satsangRule && satsangRule.profileId !== "rule-reflections",
    reflectionProfileId: p.config.profiles.find((item) => item.id === "rule-reflections")?.id ?? null,
    syncDefinitionIdMatchNomad: null,
    formsRemaining: new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")])).size,
  };
  globalThis.__desktop071FinalReadonlyStatus = result;
  return result;
})()
