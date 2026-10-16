(async () => {
  const c = window.__transcriptUIFixture;
  const action = c?.recoveryFixture.actions.at(-1);
  const state = c?.store.notebooks[c.recoveryFixture.source];
  const expectedCurrent = ["---", "nomad_transcripts: true", "---", "", "# Edited fixture transcript", "", "A user correction that must be preserved or explicitly backed up."].join("\n");
  const resultText = document.querySelector(".st-recovery-result")?.textContent ?? "";
  return {
    fixturePresent: !!c,
    action: action?.action,
    expectedCurrentMatchesFixture: action?.expectedCurrent === expectedCurrent,
    currentEditPreserved: c?.recoveryFixture.current === expectedCurrent,
    currentIsGenerated: c?.recoveryFixture.current === c?.recoveryFixture.generated,
    outputPathCorrect: state?.output === "Supernote Transcripts/UI Fixture/Edited (new mirror).md",
    stateCurrent: state?.status === "current",
    stateHasNoError: !state?.error,
    resultPresent: !!document.querySelector(".st-recovery-result"),
    resultExplainsKeep: resultText.includes("Your edits remain at the original path. A new mirror was created."),
    resultHasNewMirrorPath: resultText.includes("Supernote Transcripts/UI Fixture/Edited (new mirror).md"),
    accountFixtureCalls: c?.accountActionCalls,
  };
})();
