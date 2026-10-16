(async () => {
  const pluginId = "nomad-transcripts";
  let stage = "preflight";
  let result = { status: "running" };
  const setResult = (value) => { globalThis.__satsangPromptUpgradeResult = value; };
  setResult(result);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const basename = (path) => String(path ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const dialogs = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]));
  const ownDialogs = [...dialogs].filter((node) => node.matches(".st-fullscreen-modal,.st-preview-modal") || node.querySelector(".st-fullscreen-modal,.st-preview-modal"));
  if (dialogs.size) {
    setResult({ status: "blocked", stage, reason: "open-form", ownForms: ownDialogs.length, otherForms: dialogs.size - ownDialogs.length });
    return globalThis.__satsangPromptUpgradeResult;
  }
  const p = app.plugins.plugins[pluginId];
  const prefix = `nomad-transcripts:${app.vault.getName()}`;
  if (!p || p.initializing || p.task || p.progress.running || !p.progress.paused || localStorage.getItem(`${prefix}:paused`) !== "true") {
    setResult({ status: "blocked", stage, reason: "require-idle-paused-plugin" });
    return globalThis.__satsangPromptUpgradeResult;
  }

  const findPrompt = (doc, labels) => {
    const roots = [doc, doc?.prompts, doc?.profiles, doc?.texts].filter(Boolean);
    for (const root of roots) {
      if (Array.isArray(root)) {
        for (const item of root) {
          if (!labels.includes(String(item?.name ?? item?.id ?? "").toLowerCase())) continue;
          const text = item.prompt ?? item.text ?? item.content;
          if (typeof text === "string" && text.trim()) return text;
        }
      } else if (typeof root === "object") {
        for (const label of labels) {
          const value = root[label] ?? root[label.toUpperCase()] ?? root[label[0].toUpperCase() + label.slice(1)];
          const text = typeof value === "string" ? value : value?.prompt ?? value?.text ?? value?.content;
          if (typeof text === "string" && text.trim()) return text;
        }
      }
    }
    return "";
  };
  const promptSource = async () => {
    if (p.platform === "desktop") {
      if (typeof require !== "function") throw new Error("Desktop local file access is unavailable");
      return require("fs").readFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/private/prompt-improvements.json", "utf8");
    }
    const path = `${app.vault.configDir}/plugins/${pluginId}/prompt-upgrade.json`;
    return app.vault.adapter.read(path);
  };
  const hash = async (text) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const outputs = async () => {
    const result = {};
    const paths = [...new Set(Object.values(p.store.notebooks).map((state) => state.output).filter((path) => typeof path === "string" && path.endsWith(".md")))].sort();
    for (const path of paths) result[path] = await app.vault.adapter.exists(path) ? await hash(await app.vault.adapter.read(path)) : null;
    return JSON.stringify(result);
  };
  const snapshot = async () => ({
    config: JSON.stringify(p.config),
    notebooks: JSON.stringify(p.store.notebooks),
    queue: JSON.stringify(p.store.queue),
    outputHashes: await outputs(),
    apiKey: p.apiKey,
    encryptedRecord: await app.secretStorage.getSecret("nomad-transcripts-chatgpt-session"),
    sessionRecord: JSON.stringify(p.chatGPT.record),
    costs: localStorage.getItem(`${prefix}:spending-v1`),
    usage: localStorage.getItem(`${prefix}:subscription-usage-v1`),
    provider: p.provider,
    aiEnabled: p.aiEnabled,
    autoEnabled: p.autoEnabled,
    concurrency: p.concurrency,
    workers: localStorage.getItem(`${prefix}:workers`),
    paused: p.progress.paused,
    pausedPreference: localStorage.getItem(`${prefix}:paused`),
    callsThisRun: p.callsThisRun ?? 0,
  });

  try {
    stage = "read reviewed prompt file";
    const promptDocument = JSON.parse(await promptSource());
    const satsangPrompt = findPrompt(promptDocument, ["satsang"]);
    const generalPrompt = findPrompt(promptDocument, ["general"]);
    if (!satsangPrompt || !generalPrompt) throw new Error("Both Satsang and General prompts are required in the prompt file");
    if (satsangPrompt.length > 20000 || generalPrompt.length > 20000) throw new Error("Prompt length exceeds the safety limit");

    stage = "select unique Satsang rule";
    const candidates = p.config.rules.filter((rule) => String(rule.id).toLowerCase() === "satsang" || basename(rule.source).toLowerCase() === "satsang");
    if (candidates.length !== 1) throw new Error("Satsang rule is missing or ambiguous");
    const targetRule = candidates[0];
    const originalProfile = p.config.profiles.find((profile) => profile.id === targetRule.profileId);
    if (!originalProfile) throw new Error("Satsang profile is unavailable");
    const otherRuleUsers = p.config.rules.filter((rule) => rule.id !== targetRule.id && rule.profileId === originalProfile.id);
    const cloneProfile = otherRuleUsers.length > 0;
    let targetProfileId = originalProfile.id;
    if (cloneProfile) {
      targetProfileId = "rule-satsang";
      while (p.config.profiles.some((profile) => profile.id === targetProfileId))
        targetProfileId = `rule-satsang-${crypto.randomUUID()}`;
    }
    const before = await snapshot();
    const expected = clone(p.config);
    const expectedRule = expected.rules.find((rule) => rule.id === targetRule.id);
    const expectedProfile = expected.profiles.find((profile) => profile.id === originalProfile.id);
    if (cloneProfile) {
      const nextProfile = clone(expectedProfile);
      nextProfile.id = targetProfileId;
      nextProfile.name = "Satsang";
      nextProfile.prompt = satsangPrompt;
      expected.profiles.push(nextProfile);
      expectedRule.profileId = targetProfileId;
    } else {
      expectedProfile.name = "Satsang";
      expectedProfile.prompt = satsangPrompt;
    }

    stage = "apply isolated Satsang profile";
    if (cloneProfile) {
      const newProfile = clone(originalProfile);
      newProfile.id = targetProfileId;
      newProfile.name = "Satsang";
      newProfile.prompt = satsangPrompt;
      p.config.profiles.push(newProfile);
      targetRule.profileId = targetProfileId;
    } else {
      originalProfile.name = "Satsang";
      originalProfile.prompt = satsangPrompt;
    }
    stage = "save plugin settings";
    await p.saveConfig();

    stage = "verify settings and protected state";
    const after = await snapshot();
    const preserved = {
      onlyExpectedConfigChanges: after.config === JSON.stringify(expected),
      notebooksAndPageCaches: before.notebooks === after.notebooks,
      managedMarkdownHashes: before.outputHashes === after.outputHashes,
      apiKey: before.apiKey === after.apiKey,
      encryptedRecord: before.encryptedRecord === after.encryptedRecord,
      sessionRecord: before.sessionRecord === after.sessionRecord,
      costs: before.costs === after.costs,
      usage: before.usage === after.usage,
      provider: before.provider === after.provider,
      aiEnabled: before.aiEnabled === after.aiEnabled,
      autoEnabled: before.autoEnabled === after.autoEnabled,
      concurrency: before.concurrency === after.concurrency,
      workers: before.workers === after.workers,
      paused: before.paused === after.paused && before.pausedPreference === after.pausedPreference,
      recognitionRequests: before.callsThisRun === after.callsThisRun,
    };
    const updatedRule = p.config.rules.find((rule) => rule.id === targetRule.id);
    const updatedProfile = p.config.profiles.find((profile) => profile.id === updatedRule?.profileId);
    result = {
      status: "complete",
      version: p.manifest.version,
      platform: p.platform,
      ruleId: updatedRule?.id,
      profileId: updatedProfile?.id,
      profileName: updatedProfile?.name,
      clonedSharedProfile: cloneProfile,
      originalProfileUsers: otherRuleUsers.length + 1,
      model: updatedProfile?.model,
      endpointPreserved: updatedProfile?.endpoint === originalProfile.endpoint,
      glossaries: Array.isArray(updatedProfile?.glossaries) ? updatedProfile.glossaries : [],
      promptLength: updatedProfile?.prompt?.length ?? 0,
      generalPromptLength: generalPrompt.length,
      preserved,
      allProtectedStatePreserved: Object.values(preserved).every(Boolean),
      queuePreserved: before.queue === after.queue,
      recognitionRequests: p.callsThisRun ?? 0,
    };
    setResult(result);
    return result;
  } catch (error) {
    setResult({ ...result, status: "failed", stage, errorName: error?.name ?? "Error" });
    throw new Error(`Satsang prompt upgrade failed during ${stage}`);
  }
})();
