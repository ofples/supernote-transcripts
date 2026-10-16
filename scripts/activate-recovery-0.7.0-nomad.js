(async () => {
  const id = "nomad-transcripts";
  let stage = "preflight";
  let diagnosticResult = {};
  const setResult = (value) => { globalThis.__nomadRecoveryActivationResult = value; };
  setResult({ status: "running" });

  const hash = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const inspectDocuments = () => {
    const active = globalThis.activeDocument;
    const candidates = [
      globalThis.document,
      active,
      active?.containerEl,
      active?.contentEl,
      active?.document,
    ].filter((candidate, index, all) => candidate?.querySelectorAll && all.indexOf(candidate) === index);
    const nodes = new Set();
    for (const doc of candidates) {
      for (const node of doc.querySelectorAll(".modal-container, [role='dialog'], .st-fullscreen-modal, .st-preview-modal"))
        nodes.add(node);
    }
    const inspected = [...nodes].map((node) => {
      const rawClass = typeof node.className === "string" ? node.className : node.className?.baseVal ?? "";
      const classes = rawClass.split(/\s+/).filter(Boolean);
      const title = node.getAttribute?.("aria-label") ?? node.getAttribute?.("title") ??
        node.querySelector?.("h1, h2, .modal-title")?.textContent?.trim() ?? "";
      const own = classes.includes("st-fullscreen-modal") || classes.includes("st-preview-modal") ||
        (!!node.querySelector?.(".st-fullscreen-modal, .st-preview-modal"));
      return { node, classes, title, own };
    });
    return {
      ownForms: inspected.filter((entry) => entry.own),
      otherForms: inspected.filter((entry) => !entry.own),
    };
  };
  const snapshot = async (plugin) => {
    const prefix = `nomad-transcripts:${app.vault.getName()}`;
    const outputs = {};
    const paths = [...new Set(Object.values(plugin.store.notebooks).map((state) => state.output).filter((path) => typeof path === "string" && path.endsWith(".md")))].sort();
    for (const path of paths) {
      if (await app.vault.adapter.exists(path))
        outputs[path] = await hash(await app.vault.adapter.read(path));
      else outputs[path] = null;
    }
    const encryptedRecord = await app.secretStorage.getSecret("nomad-transcripts-chatgpt-session");
    return {
      config: JSON.stringify(plugin.config),
      store: JSON.stringify(plugin.store),
      apiKey: plugin.apiKey,
      encryptedRecord,
      sessionRecord: JSON.stringify(plugin.chatGPT.record),
      costs: localStorage.getItem(`${prefix}:spending-v1`),
      usage: localStorage.getItem(`${prefix}:subscription-usage-v1`),
      provider: plugin.provider,
      aiEnabled: plugin.aiEnabled,
      autoEnabled: plugin.autoEnabled,
      workers: localStorage.getItem(`${prefix}:workers`),
      concurrency: plugin.concurrency,
      nativeActive: plugin.nativeActive,
      active: plugin.active,
      pausedPreference: localStorage.getItem(`${prefix}:paused`),
      outputHashes: JSON.stringify(outputs),
    };
  };

  try {
    const old = app.plugins.plugins[id];
    if (!old || old.initializing || old.task || !old.progress.paused)
      throw new Error("Production must be loaded, initialized, paused, and idle");
    if (app.plugins.enabledPlugins.has("nomad-transcripts-ui-fixture"))
      throw new Error("Unload the isolated UI fixture before activation");

    const forms = inspectDocuments();
    if (forms.ownForms.length) throw new Error("Close the Supernote Transcripts form before activation");
    const manifestPath = `${app.vault.configDir}/plugins/${id}/manifest.json`;
    const targetManifest = JSON.parse(await app.vault.adapter.read(manifestPath));
    if (targetManifest.id !== id || targetManifest.version !== "0.7.0")
      throw new Error("The staged production plugin is not version 0.7.0");

    stage = "baseline";
    await old.chatGPT.initialize();
    if (!old.subscriptionStatus.connected) throw new Error("Production ChatGPT session is not connected");
    const baseline = await snapshot(old);
    const baselineOutputs = JSON.parse(baseline.outputHashes);

    stage = "unload";
    await app.plugins.unloadPlugin(id);
    stage = "load manifests";
    await app.plugins.loadManifests();
    stage = "load plugin";
    await app.plugins.loadPlugin(id);
    const next = app.plugins.plugins[id];
    if (!next) throw new Error("Production plugin failed to load");

    stage = "initialize ChatGPT session";
    await next.chatGPT.initialize();
    stage = "wait for plugin initialization";
    for (let i = 0; next.initializing && i < 400; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    if (next.initializing) throw new Error("Plugin initialization did not settle");
    const after = await snapshot(next);
    const nextOutputs = JSON.parse(after.outputHashes);
    const outputsEqual = JSON.stringify(Object.keys(nextOutputs).sort()) === JSON.stringify(Object.keys(baselineOutputs).sort()) &&
      Object.keys(baselineOutputs).every((path) => baselineOutputs[path] === nextOutputs[path]);
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
      localWorker: baseline.workers === after.workers && baseline.concurrency === after.concurrency &&
        baseline.pausedPreference === after.pausedPreference,
      managedMarkdownHashes: outputsEqual,
    };
    const nextForms = inspectDocuments();
    const result = {
      status: "complete",
      version: next.manifest.version,
      connected: !!next.subscriptionStatus.connected,
      idle: !next.task,
      paused: !!next.progress.paused,
      initializing: !!next.initializing,
      activityStateMayChangeAcrossReload: baseline.nativeActive !== after.nativeActive || baseline.active !== after.active,
      ownFormsAbsent: nextForms.ownForms.length === 0,
      otherFormsPreserved: nextForms.otherForms.length === forms.otherForms.length,
      managedOutputsChecked: Object.keys(baselineOutputs).length,
      preserved,
      allBaselineValuesEqual: Object.values(preserved).every(Boolean),
      recognitionRequests: next.callsThisRun ?? 0,
    };
    diagnosticResult = result;
    setResult(result);
    if (next.manifest.version !== "0.7.0" || !result.connected || !result.idle || !result.paused ||
        result.initializing || !result.ownFormsAbsent || !result.otherFormsPreserved ||
        !result.allBaselineValuesEqual || result.recognitionRequests !== 0)
      throw new Error("Activation verification did not meet the required baseline");
    setResult(result);
    return result;
  } catch (error) {
    const result = { ...diagnosticResult, status: "failed", stage, errorName: error?.name ?? "Error" };
    setResult(result);
    throw new Error(`0.7.0 activation verification failed during ${stage}`);
  }
})();

