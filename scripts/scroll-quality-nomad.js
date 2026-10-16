(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  const slider = root?.querySelector('.st-quality-field input[type="range"]');
  if (!root || !slider) throw Error("Production source quality editor is not open");
  slider.closest(".st-quality-field")?.scrollIntoView({ block: "center", behavior: "instant" });
  return { mode: slider.getAttribute("aria-valuetext"), detailsOpen: root.querySelector(".st-quality-details")?.open === true };
})()
