(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  const fixture = window.__qualityUIFixture;
  if (!root || !fixture) throw Error("Quality fixture panel/controller missing");
  const configure = root.querySelector('[aria-label="Configure Demo"]');
  if (!configure) throw Error("Demo configure button missing");
  configure.click();
  const panel = document.querySelector(".st-fullscreen-modal");
  const slider = panel.querySelector('.st-quality-field input[type="range"]');
  const sourceChoice = panel.querySelector(".st-source-choice");
  if (!slider || !sourceChoice) throw Error("Quality slider or source chooser missing");
  panel.querySelector(".st-quality-details summary")?.click();
  const choiceStyle = getComputedStyle(sourceChoice);
  const choiceRect = sourceChoice.getBoundingClientRect();
  const buttonRect = sourceChoice.querySelector("button")?.getBoundingClientRect();
  globalThis.__qualityUIInspection = {
    screen: panel.innerText.includes("Mirror settings") ? "editor" : "unknown",
    slider: { type: slider.type, min: slider.min, max: slider.max, step: slider.step, value: slider.value, valueText: slider.getAttribute("aria-valuetext") },
    ticks: [...panel.querySelectorAll(".st-quality-labels span")].map((node) => node.textContent),
    summary: panel.querySelector(".st-quality-summary")?.textContent,
    details: panel.querySelector(".st-quality-detail-copy")?.innerText,
    sourceChoice: { borderLeft: choiceStyle.borderLeftWidth, display: choiceStyle.display, x: choiceRect.x, y: choiceRect.y, buttonX: buttonRect?.x, buttonY: buttonRect?.y },
    realWorker: { idle: !app.plugins.plugins["nomad-transcripts"].task, paused: app.plugins.plugins["nomad-transcripts"].progress.paused },
  };
  return globalThis.__qualityUIInspection;
})();
