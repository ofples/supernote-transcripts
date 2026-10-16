(() => {
  const fs = require("fs");
  const interaction = JSON.parse(fs.readFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/interactions.json", "utf8"));
  const slider = document.querySelector('.st-fullscreen-modal .st-quality-field input[type="range"]');
  const source = document.querySelector(".st-source-choice");
  const evidence = {
    interactions: interaction,
    keyboard: globalThis.__qualityUIKeyboardResult,
    editor: { open: !!slider, range: slider ? { min: slider.min, max: slider.max, step: slider.step, value: slider.value, ariaValueText: slider.getAttribute("aria-valuetext") } : null, labels: [...document.querySelectorAll(".st-quality-labels span")].map((x) => x.textContent), summary: document.querySelector(".st-quality-summary")?.textContent, details: document.querySelector(".st-quality-detail-copy")?.innerText },
    sourceChoice: source ? { borderLeft: getComputedStyle(source).borderLeftWidth, display: getComputedStyle(source).display, x: source.getBoundingClientRect().x, buttonX: source.querySelector("button")?.getBoundingClientRect().x } : null,
    visible: { hidden: document.hidden, state: document.visibilityState },
    screenshot: "quality-editor.png",
  };
  fs.writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-ui-fixture/ui-check-evidence.json", JSON.stringify(evidence, null, 2));
  return evidence;
})();
