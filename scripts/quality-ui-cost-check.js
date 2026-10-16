(() => {
  const root = document.querySelector(".st-fullscreen-modal");
  const costs = root?.querySelector('[aria-label="Costs"]');
  if (!root || !costs) throw Error("Costs control is not visible");
  costs.click();
  setTimeout(() => {
    const details = document.querySelector(".st-fullscreen-modal .st-cost-settings");
    if (details) details.open = true;
    const text = details?.innerText || "";
    globalThis.__qualityUICostCheck = { exists: !!details, text, expectedLabel: text.includes("Output allowance per page"), oldLabelAbsent: !text.includes("Maximum output tokens"), explainsGrouped: /grouped|requests multiply|quality/i.test(text) };
  }, 150);
})();
