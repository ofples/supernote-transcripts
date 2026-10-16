(() => {
  const id = "nomad-transcripts";
  const p = app.plugins.plugins[id];
  const basename = (value) => String(value ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl,
    globalThis.activeDocument?.contentEl, globalThis.activeDocument?.document]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const nodes = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]));
  const dialogs = [...nodes].map((node) => ({
    own: node.matches(".st-fullscreen-modal,.st-preview-modal") || !!node.querySelector(".st-fullscreen-modal,.st-preview-modal"),
  }));
  const sync = app.internalPlugins?.plugins?.sync;
  const syncPlugin = sync?.instance;
  const boolFields = (value, keys) => Object.fromEntries(keys.map((key) => [key, typeof value?.[key] === "boolean" ? value[key] : null]));
  const rules = p?.config?.rules ?? [];
  const profiles = p?.config?.profiles ?? [];
  const notebooks = Object.values(p?.store?.notebooks ?? {});
  const result = {
    version: p?.manifest?.version ?? null,
    loaded: !!p,
    initialized: !!p && !p.initializing,
    idle: !!p && !p.task && !p.progress.running,
    paused: p?.progress?.paused === true,
    pausedPreference: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:paused`),
    stateBlocked: !!p?.stateStorageIssue || !!p?.progress?.stateBlocked,
    connected: !!p?.subscriptionStatus?.connected,
    aiEnabled: p?.aiEnabled === true,
    autoEnabled: p?.autoEnabled === true,
    concurrency: p?.concurrency ?? null,
    localWorkers: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:workers`),
    configDir: app.vault.configDir,
    vaultBasePath: app.vault.adapter.getBasePath?.() ?? null,
    forms: { total: dialogs.length, own: dialogs.filter((x) => x.own).length },
    coreSyncEnabled: sync?.enabled === true,
    syncSettingsFlags: {
      instance: boolFields(syncPlugin, ["enabled", "syncPluginData", "syncPlugins", "pluginSettings"]),
      settings: boolFields(syncPlugin?.settings, ["syncPluginData", "syncPlugins", "pluginSettings", "pluginData"]),
      syncConfig: boolFields(syncPlugin?.settings?.syncConfig, ["syncPluginData", "syncPlugins", "pluginSettings", "pluginData"]),
    },
    rules: rules.map((rule) => ({
      id: rule.id,
      source: basename(rule.source),
      output: basename(rule.output),
      enabled: rule.enabled === true,
      profileId: rule.profileId,
      sharedIdPresent: typeof rule.sharedId === "string" && !!rule.sharedId,
      recursive: rule.recursive === true,
      excludeCount: Array.isArray(rule.exclude) ? rule.exclude.length : 0,
    })),
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      model: profile.model,
      endpoint: profile.endpoint,
      glossaryBasenames: (profile.glossaries ?? []).map(basename),
      promptLength: profile.prompt?.length ?? 0,
    })),
    notebookCount: notebooks.length,
    statuses: notebooks.reduce((acc, state) => {
      acc[state.status] = (acc[state.status] ?? 0) + 1;
      return acc;
    }, {}),
    recognitionRequests: p?.callsThisRun ?? 0,
  };
  globalThis.__desktop071Preflight = result;
  return result;
})()
