(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const root = document.querySelector(".st-fullscreen-modal");
  if (!p || p.manifest.version !== "0.8.0" || !root || !p.progress.paused || p.task || p.progress.running)
    throw Error("Cannot safely close the Nomad quality draft");
  const cancel = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel");
  if (!cancel) throw Error("Source settings Cancel control missing");
  cancel.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const home = document.querySelector(".st-fullscreen-modal");
  if (!home?.classList.contains("st-home")) throw Error("Cancel did not return to Mirrors home");
  home.querySelector(".st-close")?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { version: p.manifest.version, paused: p.progress.paused, idle: !p.task && !p.progress.running,
    recognitionCalls: p.callsThisRun ?? 0, formsClosed: !document.querySelector(".st-fullscreen-modal,.st-preview-modal") };
})()
