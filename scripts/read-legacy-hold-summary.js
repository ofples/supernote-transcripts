(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const state = Object.values(p?.store?.notebooks ?? {}).find((item) => !!item.legacyPageFailure);
  if (!state) return { found: false };
  return {
    found: true,
    notebook: state.source.replace(/\\/g, "/").split("/").pop(),
    desiredPages: state.desired.length,
    cachedPages: Object.keys(state.pages ?? {}).length,
  };
})()
