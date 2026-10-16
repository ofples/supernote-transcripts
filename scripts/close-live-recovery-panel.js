(() => {
  const close = document.querySelector(".st-fullscreen-modal button.st-close[aria-label='Close mirrors']");
  if (!close) throw new Error("The recovery panel close control is unavailable");
  close.click();
  const plugin = app.plugins.plugins["nomad-transcripts"];
  return {
    panelClosed: !document.querySelector(".st-fullscreen-modal"),
    version: plugin?.manifest.version,
    idle: !!plugin && !plugin.task,
    paused: !!plugin?.progress.paused,
  };
})()
