(async () => {
  const id = "nomad-transcripts-quality-ui-fixture";
  const root = document.querySelector(".st-fullscreen-modal");
  if (root && !window.__qualityUIFixture) throw Error("An unrelated form is open; preserving it");
  if (root) root.querySelector('[aria-label="Close mirrors"]')?.click();
  await app.plugins.unloadPlugin(id);
  return { unloaded: !app.plugins.plugins[id], forms: document.querySelectorAll(".modal-container").length };
})();
