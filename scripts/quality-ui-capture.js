(() => {
  const fixture = window.__qualityUIFixture;
  const root = document.querySelector(".st-fullscreen-modal");
  if (!fixture || !root) throw Error("Quality fixture is not open");
  const file = "C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/desktop-ui.png";
  globalThis.__qualityUICapture = { state: "pending" };
  require("electron").remote.getCurrentWindow().webContents.capturePage()
    .then((image) => {
      require("fs").writeFileSync(file, image.toPNG());
      globalThis.__qualityUICapture = { state: "saved", width: image.getSize().width, height: image.getSize().height };
    })
    .catch((error) => { globalThis.__qualityUICapture = { state: "failed", error: String(error?.name || "Error") }; });
})();
