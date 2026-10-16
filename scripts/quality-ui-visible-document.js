(() => {
  const webContents = require("electron").remote.getCurrentWindow().webContents;
  globalThis.__qualityUIVisibleDocument = { state: "pending" };
  webContents.executeJavaScript(`(() => { const r=document.querySelector(".st-fullscreen-modal"); return {hidden:document.hidden,visibility:document.visibilityState,hasFixture:!!window.__qualityUIFixture,modal:!!r,slider:!!r?.querySelector("input[type=range]"),title:document.title}; })()`)
    .then((result) => { globalThis.__qualityUIVisibleDocument = result; })
    .catch((error) => { globalThis.__qualityUIVisibleDocument = { error: String(error?.name || "Error") }; });
})();
