globalThis.__qualityUIPreflight = (() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const id = "nomad-transcripts-quality-ui-fixture";
  if (!p || p.manifest.version !== "0.7.1") throw Error("Expected production 0.7.1 plugin");
  if (p.task || p.progress?.running || !p.progress?.paused) throw Error("Production worker must remain idle and paused");
  if (document.querySelectorAll(".modal-container").length) throw Error("Preserving existing modal; close it before fixture setup");
  if (app.plugins.plugins[id] || app.plugins.enabledPlugins.has(id)) throw Error("Quality fixture is already loaded or enabled");
  const activeDocument = app.workspace.activeLeaf?.view?.containerEl?.ownerDocument;
  if (!activeDocument || activeDocument !== document) throw Error("Active document is not the main Obsidian document");
  return { ready: true, version: p.manifest.version, idle: !p.task && !p.progress.running, paused: p.progress.paused, forms: 0, mainDocumentVisible: activeDocument === document };
})();
