(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p || p.manifest.version !== "0.7.1" || p.initializing || p.stateStorageIssue || p.progress.stateBlocked)
    throw new Error("Nomad pre-install guard failed");
  if (app.plugins.plugins["nomad-transcripts-ui-fixture"])
    throw new Error("A UI fixture is loaded");
  const forms = [...document.querySelectorAll(".st-fullscreen-modal, .st-preview-modal")];
  const homeOnly = forms.length === 1 && forms[0].classList.contains("st-home");
  if (forms.length && !homeOnly) throw new Error("Preserving an existing non-home form");
  if (!p.task && !p.progress.running && !p.progress.paused) p.pause();
  if (!p.progress.paused) p.pause();
  for (let i = 0; (p.task || p.progress.running) && i < 1200; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  if (p.task || p.progress.running) throw new Error("Worker did not settle after pause");
  if (homeOnly) forms[0].querySelector('[aria-label="Close mirrors"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  return {
    version: p.manifest.version,
    idle: !p.task && !p.progress.running,
    paused: p.progress.paused,
    connected: !!p.subscriptionStatus.connected,
    forms: [...document.querySelectorAll(".st-fullscreen-modal, .st-preview-modal")].length,
    callsThisRun: p.callsThisRun ?? 0,
  };
})()
