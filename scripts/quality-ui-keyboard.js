(() => {
  const sliderSelector = '.st-fullscreen-modal .st-quality-field input[type="range"]';
  const fixture = window.__qualityUIFixture;
  const slider = document.querySelector(sliderSelector);
  if (!fixture || !slider || slider.type !== "range") throw Error("Fixture slider missing");
  const webContents = require("electron").remote.getCurrentWindow().webContents;
  slider.focus();
  const before = slider.value;
  const keys = ["LEFT", "LEFT", "RIGHT", "RIGHT"];
  globalThis.__qualityUIKeyboardResult = { state: "sent", before, keys };
  const values = [];
  const sendNext = (index) => {
    if (index === keys.length) {
      const current = document.querySelector(sliderSelector);
      globalThis.__qualityUIKeyboardResult = { state: "observed", before, values, after: current?.value, valueText: current?.getAttribute("aria-valuetext"), summary: document.querySelector(".st-quality-summary")?.textContent, keys };
      return;
    }
    const keyCode = keys[index];
    webContents.sendInputEvent({ type: "keyDown", keyCode });
    webContents.sendInputEvent({ type: "keyUp", keyCode });
    setTimeout(() => {
      values.push(document.querySelector(sliderSelector)?.value);
      sendNext(index + 1);
    }, 60);
  };
  sendNext(0);
})();
