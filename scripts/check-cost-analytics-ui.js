(async () => {
  const c = window.__transcriptUIFixture,
    book = window.__transcriptCostFixture;
  const root = () => document.querySelector(".st-fullscreen-modal");
  const click = (text) => {
    const b = [...root().querySelectorAll("button")].find(
      (x) => x.textContent.trim() === text,
    );
    if (!b) throw Error("Missing " + text);
    b.click();
  };
  const assert = (v, msg) => {
    if (!v) throw Error(msg);
  };
  const price = {
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-6.1-sol",
    input: 2,
    cached: 0.1,
    cacheWrite: 2.5,
    output: 10,
    longThreshold: 272000,
    longInputMultiplier: 2,
    longOutputMultiplier: 1.5,
  };
  const source = "/storage/emulated/0/Note/Fixture/Planning.note";
  if (!book.snapshot().total.requests) {
    let id = book.reserve(source, 1, price.model, price, 1000);
    book.finish(
      id,
      { model: price.model, usage: { input_tokens: 1000, output_tokens: 100 } },
      true,
    );
    id = book.reserve(source, 2, price.model, price, 1000);
    book.finish(id, null, false);
  }
  if (!root().querySelector(".st-cost-live")) click("Costs");
  assert(
    root().innerText.includes("Count held amount"),
    "Held cost recovery missing",
  );
  for (const summary of root().querySelectorAll(".st-cost-breakdown summary"))
    summary.parentElement.open = true;
  assert(
    root().innerText.includes("Planning") &&
      root().innerText.includes("GPT-6.1 Sol"),
    "Cost breakdown names missing",
  );
  click("Count held amount");
  await new Promise((r) => setTimeout(r, 300));
  assert(
    c.costs.unconfirmed === 0 &&
      c.costs.total.spentUsd > 0.003 &&
      c.costs.total.heldUsd === 0,
    "Held resolution silently zeroed",
  );
  assert(
    c.costs.total.pages === 1,
    "Failed request counted as recognized page",
  );
  assert(
    [...root().querySelectorAll(".st-cost-breakdown")].every((x) => x.open),
    "Live refresh collapsed breakdowns",
  );
  return {
    mockRequests: 2,
    trackedSpent: c.costs.total.spentUsd,
    heldResolvedConservatively: true,
    recognizedPages: 1,
    breakdownsPreserved: true,
    realAiCalls: 0,
  };
})();
