(() => {
  const win = require("electron").remote.getCurrentWindow();
  win.restore();
  win.show();
  win.focus();
  globalThis.__qualityUIWindowFocus = { requested: true };
  setTimeout(() => {
    globalThis.__qualityUIWindowFocus = {
      requested: true,
      windowVisible: win.isVisible(),
      hidden: document.hidden,
      visibility: document.visibilityState,
      panelVisible: !!document.querySelector(".st-fullscreen-modal")?.getBoundingClientRect().height,
    };
  }, 250);
})();
