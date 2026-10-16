(async () => {
  const id = "nomad-transcripts";
  let stage = "preflight";
  let partial = { status: "running", version: null };
  const setResult = (value) => { globalThis.__desktop064ControlledReloadResult = value; };
  setResult(partial);
  const docs = () => [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const forms = () => {
    const nodes = new Set(docs().flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]));
    const own = [...nodes].filter((node) => node.matches(".st-fullscreen-modal,.st-preview-modal") || node.querySelector(".st-fullscreen-modal,.st-preview-modal"));
    return { own: own.length, other: nodes.size - own.length };
  };
  const hash = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const snapshot = async (plugin) => {
    const prefix = `nomad-transcripts:${app.vault.getName()}`;
    const outputs = {};
    const paths = [...new Set(Object.values(plugin.store.notebooks).map((state) => state.output).filter((path) => typeof path === "string" && path.endsWith(".md")))].sort();
    for (const path of paths) outputs[path] = await app.vault.adapter.exists(path) ? await hash(await app.vault.adapter.read(path)) : null;
    return {
      config: JSON.stringify(plugin.config),
      store: JSON.stringify(plugin.store),
      apiKey: plugin.apiKey,
      encryptedRecord: await app.secretStorage.getSecret("nomad-transcripts-chatgpt-session"),
      sessionRecord: JSON.stringify(plugin.chatGPT.record),
      costs: localStorage.getItem(`${prefix}:spending-v1`),
      usage: localStorage.getItem(`${prefix}:subscription-usage-v1`),
      provider: plugin.provider,
      aiEnabled: plugin.aiEnabled,
      autoEnabled: plugin.autoEnabled,
      workers: localStorage.getItem(`${prefix}:workers`),
      concurrency: plugin.concurrency,
      pausedPreference: localStorage.getItem(`${prefix}:paused`),
      outputHashes: JSON.stringify(outputs),
    };
  };
  try {
    const old = app.plugins.plugins[id];
    if (!old || old.manifest.version !== "0.6.4" || old.platform !== "desktop" || old.initializing || old.task || !old.progress.paused || !old.subscriptionStatus.connected)
      throw new Error("Expected initialized, connected, idle, paused desktop 0.6.4");
    const initialForms = forms();
    if (initialForms.own || initialForms.other) throw new Error("A user form is open; preserve it");
    stage = "baseline snapshot";
    const baseline = await snapshot(old);
    partial = { status: "baseline captured", version: old.manifest.version, managedOutputsChecked: Object.keys(JSON.parse(baseline.outputHashes)).length };
    setResult(partial);

    stage = "unload current 0.6.4";
    await app.plugins.unloadPlugin(id);
    stage = "reload manifests";
    await app.plugins.loadManifests();
    stage = "load current 0.6.4";
    await app.plugins.loadPlugin(id);
    const next = app.plugins.plugins[id];
    if (!next) throw new Error("Plugin did not load");
    stage = "initialize ChatGPT session";
    await next.chatGPT.initialize();
    stage = "wait for plugin initialization";
    const deadline = Date.now() + 10000;
    while (next.initializing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    if (next.initializing) throw new Error("Plugin initialization did not finish within 10 seconds");
    stage = "after snapshot";
    const after = await snapshot(next);
    const beforeOutputs = JSON.parse(baseline.outputHashes);
    const afterOutputs = JSON.parse(after.outputHashes);
    const outputPathsEqual = JSON.stringify(Object.keys(beforeOutputs).sort()) === JSON.stringify(Object.keys(afterOutputs).sort());
    const preserved = {
      config: baseline.config === after.config,
      store: baseline.store === after.store,
      apiKey: baseline.apiKey === after.apiKey,
      encryptedRecord: baseline.encryptedRecord === after.encryptedRecord,
      sessionRecord: baseline.sessionRecord === after.sessionRecord,
      costs: baseline.costs === after.costs,
      usage: baseline.usage === after.usage,
      provider: baseline.provider === after.provider,
      aiEnabled: baseline.aiEnabled === after.aiEnabled,
      autoEnabled: baseline.autoEnabled === after.autoEnabled,
      workers: baseline.workers === after.workers,
      concurrency: baseline.concurrency === after.concurrency,
      pausedPreference: baseline.pausedPreference === after.pausedPreference,
      managedMarkdownHashes: outputPathsEqual && Object.keys(beforeOutputs).every((path) => beforeOutputs[path] === afterOutputs[path]),
    };
    const afterForms = forms();
    partial = {
      status: "verified",
      version: next.manifest.version,
      platform: next.platform,
      connected: !!next.subscriptionStatus.connected,
      idle: !next.task,
      paused: !!next.progress.paused,
      initializing: !!next.initializing,
      ownFormsAbsent: afterForms.own === 0,
      otherFormsPreserved: afterForms.other === initialForms.other,
      managedOutputsChecked: Object.keys(beforeOutputs).length,
      preserved,
      allPreserved: Object.values(preserved).every(Boolean),
      recognitionRequests: next.callsThisRun ?? 0,
    };
    stage = "final verification";
    setResult(partial);
    if (next.manifest.version !== "0.6.4" || next.platform !== "desktop" || !partial.connected || !partial.idle || !partial.paused || partial.initializing || !partial.ownFormsAbsent || !partial.otherFormsPreserved || !partial.allPreserved || partial.recognitionRequests !== 0)
      throw new Error("Controlled reload verification failed");
    return partial;
  } catch (error) {
    setResult({ ...partial, status: "failed", stage, errorName: error?.name ?? "Error" });
    throw new Error(`Controlled reload verification failed during ${stage}`);
  }
})();
