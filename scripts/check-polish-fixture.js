(async () => {
  const c = window.__transcriptUIFixture,
    real = app.plugins.plugins["nomad-transcripts"];
  const root = () => document.querySelector(".st-fullscreen-modal");
  const click = (text) => {
    const b = [...root().querySelectorAll("button")].find(
      (x) => x.textContent.trim() === text,
    );
    if (!b) throw Error(`Missing ${text}`);
    b.click();
  };
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 1200));
  const original = JSON.stringify(c.config),
    originalReal = JSON.stringify(real.config);
  app.commands.executeCommandById("nomad-transcripts-ui-fixture:open");
  assert(
    document.querySelectorAll(".st-fullscreen-modal").length === 1,
    "Duplicate modal",
  );
  // Retain any open draft rather than rebuilding it when the command is repeated.
  if (root().querySelector("h1").textContent !== "Mirrors") click("Cancel");
  root().querySelector('[aria-label="Settings"]').click();
  const key = root().querySelector("input[type=password]");
  assert(!!key, "Unmasked key");
  key.value = "mock-only";
  key.dispatchEvent(new Event("input", { bubbles: true }));
  const toggle = root().querySelector("input[type=checkbox]");
  toggle.checked = true;
  toggle.dispatchEvent(new Event("change", { bubbles: true }));
  click("Cancel");
  assert(c.apiKey === "" && !c.aiEnabled, "Cancel changed settings");
  root().querySelector("[data-config-id]").click();
  const instructions = root().querySelector(".st-instructions");
  assert(!instructions.open, "Instructions not collapsed");
  instructions.open = true;
  const prompt = root().querySelector("textarea");
  prompt.value = "Mock draft";
  prompt.dispatchEvent(new Event("input", { bubbles: true }));
  app.commands.executeCommandById("nomad-transcripts-ui-fixture:open");
  assert(
    root().querySelector("textarea").value === "Mock draft",
    "Reopening lost draft",
  );
  click("Choose glossary files");
  await wait();
  const search = root().querySelector("input[type=search]");
  search.value = "Sanskrit";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  assert(
    root()
      .querySelector(".st-glossary-picker")
      .innerText.includes("Sanskrit.txt"),
    "Glossary search failed",
  );
  const checkbox = root().querySelector(".st-glossary-picker input");
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  click("Cancel");
  click("Cancel");
  assert(JSON.stringify(c.config) === original, "Source Cancel changed config");
  click("+ Add source");
  await wait();
  const entries = [...root().querySelectorAll(".st-browser-entry")];
  assert(entries.length > 0, "Browser empty");
  const footer = root().querySelector(".st-footer").getBoundingClientRect();
  assert(footer.bottom <= innerHeight + 1, "Footer outside viewport");
  assert(
    root().querySelectorAll(".modal-header-button,.modal-close-button")
      .length === 0,
    "Native duplicate close",
  );
  assert(root().querySelectorAll(".st-close").length === 1, "Own close count");
  assert(
    JSON.stringify(real.config) === originalReal &&
      !real.aiEnabled &&
      !real.autoEnabled &&
      !real.task,
    "Real state changed",
  );
  const result = {
    settingsCancel: true,
    sourceCancel: true,
    glossarySearch: true,
    glossaryCancel: true,
    singleModal: true,
    draftPreserved: true,
    browserEntries: entries.length,
    footerAnchored: true,
    closeButtons: 1,
    realAI: false,
    realAutomatic: false,
  };
  root().querySelector(".st-close").click();
  return result;
})();
