(async () => {
  const c = window.Capacitor;
  const a = c?.Plugins?.App;
  return {
    hidden: document.hidden,
    focus: document.hasFocus(),
    plugins: c?.Plugins ? Object.keys(c.Plugins) : [],
    hasApp: !!a,
    hasGetState: typeof a?.getState,
    appState: a?.getState ? await a.getState() : null,
  };
})();
