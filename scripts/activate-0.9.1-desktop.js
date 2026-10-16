(async () => {
  const id = "nomad-transcripts";
  const setResult = (value) => { globalThis.__desktop091ActivationResult = value; };
  let stage = "preflight";
  let diagnostic = {};
  setResult({ status: "running" });
  const hash = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const stable = (value) => JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
  const inspectForms = () => {
    const active = globalThis.activeDocument;
    const docs = [globalThis.document, active, active?.containerEl, active?.contentEl, active?.document]
      .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
    const nodes = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(
      ".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal",
    )]));
    const list = [...nodes].map((node) => ({
      own: node.matches?.(".st-fullscreen-modal,.st-preview-modal") ||
        !!node.querySelector?.(".st-fullscreen-modal,.st-preview-modal"),
    }));
    return { total: list.length, own: list.filter((item) => item.own).length };
  };
  const snapshot = async (plugin) => {
    const prefix = `nomad-transcripts:${app.vault.getName()}`;
    const outputs = {};
    const paths = [...new Set(Object.values(plugin.store.notebooks)
      .map((state) => state.output).filter((path) => typeof path === "string" && path.endsWith(".md")))].sort();
    for (const path of paths)
      outputs[path] = await app.vault.adapter.exists(path) ? await hash(await app.vault.adapter.read(path)) : null;
    const dataPath = `${app.vault.configDir}/plugins/${id}/data.json`;
    return {
      config: stable(plugin.config),
      store: JSON.parse(JSON.stringify(plugin.store)),
      data: JSON.parse(await app.vault.adapter.read(dataPath)),
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
      outputs: JSON.stringify(outputs),
    };
  };
  const migrationComparison = (before, after) => {
    const stripMigration = (state) => Object.fromEntries(Object.entries(state)
      .filter(([key]) => !["status", "error", "pageIssues", "legacyPageFailure"].includes(key)));
    const notebookKeys = Object.keys(before.store.notebooks).sort();
    const sameNotebookKeys = JSON.stringify(notebookKeys) === JSON.stringify(Object.keys(after.store.notebooks).sort());
    let pagesAndIdentityPreserved = sameNotebookKeys;
    let existingIssuesPreserved = sameNotebookKeys;
    let migrationsValid = sameNotebookKeys;
    const details = [];
    for (const source of notebookKeys) {
      const old = before.store.notebooks[source], next = after.store.notebooks[source];
      if (!next || stable(stripMigration(old)) !== stable(stripMigration(next))) {
        pagesAndIdentityPreserved = false;
        continue;
      }
      const oldIssues = old.pageIssues ?? {}, nextIssues = next.pageIssues ?? {};
      for (const [pageId, issue] of Object.entries(oldIssues))
        if (stable(nextIssues[pageId]) !== stable(issue)) existingIssuesPreserved = false;
      const newIssues = Object.entries(nextIssues).filter(([pageId]) => !(pageId in oldIssues));
      const newLegacy = old.legacyPageFailure === undefined && next.legacyPageFailure !== undefined;
      if (old.legacyPageFailure !== undefined && next.legacyPageFailure !== old.legacyPageFailure) existingIssuesPreserved = false;
      const desired = new Map((next.desired ?? []).map((page) => [page.id, page]));
      const validNewIssues = newIssues.every(([pageId, issue]) => {
        const page = desired.get(pageId);
        return !!page && issue.status === "failed" && ["interrupted", "lost_result"].includes(issue.kind) &&
          issue.fingerprint === page.fingerprint && issue.number === page.number && issue.attempts === 1 &&
          typeof issue.reason === "string" && typeof issue.updatedAt === "string";
      });
      const validLegacy = !newLegacy || (typeof next.legacyPageFailure === "string" &&
        (/earlier version cannot be matched reliably to a page/i.test(next.legacyPageFailure) ||
          (typeof old.error === "string" && /stream.*(?:complete|finish)|AI response.*(?:incomplete|empty)|connection.*interrupted|AI request failed.*HTTP 5\d\d/i.test(old.error))));
      const statusValid = old.status === next.status ||
        (["recognizing", "checking"].includes(old.status) && next.status === "queued") ||
        (newIssues.length > 0 && validNewIssues && ["queued", "partial"].includes(next.status)) ||
        (newLegacy && validLegacy && next.status === "failed");
      const errorValid = old.error === next.error || (newLegacy && next.error === next.legacyPageFailure);
      if (!validNewIssues || !validLegacy || !statusValid || !errorValid) migrationsValid = false;
      details.push({ addedPageHolds: newIssues.length, addedLegacyHold: newLegacy ? 1 : 0 });
    }
    const oldQueue = before.store.queue ?? [], nextQueue = after.store.queue ?? [];
    const queueOnlyRemovedForHolds = nextQueue.every((entry) => oldQueue.some((old) => stable(old) === stable(entry)));
    const removedQueue = oldQueue.filter((entry) => !nextQueue.some((next) => stable(next) === stable(entry)));
    const removedQueueAllowed = removedQueue.every((entry) => {
      const old = before.store.notebooks[entry.source], next = after.store.notebooks[entry.source];
      return !!old && !!next && ((next.legacyPageFailure && !old.legacyPageFailure) ||
        (next.status === "partial" && Object.keys(next.pageIssues ?? {}).some((pageId) => !(pageId in (old.pageIssues ?? {})))));
    });
    const historyPreserved = stable(before.store.history) === stable(after.store.history);
    const initializedMarkerOnly = (() => {
      const oldData = { ...before.data }, nextData = { ...after.data };
      delete oldData.stateInitialized;
      delete nextData.stateInitialized;
      return stable(oldData) === stable(nextData) &&
        (before.data.stateInitialized === after.data.stateInitialized || after.data.stateInitialized === true);
    })();
    return {
      pagesIdentityOutputAndPublicationPreserved: pagesAndIdentityPreserved,
      existingPageIssuesPreserved: existingIssuesPreserved,
      startupHoldsAndStatusChangesValid: migrationsValid,
      queueOnlyRemovedForNewHolds: queueOnlyRemovedForHolds && removedQueueAllowed,
      removedQueueCount: removedQueue.length,
      historyPreserved,
      dataUnchangedExceptStateInitializedMarker: initializedMarkerOnly,
      newPageHolds: details.reduce((sum, item) => sum + item.addedPageHolds, 0),
      newLegacyHolds: details.reduce((sum, item) => sum + item.addedLegacyHold, 0),
    };
  };
  try {
    const old = app.plugins.plugins[id];
    if (app.vault.getName() !== "Vedas" || !old || old.initializing || old.task || old.progress.running ||
        !old.progress.paused || localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:paused`) !== "true" ||
        old.stateStorageIssue || old.progress.stateBlocked || !old.subscriptionStatus.connected)
      throw new Error("Pre-activation production guard failed");
    if (app.plugins.plugins["nomad-transcripts-ui-fixture"] || inspectForms().total !== 0)
      throw new Error("An isolated fixture or user form is open");
    const manifestPath = `${app.vault.configDir}/plugins/${id}/manifest.json`;
    const manifest = JSON.parse(await app.vault.adapter.read(manifestPath));
    if (manifest.id !== id || manifest.version !== "0.9.1")
      throw new Error("Staged production plugin is not version 0.9.1");
    stage = "flush validated idle baseline";
    await old.persist();
    stage = "baseline";
    const before = await snapshot(old);
    const beforeOutputs = JSON.parse(before.outputs);
    stage = "unload";
    await app.plugins.unloadPlugin(id);
    stage = "reload manifests";
    await app.plugins.loadManifests();
    stage = "load production plugin";
    await app.plugins.loadPlugin(id);
    const next = app.plugins.plugins[id];
    if (!next) throw new Error("Production plugin did not load");
    stage = "wait for bounded initialization and connection restore";
    for (let i = 0; (next.initializing || !next.subscriptionStatus.connected) && i < 600; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    if (next.initializing || !next.subscriptionStatus.connected)
      throw new Error("Plugin initialization or existing connection did not settle within 15 seconds");
    const nextForms = inspectForms();
    stage = "post-load snapshot";
    const after = await snapshot(next);
    const afterOutputs = JSON.parse(after.outputs);
    const outputsEqual = JSON.stringify(Object.keys(beforeOutputs).sort()) === JSON.stringify(Object.keys(afterOutputs).sort()) &&
      Object.keys(beforeOutputs).every((path) => beforeOutputs[path] === afterOutputs[path]);
    const migration = migrationComparison(before, after);
    const preserved = {
      config: before.config === after.config,
      apiKey: before.apiKey === after.apiKey,
      encryptedSession: before.encryptedRecord === after.encryptedRecord,
      sessionRecord: before.sessionRecord === after.sessionRecord,
      costs: before.costs === after.costs,
      usage: before.usage === after.usage,
      provider: before.provider === after.provider,
      aiEnabled: before.aiEnabled === after.aiEnabled,
      autoEnabled: before.autoEnabled === after.autoEnabled,
      workerAndPausePreferences: before.workers === after.workers && before.concurrency === after.concurrency &&
        before.pausedPreference === after.pausedPreference,
      managedMarkdownHashes: outputsEqual,
    };
    const result = {
      status: "complete",
      version: next.manifest.version,
      connected: !!next.subscriptionStatus.connected,
      idle: !next.task && !next.progress.running,
      paused: !!next.progress.paused,
      initializing: !!next.initializing,
      stateBlocked: !!next.stateStorageIssue || !!next.progress.stateBlocked,
      forms: nextForms,
      fixtureLoaded: !!app.plugins.plugins["nomad-transcripts-ui-fixture"],
      recognitionRequests: next.callsThisRun ?? 0,
      migration,
      preserved,
      allProtectedValuesPreserved: Object.values(preserved).every(Boolean) &&
        migration.pagesIdentityOutputAndPublicationPreserved && migration.existingPageIssuesPreserved &&
        migration.startupHoldsAndStatusChangesValid && migration.queueOnlyRemovedForNewHolds &&
        migration.historyPreserved && migration.dataUnchangedExceptStateInitializedMarker,
    };
    diagnostic = result;
    setResult(result);
    if (result.version !== "0.9.1" || !result.connected || !result.idle || !result.paused || result.initializing ||
        result.stateBlocked || result.forms.total !== 0 || result.fixtureLoaded || result.recognitionRequests !== 0 ||
        !result.allProtectedValuesPreserved)
      throw new Error("Activation verification did not satisfy migration and preservation guards");
    return result;
  } catch (error) {
    const result = { ...diagnostic, status: "failed", stage, errorName: error?.name ?? "Error" };
    setResult(result);
    throw new Error(`0.9.1 desktop activation verification failed at ${stage}`);
  }
})();
