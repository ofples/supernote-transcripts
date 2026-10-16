(async () => {
  const c = window.__transcriptUIFixture;
  const root = () => document.querySelector(".st-fullscreen-modal");
  if (!c || !root()?.querySelector(".st-recovery-compare")) throw new Error("Isolated recovery preview is not open");
  const expectedCurrent = c.recoveryFixture.current;
  const output = c.store.notebooks[c.recoveryFixture.source].output;
  const button = [...root().querySelectorAll("button")].find((item) => item.textContent?.trim() === "Back up edits and restore mirror");
  if (!button || button.disabled) throw new Error("Replacement action is unavailable");
  button.click();
  for (let i = 0; i < 40 && c.recoveryFixture.actions.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  const state = c.store.notebooks[c.recoveryFixture.source];
  const action = c.recoveryFixture.actions.at(-1);
  const resultText = root().querySelector(".st-recovery-result")?.textContent ?? "";
  const replacementVerified = action?.action === "replace" && action.expectedCurrent === expectedCurrent &&
    c.recoveryFixture.current === c.recoveryFixture.generated && state.status === "current" && !state.error &&
    resultText.includes(`${output}.backup-fixture`) && resultText.includes(output);
  if (!replacementVerified) throw new Error("Mock replacement action or backup confirmation did not match");

  const originalCurrent = action.expectedCurrent;
  const originalGenerated = c.recoveryFixture.generated;
  c.recoveryFixture.current = originalCurrent;
  c.recoveryFixture.generated = originalGenerated;
  state.status = "conflict";
  state.error = "Generated transcript was manually edited. Preserve those changes before retrying.";
  const close = root().querySelector('[aria-label="Close mirrors"]');
  if (!close || root().querySelectorAll('[aria-label="Close mirrors"]').length !== 1) throw new Error("Cannot safely close only the fixture");
  close.click();
  await app.plugins.unloadPlugin("nomad-transcripts-ui-fixture");
  if (app.plugins.plugins["nomad-transcripts-ui-fixture"] || document.querySelector(".modal-container")) throw new Error("Fixture did not close and unload cleanly");
  return { mockReplaceActionVerified: true, expectedCurrentMatchedExactly: true, backupPathShown: true, resultStatusCurrent: true, fixtureResetBeforeReload: true, fixtureClosedAndUnloaded: true };
})();
