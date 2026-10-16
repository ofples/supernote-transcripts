(async () => {
  const id = "nomad-transcripts-ui-fixture";
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl,
    globalThis.activeDocument?.contentEl, globalThis.activeDocument?.document]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const forms = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(
    ".st-fullscreen-modal,.st-preview-modal",
  )]));
  const fixture = app.plugins.plugins[id];
  if (forms.size) {
    globalThis.__desktop071FixtureUnload = { status: "blocked", forms: forms.size };
    return globalThis.__desktop071FixtureUnload;
  }
  if (!fixture) {
    globalThis.__desktop071FixtureUnload = { status: "already-unloaded" };
    return globalThis.__desktop071FixtureUnload;
  }
  if (fixture.manifest?.id !== id) throw new Error("Fixture identity check failed");
  await app.plugins.unloadPlugin(id);
  const result = { status: app.plugins.plugins[id] ? "still-loaded" : "unloaded", formsAfter: forms.size };
  globalThis.__desktop071FixtureUnload = result;
  return result;
})()
