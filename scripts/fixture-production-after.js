(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p) throw new Error("Production plugin unavailable after fixture test");
  const prefix = `nomad-transcripts:${app.vault.getName()}`;
  const after = JSON.stringify({
    config: p.config,
    store: p.store,
    sessionRecord: p.chatGPT.record,
    apiKey: p.apiKey,
    provider: p.provider,
    aiEnabled: p.aiEnabled,
    autoEnabled: p.autoEnabled,
    costs: localStorage.getItem(`${prefix}:spending-v1`),
    subscriptionUsage: localStorage.getItem(`${prefix}:subscription-usage-v1`),
  });
  const before = window.__nomadFixtureProductionSnapshot;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(after));
  const snapshotHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  delete window.__nomadFixtureProductionSnapshot;
  const result = {
    exactProductionSnapshotPreserved: typeof before === "string" && before === after,
    connected: !!p.subscriptionStatus.connected,
    paused: !!p.progress.paused,
    idle: !p.task,
    modalCount: document.querySelectorAll(".modal-container").length,
    fixturePluginUnloaded: !app.plugins.plugins["nomad-transcripts-ui-fixture"],
  };
  result.snapshotHashMatches = result.exactProductionSnapshotPreserved && snapshotHash.length === 64;
  if (!result.exactProductionSnapshotPreserved || !result.connected || !result.paused || !result.idle || result.modalCount !== 0 || !result.fixturePluginUnloaded)
    throw new Error("Production state or fixture cleanup check failed");
  return result;
})();
