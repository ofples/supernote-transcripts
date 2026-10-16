(() => {
  const fs = require("fs");
  const report = {
    inspection: globalThis.__qualityUIInspection,
    interactions: globalThis.__qualityUIInteractions,
    visibleDocument: globalThis.__qualityUIVisibleDocument,
    capture: globalThis.__qualityUICapture,
    keyboard: globalThis.__qualityUIKeyboardResult,
    state: globalThis.__qualityUIState,
    costCheck: globalThis.__qualityUICostCheck,
  };
  fs.writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/desktop-report.json", JSON.stringify(report, null, 2));
  return report;
})();
