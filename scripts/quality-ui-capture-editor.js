(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  const file = "C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/quality-editor.png";
  if (!root?.querySelector('.st-quality-field input[type="range"]')) throw Error("Source editor is not open");
  const detail = root.querySelector(".st-quality-details");
  if (detail && !detail.open) detail.querySelector("summary")?.click();
  root.querySelector(".st-body").scrollTop = root.querySelector(".st-body").scrollHeight;
  setTimeout(() => require("electron").remote.getCurrentWindow().webContents.capturePage().then((image) => {
    require("fs").writeFileSync(file, image.toPNG());
    globalThis.__qualityUIEditorCapture = { path: file, width: image.getSize().width, height: image.getSize().height };
  }), 180);
})();
