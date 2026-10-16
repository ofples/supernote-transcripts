(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const id = "nomad-transcripts-quality-ui-fixture";
  const result = { fixtureLoaded: !!app.plugins.plugins[id], fixtureEnabled: app.plugins.enabledPlugins.has(id), forms: document.querySelectorAll(".modal-container").length, productionVersion: p?.manifest.version, productionIdle: !p?.task && !p?.progress?.running, productionPaused: p?.progress?.paused, documentHidden: document.hidden, visibility: document.visibilityState };
  require("fs").writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/final-state.json", JSON.stringify(result, null, 2));
  return result;
})();
