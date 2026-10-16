(async () => {
  const id = "nomad-transcripts";
  const real = app.plugins.plugins[id];
  let stage = "preflight";
  let mutatorAttempts = [];
  let suppressedPersistCount = 0;
  const setResult = (value) => { globalThis.__nomadRecoveryReadonlyResult = value; };
  setResult({ status: "running" });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const hash = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const managedOutputHashes = async (plugin) => {
    const output = {};
    const paths = [...new Set(Object.values(plugin.store.notebooks).map((state) => state.output).filter((path) => typeof path === "string" && path.endsWith(".md")))].sort();
    for (const path of paths)
      output[path] = await app.vault.adapter.exists(path) ? await hash(await app.vault.adapter.read(path)) : null;
    return JSON.stringify(output);
  };
  const realSnapshot = async (plugin) => {
    const prefix = `nomad-transcripts:${app.vault.getName()}`;
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
      managedMarkdownHashes: await managedOutputHashes(plugin),
    };
  };

  try {
    if (!real || real.task || real.progress.running || !real.progress.paused)
      throw new Error("Production must be idle and paused before read-only verification");
    await real.chatGPT.initialize();
    const before = await realSnapshot(real);

    const readonlyAdapter = Object.create(app.vault.adapter);
    const adapterOriginal = app.vault.adapter;
    const deny = (name) => (..._args) => { mutatorAttempts.push(name); throw new Error(`Read-only facade blocked ${name}`); };
    for (const name of ["exists", "read", "list"])
      Object.defineProperty(readonlyAdapter, name, { configurable: true, value: (...args) => adapterOriginal[name](...args) });
    for (const name of ["write", "append", "create", "remove", "rename", "mkdir", "rmdir", "process"])
      if (name in adapterOriginal) Object.defineProperty(readonlyAdapter, name, { configurable: true, value: deny(`adapter.${name}`) });
    const readonlyVault = Object.create(app.vault);
    Object.defineProperties(readonlyVault, {
      adapter: { configurable: true, value: readonlyAdapter },
      create: { configurable: true, value: deny("vault.create") },
      createFolder: { configurable: true, value: deny("vault.createFolder") },
      delete: { configurable: true, value: deny("vault.delete") },
      rename: { configurable: true, value: deny("vault.rename") },
    });
    const readonlyApp = Object.create(app);
    Object.defineProperty(readonlyApp, "vault", { configurable: true, value: readonlyVault });

    const cloneConfig = clone(real.config);
    const cloneStore = clone(real.store);
    const cloneProgress = clone(real.progress);
    const facade = Object.create(real);
    Object.defineProperties(facade, {
      app: { configurable: true, writable: true, value: readonlyApp },
      config: { configurable: true, writable: true, value: cloneConfig },
      store: { configurable: true, writable: true, value: cloneStore },
      progress: { configurable: true, writable: true, value: cloneProgress },
      task: { configurable: true, writable: true, value: null },
      disposed: { configurable: true, writable: true, value: false },
      sharedIO: {
        configurable: true,
        value: () => ({
          exists: (path) => readonlyAdapter.exists(path),
          read: (path) => readonlyAdapter.read(path),
          list: (path) => readonlyAdapter.list(path),
          write: deny("sharedIO.write"),
          create: deny("sharedIO.create"),
          mkdir: deny("sharedIO.mkdir"),
        }),
      },
      reader: {
        configurable: true,
        value: () => {
          const reader = real.reader();
          reader.progress = () => {};
          return reader;
        },
      },
      persist: { configurable: true, value: async () => { suppressedPersistCount++; } },
      emit: { configurable: true, value: () => {} },
      stage: { configurable: true, value: () => {} },
      update: { configurable: true, value: deny("update") },
      manual: { configurable: true, value: deny("manual") },
      resolveTranscriptConflict: { configurable: true, value: deny("resolveTranscriptConflict") },
      publish: { configurable: true, value: deny("publish") },
      transcribe: { configurable: true, value: deny("transcribe") },
      connectSubscription: { configurable: true, value: deny("connectSubscription") },
      finishSubscriptionLogin: { configurable: true, value: deny("finishSubscriptionLogin") },
      disconnectSubscription: { configurable: true, value: deny("disconnectSubscription") },
      exportSavedResults: { configurable: true, value: deny("exportSavedResults") },
    });
    for (const name of ["shared", "session", "costBook", "subscriptionBook", "provider", "aiEnabled"])
      Object.defineProperty(facade, name, { configurable: true, get: () => { throw new Error(`Blocked facade ${name} access`); } });

    stage = "Reflection inventory check";
    const reflection = Object.values(real.store.notebooks).find((state) => /2610 - Reflection\.note$/i.test(state.source));
    if (!reflection) throw new Error("Reflection notebook state is unavailable");
    const cloneReflection = cloneStore.notebooks[reflection.source];
    const cloneBefore = clone(cloneReflection);
    const reflectionReader = facade.reader();
    const opened = await reflectionReader.open(reflection.source);
    const descriptorMatches = opened.descriptor.path === reflection.source &&
      opened.descriptor.revision === cloneReflection.revision &&
      JSON.stringify(opened.descriptor.pages) === JSON.stringify(cloneReflection.desired) &&
      await reflectionReader.revision(reflection.source) === cloneReflection.revision;
    const descriptorCount = opened.descriptor.pages.length;
    await opened.close();
    if (!descriptorMatches) throw new Error("Fresh Reflection metadata differs from the stored desired inventory or revision");

    const rule = cloneConfig.rules.find((item) => item.id === cloneReflection.ruleId);
    if (!rule) throw new Error("Reflection source rule is unavailable");
    const sourcePath = cloneReflection.source.replace(/\\/g, "/");
    const rulePath = rule.source.replace(/\\/g, "/").replace(/\/+$/, "");
    const relativePath = sourcePath === rulePath ? sourcePath.split("/").pop() : sourcePath.startsWith(`${rulePath}/`) ? sourcePath.slice(rulePath.length + 1) : sourcePath.split("/").pop();
    const notebookId = await hash(JSON.stringify(["notebook-v1", rule.sharedId ?? rule.id, relativePath]));
    const actualPublishedPages = reflection.publishedPages?.length ?? 0;
    const priorClonePublishedPages = cloneReflection.publishedPages?.length ?? 0;
    let checkOutput = { ok: false, reason: "not run" };
    try {
      await real.checkOutput.call(facade, cloneReflection, cloneBefore, notebookId);
      checkOutput = {
        ok: true,
        descriptorMatches,
        descriptorPages: descriptorCount,
        priorClonePublishedPages,
        clonedPublishedPages: cloneReflection.publishedPages?.length ?? 0,
        actualPublishedPages,
        cloneOnlyLegacyInventoryAdopted: (cloneReflection.publishedPages?.length ?? 0) > actualPublishedPages,
        suppressedPersistCount,
      };
    } catch (error) {
      checkOutput = { ok: false, reason: String(error?.message ?? "checkOutput failed") };
    }

    stage = "Satsang recovery preview";
    const satsangSource = Object.keys(cloneStore.notebooks).find((source) => /Satsang/i.test(source));
    let satsangPreview;
    if (!satsangSource) satsangPreview = { ok: false, reason: "Satsang notebook state is unavailable" };
    else {
      try {
        const preview = await real.previewTranscriptRecovery.call(facade, satsangSource);
        satsangPreview = {
          ok: true,
          output: preview.output,
          currentLength: preview.current.length,
          generatedLength: preview.generated.length,
          revisionPresent: typeof preview.revision === "string" && preview.revision.length > 0,
        };
      } catch (error) {
        satsangPreview = { ok: false, reason: String(error?.message ?? "preview failed") };
      }
    }

    stage = "production state comparison";
    const after = await realSnapshot(real);
    const preserved = Object.fromEntries(Object.keys(before).map((key) => [key, before[key] === after[key]]));
    const result = {
      status: "complete",
      checkOutput,
      satsangPreview,
      preserved,
      allProductionBaselineValuesEqual: Object.values(preserved).every(Boolean),
      suppressedPersistCount,
      blockedMutatorAttempts: mutatorAttempts,
      recognitionRequests: real.callsThisRun ?? 0,
    };
    setResult(result);
    if (!result.allProductionBaselineValuesEqual || mutatorAttempts.length || result.recognitionRequests !== 0)
      throw new Error("Read-only facade verification detected a production change or blocked mutation attempt");
    return result;
  } catch (error) {
    const result = { status: "failed", stage, reason: String(error?.message ?? "verification failed"), suppressedPersistCount, blockedMutatorAttempts: mutatorAttempts };
    setResult(result);
    throw new Error(`Read-only recovery verification failed during ${stage}`);
  }
})();
