(async () => {
  const c = window.__transcriptUIFixture;
  const root = document.querySelector(".st-fullscreen-modal");
  if (!c || !root) throw new Error("Fixture is not open");
  const expectedCurrent = ["---", "nomad_transcripts: true", "---", "", "# Edited fixture transcript", "", "A user correction that must be preserved or explicitly backed up."].join("\n");
  const expectedGenerated = ["---", "nomad_transcripts: true", "---", "", "# Saved recognition", "", "Page 1 saved text: Cached fixture text.", "", "Page 2: No saved recognition yet."].join("\n");
  const action = c.recoveryFixture.actions.at(-1);
  const state = c.store.notebooks[c.recoveryFixture.source];
  const output = state.output;
  const resultText = root.querySelector(".st-recovery-result")?.textContent ?? "";
  const replacementVerified = action?.action === "replace" && action.expectedCurrent === expectedCurrent &&
    c.recoveryFixture.current === expectedGenerated && c.recoveryFixture.generated === expectedGenerated &&
    state.status === "current" && !state.error && resultText.includes(`${output}.backup-fixture`) && resultText.includes(output);
  if (!replacementVerified) throw new Error("Mock replacement action or backup confirmation did not match fixture data");

  c.recoveryFixture.current = expectedCurrent;
  c.recoveryFixture.generated = expectedGenerated;
  state.status = "conflict";
  state.error = "Generated transcript was manually edited. Preserve those changes before retrying.";
  const close = root.querySelector('[aria-label="Close mirrors"]');
  if (!close || root.querySelectorAll('[aria-label="Close mirrors"]').length !== 1) throw new Error("Cannot safely close only the fixture");
  close.click();
  await app.plugins.unloadPlugin("nomad-transcripts-ui-fixture");
  if (app.plugins.plugins["nomad-transcripts-ui-fixture"] || document.querySelector(".modal-container")) throw new Error("Fixture did not close and unload cleanly");
  return { mockReplaceActionVerified: true, expectedCurrentMatchedExactFixture: true, backupPathShown: true, resultStatusCurrent: true, fixtureResetBeforeReload: true, fixtureClosedAndUnloaded: true };
})();
