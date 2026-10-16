(async () => {
  const c = window.__transcriptUIFixture,
    real = app.plugins.plugins["nomad-transcripts"];
  const root = () => document.querySelector(".st-fullscreen-modal");
  const assert = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  const click = (text) => {
    const b = [...root().querySelectorAll("button")].find(
      (x) => x.textContent.trim() === text,
    );
    assert(b, `Missing ${text}`);
    b.click();
  };
  const wait = () => new Promise((r) => setTimeout(r, 800));
  const field = (name) =>
    [...root().querySelectorAll("label")]
      .find((x) => x.querySelector("span")?.textContent === name)
      ?.querySelector("input");
  const input = (name, value) => {
    const el = field(name);
    assert(el, `Missing ${name}`);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const before = JSON.stringify(real.config),
    cache = JSON.stringify(real.store),
    original = JSON.stringify(c.config);
  const close = root().querySelector(".st-close").getBoundingClientRect();
  assert(innerWidth - close.right < 30, "Close button shifted left");
  assert(root().querySelectorAll(".st-close").length === 1, "Duplicate close");
  click("Costs");
  assert(
    root().innerText.includes("$1.00") && root().innerText.includes("$10.00"),
    "Default budget missing",
  );
  root().querySelector(".st-cost-settings").open = true;
  input("Daily spending limit (USD)", "0.75");
  click("Cancel");
  assert(c.costs.settings.dailyUsd === 1, "Cancel saved budget");
  click("Costs");
  root().querySelector(".st-cost-settings").open = true;
  input("Daily spending limit (USD)", "0.75");
  click("Save");
  await wait();
  assert(c.costs.settings.dailyUsd === 0.75, "Decimal not saved");
  const rule = c.config.rules.find((r) => r.enabled);
  root()
    .querySelector(
      `[aria-label="Configure ${rule.source
        .split("/")
        .pop()
        .replace(/\.note$/i, "")}"]`,
    )
    .click();
  click("Choose existing folder");
  await wait();
  const names = [...root().querySelectorAll(".st-browser-entry")].map((x) =>
    x.innerText.trim(),
  );
  assert(
    names.length && names.every((x) => !x.startsWith(".")),
    "Hidden config folders or empty output picker",
  );
  const entry = root().querySelector(".st-browser-entry");
  const chosen = entry.innerText.trim();
  entry.click();
  await wait();
  click("Choose this folder");
  assert(
    field("Output folder").value.endsWith(chosen),
    "Output folder selection failed",
  );
  click("Cancel");
  assert(
    JSON.stringify(c.config) === original,
    "Output picker changed saved config on cancel",
  );
  click("+ Add source");
  await wait();
  click("Choose this folder");
  assert(
    field("Output folder").value === "Supernote Transcripts/Transcripts",
    "New default path wrong",
  );
  click("Cancel");
  // Entirely synthetic folder and notebook state, confined to fixture memory.
  const folder = {
    ...rule,
    id: "fixture-folder",
    source: "/storage/emulated/0/Note/Fixture",
    enabled: true,
    paused: false,
  };
  c.config.rules = [folder];
  c.store.notebooks = {};
  for (const [name, total, ready] of [
    ["Planning", 3, 1],
    ["Reflections", 2, 2],
  ]) {
    const source = folder.source + "/" + name + ".note",
      desired = Array.from({ length: total }, (_, i) => ({
        id: "p" + i,
        number: i + 1,
        fingerprint: "f" + i,
      }));
    c.store.notebooks[source] = {
      id: name,
      source,
      ruleId: folder.id,
      output: name + ".md",
      revision: "test",
      order: desired.map((p) => p.id),
      desired,
      pages: Object.fromEntries(
        desired
          .slice(0, ready)
          .map((p) => [
            p.id,
            {
              fingerprint: p.fingerprint,
              text: "Mock",
              recipe: "test",
              number: p.number,
            },
          ]),
      ),
      status: ready === total ? "current" : "queued",
    };
  }
  await c.saveConfig();
  root().querySelector('[aria-label="Expand Fixture"]').click();
  assert(
    root().querySelectorAll(".st-notebook-child").length === 2,
    "Folder children missing",
  );
  const pause = () => root().querySelector('[aria-label="Pause Planning"]');
  pause().click();
  await wait();
  assert(
    c.store.notebooks[folder.source + "/Planning.note"].paused,
    "Notebook pause failed",
  );
  assert(
    root().querySelector(".st-notebook-child").innerText.includes("Paused"),
    "Notebook pause status missing",
  );
  root().querySelector('[aria-label="Resume Planning"]').click();
  await wait();
  root().querySelector('[aria-label="Pause Fixture"]').click();
  await wait();
  assert(c.config.rules[0].paused, "Folder pause failed");
  assert(
    [...root().querySelectorAll(".st-notebook-child .st-source-pause")].every(
      (x) => x.disabled,
    ),
    "Inherited pause missing",
  );
  root().querySelector('[aria-label="Resume Fixture"]').click();
  await wait();
  assert(
    root().querySelectorAll(".st-notebook-child").length === 2,
    "Expand state lost",
  );
  assert(
    JSON.stringify(real.config) === before &&
      JSON.stringify(real.store) === cache &&
      !real.aiEnabled &&
      !real.autoEnabled &&
      !real.task,
    "Real state changed",
  );
  const rects = [...root().querySelectorAll(".st-row-controls button")].map(
    (x) => x.getBoundingClientRect(),
  );
  assert(
    rects.every(
      (r) => r.width >= 48 && r.height >= 48 && r.right <= innerWidth,
    ),
    "Row controls overflow or too small",
  );
  return {
    costDefaults: true,
    decimalSave: true,
    budgetCancel: true,
    folderPickerEntries: names,
    outputCancel: true,
    newDefault: true,
    folderChildren: 2,
    notebookPause: true,
    folderPause: true,
    inheritedPause: true,
    expansionPreserved: true,
    singleClose: true,
    closeRightGap: innerWidth - close.right,
    realCachePreserved: true,
    aiRequests: 0,
  };
})();
