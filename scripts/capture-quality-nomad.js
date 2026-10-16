(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const doc = document;
  if (!p || p.manifest.version !== "0.8.0" || p.task || p.progress.running || !p.progress.paused || p.callsThisRun !== 0)
    throw Error("Expected idle, paused Nomad 0.8.0 with zero recognition calls");
  if (doc.querySelector(".modal-container,.st-fullscreen-modal,.st-preview-modal"))
    throw Error("Preserving the existing open form");
  const config = JSON.stringify(p.config);
  void app.commands.executeCommandById("nomad-transcripts:open");
  for (let i = 0; i < 80 && !doc.querySelector(".st-fullscreen-modal"); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const root = doc.querySelector(".st-fullscreen-modal");
  const configure = [...(root?.querySelectorAll("button") ?? [])].find((b) => /^Configure /.test(b.getAttribute("aria-label") || ""));
  if (!root || !configure) throw Error("Production Mirrors or source Configure control missing");
  configure.click();
  const slider = root.querySelector('.st-quality-field input[type="range"]');
  if (!slider || slider.getAttribute("aria-valuetext") !== "Fast") throw Error("Expected legacy source to open at Fast");
  slider.value = "1";
  slider.dispatchEvent(new slider.ownerDocument.defaultView.Event("input", { bubbles: true }));
  root.querySelector(".st-quality-details summary")?.click();
  return {
    screen: root.innerText.includes("Source") ? "source-settings" : "unknown",
    mode: slider.getAttribute("aria-valuetext"),
    detailsOpen: root.querySelector(".st-quality-details")?.open === true,
    details: root.querySelector(".st-quality-detail-copy")?.innerText,
    configUnchanged: JSON.stringify(p.config) === config,
  };
})()
