(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const doc = globalThis.activeDocument || document;
  if (!p || p.manifest.version !== "0.8.0" || p.task || !p.progress.paused || p.callsThisRun !== 0)
    throw Error("Expected idle, paused desktop 0.8.0 with zero recognition calls");
  if (doc.querySelector(".modal-container,.st-fullscreen-modal")) throw Error("Preserve the open user form");
  const configBefore = JSON.stringify(p.config);
  const hash = value => require("crypto").createHash("sha256").update(value).digest("hex");
  const outputs = {};
  for (const n of Object.values(p.store.notebooks))
    if (await app.vault.adapter.exists(n.output)) outputs[n.output] = hash(await app.vault.adapter.read(n.output));
  void app.commands.executeCommandById("nomad-transcripts:open");
  await new Promise(r => setTimeout(r, 150));
  const root = doc.querySelector(".st-fullscreen-modal");
  if (!root) throw Error("Production Mirrors did not open");
  const result = { version: p.manifest.version, sourceCount: p.config.rules.filter(r => r.enabled).length };
  try {
    const configure = [...root.querySelectorAll("button")].find(b => /^Configure /.test(b.getAttribute("aria-label") || ""));
    if (!configure) throw Error("No source Configure control");
    configure.click();
    const slider = root.querySelector('.st-quality-field input[type="range"]');
    if (!slider) throw Error("Production quality slider missing");
    result.initialMode = slider.getAttribute("aria-valuetext");
    result.labels = [...root.querySelectorAll(".st-quality-labels span")].map(n => n.textContent);
    result.range = { min: slider.min, max: slider.max, step: slider.step };
    slider.value = "1";
    slider.dispatchEvent(new slider.ownerDocument.defaultView.Event("input", { bubbles: true }));
    result.balancedPreview = slider.getAttribute("aria-valuetext") === "Balanced";
    result.detailsCollapsed = !root.querySelector(".st-quality-details").open;
    const cancel = [...root.querySelectorAll("button")].find(b => b.textContent.trim() === "Cancel");
    if (!cancel) throw Error("Cancel missing");
    cancel.click();
    result.cancelPreservedConfig = JSON.stringify(p.config) === configBefore;
  } finally { root.querySelector(".st-close")?.click(); }
  result.outputHashesPreserved = true;
  for (const [path, before] of Object.entries(outputs))
    if (hash(await app.vault.adapter.read(path)) !== before) result.outputHashesPreserved = false;
  result.idle = !p.task && !p.progress.running;
  result.paused = p.progress.paused;
  result.recognitionCalls = p.callsThisRun;
  result.formsClosed = !doc.querySelector(".st-fullscreen-modal");
  if (!result.balancedPreview || !result.cancelPreservedConfig || !result.outputHashesPreserved || !result.idle || !result.paused || result.recognitionCalls !== 0 || !result.formsClosed)
    throw Error("Production UI preservation check failed");
  globalThis.__qualityProductionUI = result;
  require("fs").writeFileSync("C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/quality-production-desktop.json", JSON.stringify(result, null, 2));
  return result;
})()
