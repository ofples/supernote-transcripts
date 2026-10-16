(async () => {
  let stage = "guard";
  const mark = (next) => { stage = next; globalThis.__desktop010UiCheck = { status: "running", stage }; };
  const p = app.plugins.plugins["nomad-transcripts"];
  const fail = (message) => { throw new Error(message); };
  const modal = document.querySelector(".st-fullscreen-modal");
  if (!p || p.manifest.version !== "0.10.0" || !modal || p.task || p.progress.running || !p.progress.paused)
    fail("Live UI guard failed");
  const readLayout = () => {
    const box = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const close = modal.querySelector(".st-close");
    const header = modal.querySelector(".st-header");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      modal: box(modal), shell: box(modal.querySelector(".st-shell")), header: box(header), close: box(close),
      closeAlignedRight: !!close && !!header && Math.abs(box(close).right - box(header).right) <= 12,
      horizontalOverflow: modal.scrollWidth > modal.clientWidth,
    };
  };
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (modal.querySelector("h1")?.textContent !== "Transcripts") {
    [...modal.querySelectorAll("button")].find((button) => button.textContent.trim() === "Sources")?.click();
    await settle();
  }
  if (modal.querySelector("h1")?.textContent !== "Transcripts") fail("Could not return to Sources before live UI check");
  const configBefore = JSON.stringify(p.config);
  const storeBefore = JSON.stringify(p.store);
  const localBefore = {
    paused: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:paused`),
    costs: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`),
    usage: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:subscription-usage-v1`),
  };
  const activeBefore = app.workspace.getActiveFile()?.path ?? null;
  const leavesBefore = app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view?.file?.path).filter(Boolean);
  const modalsBefore = document.querySelectorAll(".modal-container,[role='dialog'],.st-preview-modal").length;
  if (modalsBefore !== 1) fail("Unexpected dialog was open before live UI check");
  const sourcesLayout = readLayout();
  mark("open-source-editor");
  const sourceLabels = [...modal.querySelectorAll('button[aria-label^="Configure "]')].map((button) => button.getAttribute("aria-label"));
  const sourceButton = modal.querySelector('button[aria-label="Configure Satsang"]') ?? modal.querySelector('button[aria-label^="Configure "]');
  if (!sourceButton) fail("No source editor entry was available");
  sourceButton.click();
  await settle();
  mark("verify-source-editor");
  if (modal.querySelector("h1")?.textContent !== "Source settings") fail("Source editor did not open");
  const editorLayout = readLayout();
  const editorText = modal.innerText;
  const editorLabels = [...modal.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") || button.textContent.trim()).filter(Boolean);
  if (!editorText.includes("What to mirror") || !editorText.includes("Save Markdown") || !editorText.includes("Recognition"))
    fail("Source editor sections were not present");
  const footer = modal.querySelector(".st-footer");
  const save = [...modal.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save");
  const cancel = [...modal.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel");
  if (!save || !cancel || !footer?.contains(save) || !footer?.contains(cancel)) fail("Source editor Save/Cancel footer is missing");
  const footerLayout = { save: (() => { const r = save.getBoundingClientRect(); return { y: Math.round(r.y), bottom: Math.round(r.bottom), height: Math.round(r.height) }; })(), cancel: (() => { const r = cancel.getBoundingClientRect(); return { y: Math.round(r.y), bottom: Math.round(r.bottom), height: Math.round(r.height) }; })() };
  cancel.click();
  await settle();
  mark("source-cancel-return");
  if (modal.querySelector("h1")?.textContent !== "Transcripts") fail("Source editor Cancel did not return to Sources");
  [...modal.querySelectorAll("button")].find((button) => button.textContent.trim() === "Queue")?.click();
  await settle();
  mark("queue-view");
  if (modal.querySelector("h1")?.textContent !== "Queue") fail("Queue view did not open");
  const queueLayout = readLayout();
  const queueText = modal.innerText;
  const queueHasSections = queueText.includes("Up next") &&
    (queueText.includes("Working now") || queueText.includes("Paused"));
  if (!queueHasSections) fail("Queue sections were not present");
  mark("open-settings");
  modal.querySelector('button[aria-label="Settings"]')?.click();
  await settle();
  mark("verify-settings");
  if (modal.querySelector("h1")?.textContent !== "Settings") fail("General Settings did not open from Queue");
  const settingsHasSections = ["Connection", "Run behavior", "Default recognition", "Transcript appearance"]
    .every((text) => modal.innerText.includes(text));
  const settingsCancel = [...modal.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel");
  if (!settingsCancel || !settingsHasSections) fail("General Settings content or Cancel is missing");
  settingsCancel.click();
  await settle();
  mark("settings-cancel-return");
  const settingsCancelReturnedQueue = modal.querySelector("h1")?.textContent === "Queue";
  if (!settingsCancelReturnedQueue) fail("Settings Cancel did not return to Queue");
  modal.querySelector('button[aria-label="Close mirrors"]')?.click();
  await settle();
  mark("closed");
  const noModalAfterClose = !document.querySelector(".st-fullscreen-modal");
  const result = {
    status: "complete",
    version: p.manifest.version,
    sourceLabels,
    sourceEditorSections: true,
    sourceEditorCancelReturnedSources: true,
    settingsSections: settingsHasSections,
    settingsCancelReturnedQueue,
    queueSections: queueHasSections,
    noModalAfterClose,
    layouts: { sources: sourcesLayout, sourceEditor: editorLayout, queue: queueLayout, sourceFooter: footerLayout },
    configUnchanged: JSON.stringify(p.config) === configBefore,
    storeUnchanged: JSON.stringify(p.store) === storeBefore,
    localAccountingAndPauseUnchanged: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:paused`) === localBefore.paused &&
      localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`) === localBefore.costs &&
      localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:subscription-usage-v1`) === localBefore.usage,
    activeFileUnchanged: (app.workspace.getActiveFile()?.path ?? null) === activeBefore,
    markdownTabsUnchanged: JSON.stringify(app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view?.file?.path).filter(Boolean)) === JSON.stringify(leavesBefore),
    activeFile: activeBefore,
    markdownTabCount: leavesBefore.length,
    recognitionRequests: p.callsThisRun ?? 0,
  };
  globalThis.__desktop010UiCheck = result;
  if (!result.noModalAfterClose || !result.configUnchanged || !result.storeUnchanged || !result.localAccountingAndPauseUnchanged ||
      !result.activeFileUnchanged || !result.markdownTabsUnchanged || result.recognitionRequests !== 0)
    fail("Post-UI preservation check failed");
  return result;
})();
