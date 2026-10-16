(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p || p.task || !p.progress.paused || document.querySelector(".modal-container"))
    throw new Error("Production must be paused and idle with no form open");
  const prefix = `nomad-transcripts:${app.vault.getName()}`;
  const snapshot = JSON.stringify({
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
  window.__nomadFixtureProductionSnapshot = snapshot;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  return {
    captured: true,
    snapshotHash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    connected: !!p.subscriptionStatus.connected,
    paused: !!p.progress.paused,
    idle: !p.task,
    modalCount: document.querySelectorAll(".modal-container").length,
  };
})();
