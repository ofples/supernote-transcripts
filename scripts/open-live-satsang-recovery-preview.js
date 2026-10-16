(async () => {
  const root = document.querySelector(".st-fullscreen-modal");
  if (!root || document.querySelectorAll(".st-fullscreen-modal").length !== 1)
    throw new Error("Expected one production mirrors panel");
  const plugin = app.plugins.plugins["nomad-transcripts"];
  if (!plugin || plugin.manifest.version !== "0.6.4" || plugin.task || !plugin.progress.paused)
    throw new Error("Production state changed before preview");
  const source = Object.keys(plugin.store.notebooks).find((candidate) => /Satsang/i.test(candidate));
  const state = source && plugin.store.notebooks[source];
  const rule = state && plugin.config.rules.find((candidate) => candidate.id === state.ruleId);
  if (!source || !state || !rule) throw new Error("Satsang notebook state is unavailable");
  let folder = [...root.querySelectorAll(".st-folder-contents")].find((candidate) => candidate.dataset.ruleId === rule.id);
  if (!folder) {
    const expand = [...root.querySelectorAll("button.st-folder-toggle")].find((candidate) => candidate.dataset.configId === `${rule.id}:expand`);
    if (!expand) throw new Error("Could not expand the Satsang folder");
    expand.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    folder = [...root.querySelectorAll(".st-folder-contents")].find((candidate) => candidate.dataset.ruleId === rule.id);
  }
  const title = source.split(/[\\/]/).pop().replace(/\.note$/i, "");
  const row = folder && [...folder.querySelectorAll(".st-notebook-child")].find((candidate) =>
    candidate.querySelector(".st-rule-source")?.textContent.trim() === title);
  const button = row?.querySelector("button.st-recovery-action");
  if (!button) throw new Error("Could not identify the Satsang Resolve edits action");
  button.click();
  const deadline = Date.now() + 15000;
  let recovery;
  while (Date.now() < deadline) {
    recovery = document.querySelector(".st-fullscreen-modal .st-recovery");
    const busy = recovery?.querySelector(".st-recovery-compare") || recovery?.querySelector(".st-recovery-error");
    if (busy) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!recovery) throw new Error("Recovery view did not open");
  const compare = recovery.querySelector("details.st-recovery-compare");
  const textVersions = [...recovery.querySelectorAll("pre.st-recovery-text")];
  const actions = [...document.querySelectorAll(".st-recovery-actions button")];
  return {
    version: plugin.manifest.version,
    recoveryViewOpen: true,
    previewReady: !!compare && textVersions.length === 2,
    compareCollapsedByDefault: !!compare && !compare.open,
    currentLength: textVersions[0]?.textContent.length ?? 0,
    generatedLength: textVersions[1]?.textContent.length ?? 0,
    resolveActionsPresent: actions.length === 2,
    resolveActionsEnabled: actions.length === 2 && actions.every((action) => !action.disabled),
    closeControls: document.querySelectorAll(".st-fullscreen-modal .st-close").length,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    paused: !!plugin.progress.paused,
    idle: !plugin.task,
  };
})()
