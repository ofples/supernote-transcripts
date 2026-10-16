(async () => {
  if (document.querySelector(".modal-container")) throw new Error("A form is already open");
  const plugin = app.plugins.plugins["nomad-transcripts"];
  if (!plugin || plugin.manifest.version !== "0.6.4" || plugin.task || !plugin.progress.paused)
    throw new Error("Production plugin is not in the expected idle, paused state");
  await app.commands.executeCommandById("nomad-transcripts:open");
  const root = document.querySelector(".st-fullscreen-modal");
  if (!root) throw new Error("Mirrors panel did not open");
  return {
    version: plugin.manifest.version,
    homeOpen: true,
    resolveEditsButtonCount: [...root.querySelectorAll("button")].filter((button) => button.textContent.trim() === "Resolve edits").length,
    closeControls: root.querySelectorAll(".st-close").length,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    paused: !!plugin.progress.paused,
    idle: !plugin.task,
  };
})()
