(async () => {
  const c = window.__transcriptUIFixture;
  const root = document.querySelector(".st-fullscreen-modal");
  if (!c || !root?.querySelector(".st-recovery-compare")) throw new Error("Isolated recovery preview is not open");
  const expectedCurrent = c.recoveryFixture.current;
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Keep edits · create new mirror");
  if (!button || button.disabled) throw new Error("Keep edits action is unavailable");
  button.click();
  for (let i = 0; i < 40 && !root.querySelector(".st-recovery-result"); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  const action = c.recoveryFixture.actions.at(-1);
  const state = c.store.notebooks[c.recoveryFixture.source];
  const resultText = root.querySelector(".st-recovery-result")?.textContent ?? "";
  const expectedOutput = "Supernote Transcripts/UI Fixture/Edited (new mirror).md";
  const verified = action?.action === "keep" && action.expectedCurrent === expectedCurrent &&
    c.recoveryFixture.current === expectedCurrent && state.output === expectedOutput && state.status === "current" && !state.error &&
    resultText.includes("Your edits remain at the original path. A new mirror was created.") && resultText.includes(expectedOutput);
  if (!verified) throw new Error("Mock Keep edits action did not preserve the original and create its new mirror");
  return { mockKeepActionVerified: true, expectedCurrentMatchedExactly: true, originalEditPreserved: true, newMirrorPathShown: true, resultStatusCurrent: true };
})();
