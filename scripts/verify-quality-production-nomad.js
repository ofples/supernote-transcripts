(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const doc = globalThis.activeDocument || document;
  const forms = () => doc.querySelectorAll(".modal-container,.st-fullscreen-modal,.st-preview-modal").length;
  if (!p || p.manifest.version !== "0.8.0" || p.task || p.progress.running || !p.progress.paused || p.callsThisRun !== 0)
    throw Error("Expected idle, paused Nomad 0.8.0 with zero recognition calls");
  if (forms()) throw Error("Preserving the existing open form");
  const configBefore = JSON.stringify(p.config);
  const hash = async (value) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const outputs = {};
  for (const n of Object.values(p.store.notebooks))
    if (await app.vault.adapter.exists(n.output)) outputs[n.output] = await hash(await app.vault.adapter.read(n.output));
  const result = { version: p.manifest.version, sourceCount: p.config.rules.filter((r) => r.enabled).length };
  void app.commands.executeCommandById("nomad-transcripts:open");
  for (let i = 0; i < 80 && !doc.querySelector(".st-fullscreen-modal"); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const root = doc.querySelector(".st-fullscreen-modal");
  if (!root) throw Error("Production Mirrors did not open");
  try {
    const configure = [...root.querySelectorAll("button")].find((b) => /^Configure /.test(b.getAttribute("aria-label") || ""));
    if (!configure) throw Error("No source Configure control");
    configure.click();
    const slider = root.querySelector('.st-quality-field input[type="range"]');
    if (!slider) throw Error("Production quality slider missing");
    result.initialMode = slider.getAttribute("aria-valuetext");
    result.labels = [...root.querySelectorAll(".st-quality-labels span")].map((n) => n.textContent?.trim());
    result.range = { min: slider.min, max: slider.max, step: slider.step };
    const details = root.querySelector(".st-quality-details");
    if (!details) throw Error("Quality details missing");
    result.detailsInitiallyCollapsed = !details.open;
    details.querySelector("summary")?.click();
    const detailText = () => root.querySelector(".st-quality-detail-copy")?.innerText ?? "";
    result.fastDetails = detailText();
    slider.value = "2";
    slider.dispatchEvent(new slider.ownerDocument.defaultView.Event("input", { bubbles: true }));
    result.carefulMode = slider.getAttribute("aria-valuetext");
    result.carefulDetails = detailText();
    slider.value = "1";
    slider.dispatchEvent(new slider.ownerDocument.defaultView.Event("input", { bubbles: true }));
    result.balancedMode = slider.getAttribute("aria-valuetext");
    result.balancedDetails = detailText();
    const cancel = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel");
    if (!cancel) throw Error("Cancel missing");
    cancel.click();
    result.cancelPreservedConfig = JSON.stringify(p.config) === configBefore;
  } finally {
    root.querySelector(".st-close")?.click();
  }
  result.outputHashesPreserved = true;
  for (const [path, before] of Object.entries(outputs))
    if (!(await app.vault.adapter.exists(path)) || await hash(await app.vault.adapter.read(path)) !== before)
      result.outputHashesPreserved = false;
  result.idle = !p.task && !p.progress.running;
  result.paused = p.progress.paused;
  result.recognitionCalls = p.callsThisRun;
  result.formsClosed = forms() === 0;
  result.modeDetailsAccurate = result.fastDetails.includes("Up to 1 target page") &&
    result.fastDetails.includes("Up to 0 neighbor page") && result.fastDetails.includes("One-target request output cap") &&
    result.carefulDetails.includes("Up to 4 target pages") && result.carefulDetails.includes("Up to 2 neighbor page") &&
    result.carefulDetails.includes("24,000 characters") && result.carefulDetails.includes("Maximum 4-target request output cap") &&
    result.balancedDetails.includes("Up to 4 target pages") && result.balancedDetails.includes("Up to 1 neighbor page") &&
    result.balancedDetails.includes("12,000 characters") && result.balancedDetails.includes("Maximum 4-target request output cap") &&
    result.balancedDetails.includes("Reasoning: medium.");
  if (result.initialMode !== "Fast" || JSON.stringify(result.labels) !== JSON.stringify(["Fast", "Balanced", "Careful"]) ||
      result.range.min !== "0" || result.range.max !== "2" || result.range.step !== "1" || !result.detailsInitiallyCollapsed ||
      result.carefulMode !== "Careful" || result.balancedMode !== "Balanced" || !result.modeDetailsAccurate ||
      !result.cancelPreservedConfig || !result.outputHashesPreserved || !result.idle || !result.paused ||
      result.recognitionCalls !== 0 || !result.formsClosed)
    throw Error("Production quality UI verification failed");
  return result;
})()
