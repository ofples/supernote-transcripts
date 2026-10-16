(async () => {
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const nodes = () => [...new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]))];
  if (nodes().length) throw new Error("A user form is open; leaving it untouched");
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p || p.manifest.version !== "0.7.1" || p.platform !== "desktop" || p.task || !p.progress.paused || (p.callsThisRun ?? 0) !== 0)
    throw new Error("Production plugin is not in the expected desktop, idle, paused state");
  // The command opens a modal and may intentionally keep its promise pending until close.
  void app.commands.executeCommandById("nomad-transcripts:open");
  await new Promise((resolve) => setTimeout(resolve, 250));
  let root = docs.map((doc) => doc.querySelector(".st-fullscreen-modal")).find(Boolean);
  if (!root) throw new Error("Mirrors panel did not open");
  const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  const geometry = () => {
    const r = root.getBoundingClientRect();
    const v = root.ownerDocument.defaultView;
    return {
      horizontalOverflow: root.scrollWidth > root.clientWidth,
      insideWindow: r.left >= 0 && r.top >= 0 && r.right <= (v?.innerWidth ?? 0) && r.bottom <= (v?.innerHeight ?? 0),
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      view: { width: v?.innerWidth ?? 0, height: v?.innerHeight ?? 0 },
    };
  };
  const result = {
    version: p.manifest.version,
    platform: p.platform,
    connected: !!p.subscriptionStatus.connected,
    idle: !p.task,
    paused: !!p.progress.paused,
    recognitionRequests: p.callsThisRun ?? 0,
    closeControls: root.querySelectorAll(".st-close").length,
    mirrorsTab: !!button("Mirrors"),
    queueTab: !!button("Queue"),
    geometry: geometry(),
  };
  if (!button("Queue") || !button("Mirrors")) throw new Error("Expected Mirrors and Queue tabs");
  button("Queue").click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  result.queueScreen = root.textContent.includes("Queue");
  result.queueItemCount = root.querySelectorAll(".st-queue-item,.st-issue-row").length;
  button("Mirrors").click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const add = button("+ Add source");
  if (!add) throw new Error("Add source control is unavailable");
  add.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  result.sourceBrowserOpen = root.textContent.includes("Mirror this folder");
  result.satsangEntryPresent = [...root.querySelectorAll(".st-browser-entry")]
    .some((entry) => /Satsang/i.test(entry.getAttribute("title") || entry.textContent || ""));
  result.sourceBrowserMirrorActions = root.querySelectorAll(".st-browser-entry button").length;
  result.geometry = geometry();
  // Close only the Mirrors modal opened above. No browser Mirror action is invoked.
  const close = root.querySelector(".st-close");
  if (close) close.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  result.ownModalClosed = !docs.some((doc) => doc.querySelector(".st-fullscreen-modal"));
  result.noUserForms = nodes().length === 0;
  result.finalIdle = !p.task;
  result.finalPaused = !!p.progress.paused;
  result.finalRecognitionRequests = p.callsThisRun ?? 0;
  globalThis.__desktop071FinalUIResult = result;
  return result;
})()
