(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const forms = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]));
  const own = [...forms].filter((node) => node.matches(".st-fullscreen-modal,.st-preview-modal") || node.querySelector(".st-fullscreen-modal,.st-preview-modal")).length;
  const status = {
    version: p?.manifest?.version ?? null,
    connected: !!p?.subscriptionStatus?.connected,
    idle: !!p && !p.task,
    paused: !!p?.progress?.paused,
    initializing: !!p?.initializing,
    desktop: globalThis.__desktop === true,
    providerPresent: typeof p?.provider === "string",
    aiEnabled: !!p?.aiEnabled,
    autoEnabled: !!p?.autoEnabled,
    callsThisRun: p?.callsThisRun ?? 0,
    ownForms: own,
  };
  globalThis.__desktop064PostActivationStatus = status;
  return status;
})()
