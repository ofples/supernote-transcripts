(async () => {
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const nodes = () => [...new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]))];
  const current = nodes();
  if (current.length) throw new Error("A user form is open; leaving it untouched");
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p || p.manifest.version !== "0.6.4" || p.platform !== "desktop" || p.task || !p.progress.paused)
    throw new Error("Production plugin is not in its expected desktop, idle, paused state");
  await app.commands.executeCommandById("nomad-transcripts:open");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const roots = docs.flatMap((doc) => [...doc.querySelectorAll(".st-fullscreen-modal")]);
  if (roots.length !== 1) throw new Error("Expected one Mirrors panel after the open command");
  const root = roots[0];
  const bounds = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  const buttons = [...root.querySelectorAll("button")];
  const result = {
    version: p.manifest.version,
    platform: p.platform,
    connected: !!p.subscriptionStatus.connected,
    idle: !p.task,
    paused: !!p.progress.paused,
    homeOpen: true,
    closeControls: root.querySelectorAll(".st-close").length,
    mirrorsTab: buttons.some((button) => button.textContent.trim() === "Mirrors"),
    queueTab: buttons.some((button) => button.textContent.trim() === "Queue"),
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    rect: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) },
    view: { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
    insideWindow: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= (view?.innerWidth ?? 0) && bounds.bottom <= (view?.innerHeight ?? 0),
  };
  globalThis.__desktop064HomeResult = result;
  return result;
})()
