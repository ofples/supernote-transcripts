(async () => {
  const c = window.__transcriptUIFixture;
  const root = () => document.querySelector(".st-fullscreen-modal");
  if (!c || !root()) throw new Error("Open only the isolated transcript UI fixture");
  const source = c.recoveryFixture.source;
  const row = [...root().querySelectorAll(".st-rule-row")].find((item) => item.querySelector(".st-rule-source")?.textContent?.trim() === "Edited");
  if (!row) throw new Error("Synthetic Edited row is missing");
  row.click();
  const detailResolve = [...root().querySelectorAll("button")].find((button) => button.textContent?.trim() === "Resolve edits");
  if (!detailResolve) throw new Error("Resolve edits action is missing from notebook detail");
  detailResolve.click();
  const waitFor = async (test) => {
    for (let i = 0; i < 40; i++) {
      if (test()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };
  if (!await waitFor(() => root()?.querySelector(".st-recovery-compare pre")))
    throw new Error("Recovery comparison did not load");
  const compare = root().querySelector(".st-recovery-compare");
  const previews = [...compare.querySelectorAll("pre")].map((node) => node.textContent);
  const exactPreviews = previews.length === 2 && previews[0] === c.recoveryFixture.current && previews[1] === c.recoveryFixture.generated;
  const initiallyCollapsed = !compare.open;
  compare.open = true;
  const headings = [...compare.querySelectorAll("h3")].map((node) => node.textContent?.trim());
  const labelsCorrect = headings[0] === "Your edited version" && headings[1] === "Saved recognition";
  compare.open = false;

  const panel = root();
  const actions = panel.querySelector(".st-actions.st-recovery-actions");
  const actionRects = [...(actions?.querySelectorAll("button") ?? [])].map((button) => button.getBoundingClientRect());
  const actionsInViewport = !!actions && actionRects.length === 3 && actionRects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1);
  const box = panel.getBoundingClientRect();
  const noHorizontalOverflow = panel.scrollWidth <= panel.clientWidth + 2 && document.documentElement.scrollWidth <= innerWidth + 2 && box.left >= -1 && box.right <= innerWidth + 2;
  const oneCloseControl = panel.querySelectorAll('[aria-label="Close mirrors"]').length === 1;
  if (!exactPreviews || !initiallyCollapsed || !labelsCorrect || !actionsInViewport || !noHorizontalOverflow || !oneCloseControl)
    throw new Error("Recovery fixture layout or comparison check failed");
  return { recoveryOpenedFromEditedDetail: true, exactMockVersionsInPreview: exactPreviews, compareCollapsedByDefault: initiallyCollapsed, versionHeadingsCorrect: labelsCorrect, footerActionsVisible: actionsInViewport, noHorizontalOverflow, oneCloseControl, previewCalls: c.recoveryFixture.previewCalls };
})();
