(() => {
  const slider = document.querySelector('.st-fullscreen-modal .st-quality-field input[type="range"]');
  if (!slider) throw Error("Quality slider is not visible");
  slider.focus();
  globalThis.__qualityUIKeyProbe = { focused: document.activeElement === slider, initial: slider.value, valueText: slider.getAttribute("aria-valuetext") };
  return globalThis.__qualityUIKeyProbe;
})();
