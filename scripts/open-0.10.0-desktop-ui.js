(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p || p.manifest.version !== "0.10.0" || p.task || p.progress.running || !p.progress.paused)
    throw new Error("Desktop UI open guard failed");
  app.commands.executeCommandById("nomad-transcripts:open");
  globalThis.__desktop010UiOpen = { opened: !!document.querySelector(".st-fullscreen-modal") };
  return globalThis.__desktop010UiOpen;
})();
