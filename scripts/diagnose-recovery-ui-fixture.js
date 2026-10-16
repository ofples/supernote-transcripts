(async () => {
  const c = window.__transcriptUIFixture;
  const root = document.querySelector(".st-fullscreen-modal");
  const state = c?.store.notebooks[c.recoveryFixture.source];
  const action = c?.recoveryFixture.actions.at(-1);
  const text = root?.querySelector(".st-recovery-result")?.textContent ?? "";
  return {
    fixturePresent: !!c,
    recoveryOpen: !!root?.querySelector(".st-recovery-compare"),
    actions: c?.recoveryFixture.actions.length,
    action: action?.action,
    expectedMatches: action?.expectedCurrent === c?.recoveryFixture.current,
    currentEqualsGenerated: c?.recoveryFixture.current === c?.recoveryFixture.generated,
    stateStatus: state?.status,
    hasStateError: !!state?.error,
    resultPresent: !!root?.querySelector(".st-recovery-result"),
    resultMentionsBackup: text.includes(`${state?.output}.backup-fixture`),
    resultMentionsMirror: text.includes(state?.output ?? "__missing__"),
    buttonCount: root?.querySelectorAll(".st-recovery-actions button").length,
  };
})();
