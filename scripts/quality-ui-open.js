(async () => {
  const id = "nomad-transcripts-quality-ui-fixture";
  if (document.querySelectorAll(".modal-container").length) throw Error("Preserving open modal");
  await app.plugins.loadManifests();
  await app.plugins.loadPlugin(id);
  app.commands.executeCommandById(`${id}:open`);
  for (let i = 0; i < 80; i++) {
    if (document.querySelector(".st-fullscreen-modal")) return { loaded: true, panel: true };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("Quality UI fixture panel did not open");
})();
