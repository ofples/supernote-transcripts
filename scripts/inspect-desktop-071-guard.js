(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const prefix = `nomad-transcripts:${app.vault.getName()}`;
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl,
    globalThis.activeDocument?.contentEl, globalThis.activeDocument?.document]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const forms = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(
    ".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal",
  )]));
  const manifest = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/nomad-transcripts/manifest.json`));
  const result = {
    vault: app.vault.getName(),
    version: p?.manifest?.version,
    stagedVersion: manifest.version,
    loaded: !!p,
    initializing: !!p?.initializing,
    taskPresent: !!p?.task,
    progressRunning: !!p?.progress?.running,
    paused: p?.progress?.paused === true,
    pausedPreference: localStorage.getItem(`${prefix}:paused`),
    storageBlocked: !!p?.stateStorageIssue,
    progressBlocked: !!p?.progress?.stateBlocked,
    connected: !!p?.subscriptionStatus?.connected,
    fixtureLoaded: !!app.plugins.plugins["nomad-transcripts-ui-fixture"],
    forms: forms.size,
    ownForms: [...forms].filter((node) => node.matches?.(".st-fullscreen-modal,.st-preview-modal") ||
      node.querySelector?.(".st-fullscreen-modal,.st-preview-modal")).length,
  };
  globalThis.__desktop071Guard = result;
  return result;
})()
