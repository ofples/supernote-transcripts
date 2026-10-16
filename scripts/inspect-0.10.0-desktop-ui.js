(() => {
  const modal = document.querySelector(".st-fullscreen-modal");
  if (!modal) throw new Error("0.10.0 Mirrors modal is missing");
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const result = {
    title: modal.querySelector("h1")?.textContent,
    buttons: [...modal.querySelectorAll("button")].map((button) => ({
      label: button.getAttribute("aria-label") || button.textContent.trim(),
      className: String(button.className),
      rect: rect(button),
    })),
    sourceRows: modal.querySelectorAll(".st-rule-row").length,
    configureLabels: [...modal.querySelectorAll('button[aria-label^="Configure "]')].map((button) => button.getAttribute("aria-label")),
    horizontalOverflow: modal.scrollWidth > modal.clientWidth,
    closeAtRight: (() => { const close = modal.querySelector('button[aria-label="Close"]'); const shell = modal.querySelector(".st-shell"); return !!close && !!shell && Math.abs(rect(close).x + rect(close).width - (rect(shell).x + rect(shell).width)) <= 12; })(),
  };
  globalThis.__desktop010UiInspection = result;
  return result;
})();
