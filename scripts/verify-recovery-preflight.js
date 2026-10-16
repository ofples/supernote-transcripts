(async () => {
  const id = "nomad-transcripts";
  const p = app.plugins.plugins[id];
  if (!p) throw new Error("Production plugin unavailable");

  const states = Object.values(p.store.notebooks);
  const state = states.find((s) => /2610 - Reflection\.note$/i.test(s.source));
  if (!state) throw new Error("Reflection notebook state not found");

  const reader = p.reader();
  reader.progress = () => {};
  const opened = await reader.open(state.source);
  const sourcePages = opened.descriptor.pages.length;
  await opened.close();

  const sharedIO = p.sharedIO();
  const hash = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const relative = state.source.split("/").pop();
  const rule = p.config.rules.find((r) => r.id === state.ruleId);
  const notebookId = await hash(JSON.stringify(["notebook-v1", rule?.sharedId ?? rule?.id, relative]));
  const transcript = await sharedIO.read(state.output);
  const textHash = await hash(transcript);
  const publicationFolder = `Supernote Transcripts/Shared Data/${notebookId}/publications/${textHash}`;
  let publication = { status: "missing", pages: null, results: null, candidates: null };
  let receipt = null;
  if (await sharedIO.exists(publicationFolder)) {
    const { files } = await sharedIO.list(publicationFolder);
    const records = [];
    for (const path of files) {
      if (!path.endsWith(".md")) continue;
      const raw = await sharedIO.read(path);
      const header = "<!-- supernote-publication-v2 -->\n";
      if (!raw.startsWith(header)) continue;
      try {
        const record = JSON.parse(raw.slice(header.length));
        if (record.notebookId === notebookId && record.textHash === textHash && Array.isArray(record.pages)) records.push(record);
      } catch {}
    }
    const superseded = new Set(records.flatMap((r) => r.supersedes ?? []));
    const tips = records.filter((r) => !superseded.has(r.recordId));
    if (!records.length) publication.status = "invalid-or-empty";
    else if (tips.length > 1) publication = { status: "concurrent", pages: null, results: null, candidates: tips.map((r) => ({ pages: r.pages.length, results: r.results?.length ?? null })) };
    else if (tips.length === 1) {
      receipt = tips[0];
      publication = { status: "current", pages: receipt.pages.length, results: receipt.results?.length ?? 0, candidates: null };
    }
    else publication.status = "invalid-chain";
  }

  const descriptor = opened.descriptor.pages;
  const receiptPages = receipt?.pages ?? [];
  const byId = new Map(descriptor.map((page, index) => [page.id, { page, number: index + 1 }]));
  const publishedPages = state.publishedPages ?? [];
  const prefixMatches = receiptPages.every((page, index) => descriptor[index]?.id === page.id && descriptor[index]?.fingerprint === page.fingerprint);
  const exactMatches = receiptPages.filter((page) => byId.get(page.id)?.page.fingerprint === page.fingerprint).length;
  const changedPageNumbers = [];
  const receiptFingerprintMismatches = [];
  receiptPages.forEach((page, index) => {
    const current = byId.get(page.id);
    if (!current) return;
    if (current.page.fingerprint !== page.fingerprint) receiptFingerprintMismatches.push(index + 1);
    else if (current.number !== index + 1) changedPageNumbers.push({ receiptPage: index + 1, currentPage: current.number });
  });
  const outputHashMatchesPublishedHash = await hash(transcript) === state.publishedHash;
  const cacheEntries = Object.entries(state.pages ?? {});
  const localCache = { total: cacheEntries.length, matchingCurrentInventory: cacheEntries.filter(([pageId, value]) => byId.get(pageId)?.page.fingerprint === value.fingerprint).length };
  const localResultChecks = [];
  for (const [index, result] of (receipt?.results ?? []).entries()) {
    const cached = state.pages?.[result.id];
    localResultChecks.push({
      receiptPage: receiptPages.findIndex((page) => page.id === result.id) + 1 || index + 1,
      fingerprintMatches: !!cached && cached.fingerprint === result.fingerprint,
      recipeMatches: !!cached && cached.recipe === result.recipe,
      textHashMatches: !!cached && await hash(cached.text) === result.textHash,
    });
  }

  const reflectionState = {
    source: state.source,
    sourcePages,
    desiredPages: state.desired.length,
    currentError: state.error ?? null,
    status: state.status,
  };
  return {
    version: p.manifest.version,
    productionPluginPresent: true,
    testPluginPresent: !!app.plugins.plugins["nomad-subscription-test"],
    communityPluginIdPresent: (await app.vault.adapter.read(`${app.vault.configDir}/community-plugins.json`)).includes("nomad-subscription-test"),
    configDir: app.vault.configDir,
    productionConnected: !!p.subscriptionStatus.connected,
    paused: !!p.progress.paused,
    idle: !p.task,
    modalCount: document.querySelectorAll(".modal-container").length,
    reflection: reflectionState,
    publication,
    inventoryComparison: {
      descriptorPages: descriptor.length,
      receiptIsExactPrefix: prefixMatches,
      receiptPagesMatchingCurrentIdAndFingerprint: exactMatches,
      receiptPagesMissingFromCurrentDescriptor: receiptPages.flatMap((page, index) => byId.has(page.id) ? [] : [index + 1]),
      receiptPageNumbersChanged: changedPageNumbers,
      receiptFingerprintMismatchPageNumbers: receiptFingerprintMismatches,
    storedPublishedPages: publishedPages.length,
    receiptExactlyMatchesStoredPublishedInventory: receiptPages.length === publishedPages.length && receiptPages.every((page, index) => publishedPages[index]?.id === page.id && publishedPages[index]?.fingerprint === page.fingerprint),
    receiptIsPrefixOfStoredPublishedInventory: receiptPages.length <= publishedPages.length && receiptPages.every((page, index) => publishedPages[index]?.id === page.id && publishedPages[index]?.fingerprint === page.fingerprint),
    },
    outputHashMatchesPublishedHash,
    localCache,
    receiptResultCacheChecks: {
      tested: localResultChecks.length,
      allFingerprintRecipeAndTextHashesMatch: localResultChecks.length > 0 && localResultChecks.every((r) => r.fingerprintMatches && r.recipeMatches && r.textHashMatches),
      mismatchedReceiptPageNumbers: localResultChecks.filter((r) => !r.fingerprintMatches || !r.recipeMatches || !r.textHashMatches).map((r) => r.receiptPage),
    },
    testSecretEmpty: !(await app.secretStorage.getSecret("nomad-transcripts-subscription-test")),
  };
})();
