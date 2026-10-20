import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (localError) {
  const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT;
  if (!moduleRoot) throw new Error("Playwright is not resolvable; install it or set PLAYWRIGHT_MODULE_ROOT", { cause: localError });
  ({ chromium } = require(join(resolve(moduleRoot), "playwright")));
}
const chrome = process.env.CHROME_EXECUTABLE_PATH ? resolve(process.env.CHROME_EXECUTABLE_PATH) : undefined;
const evidenceDir = resolve(repoRoot, "private/ux-streamline/evidence/current-ui");
await mkdir(evidenceDir, { recursive: true });
const reports = [];
let assertions = 0;
const check = (condition, message) => {
  assertions++;
  assert.ok(condition, message);
};

async function launch(platform, viewport) {
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(7000);
  const errors = [], externalRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(/^https?:\/\//, async (route) => {
    externalRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto(pathToFileURL(resolve(repoRoot, `private/ux-streamline/build/${platform}/index.html`)).href);
  await page.waitForFunction(() => !!window.__streamlinedFixture);
  const root = page.locator(".st-fullscreen-modal");
  await root.waitFor();
  return { browser, page, root, errors, externalRequests };
}

async function seedReviewCases(page, root, platform) {
  await root.getByRole("button", { name: "Close mirrors", exact: true }).click();
  await page.evaluate(() => {
    const { controller: c, paths } = window.__streamlinedFixture;
    const base = paths.working.replace(/\/Journal\/Reflection\.note$/i, "");
    const folderRule = c.config.rules.find((rule) => rule.id === "research-source");
    const oldFolder = folderRule.source;
    const satsang = `${base}/Satsang`;
    const moved = {};
    for (const [source, state] of Object.entries(c.store.notebooks)) {
      if (state.ruleId !== folderRule.id) continue;
      const nextSource = source.replace(oldFolder, satsang);
      state.source = nextSource;
      state.output = `Fixture Output/Satsang/${nextSource.slice(satsang.length + 1).replace(/\.note$/i, ".md")}`;
      for (const page of state.desired) {
        state.pages[page.id] ??= { fingerprint: page.fingerprint, text: `Synthetic Satsang page ${page.number}.`, recipe: "fixture", number: page.number };
      }
      state.status = "current";
      moved[nextSource] = state;
      delete c.store.notebooks[source];
      for (const task of c.store.queue) if (task.source === source) task.source = nextSource;
    }
    Object.assign(c.store.notebooks, moved);
    folderRule.source = satsang;
    folderRule.output = "Fixture Output/Satsang";
    const formerlyWorking = c.store.notebooks[paths.working];
    for (const page of formerlyWorking.desired) {
      formerlyWorking.pages[page.id] ??= { fingerprint: page.fingerprint, text: `Synthetic completed page ${page.number}.`, recipe: "fixture", number: page.number };
    }
    formerlyWorking.status = "current";
    c.store.queue = c.store.queue.filter((task) => {
      const state = c.store.notebooks[task.source];
      return state?.desired.some((page) =>
        (state.forcePending?.includes(page.id) || state.pages[page.id]?.fingerprint !== page.fingerprint) &&
        state.pageIssues?.[page.id]?.fingerprint !== page.fingerprint,
      );
    });
    c.store.queue = c.store.queue.filter((task) => task.source.toLowerCase() !== `${satsang}/reflection.note`.toLowerCase());

    const singleSource = `${base}/Reflection.note`;
    const soloRule = {
      id: "reflection-single", enabled: true, source: singleSource,
      output: "Fixture Output/Reflection", recursive: false, exclude: [], profileId: "general",
    };
    const desired = [
      { id: "reflection-page-1", number: 1, fingerprint: "synthetic-reflection-1" },
      { id: "reflection-page-2", number: 2, fingerprint: "synthetic-reflection-2" },
    ];
    c.config.rules.push(soloRule);
    c.store.notebooks[singleSource] = {
      id: "synthetic-reflection", source: singleSource, ruleId: soloRule.id,
      output: soloRule.output, revision: "synthetic-revision", order: desired.map((page) => page.id), desired,
      pages: Object.fromEntries(desired.map((page) => [page.id, {
        fingerprint: page.fingerprint, text: `Synthetic reflection page ${page.number}.`,
        recipe: "fixture", number: page.number,
      }])), status: "current", paused: false,
      lastAutomaticCheck: "2026-10-18T10:00:00.000Z", lastFullCheck: "2026-10-17T10:00:00.000Z",
      cleanup: { updatedAt: "2026-10-10T12:00:00.000Z", inputHash: "synthetic-cleanup-input", outputHash: "synthetic-cleanup-output", model: "gpt-5.6-sol", quality: "careful", provider: "api", basePages: desired.map((page) => ({ ...page })), stale: true },
    };
    c.aiEnabled = true;
    c.progress.running = false;
    c.progress.paused = false;
    c.actionCounters.cleanupDocument = 0;
    c.actionCounters.reprocessPages = 0;
    c.workflowCapture = { cleanupEstimateModels: [], cleanupEstimateOptions: [], cleanupCalls: [], reprocessEstimates: [], reprocessCalls: [], previewCalls: [], imagePreviewCalls: [], excludeCalls: [], restoreCalls: [], storageCalls: [], pruneCalls: [], deferCleanup: false, cleanupResolved: false, deferImagePreview: false, rejectImagePreview: false, resolveImagePreview: undefined };
    c.cleanupEstimate = (source, options = {}) => {
      c.workflowCapture.cleanupEstimateModels.push(options.model ?? "");
      c.workflowCapture.cleanupEstimateOptions.push({ source, ...options });
      return { pages: 2, requests: 1, usd: options.model === "custom-fixture-model" ? 0.0032 : 0.001 };
    };
    c.reprocessEstimate = (source, range, outdatedOnly) => {
      c.workflowCapture.reprocessEstimates.push({ source, range, outdatedOnly });
      const selectedPages = range.trim() === "1" ? 1 : range.trim() ? 2 : outdatedOnly ? 1 : 0;
      return { pages: selectedPages, requests: selectedPages ? 1 : 0, usd: 0.001 };
    };
    c.cleanupDocument = async (source, options) => {
      c.workflowCapture.cleanupCalls.push({ source, ...options });
      if (c.workflowCapture.deferCleanup) await new Promise((resolve) => {
        c.workflowCapture.resolveCleanup = () => { c.workflowCapture.cleanupResolved = true; resolve(); };
      });
    };
    c.reprocessPages = async (source, range, outdatedOnly) => { c.workflowCapture.reprocessCalls.push({ source, range, outdatedOnly }); };
    c.preview = async (source, number) => {
      c.workflowCapture.imagePreviewCalls.push({ source, number });
      if (c.workflowCapture.deferImagePreview) await new Promise((resolve, reject) => {
        c.workflowCapture.resolveImagePreview = () => resolve();
        c.workflowCapture.rejectImagePreviewNow = () => reject(new Error("Synthetic page preview failed."));
      });
      if (c.workflowCapture.rejectImagePreview) throw new Error("Synthetic page preview failed.");
      const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="800" height="1000" fill="#f7f4ec"/><path d="M80 110H720M80 180H660M80 250H700M80 320H620M80 390H700M80 460H650M80 530H710M80 600H600M80 670H700M80 740H660M80 810H700" stroke="#333" stroke-width="8" stroke-linecap="round"/><text x="80" y="930" font-family="sans-serif" font-size="30" fill="#666">Synthetic original page ${number}</text></svg>`;
      return `data:image/svg+xml,${encodeURIComponent(imageSvg)}`;
    };
    c.excludeNotebook = async (source) => {
      c.workflowCapture.excludeCalls.push(source);
      const rule = c.config.rules.find((item) => item.source === source && !item.recursive);
      const relativeNotebook = source.split("/").at(-1);
      if (rule && !rule.exclude.includes(relativeNotebook)) rule.exclude.push(relativeNotebook);
      c.notify();
    };
    c.pageSelectionPreview = async (source, start = 1, count = 12) => {
      c.workflowCapture.previewCalls.push({ source, start, count });
      const state = c.store.notebooks[source];
      return state.desired
        .filter((page) => page.number >= start && page.number < start + count)
        .map((page) => ({ number: page.number, text: `Synthetic OCR page ${page.number}. ${"Readable OCR excerpt with enough words to wrap across several visible lines. ".repeat(5)}`, origin: "device-ocr" }));
    };
    c.lastVersion = async (source) => ({ path: `History/${source.split("/").pop()}.previous.md`, createdAt: "2026-10-10T12:00:00.000Z" });
    c.restoreLastVersion = async (source) => { c.workflowCapture.restoreCalls.push(source); };
    c.storageSummary = async () => {
      c.workflowCapture.storageCalls.push("summary");
      return { historyFiles: 4, cacheFiles: 7, bytes: 2048, removableFiles: 3, removableBytes: 1024 };
    };
    c.pruneStorage = async () => {
      c.workflowCapture.pruneCalls.push("prune");
      return { removedFiles: 3, removedBytes: 1024 };
    };
    const pendingPageCount = (state) => state.desired.filter((page) =>
      (state.forcePending?.includes(page.id) || state.pages[page.id]?.fingerprint !== page.fingerprint) &&
      state.pageIssues?.[page.id]?.fingerprint !== page.fingerprint,
    ).length;
    const sourceBlocked = (source, state) => {
      const rule = c.config.rules.find((candidate) => candidate.id === state?.ruleId);
      return !rule?.enabled || !!state?.paused || !!rule.paused ||
        (c.automaticRun && rule.autoRecognize === false) ||
        c.sharedSettingsIssues?.some((issue) => issue.ruleId === rule.id) ||
        !!state?.legacyPageFailure || !!state?.executionIssue ||
        ["conflict", "failed", "missing", "excluded"].includes(state?.status);
    };
    Object.defineProperty(c, "queueView", {
      configurable: true,
      get() {
        const active = c.progress.running ? (c.progress.activeSource ?? c.progress.activePage?.source) : undefined;
        const queued = [...c.store.queue];
        const waiting = queued.filter((task) => {
          const state = c.store.notebooks[task.source];
          return task.source !== active && !sourceBlocked(task.source, state) && pendingPageCount(state) > 0;
        }).map((task) => task.source);
        const paused = queued.filter((task) => {
          const state = c.store.notebooks[task.source];
          return task.source !== active && sourceBlocked(task.source, state) && pendingPageCount(state) > 0;
        }).map((task) => task.source);
        const attention = Object.values(c.store.notebooks).filter((state) =>
          state.status === "failed" || state.status === "conflict" || state.executionIssue || state.legacyPageFailure ||
          Object.values(state.pageIssues ?? {}).some((issue) => issue.status !== "skipped"),
        ).map((state) => state.source);
        return { working: active ? { source: active, stage: c.progress.stage } : undefined, waiting, paused, attention };
      },
    });
    const estimateForSource = c.queueEstimate.bind(c);
    c.queueEstimate = (source) => {
      if (source) return estimateForSource(source);
      const estimate = estimateForSource();
      const eligiblePages = Object.values(c.store.notebooks).reduce((total, state) =>
        sourceBlocked(state.source, state) ? total : total + pendingPageCount(state), 0,
      );
      return {
        ...estimate,
        pages: eligiblePages,
        requests: c.provider === "subscription" ? Math.max(1, Math.ceil(eligiblePages / 3)) : Math.max(1, Math.ceil(eligiblePages / 2)),
      };
    };
  });
  await page.evaluate(() => window.__streamlinedFixture.commands.get("open")?.callback());
  await root.waitFor();
  if (platform === "nomad") await root.evaluate((element) => {
    element.style.cssText = "--st-visual-height: 100vh; position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; transform: none";
  });
  await root.getByText("Satsang", { exact: true }).waitFor();
  const activeSource = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    c.progress.running = true;
    c.progress.activeSource = state.source;
    c.progress.activePage = { source: state.source, number: 1, total: 2 };
    c.progress.stage = "Rendering transcript";
    c.progress.detail = "Rendering page links for the current transcript.";
    c.progress.checked = 1;
    c.progress.total = 2;
    c.progress.renderingContext = true;
    c.progress.activePages = [1];
    c.notify();
    return state.source;
  });
  const homeProgress = root.locator(".st-summary-status");
  await homeProgress.getByText(/Recognizing… 2\/2 pages · Reflection/).waitFor();
  const homeProgressDetails = homeProgress.locator(".st-home-progress-details");
  check(!(await homeProgressDetails.evaluate((details) => details.open)), `${platform}: home progress details are expanded by default`);
  check(!(await homeProgress.locator(":scope > .st-caption").innerText()).includes("Rendering transcript"), `${platform}: home progress caption exposes rendering details by default`);
  await homeProgressDetails.locator("summary").click();
  check(await homeProgressDetails.getByText(/Rendering transcript · page 1 of 2/).isVisible() && await homeProgressDetails.getByText(/Rendering context is included/i).isVisible(), `${platform}: home progress details omit stage/page or rendering context`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.progress.detail = "Updated synthetic rendering detail.";
    c.notify();
  });
  check(await homeProgress.locator(".st-home-progress-details").evaluate((details) => details.open), `${platform}: home progress refresh did not preserve the open Details disclosure`);
  await page.screenshot({ path: join(evidenceDir, `${platform}-home-progress-details.png`) });
  await page.evaluate((source) => {
    const c = window.__streamlinedFixture.controller;
    c.progress.running = false;
    c.progress.activeSource = undefined;
    c.progress.activePage = undefined;
    c.progress.detail = "";
    c.progress.renderingContext = false;
    c.progress.activePages = undefined;
    c.notify();
  }, activeSource);
}

async function inspectViewport(platform, viewport, label) {
  const { browser, page, root, errors, externalRequests } = await launch(platform, viewport);
  await seedReviewCases(page, root, platform);
  const prefix = `${label}-${viewport.width}x${viewport.height}`;
  const dimensions = async (state) => page.evaluate((state) => {
    const modal = document.querySelector(".st-fullscreen-modal");
    const body = modal?.querySelector(".st-body");
    const footer = modal?.querySelector(".st-footer");
    const rect = (element) => {
      const r = element?.getBoundingClientRect();
      return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      modalScrollWidth: modal?.scrollWidth,
      bodyScrollWidth: body?.scrollWidth,
      bodyClientWidth: body?.clientWidth,
      bodyScrollHeight: body?.scrollHeight,
      bodyClientHeight: body?.clientHeight,
      bodyScrollTop: body?.scrollTop,
      modal: rect(modal), footer: rect(footer), state,
      modalCss: modal && { inline: modal.getAttribute("style"), position: getComputedStyle(modal).position, left: getComputedStyle(modal).left, right: getComputedStyle(modal).right },
    };
  }, state);
  const assertLayout = async (state, { footerVisible = true } = {}) => {
    const m = await dimensions(state);
    check(m.modal && m.modal.left >= -1 && m.modal.right <= viewport.width + 1, `${label}: modal outside viewport: ${JSON.stringify(m)}`);
    check(m.documentScrollWidth <= viewport.width + 1, `${label}: document horizontal overflow: ${JSON.stringify(m)}`);
    check(m.modalScrollWidth <= m.modal.width + 1, `${label}: modal horizontal overflow: ${JSON.stringify(m)}`);
    check(m.bodyScrollWidth <= m.bodyClientWidth + 1, `${label}: body horizontal overflow: ${JSON.stringify(m)}`);
    if (footerVisible) check(m.footer && m.footer.top >= 0 && m.footer.bottom <= viewport.height + 1, `${label}: footer outside viewport: ${JSON.stringify(m.footer)}`);
    const footerButtons = await root.locator(".st-footer button:visible").evaluateAll((buttons) => buttons.map((button) => {
      const r = button.getBoundingClientRect();
      return { label: (button.getAttribute("aria-label") || button.textContent || "").trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    for (const button of footerButtons) {
      const contained = m.footer && m.modal
        && button.left >= m.footer.left - 1 && button.right <= m.footer.right + 1
        && button.top >= m.footer.top - 1 && button.bottom <= m.footer.bottom + 1
        && button.left >= m.modal.left - 1 && button.right <= m.modal.right + 1
        && button.top >= m.modal.top - 1 && button.bottom <= m.modal.bottom + 1;
      check(contained, `${label}: footer button is not fully inside the footer and modal in ${state}: ${JSON.stringify({ button, footer: m.footer, modal: m.modal })}`);
    }
    return m;
  };
  const screenshot = async (name) => page.screenshot({ path: join(evidenceDir, `${prefix}-${name}.png`), fullPage: false });
  const previewHitAreas = [];

  // Sources: compact modal, visible desktop action labels, and expanded Satsang child actions.
  await screenshot("sources");
  await assertLayout("Sources");
  if (platform === "desktop") {
    const labels = root.locator(".st-icon-button-label");
    const visibleLabels = (await labels.allTextContents()).map((text) => text.trim()).filter(Boolean);
    check(visibleLabels.includes("Settings") && visibleLabels.includes("Pause") && visibleLabels.includes("Configure"), `${label}: desktop action labels are missing: ${JSON.stringify(visibleLabels)}`);
  }
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.sharedSettingsIssues = [{
      ruleId: "research-source",
      name: "Satsang",
      fields: ["profile.model", "profile.quality"],
      reason: "This device and a synced copy changed these settings separately.",
    }];
    c.resolveSharedSettings = async () => {};
    c.notify();
  });
  const conflict = root.locator(".st-shared-settings-conflict").filter({ hasText: "Settings conflict · Satsang" });
  await conflict.waitFor();
  check(await conflict.innerText().then((text) => /Model, Recognition quality/.test(text) && /changed these settings separately/.test(text)), `${label}: settings conflict does not identify changed fields in user-facing terms and cause`);
  for (const name of ["Keep this device", "Use synced settings"]) {
    const action = conflict.getByRole("button", { name, exact: true });
    check(await action.isVisible() && !(await action.isDisabled()), `${label}: conflict resolution action ${name} is missing or disabled`);
  }
  await assertLayout("Source settings conflict");
  await screenshot("source-settings-conflict");
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.sharedSettingsIssues = [{
      ruleId: "research-source",
      name: "Satsang",
      fields: [],
      reason: "Could not read shared source settings from this vault.",
    }];
    c.refreshAttempts = 0;
    c.refreshSharedSettings = async () => {
      c.refreshAttempts++;
      c.sharedSettingsIssues = [];
      c.notify();
    };
    c.notify();
  });
  const syncIssue = root.locator(".st-shared-settings-conflict").filter({ hasText: "Settings need attention · Satsang" });
  await syncIssue.waitFor();
  check(await syncIssue.locator("p").innerText().then((text) => !/^\s*·/.test(text) && /Could not read shared source settings/.test(text)), `${label}: sync failure has conflict punctuation or missing reason`);
  check(await syncIssue.getByRole("button", { name: "Retry Sync", exact: true }).isVisible(), `${label}: shared settings failure has no retry action`);
  check(await syncIssue.getByRole("button", { name: "Keep this device", exact: true }).count() === 0 && await syncIssue.getByRole("button", { name: "Use synced settings", exact: true }).count() === 0, `${label}: sync failure incorrectly offers conflict choices`);
  await assertLayout("Shared settings sync failure");
  await screenshot("source-settings-sync-failure");
  await syncIssue.getByRole("button", { name: "Retry Sync", exact: true }).click();
  await syncIssue.waitFor({ state: "detached" });
  check(await page.evaluate(() => window.__streamlinedFixture.controller.refreshAttempts) === 1, `${label}: Retry Sync did not call the shared settings refresh`);
  await root.getByRole("button", { name: "Expand Satsang", exact: true }).click();
  const child = root.locator(".st-folder-contents .st-notebook-child").filter({ hasText: "Reflection" }).first();
  await child.waitFor();
  check(await child.locator('button[aria-label^="Pause"], button[aria-label^="Resume"]').count() === 1, `${label}: Satsang child pause action missing`);
  const childDetails = child.getByRole("button", { name: "Notebook details: Reflection", exact: true });
  check(await childDetails.isVisible(), `${label}: Satsang child notebook detail icon action missing`);
  check(await childDetails.getAttribute("title") === "Notebook details: Reflection", `${label}: Satsang child detail action lacks its accessible tooltip`);
  check(await child.locator(".st-document-action-toolbar, .st-cleanup-task, .st-reprocess-task, .st-cleanup-previous").count() === 0, `${label}: expanded home child renders full actions or cleanup metadata`);
  await screenshot("satsang-expanded-child-actions");
  await childDetails.click();
  await root.locator(".st-detail-controls").waitFor();
  check(await root.locator(".st-detail-controls").getByRole("button", { name: "Clean up document", exact: true }).isVisible(), `${label}: child notebook detail does not expose the cleanup workflow launch`);
  const childHistory = root.locator(".st-history-details");
  check(await childHistory.isVisible() && await childHistory.getAttribute("aria-expanded") === "false", `${label}: notebook History is not collapsed by default`);
  await childHistory.click();
  check(await root.locator(".st-restore-last-version").isVisible(), `${label}: notebook History does not offer its available restore point`);
  await root.locator(".st-restore-last-version").click();
  check(await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.restoreCalls.length) === 1, `${label}: restore-last-version action did not call the controller`);
  await root.getByRole("button", { name: "Back", exact: true }).click();
  await root.locator(".st-folder-contents .st-notebook-child").filter({ hasText: "Reflection" }).first().waitFor();

  // Queue navigation and status view.
  await page.evaluate(() => { const c = window.__streamlinedFixture.controller; c.progress.running = true; c.progress.paused = false; c.progress.activeSource = window.__streamlinedFixture.paths.working; c.progress.activePage = { source: window.__streamlinedFixture.paths.working, number: 3, total: 6 }; c.progress.manualSources = []; c.notify(); });
  await root.getByRole("button", { name: "Queue", exact: true }).click();
  await root.getByText(/Waiting|Working|paused|attention|No pending/i).first().waitFor();
  await assertLayout("Queue");
  const queuedCompletedSources = await page.evaluate(() => window.__streamlinedFixture.controller.queueView.waiting.filter((source) => {
    const state = window.__streamlinedFixture.controller.store.notebooks[source];
    return state && state.desired.every((page) => state.pages[page.id]?.fingerprint === page.fingerprint);
  }));
  check(queuedCompletedSources.length === 0, `${label}: completed notebooks remain in the mocked waiting queue: ${JSON.stringify(queuedCompletedSources)}`);
  await screenshot("queue");
  const estimateInfo = root.locator(".st-queue-estimate-info");
  const estimateHelp = estimateInfo.getByRole("button", { name: "Help: About this estimate", exact: true });
  check(await estimateHelp.innerText() === "?" && await estimateHelp.getAttribute("aria-expanded") === "false" && await estimateInfo.locator(".st-help-text").isHidden(), `${label}: estimate help is not collapsed behind the standard ? control`);
  await estimateHelp.click();
  check(await estimateHelp.innerText() === "?" && await estimateHelp.getAttribute("aria-expanded") === "true", `${label}: eligible-work estimate does not use the standard contextual help control`);
  check(await estimateInfo.locator(".st-help-text p").first().innerText().then((text) => /after you press Update or Resume\. Individually paused or blocked notebooks are excluded/i.test(text)), `${label}: total estimate scope does not distinguish eligible work from paused or blocked sources`);
  await estimateHelp.click();
  const workingCard = root.locator(".st-working");
  if (await workingCard.count()) {
    const workingDisclosure = workingCard.locator(".st-working-disclosure");
    check(await workingCard.getAttribute("aria-expanded") === "false" && await workingCard.locator(".st-working-details").isHidden(), `${label}: Working now details are not collapsed in the card`);
    check(await workingCard.locator(".st-working-progress").isVisible(), `${label}: Working now progress is hidden with the details`);
    const pauseBounds = await workingCard.getByRole("button", { name: /Pause: Reflection/ }).boundingBox();
    const caretBounds = await workingDisclosure.boundingBox();
    check(!!pauseBounds && !!caretBounds && caretBounds.x > pauseBounds.x, `${label}: Working now caret is not to the right of Pause`);
    await workingCard.focus();
    await page.keyboard.press("Enter");
    check(await workingCard.getAttribute("aria-expanded") === "true", `${label}: keyboard Enter did not expand the Working now card`);
    await page.keyboard.press("Space");
    check(await workingCard.getAttribute("aria-expanded") === "false", `${label}: keyboard Space did not collapse the Working now card`);
    await workingDisclosure.click();
    check(await workingCard.getAttribute("aria-expanded") === "true" && await workingCard.locator(".st-working-details").isVisible(), `${label}: adjacent caret did not expand Working now details`);
    await screenshot("queue-working-expanded");
    await workingCard.locator(".st-queue-copy").click();
    check(await workingCard.getAttribute("aria-expanded") === "false", `${label}: tapping Working now copy did not toggle the card back closed`);
    const pauseWorking = workingCard.getByRole("button", { name: /Pause: Reflection/ });
    const stateSource = await page.evaluate(() => window.__streamlinedFixture.paths.working);
    await pauseWorking.click();
    check(await workingCard.getAttribute("aria-expanded") === "false", `${label}: pause action click expanded Working now`);
    await page.evaluate((source) => { const c = window.__streamlinedFixture.controller; c.store.notebooks[source].paused = false; c.actionCounters.notebookPause.pop(); c.notify(); }, stateSource);
  }
  await page.evaluate(() => { const c = window.__streamlinedFixture.controller; c.progress.running = false; c.progress.activeSource = undefined; c.progress.activePage = undefined; c.notify(); });
  const aggregateEstimate = root.locator(".st-queue-overview .st-queue-estimate");
  const eligiblePages = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const pending = (state) => state.desired.filter((item) =>
      (state.forcePending?.includes(item.id) || state.pages[item.id]?.fingerprint !== item.fingerprint) &&
      state.pageIssues?.[item.id]?.fingerprint !== item.fingerprint,
    ).length;
    const blocked = (state) => {
      const rule = c.config.rules.find((candidate) => candidate.id === state.ruleId);
      return !rule?.enabled || !!state.paused || !!rule.paused ||
        (c.automaticRun && rule.autoRecognize === false) ||
        c.sharedSettingsIssues?.some((issue) => issue.ruleId === rule.id) ||
        !!state.legacyPageFailure || !!state.executionIssue ||
        ["conflict", "failed", "missing", "excluded"].includes(state.status);
    };
    return Object.values(c.store.notebooks).reduce((total, state) => total + (blocked(state) ? 0 : pending(state)), 0);
  });
  const aggregateText = await aggregateEstimate.innerText();
  check(/Eligible work estimate/.test(aggregateText), `${label}: total estimate is not labeled as eligible work`);
  check(new RegExp(`\\b${eligiblePages} pages?\\b`).test(aggregateText), `${label}: aggregate estimate does not match ${eligiblePages} eligible remaining pages: ${aggregateText}`);
  await estimateHelp.click();
  await screenshot("queue-estimate-explained");

  // A budget block can stop eligible work while the selected-work estimate remains useful.
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.progress.running = false;
    c.progress.budgetBlocked = "Synthetic spending limit reached.";
    c.aiEnabled = true;
    c.notify();
  });
  check(await root.locator(".st-queue-status").innerText() === "Spending paused", `${label}: budget-blocked queue status is unclear`);
  const reviewCosts = root.locator(".st-blocker-action");
  check(await reviewCosts.innerText() === "Review Costs", `${label}: budget-blocked queue has no direct Costs action`);
  const reviewCostsBounds = await reviewCosts.boundingBox();
  check(reviewCostsBounds && reviewCostsBounds.y >= 0 && reviewCostsBounds.y + reviewCostsBounds.height <= viewport.height, `${label}: Review Costs action is below the visible area in a budget-blocked queue: ${JSON.stringify(reviewCostsBounds)}`);
  check(await root.locator(".st-update").isDisabled(), `${label}: Update remains enabled while spending is blocked`);
  if (await estimateHelp.getAttribute("aria-expanded") === "false") await estimateHelp.click();
  check(await estimateInfo.locator(".st-help-text p").first().innerText().then((text) => /spending or execution limits can still stop requests/i.test(text)), `${label}: budget-blocked state hides the estimate scope explanation`);
  await assertLayout("Budget-blocked queue");
  await screenshot("queue-spending-paused");
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.progress.running = false;
    c.progress.budgetBlocked = undefined;
    c.aiEnabled = true;
    c.notify();
  });
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = c.store.notebooks[Object.keys(c.store.notebooks).find((source) => source.endsWith("/Failed.note"))];
    state.status = "conflict";
    state.error = "Shared transcript recognition versions differ on pages 1 and 2. Force update can use this device's results after backing up the current transcript.";
    c.forceUpdateCalls = 0;
    c.forceUpdate = async () => { c.forceUpdateCalls++; return {}; };
    c.forceUpdateEstimate = (_source, reRecognizeAll = false) => reRecognizeAll
      ? { pages: state.desired.length, requests: 2, usd: 0.002, samples: 2, provisional: false }
      : { pages: 0, requests: 0, usd: 0, samples: 2, provisional: false };
    c.notify();
  });
  await root.getByRole("button", { name: "Sources", exact: true }).click();
  const satsangDisclosure = root.getByRole("button", { name: "Expand Satsang", exact: true });
  if (await satsangDisclosure.count()) await satsangDisclosure.click();
  const failedSourceRow = root.locator(".st-notebook-child").filter({ hasText: "Failed" });
  const sourceActionRow = failedSourceRow.locator(".st-source-actions");
  if (await failedSourceRow.count()) {
    check(await sourceActionRow.getByRole("button", { name: "Review pages", exact: true }).isVisible() && await sourceActionRow.getByRole("button", { name: /Force update Failed/ }).isVisible(), `${label}: Review pages and Force update are not grouped below the page progress`);
    const actionLayout = await sourceActionRow.evaluate((node) => ({ display: getComputedStyle(node).display, review: node.querySelector("button.st-review-pages")?.getBoundingClientRect(), force: node.querySelector("button.st-force-update-action")?.getBoundingClientRect() }));
    check(actionLayout.display === "flex" && actionLayout.review && actionLayout.force && Math.abs(actionLayout.review.y - actionLayout.force.y) <= 2, `${label}: Review pages and Force update are not side by side: ${JSON.stringify(actionLayout)}`);
    const progressBottom = await failedSourceRow.locator(".st-progress").evaluate((node) => node.getBoundingClientRect().bottom);
    check(!!actionLayout.review && actionLayout.review.y >= progressBottom, `${label}: source actions are not beneath the progress bar`);
    check(await failedSourceRow.evaluate((node) => getComputedStyle(node).borderBottomWidth) === "0px", `${label}: the page-progress line is doubled with a second bottom divider`);
  }
  await root.getByRole("button", { name: "Queue", exact: true }).click();
  const attentionSection = root.locator(".st-queue-attention");
  const forceRow = attentionSection.locator(".st-queue-row").filter({ hasText: "Failed" });
  check(await attentionSection.locator("h2").innerText().then((text) => /Needs attention/.test(text)) && await forceRow.isVisible(), `${label}: Needs attention is not a continuously visible section`);
  check(await root.locator(".st-queue-live hr").count() === 0 && await attentionSection.evaluate((node) => getComputedStyle(node).borderTopWidth) === "0px", `${label}: a duplicate horizontal rule separates the prior queue row from Needs attention`);
  const attentionPrevious = await attentionSection.evaluate((node) => {
    const previous = node.previousElementSibling;
    return { className: previous?.className ?? "", borderBottom: previous?.matches(".st-queue-row") ? getComputedStyle(previous).borderBottomWidth : "not-a-row", progress: !!previous?.querySelector(".st-progress") };
  });
  if (attentionPrevious.progress) check(attentionPrevious.borderBottom === "0px", `${label}: the progress line before Needs attention is doubled by an adjacent row divider`);
  const forceAction = forceRow.getByRole("button", { name: /Force update Failed/ });
  check(await forceAction.isVisible() && !(await forceAction.isDisabled()), `${label}: eligible sync conflict has no enabled Force update action in Queue; state=${await page.evaluate(() => { const c = window.__streamlinedFixture.controller; const s = c.store.notebooks[Object.keys(c.store.notebooks).find((source) => source.endsWith("/Failed.note"))]; return JSON.stringify({status:s?.status,error:s?.error,hasMethod:!!c.forceUpdate}); })}; rows=${await root.locator(".st-queue-collapsed[open] .st-queue-row").allInnerTexts().then((items) => JSON.stringify(items))}; buttons=${await root.locator(".st-queue-collapsed[open] .st-queue-row button").evaluateAll((items) => JSON.stringify(items.map((item) => [item.textContent, item.getAttribute("aria-label")])))}`);
  await forceAction.click();
  await root.locator(".st-force-update").waitFor();
  check(await root.locator(".st-force-update").innerText().then((text) =>
    /bypasses shared claims and the Sync wait for this notebook only/i.test(text) &&
    /uses the original notebook and recognition settings saved on this device/i.test(text) &&
    /duplicate requests or replace newer transcript text/i.test(text) &&
    /backs up the current Markdown transcript and cached recognition/i.test(text) &&
    /Provider budgets, authentication, and storage checks still apply/i.test(text) &&
    /Matching cached pages are reused by default/i.test(text)), `${label}: Force update warning omits a key behavior or safeguard`);
  check(await root.getByRole("button", { name: "Cancel", exact: true }).isVisible(), `${label}: Force update warning has no Cancel action`);
  check(await root.getByRole("button", { name: "Force update", exact: true }).isVisible(), `${label}: Force update warning has no confirm action`);
  const forceReRecognize = root.getByRole("checkbox", { name: "Re-recognize every page", exact: true });
  check(await forceReRecognize.isVisible() && !(await forceReRecognize.isChecked()), `${label}: Force update re-recognition option is not off by default`);
  check(await root.locator(".st-force-update-estimate").innerText().then((text) => /0 pages · 0 requests/.test(text)), `${label}: cached-result Force update estimate does not show zero new work`);
  await forceReRecognize.check();
  check(await root.locator(".st-force-update-estimate").innerText().then((text) => /3 pages · 2 requests/.test(text)), `${label}: re-recognize-all option does not update the estimate`);
  await forceReRecognize.uncheck();
  await assertLayout("Force update warning");
  await screenshot("force-update-warning");
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await root.locator(".st-queue-live").waitFor();
  check(await page.evaluate(() => window.__streamlinedFixture.controller.forceUpdateCalls) === 0, `${label}: cancelling Force update invoked the mutating controller action`);
  check(await root.locator(".st-queue-status").isVisible(), `${label}: cancelling Force update did not return to the Queue`);

  // Settings: compact rows and keyboard-operable contextual help.
  await root.getByRole("button", { name: "Settings", exact: true }).click();
  await root.locator(".st-settings-section").first().waitFor();
  await assertLayout("Settings");
  const settingsTabs = root.getByRole("tablist", { name: "Settings sections" });
  check((await settingsTabs.getByRole("tab").allTextContents()).join("|") === "Connection|Recognition|Updates|Storage", `${label}: settings tabs are missing or out of order`);
  check(await settingsTabs.getByRole("tab", { name: "Connection" }).getAttribute("aria-selected") === "true", `${label}: settings did not open on Connection`);
  await settingsTabs.getByRole("tab", { name: "Connection" }).focus();
  await page.keyboard.press("ArrowRight");
  check(await settingsTabs.getByRole("tab", { name: "Recognition" }).getAttribute("aria-selected") === "true" && await page.evaluate(() => document.activeElement?.getAttribute("data-settings-tab")) === "recognition", `${label}: Right Arrow did not select and focus the next settings tab`);
  await root.locator(".st-body").evaluate((body) => { body.scrollTop = 120; });
  await page.keyboard.press("End");
  check(await settingsTabs.getByRole("tab", { name: "Storage" }).getAttribute("aria-selected") === "true" && await page.evaluate(() => document.activeElement?.getAttribute("data-settings-tab")) === "storage" && await root.locator(".st-body").evaluate((body) => body.scrollTop) === 0, `${label}: End did not select/focus Storage and reset the tab scroll position`);
  await page.keyboard.press("Home");
  check(await settingsTabs.getByRole("tab", { name: "Connection" }).getAttribute("aria-selected") === "true" && await page.evaluate(() => document.activeElement?.getAttribute("data-settings-tab")) === "connection", `${label}: Home did not return focus to the first settings tab`);
  await settingsTabs.getByRole("tab", { name: "Recognition" }).click();
  const defaultCleanupInstructions = root.getByLabel("Default cleanup instructions", { exact: true });
  check((await defaultCleanupInstructions.inputValue()).trim().length > 0, `${label}: editable default cleanup instructions do not display the built-in default`);
  check(await page.evaluate(() => window.__streamlinedFixture.controller.config.cleanupPrompt) === undefined, `${label}: merely opening Settings wrote the default cleanup prompt into saved config`);
  await root.locator(".st-cleanup-defaults").scrollIntoViewIfNeeded();
  await screenshot("cleanup-defaults-settings");
  await settingsTabs.getByRole("tab", { name: "Storage" }).click();
  const supportFolder = root.getByLabel("Support folder", { exact: true });
  check(await supportFolder.inputValue() === "_supernote", `${label}: Storage did not show the default support folder`);
  check(await root.getByLabel("Hide support folder in File Explorer", { exact: true }).isChecked() && await root.getByLabel("Exclude support files from Search and Quick Switcher", { exact: true }).isChecked(), `${label}: storage visibility defaults are not enabled`);
  await root.getByRole("button", { name: "Review storage", exact: true }).click();
  const storage = root.locator(".st-storage-screen");
  await storage.waitFor();
  check(await storage.getByText(/unresolved paid results, current recognized pages, the latest undo point, and the seven-day sync grace period/i).isVisible(), `${label}: storage review does not explain which recoverable data and sync grace are retained`);
  check(await storage.getByText(/obsolete files from all synced devices/i).isVisible(), `${label}: storage review does not explain that obsolete files are removed across synced devices`);
  check(await storage.getByText(/Local account cost records are kept/i).isVisible(), `${label}: storage review does not explain that local account cost records are retained`);
  await storage.getByText(/can be removed/i).waitFor();
  await assertLayout("Saved data review");
  await screenshot("saved-data-storage");
  const pruneStorage = root.getByRole("button", { name: /Clean up removable storage/i });
  check(await pruneStorage.isEnabled(), `${label}: manual storage cleanup is not available when removable files exist`);
  await pruneStorage.click();
  check(await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.pruneCalls.length) === 1, `${label}: manual storage cleanup did not call its controller action`);
  await root.getByRole("button", { name: "Back", exact: true }).click();
  await root.locator(".st-settings-storage").waitFor({ state: "visible" });
  const assertOneSettingsLabel = async (step) => {
    const label = root.locator(".st-head-action .st-icon-button-label");
    const count = await label.count();
    if (platform !== "desktop") {
      check(count === 0, `${label}: Nomad should not show a desktop Settings label after ${step}; found ${count}`);
      return;
    }
    const text = (await label.first().textContent().catch(() => ""))?.trim();
    check(count === 1 && text === "Settings", `${label}: header Settings label is not exactly one after ${step}; found ${count}, text=${text}`);
  };
  await assertOneSettingsLabel("opening settings");
  const activeTabs = root.getByRole("tablist", { name: "Settings sections" });
  await activeTabs.getByRole("tab", { name: "Storage" }).click();
  const storagePathDraft = root.getByLabel("Support folder", { exact: true });
  await storagePathDraft.fill("Typed support folder");
  await root.getByRole("button", { name: "Choose folder", exact: true }).click();
  const supportBrowser = root.locator(".st-output-browser");
  await supportBrowser.waitFor();
  check(await root.getByRole("heading", { name: "Choose support folder", exact: true }).isVisible(), `${label}: support folder picker has the wrong screen title`);
  await supportBrowser.locator(".st-browser-entry").filter({ hasText: "Reference" }).click();
  await root.getByRole("button", { name: "Use this folder", exact: true }).click();
  check(await root.getByLabel("Support folder", { exact: true }).inputValue() === "Reference", `${label}: choosing a support folder did not update the draft`);
  await root.getByLabel("Hide support folder in File Explorer", { exact: true }).uncheck();
  await root.getByLabel("Exclude support files from Search and Quick Switcher", { exact: true }).uncheck();
  await activeTabs.getByRole("tab", { name: "Updates" }).click();
  const automaticChecks = root.locator(".st-automatic-check-control").first();
  const automaticSlider = automaticChecks.locator('input[type="range"]');
  const automaticLabels = await automaticChecks.locator(".st-automatic-check-labels span").allTextContents();
  check(automaticLabels.join("|") === "New pages|Recent edits|All changes", `${label}: automatic check slider labels are missing or out of order: ${JSON.stringify(automaticLabels)}`);
  check(await automaticSlider.inputValue() === "0" && await automaticChecks.locator(".st-automatic-check-summary").innerText().then((text) => /new pages and page-order/i.test(text)), `${label}: default automatic check position or summary is incorrect`);
  const setAutomaticPosition = async (position) => automaticSlider.evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, position);
  await setAutomaticPosition(1);
  const globalRecentCount = automaticChecks.locator(".st-automatic-check-recent-pages");
  const globalRecentVisible = await globalRecentCount.isVisible();
  const globalRecentValue = await globalRecentCount.inputValue();
  check(globalRecentVisible && globalRecentValue === "5" && await automaticChecks.locator(".st-automatic-check-count-field").isVisible(), `${label}: Recent edits does not reveal the default five-page count: visible=${globalRecentVisible}, value=${globalRecentValue}`);
  await globalRecentCount.fill("8");
  await setAutomaticPosition(2);
  check(await globalRecentCount.isHidden() && await automaticChecks.locator(".st-automatic-check-count-field").isHidden() && await automaticChecks.locator(".st-automatic-check-summary").innerText().then((text) => /all page content/i.test(text)), `${label}: All changes did not hide the count row or update its summary`);
  await activeTabs.getByRole("tab", { name: "Storage" }).click();
  check(await root.getByLabel("Support folder", { exact: true }).inputValue() === "Reference" && !(await root.getByLabel("Hide support folder in File Explorer", { exact: true }).isChecked()) && !(await root.getByLabel("Exclude support files from Search and Quick Switcher", { exact: true }).isChecked()), `${label}: changing settings tabs discarded the storage draft`);
  await activeTabs.getByRole("tab", { name: "Updates" }).click();
  const autoHelpButton = automaticChecks.getByRole("button", { name: "Help: Automatic checks", exact: true });
  await autoHelpButton.click();
  check(await root.locator(`#${await autoHelpButton.getAttribute("aria-controls")}`).innerText().then((text) => /older pages/i.test(text) && /ambiguous/i.test(text) && /Manual Update/i.test(text)), `${label}: automatic check help omits limits or manual fallback`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await page.evaluate(() => { const c = window.__streamlinedFixture.controller; return !c.config.automaticCheck && !c.config.automaticCheckRecentPages && !c.config.supportFolder && c.storagePreferences().hideInExplorer && c.storagePreferences().excludeFromSearch && c.actionCounters.saveConfig === 0 && c.actionCounters.setStoragePreferences === 0; }), `${label}: cancelling settings changed saved defaults, storage preferences, or config`);
  await root.getByRole("button", { name: "Settings", exact: true }).click();
  await root.getByRole("tab", { name: "Updates" }).click();
  const saveChecks = root.locator(".st-automatic-check-control").first();
  const saveSlider = saveChecks.locator('input[type="range"]');
  await saveSlider.evaluate((input) => { input.value = "1"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await saveChecks.locator(".st-automatic-check-recent-pages").fill("8");
  await root.getByRole("tab", { name: "Storage" }).click();
  await root.getByLabel("Support folder", { exact: true }).fill("Reference");
  await root.getByLabel("Hide support folder in File Explorer", { exact: true }).uncheck();
  await root.getByLabel("Exclude support files from Search and Quick Switcher", { exact: true }).uncheck();
  await root.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => { const c = window.__streamlinedFixture.controller; return c.config.automaticCheck === "recent" && c.config.automaticCheckRecentPages === 8 && c.config.supportFolder === "Reference" && !c.storagePreferences().hideInExplorer && !c.storagePreferences().excludeFromSearch; });
  check(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.saveConfig) === 1, `${label}: saving global automatic check defaults did not save exactly once`);
  check(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.setStoragePreferences) === 1, `${label}: saving storage visibility preferences did not call its setter exactly once`);
  await page.evaluate(() => { window.__streamlinedFixture.controller.actionCounters.saveConfig = 0; });
  await page.evaluate(() => { window.__streamlinedFixture.controller.actionCounters.setStoragePreferences = 0; });
  await root.getByRole("button", { name: "Settings", exact: true }).click();
  await root.getByRole("tab", { name: "Updates" }).click();
  check(await root.locator(".st-automatic-check-control").first().locator('input[type="range"]').inputValue() === "1" && await root.locator(".st-automatic-check-control").first().locator(".st-automatic-check-recent-pages").inputValue() === "8", `${label}: saved automatic check defaults did not reload in settings`);
  if (platform === "desktop" || platform === "nomad") {
    for (const fieldName of ["API key", "Simultaneous requests", "Check interval (minutes)"]) {
      await root.getByRole("tab", { name: fieldName === "API key" ? "Connection" : "Updates" }).click();
      const label = root.locator(".st-settings-section label").filter({ hasText: new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
      const geometry = await label.evaluate((element) => {
        const field = element.closest(".st-field");
        const rect = (node) => {
          const r = node?.getBoundingClientRect();
          return r && { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
        };
        const input = field?.querySelector("input, select");
        return { label: rect(element), field: rect(field), grid: field ? getComputedStyle(field).gridTemplateColumns : "", input: rect(input), inputGrid: input ? `${getComputedStyle(input).gridColumnStart}/${getComputedStyle(input).gridColumnEnd}` : "", help: rect(field?.querySelector("button.st-help-button")) };
      });
      const { label: labelBounds, input: inputBounds, help: helpBounds } = geometry;
      check(labelBounds && inputBounds && helpBounds, `${label}: ${fieldName} settings row is missing label/input/help geometry`);
      check(Math.abs(inputBounds.right - helpBounds.right) <= 2, `${label}: ${fieldName} control and help button do not share the right rail: ${JSON.stringify(geometry)}`);
      const labelHelpTopDelta = Math.abs(helpBounds.y - labelBounds.y);
      check(inputBounds.y > labelBounds.y + labelBounds.height - 2 && labelHelpTopDelta <= 8, `${label}: ${fieldName} label, control, and help do not use the aligned label-above-control layout: ${JSON.stringify({ labelBounds, inputBounds, helpBounds })}`);
    }
    const settingsToggles = await root.locator(".st-settings-panel-updates .st-settings-section .st-check-row").evaluateAll((rows) => rows.map((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]')?.getBoundingClientRect();
      const help = row.querySelector(".st-help-button")?.getBoundingClientRect();
      return { checkboxX: checkbox ? checkbox.x + checkbox.width / 2 : null, helpRight: help?.right ?? null };
    }).filter((item) => item.checkboxX !== null));
    check(settingsToggles.length >= 2, `${label}: settings toggle geometry was not found`);
    check(Math.max(...settingsToggles.map((item) => item.checkboxX)) - Math.min(...settingsToggles.map((item) => item.checkboxX)) <= 2, `${label}: settings checkbox centers do not align: ${JSON.stringify(settingsToggles)}`);
    const settingsHelpRights = settingsToggles.map((item) => item.helpRight).filter((right) => right !== null);
    check(settingsHelpRights.length > 0 && Math.max(...settingsHelpRights) - Math.min(...settingsHelpRights) <= 2, `${label}: settings toggle help buttons do not share a right rail: ${JSON.stringify(settingsToggles)}`);
  }
  const helpButton = root.locator(".st-settings-panel-updates button.st-help-button").first();
  check(await helpButton.count() === 1, `${label}: settings help button missing`);
  check(await helpButton.innerText() === "?", `${label}: help is rendered as inline explanation text`);
  await helpButton.focus();
  await page.keyboard.press("Enter");
  check(await helpButton.getAttribute("aria-expanded") === "true", `${label}: Enter did not open contextual help`);
  const helpText = root.locator(`#${await helpButton.getAttribute("aria-controls")}`);
  check(await helpText.isVisible(), `${label}: contextual help did not open`);
  await screenshot("settings-help-open");
  await page.keyboard.press("Space");
  check(await helpButton.getAttribute("aria-expanded") === "false", `${label}: Space did not close contextual help`);
  await screenshot("settings");

  // Subscription connection actions are direct siblings with a visible gap.
  await root.getByRole("tab", { name: "Connection" }).click();
  await root.locator(".st-settings-connection select").selectOption("subscription");
  await assertOneSettingsLabel("changing provider");
  check(await root.getByText("Manage subscription usage", { exact: true }).count() === 0, `${label}: subscription settings still expose the removed Manage subscription usage link`);
  const connection = root.locator(".st-settings-connection");
  if (platform === "desktop") {
    const connectNomad = connection.getByRole("button", { name: "Connect a Nomad", exact: true });
    const disconnect = connection.getByRole("button", { name: "Disconnect ChatGPT account", exact: true });
    check(await connectNomad.isVisible() && await disconnect.isVisible(), `${label}: connected subscription controls are not both visible`);
    const controlGeometry = await Promise.all([connectNomad.boundingBox(), disconnect.boundingBox()]);
    const connectionBounds = await connection.boundingBox();
    check(controlGeometry[0] && controlGeometry[1] && connectionBounds, `${label}: subscription control geometry is unavailable`);
    const [connectBounds, disconnectBounds] = controlGeometry;
    const overlapX = Math.min(connectBounds.x + connectBounds.width, disconnectBounds.x + disconnectBounds.width) - Math.max(connectBounds.x, disconnectBounds.x);
    const overlapY = Math.min(connectBounds.y + connectBounds.height, disconnectBounds.y + disconnectBounds.height) - Math.max(connectBounds.y, disconnectBounds.y);
    check(!(overlapX > 0 && overlapY > 0), `${label}: connected subscription actions overlap: ${JSON.stringify({ connectBounds, disconnectBounds })}`);
    const gap = overlapY > 0
      ? Math.max(connectBounds.x, disconnectBounds.x) - Math.min(connectBounds.x + connectBounds.width, disconnectBounds.x + disconnectBounds.width)
      : Math.max(connectBounds.y, disconnectBounds.y) - Math.min(connectBounds.y + connectBounds.height, disconnectBounds.y + disconnectBounds.height);
    check(gap >= 6, `${label}: connected subscription actions are less than 6px apart: ${JSON.stringify({ gap, connectBounds, disconnectBounds })}`);
  }
  await assertLayout("Subscription settings");
  await screenshot("subscription-settings");
  if (platform === "desktop" || platform === "nomad") {
    await root.getByRole("tab", { name: "Recognition" }).click();
    const quality = root.locator(".st-quality-control:not(.st-automatic-check-control)").first();
    const trackBounds = await quality.locator('input[type="range"]').boundingBox();
    const labelsBounds = await quality.locator(".st-quality-labels").boundingBox();
    check(trackBounds && labelsBounds && Math.abs(trackBounds.x - labelsBounds.x) <= 2 && Math.abs(trackBounds.width - labelsBounds.width) <= 2, `${label}: quality slider track and labels have different widths or alignment: ${JSON.stringify({ trackBounds, labelsBounds })}`);
  }
  await root.getByRole("button", { name: "Back", exact: true }).click();
  await assertOneSettingsLabel("returning home");
  await root.getByRole("button", { name: "Settings", exact: true }).click();
  await assertOneSettingsLabel("reopening settings");

  // Standalone Reflection editor: cleanup and reprocess controls remain directly reachable.
  await root.getByRole("button", { name: "Back", exact: true }).click();
  await root.getByRole("button", { name: "Sources", exact: true }).waitFor();
  await root.getByRole("button", { name: "Sources", exact: true }).click();
  const soloConfigure = root.locator('button.st-edit[data-config-id="reflection-single"]');
  check(await soloConfigure.isVisible(), `${label}: standalone Reflection Configure button missing`);
  await soloConfigure.click();
  await root.locator(".st-form").waitFor();
  await root.locator(".st-body").evaluate((element) => { element.scrollTop = 0; });
  check(await root.locator(".st-source-title").innerText() === "Reflection", `${label}: single-note editor did not open Reflection`);
  const editorHeadings = await root.locator(".st-form h2").allTextContents();
  for (const heading of ["Source", "Markdown", "Recognition", "Notebook actions"]) {
    check(editorHeadings.includes(heading), `${label}: source editor is missing the ${heading} section heading: ${JSON.stringify(editorHeadings)}`);
  }
  check(await root.locator(".st-form .st-source-advanced").count() === 0, `${label}: single-note editor still has a Source Advanced disclosure`);
  const autoRecognition = root.locator(".st-form").getByLabel("Automatic updates", { exact: true });
  await autoRecognition.uncheck();
  check(await root.locator(".st-form .st-automatic-check-control").count() === 0 && await root.locator(".st-form").getByLabel("Use default automatic checks", { exact: true }).count() === 0, `${label}: automatic check slider or inheritance control stayed visible with source automatic recognition disabled`);
  await root.locator(".st-form").getByLabel("Automatic updates", { exact: true }).check();
  const automaticInherit = root.locator(".st-form").getByLabel("Use default automatic checks", { exact: true });
  check(await automaticInherit.isChecked(), `${label}: new source does not inherit the global automatic check default`);
  await automaticInherit.uncheck();
  let sourceAutomatic = root.locator(".st-form .st-automatic-check-control");
  check(await sourceAutomatic.locator('input[type="range"]').inputValue() === "1" && await sourceAutomatic.locator(".st-automatic-check-recent-pages").inputValue() === "8", `${label}: source override did not initialize from global Recent edits defaults`);
  await sourceAutomatic.locator(".st-automatic-check-recent-pages").fill("12");
  await sourceAutomatic.locator('input[type="range"]').evaluate((input) => { input.value = "2"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  check(await sourceAutomatic.getByLabel("Last N pages", { exact: true }).isHidden(), `${label}: source All changes still shows Recent pages count`);
  await sourceAutomatic.locator('input[type="range"]').evaluate((input) => { input.value = "1"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await root.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => { const rule = window.__streamlinedFixture.controller.config.rules.find((item) => item.id === "reflection-single"); return rule.automaticCheck === "recent" && rule.automaticCheckRecentPages === 12; });
  await page.evaluate(() => { window.__streamlinedFixture.controller.actionCounters.saveConfig = 0; });
  await soloConfigure.click();
  await root.locator(".st-form").waitFor();
  check(!(await root.locator(".st-form").getByLabel("Use default automatic checks", { exact: true }).isChecked()) && await root.locator(".st-form .st-automatic-check-control").locator(".st-automatic-check-recent-pages").inputValue() === "12", `${label}: saved source-specific automatic check override did not reload`);
  await root.locator(".st-form").getByLabel("Use default automatic checks", { exact: true }).check();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await page.evaluate(() => { const c = window.__streamlinedFixture.controller; const rule = c.config.rules.find((item) => item.id === "reflection-single"); return rule.automaticCheck === "recent" && rule.automaticCheckRecentPages === 12 && c.actionCounters.saveConfig === 0; }), `${label}: cancelling source inheritance draft changed the saved override or wrote config`);
  await soloConfigure.click();
  await root.locator(".st-form").waitFor();
  const outputRail = await root.locator(".st-form .st-output-folder-field").evaluate((field) => {
    const bounds = (node) => {
      const r = node?.getBoundingClientRect();
      return r && { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
    };
    return {
      field: bounds(field),
      controls: bounds(field.querySelector(".st-output-folder-controls")),
      help: bounds(field.querySelector(".st-help-button")),
    };
  });
  check(outputRail.field && outputRail.controls && outputRail.help, `${label}: output folder and help geometry is missing: ${JSON.stringify(outputRail)}`);
  check(Math.abs(outputRail.controls.right - outputRail.help.right) <= 2, `${label}: output folder controls and help button do not share a right rail: ${JSON.stringify(outputRail)}`);
  if (platform === "desktop" && viewport.width >= 701) {
    const fieldGeometry = await root.evaluate(() => {
      const rect = (node) => {
        const r = node?.getBoundingClientRect();
        return r && { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
      };
      const fields = [".st-shared-mirror-field .st-field", ".st-model-picker", ".st-output-folder-field"].map((selector) => {
        const field = document.querySelector(selector);
        const control = selector.includes("output-folder") ? field?.querySelector(".st-output-folder-controls") : field?.querySelector("select");
        return { selector, field: rect(field), control: rect(control) };
      });
      const helpButtons = [...document.querySelectorAll(".st-form .st-help-button")].map((button) => ({
        button: rect(button), field: rect(button.closest(".st-field")),
      }));
      const toggles = [...document.querySelectorAll(".st-form .st-check-row")].map((row) => ({
        checkbox: rect(row.querySelector('input[type="checkbox"]')),
        help: rect(row.querySelector(".st-help-button")),
      })).filter((item) => item.checkbox);
      return { fields, helpButtons, toggles };
    });
    check(fieldGeometry.fields.every((item) => item.field && item.control), `${label}: shared mirror, model, or output control geometry is missing: ${JSON.stringify(fieldGeometry.fields)}`);
    const fieldRights = fieldGeometry.fields.map((item) => item.field.right);
    check(Math.max(...fieldRights) - Math.min(...fieldRights) <= 2, `${label}: shared mirror, model, and output fields do not share a right edge: ${JSON.stringify(fieldGeometry.fields)}`);
    check(fieldGeometry.fields.every((item) => Math.abs(item.control.right - item.field.right) <= 2), `${label}: shared mirror, model, or output control does not reach the shared field edge: ${JSON.stringify(fieldGeometry.fields)}`);
    check(fieldGeometry.helpButtons.length > 0 && fieldGeometry.helpButtons.every((item) => item.button && (!item.field || Math.abs(item.button.right - item.field.right) <= 2)), `${label}: one or more source form help buttons are not at the field's right rail: ${JSON.stringify(fieldGeometry.helpButtons)}`);
    const helpRights = fieldGeometry.helpButtons.map((item) => item.button.right);
    check(Math.max(...helpRights) - Math.min(...helpRights) <= 2, `${label}: source form help buttons do not share a right rail: ${JSON.stringify(helpRights)}`);
    check(fieldGeometry.toggles.length >= 2, `${label}: source form toggle geometry was not found`);
    const checkboxCenters = fieldGeometry.toggles.map((item) => item.checkbox.x + item.checkbox.width / 2);
    check(Math.max(...checkboxCenters) - Math.min(...checkboxCenters) <= 2, `${label}: source form checkbox centers do not align: ${JSON.stringify(fieldGeometry.toggles)}`);
    const toggleHelpRights = fieldGeometry.toggles.filter((item) => item.help).map((item) => item.help.x + item.help.width);
    check(toggleHelpRights.length > 0 && Math.max(...toggleHelpRights) - Math.min(...toggleHelpRights) <= 2, `${label}: source form toggle help buttons do not share a right rail: ${JSON.stringify(fieldGeometry.toggles)}`);
  }
  const mirrorHelp = root.locator(".st-form .st-help-button[aria-label='Help: Shared mirror']");
  await mirrorHelp.focus();
  await page.keyboard.press("Enter");
  const mirrorHelpText = root.locator(`#${await mirrorHelp.getAttribute("aria-controls")}`);
  check(await mirrorHelpText.innerText().then((text) => /configuration folder separate/i.test(text) && /queue state/i.test(text) && /shared data is stored in reference/i.test(text) && /markdown transcripts stay under supernote transcripts/i.test(text) && /exclude that folder from Search/i.test(text)), `${label}: Shared mirror help omits configuration, storage or Search guidance`);
  await screenshot("reflection-editor-shared-mirror-help");
  await page.keyboard.press("Space");
  const chooseFolder = root.getByRole("button", { name: "Choose folder", exact: true });
  check(await chooseFolder.isVisible(), `${label}: output folder picker button missing`);
  const outputField = root.locator(".st-output-choice .st-field");
  const outputInput = outputField.locator("input");
  const chooserBounds = await chooseFolder.boundingBox();
  const fieldBounds = await outputField.boundingBox();
  const inputBounds = await outputInput.boundingBox();
  const bodyBounds = await root.locator(".st-body").boundingBox();
  check(chooserBounds && fieldBounds && inputBounds && bodyBounds, `${label}: output folder field/button has no layout bounds`);
  const buttonRight = chooserBounds.x + chooserBounds.width;
  const fieldRight = fieldBounds.x + fieldBounds.width;
  const fieldBottom = fieldBounds.y + fieldBounds.height;
  const bodyRight = bodyBounds.x + bodyBounds.width;
  const buttonBottom = chooserBounds.y + chooserBounds.height;
  check(chooserBounds.x >= fieldBounds.x - 2 && buttonRight <= bodyRight - 2, `${label}: output folder button misaligned relative to field/body: ${JSON.stringify({ chooserBounds, fieldBounds, bodyBounds })}`);
  check(!(chooserBounds.x < inputBounds.x + inputBounds.width && buttonRight > inputBounds.x && chooserBounds.y < inputBounds.y + inputBounds.height && buttonBottom > inputBounds.y), `${label}: output folder button overlaps the text input`);
  if (platform === "desktop" && viewport.width >= 701) check(Math.abs((chooserBounds.y + chooserBounds.height / 2) - (inputBounds.y + inputBounds.height / 2)) <= 2, `${label}: output folder Browse button is not center-aligned with the input: ${JSON.stringify({ chooserBounds, inputBounds })}`);
  const editorActions = root.locator(".st-notebook-actions");
  check(await editorActions.getByRole("button", { name: "Clean up document", exact: true }).isVisible(), `${label}: single-note source settings lack cleanup launch action`);
  check(await editorActions.getByRole("button", { name: "Re-recognize pages", exact: true }).isVisible(), `${label}: single-note source settings lack reprocess launch action`);
  check(await editorActions.locator(".st-cleanup-task, .st-reprocess-task, .st-cleanup-previous").count() === 0, `${label}: source settings render full action forms or cleanup metadata inline`);
  await editorActions.getByRole("button", { name: "Clean up document", exact: true }).click();
  await root.locator(".st-cleanup-workflow").waitFor();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await root.locator(".st-form .st-source-title").innerText() === "Reflection", `${label}: cleanup Cancel did not return to source settings`);
  await root.locator(".st-notebook-actions").getByRole("button", { name: "Re-recognize pages", exact: true }).click();
  await root.locator(".st-reprocess-workflow").waitFor();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await root.locator(".st-form .st-source-title").innerText() === "Reflection", `${label}: reprocess Cancel did not return to source settings`);
  const outputPathInput = root.locator(".st-output-folder-field input");
  const savedOutputPath = await outputPathInput.inputValue();
  await outputPathInput.fill(`${savedOutputPath}-draft`);
  await root.locator(".st-notebook-actions").getByRole("button", { name: "Clean up document", exact: true }).click();
  check(await root.locator(".st-cleanup-workflow").count() === 0 && await root.locator(".st-form .st-source-title").innerText() === "Reflection", `${label}: unsaved source settings did not guard workflow launch`);
  await outputPathInput.fill(savedOutputPath);
  await screenshot("reflection-editor");
  await chooseFolder.click();
  await root.locator(".st-output-browser").waitFor();
  await root.getByRole("button", { name: "Choose this folder", exact: true }).waitFor();
  check(await root.getByText("Vault", { exact: true }).count() === 0 && await root.locator(".st-browser-root").count() === 0, `${label}: output picker adds a redundant root heading`);
  check(await root.getByRole("searchbox", { name: "Find", exact: true }).isVisible(), `${label}: output folder search is not labeled Find`);
  await assertLayout("Output folder picker");
  await screenshot("output-folder-picker");
  await root.locator(".st-create-folder-open").click();
  const createFolder = root.locator(".st-output-folder-create");
  await createFolder.waitFor();
  const folderName = createFolder.getByLabel("Folder name", { exact: true });
  const createConfirm = root.locator(".st-create-folder-confirm");
  await screenshot("output-folder-create");
  check(await createConfirm.isDisabled(), `${label}: blank folder name can be submitted`);
  await folderName.fill("bad/name");
  await createConfirm.click();
  check(await createFolder.locator(".st-create-folder-error").isVisible(), `${label}: invalid folder name has no inline validation error`);
  await root.locator(".st-create-folder-cancel").click();
  await root.locator(".st-output-browser").waitFor();
  check(await root.locator(".st-browser-entry-name").filter({ hasText: "bad" }).count() === 0, `${label}: cancelling the invalid folder draft changed the vault picker`);
  await root.locator(".st-create-folder-open").click();
  await createFolder.waitFor();
  check(await folderName.inputValue() === "", `${label}: cancelling folder creation retained the draft name`);
  await root.locator(".st-create-folder-cancel").click();
  await root.locator(".st-output-browser").waitFor();
  await root.locator(".st-create-folder-open").click();
  await createFolder.waitFor();
  await folderName.fill("Synthetic verified folder");
  await createConfirm.click();
  await root.locator(".st-output-browser").waitFor();
  check(await page.evaluate(() => !!window.__streamlinedFixture.app.vault.getAbstractFileByPath("Synthetic verified folder")), `${label}: valid output folder creation did not create the requested synthetic folder`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await root.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();

  // Open standalone notebook detail, then inspect cleanup and reprocess in dedicated workflows.
  const standaloneDetails = root.locator('article.st-rule-row .st-notebook-details-action[aria-label="Notebook details: Reflection"]').last();
  check(await standaloneDetails.isVisible() && await standaloneDetails.getAttribute("title") === "Notebook details: Reflection", `${label}: standalone notebook does not use the same accessible details icon action as folder children`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.reconciliationCapture = {
      items: [
        { pageId: "fixture-page-2", number: 2, reason: "This page has both local edits and a new recognition.", editedText: "Synthetic edited text for page two.", recognizedText: "Synthetic new recognition for page two.", fingerprint: "fixture-fingerprint-2" },
        { pageId: "fixture-page-4", number: 4, reason: "The page changed after the comparison was prepared.", editedText: "Synthetic edited text for page four.", recognizedText: "Synthetic new recognition for page four.", proposedText: "Synthetic proposal for page four.", fingerprint: "fixture-fingerprint-4-old" },
      ],
      calls: [],
      staleInjected: false,
    };
    c.getReconciliationConflicts = () => structuredClone(c.reconciliationCapture.items);
    c.resolveReconciliationConflict = async (source, pageId, choice, fingerprint, editedText) => {
      const capture = c.reconciliationCapture;
      capture.calls.push({ source, pageId, choice, fingerprint, editedText });
      const current = capture.items.find((item) => item.pageId === pageId);
      if (!current || current.fingerprint !== fingerprint || current.editedText !== editedText) {
        if (pageId === "fixture-page-4" && !capture.staleInjected) {
          capture.staleInjected = true;
          capture.items = capture.items.map((item) => item.pageId === pageId
            ? { ...item, editedText: "Updated edited content after concurrent change.", recognizedText: "Updated recognition after concurrent change.", proposedText: "Updated proposal after concurrent change.", fingerprint: "fixture-fingerprint-4-new" }
            : item);
        }
        throw new Error("Stale page values");
      }
      capture.items = capture.items.filter((item) => item.pageId !== pageId);
    };
  });
  await standaloneDetails.click();
  await root.locator(".st-detail-controls").waitFor();
  const detail = root.locator(".st-detail-controls");
  const reconciliationSummary = root.locator(".st-reconciliation-summary");
  await reconciliationSummary.getByRole("button", { name: "Review changes", exact: true }).waitFor();
  check(await reconciliationSummary.getByText("2 pages have edits that differ from the new recognition.", { exact: true }).isVisible(), `${label}: detail did not show the independent page conflict count`);
  await reconciliationSummary.getByRole("button", { name: "Review changes", exact: true }).click();
  const reconciliation = root.locator(".st-page-reconciliation");
  await reconciliation.waitFor();
  check(await reconciliation.getByText("Synthetic edited text for page two.", { exact: true }).isVisible() && await reconciliation.getByText("Synthetic new recognition for page two.", { exact: true }).isVisible(), `${label}: page comparison omitted either edited or recognized text`);
  check(await reconciliation.getByText("This page has both local edits and a new recognition.", { exact: true }).isVisible(), `${label}: page comparison omitted its reason`);
  const firstConflict = reconciliation.locator(".st-page-conflict").filter({ hasText: "Page 2" });
  check(await firstConflict.getByRole("button", { name: "Keep my edits", exact: true }).isVisible() && await firstConflict.getByRole("button", { name: "Use updated handwriting", exact: true }).isVisible() && await firstConflict.getByRole("button", { name: "Use proposed edit", exact: true }).count() === 0, `${label}: standard conflict choices are missing or a proposal action appeared without a proposal`);
  const proposedConflict = reconciliation.locator(".st-page-conflict").filter({ hasText: "Page 4" });
  check(await proposedConflict.getByText("Synthetic proposal for page four.", { exact: true }).isVisible() && await proposedConflict.getByRole("button", { name: "Use proposed edit", exact: true }).isVisible(), `${label}: provided proposal was not shown as an optional explicit choice`);
  check(await page.evaluate(() => window.__streamlinedFixture.controller.reconciliationCapture.calls.length) === 0, `${label}: opening the review automatically resolved a page conflict`);
  await firstConflict.getByRole("button", { name: "Keep my edits", exact: true }).click();
  await reconciliation.locator(".st-page-conflict").filter({ hasText: "Page 2" }).waitFor({ state: "detached" });
  const firstResolution = await page.evaluate(() => window.__streamlinedFixture.controller.reconciliationCapture.calls[0]);
  check(firstResolution.choice === "keep-edits" && firstResolution.fingerprint === "fixture-fingerprint-2" && firstResolution.editedText === "Synthetic edited text for page two.", `${label}: the keep choice did not pass the exact page fingerprint and reviewed edited text`);
  await page.evaluate(() => {
    const capture = window.__streamlinedFixture.controller.reconciliationCapture;
    capture.items = capture.items.map((item) => item.pageId === "fixture-page-4"
      ? { ...item, fingerprint: "fixture-fingerprint-4-concurrently-changed" }
      : item);
  });
  await reconciliation.locator(".st-page-conflict").filter({ hasText: "Page 4" }).getByRole("button", { name: "Use proposed edit", exact: true }).click();
  await reconciliation.getByText(/may have changed/).waitFor();
  check(await reconciliation.getByText("Updated edited content after concurrent change.", { exact: true }).isVisible() && await reconciliation.getByText("Updated proposal after concurrent change.", { exact: true }).isVisible(), `${label}: stale conflict did not refresh to the current page values`);
  await reconciliation.locator(".st-page-conflict").filter({ hasText: "Page 4" }).getByRole("button", { name: "Use proposed edit", exact: true }).click();
  await reconciliation.getByText("No page changes need review.", { exact: true }).waitFor();
  const resolutions = await page.evaluate(() => window.__streamlinedFixture.controller.reconciliationCapture.calls);
  const retriedResolution = resolutions.at(-1);
  check(retriedResolution.choice === "use-proposal" && retriedResolution.fingerprint === "fixture-fingerprint-4-new" && retriedResolution.editedText === "Updated edited content after concurrent change.", `${label}: retry did not use the refreshed expected fingerprint and edited text`);
  await root.getByRole("button", { name: "Back to notebook", exact: true }).click();
  await root.locator(".st-detail-controls").waitFor();
  check(await detail.locator(".st-notebook-advanced").count() === 0, `${label}: single-note detail still has a separate Advanced disclosure`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    state.status = "conflict";
    state.error = "Shared publication receipt is damaged. Diagnostic frames and internal details follow.\n at synthetic stack frame";
  });
  await root.locator(".st-body > .st-field select").dispatchEvent("change");
  const visibleAttentionReason = root.locator(".st-detail-live .st-attention-reason");
  const visibleAttentionReasonText = await visibleAttentionReason.innerText().catch(() => "missing");
  check(await visibleAttentionReason.isVisible() && visibleAttentionReasonText === "Could not verify this transcript’s sync record. It links the saved Markdown to the original note; this check did not modify the notebook. Check Sync, then use Check & update.", `${label}: notebook details do not show a concise blocking reason without opening diagnostics: ${visibleAttentionReasonText}`);
  check(await root.locator(".st-notebook-diagnostics").count() === 1 && !(await root.locator(".st-notebook-diagnostics").evaluate((details) => details.open)), `${label}: verbose notebook diagnostics are not kept in a collapsed technical section`);
  check(await root.locator(".st-update-controls").getByRole("button", { name: "Force update", exact: true }).isVisible(), `${label}: blocking notebook reason has no visible recovery action`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    state.status = "current";
    delete state.error;
  });
  await root.locator(".st-body > .st-field select").dispatchEvent("change");
  const updateControls = detail.locator(".st-update-controls");
  const notebookTools = detail.locator(".st-notebook-tools");
  check(await updateControls.count() === 1 && await notebookTools.count() === 1 && await updateControls.locator("h2").innerText() === "Update" && await notebookTools.locator("h2").innerText() === "Notebook tools", `${label}: notebook details do not separate Update controls from Notebook tools`);
  check(await updateControls.getByRole("button", { name: "Check & update", exact: true }).isVisible() && await updateControls.getByRole("button", { name: "Pause recognition", exact: true }).isVisible() && await updateControls.getByRole("button", { name: "Exclude notebook", exact: true }).isVisible(), `${label}: Update controls are missing Check & update, Pause recognition, or Exclude notebook`);
  check(await notebookTools.locator(".st-cleanup-open, .st-reprocess-open, .st-history-details").count() === 3 && await notebookTools.locator(".st-history-details").getAttribute("aria-expanded") === "false", `${label}: Notebook tools are missing Clean up, Re-recognize, or History`);
  const detailActions = detail.locator(".st-detail-action-grid > button");
  const actionHeights = await detailActions.evaluateAll((buttons) => buttons.map((button) => ({ label: (button.textContent || "").trim(), height: button.getBoundingClientRect().height })));
  check(actionHeights.length >= 6 && actionHeights.every((item) => item.height >= 48), `${label}: notebook detail actions are not full-sized buttons: ${JSON.stringify(actionHeights)}`);
  const actionGridLayout = await detail.locator(".st-detail-action-grid").evaluateAll((grids) => grids.map((grid) => {
    const style = getComputedStyle(grid);
    const buttons = [...grid.querySelectorAll("button")];
    return {
      columns: style.gridTemplateColumns.split(" ").length,
      buttons: buttons.map((button) => ({
        label: (button.textContent || "").trim(),
        width: button.clientWidth,
        scrollWidth: button.scrollWidth,
        whiteSpace: getComputedStyle(button).whiteSpace,
        y: button.getBoundingClientRect().y,
        x: button.getBoundingClientRect().x,
      })),
    };
  }));
  check(actionGridLayout.length === 2 && actionGridLayout.every((grid) => grid.columns === 2 && grid.buttons.length >= 3), `${label}: Update and Notebook tools actions are not arranged in two columns: ${JSON.stringify(actionGridLayout)}`);
  check(actionGridLayout.every((grid) => grid.buttons.every((button) => button.whiteSpace === "nowrap" && button.scrollWidth <= button.width + 1)), `${label}: a notebook action label wraps or overflows its button: ${JSON.stringify(actionGridLayout)}`);
  check(!(await detail.locator(".st-notebook-details").evaluate((details) => details.open)), `${label}: technical notebook details are expanded by default`);
  await detail.locator(".st-notebook-details > summary").click();
  check(await detail.locator(".st-check-timestamps").innerText().then((text) => /Automatic check .* · full check /.test(text)), `${label}: notebook details do not show automatic and full check timestamps`);
  await detail.locator(".st-notebook-details > summary").click();
  const checkAndUpdate = updateControls.getByRole("button", { name: "Check & update", exact: true });
  const previousRecognitionRequests = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.recognitionNow.length);
  await checkAndUpdate.click();
  await page.waitForFunction((previous) => window.__streamlinedFixture.controller.actionCounters.recognitionNow.length === previous + 1, previousRecognitionRequests);
  check(await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const source = Object.keys(c.store.notebooks).find((path) => c.store.notebooks[path].ruleId === "reflection-single");
    return JSON.stringify(c.actionCounters.recognitionNow.at(-1)) === JSON.stringify({ source });
  }), `${label}: Check & update did not request a full one-shot notebook update`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const source = Object.keys(c.store.notebooks).find((path) => c.store.notebooks[path].ruleId === "reflection-single");
    c.store.queue = c.store.queue.filter((task) => task.source !== source);
    c.progress.manualSources = (c.progress.manualSources || []).filter((item) => item !== source);
    c.actionCounters.recognitionNow.pop();
    c.notify();
  });
  const pauseAction = updateControls.getByRole("button", { name: "Pause recognition", exact: true });
  await pauseAction.click();
  await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.notebookPause.at(-1)?.paused === true);
  await updateControls.getByRole("button", { name: "Resume recognition", exact: true }).click();
  await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.notebookPause.at(-1)?.paused === false);
  await page.evaluate(() => { window.__streamlinedFixture.controller.actionCounters.notebookPause = []; });
  await updateControls.getByRole("button", { name: "Exclude notebook", exact: true }).click();
  await root.locator(".st-exclude-confirmation").waitFor();
  check(await root.locator(".st-exclude-confirmation").getByText("This stops mirroring the notebook from this source.").isVisible(), `${label}: Exclude notebook skipped its existing confirmation`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await detail.waitFor();
  const cleanup = detail.getByRole("button", { name: "Clean up document", exact: true });
  const reprocess = detail.getByRole("button", { name: "Re-recognize pages", exact: true });
  check(await cleanup.isVisible() && await reprocess.isVisible(), `${label}: detail action launch buttons are missing`);
  check(await detail.locator(".st-cleanup-task, .st-reprocess-task, .st-cleanup-previous").count() === 0, `${label}: detail renders full action forms or cleanup metadata inline`);
  const initialConfig = await page.evaluate(() => JSON.stringify(window.__streamlinedFixture.controller.config));
  await cleanup.click();
  const cleanupFlow = root.locator(".st-cleanup-workflow");
  await cleanupFlow.waitFor();
  check(await cleanupFlow.getByText(/Estimated cleanup: 2 pages · 1 request · about \$0\.0010/).isVisible(), `${label}: cleanup estimate is missing or not based on the selected model`);
  check(await cleanupFlow.locator(".st-cleanup-previous").count() === 1 && !(await cleanupFlow.locator(".st-cleanup-previous").evaluate((details) => details.open)), `${label}: previous cleanup metadata is not in a collapsed details section`);
  check(await cleanupFlow.locator(".st-cleanup-copy-field").isHidden(), `${label}: copy path is visible while save-as-copy is off`);
  check(await cleanupFlow.locator(".st-cleanup-destination-path").innerText() === "Fixture Output/Reflection", `${label}: default cleanup destination is not the canonical transcript`);
  const removePageComments = cleanupFlow.getByLabel("Remove page comments from the cleaned copy", { exact: true });
  check(await removePageComments.isDisabled(), `${label}: page comment removal is enabled while overwrite mode is selected`);
  await assertLayout("Cleanup workflow");
  await screenshot("cleanup-workflow");
  const model = cleanupFlow.getByLabel("Cleanup model", { exact: true });
  await model.selectOption("__custom__");
  const customModel = cleanupFlow.getByPlaceholder("Enter model name");
  await customModel.fill("");
  check(await root.getByText("Choose a valid cleanup model.", { exact: true }).isVisible(), `${label}: empty custom cleanup model has no specific disabled reason`);
  check(await root.getByRole("button", { name: "Clean up document", exact: true }).isDisabled(), `${label}: cleanup can run with an empty custom model`);
  await customModel.fill("custom-fixture-model");
  check(await cleanupFlow.getByText(/about \$0\.0032/).isVisible(), `${label}: cleanup estimate did not refresh for the custom model`);
  check(await root.getByRole("button", { name: "Clean up document", exact: true }).isEnabled(), `${label}: cleanup remains disabled after entering a valid custom model`);
  await model.selectOption("gpt-6-luna");
  const copyToggle = cleanupFlow.locator('input[data-testid="cleanup-save-copy"]');
  await copyToggle.check();
  check(await removePageComments.isEnabled(), `${label}: page comment removal stays disabled in save-as-copy mode`);
  const copyPath = cleanupFlow.getByLabel("Copy path", { exact: true });
  check(await copyPath.isVisible() && (await copyPath.inputValue()).endsWith("(cleaned).md"), `${label}: enabled copy path did not show its default sibling path`);
  check(await cleanupFlow.locator(".st-cleanup-destination").isHidden(), `${label}: save-as-copy repeats its destination below the editable path: ${JSON.stringify(await cleanupFlow.locator(".st-cleanup-destination").evaluate((node) => ({ hidden: node.hidden, display: getComputedStyle(node).display })))}`);
  await screenshot("cleanup-save-copy-workflow");
  await assertLayout("Cleanup save-as-copy workflow");
  await copyPath.fill("");
  check(await root.getByText("Enter a path for the cleaned copy.", { exact: true }).isVisible() && await root.getByRole("button", { name: "Clean up document", exact: true }).isDisabled(), `${label}: empty copy path lacks a specific disabled reason`);
  await copyPath.fill("Fixture Output/Reflection (reviewed).md");
  check(await copyPath.inputValue() === "Fixture Output/Reflection (reviewed).md", `${label}: editable copy destination did not retain the entered path`);
  await copyToggle.uncheck();
  check(await cleanupFlow.locator(".st-cleanup-copy-field").isHidden() && await cleanupFlow.locator(".st-cleanup-destination").isVisible() && await cleanupFlow.locator(".st-cleanup-destination-path").innerText() === "Fixture Output/Reflection", `${label}: disabling save-as-copy did not hide the path and restore canonical destination`);
  check(await removePageComments.isDisabled() && !(await removePageComments.isChecked()), `${label}: leaving save-as-copy mode did not disable and reset page comment removal`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await root.locator(".st-detail-controls").isVisible(), `${label}: cleanup Cancel did not return to notebook detail`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    for (let number = 3; number <= 20; number++) {
      const descriptor = { id: `reflection-page-${number}`, number, fingerprint: `synthetic-reflection-${number}` };
      state.desired.push(descriptor);
      state.order.push(descriptor.id);
      state.pages[descriptor.id] = { fingerprint: descriptor.fingerprint, text: `Synthetic reflection page ${number}.`, recipe: "fixture", number };
    }
  });
  await reprocess.click();
  const reprocessFlow = root.locator(".st-reprocess-workflow");
  await reprocessFlow.waitFor();
  check(await root.getByText("Enter pages or choose outdated pages.", { exact: true }).isVisible(), `${label}: empty reprocess range has no specific disabled reason`);
  check(await root.getByRole("button", { name: "Re-recognize selected pages", exact: true }).isDisabled(), `${label}: reprocess can run without a page selection`);
  const pageRange = reprocessFlow.getByLabel("Pages", { exact: true });
  await reprocessFlow.locator(".st-page-preview-card").first().waitFor();
  check(await reprocessFlow.getByText("Available pages: 1–20.", { exact: false }).isVisible(), `${label}: re-recognition workflow does not state the available page range`);
  check(await reprocessFlow.getByText("Synthetic OCR page 1.", { exact: false }).isVisible(), `${label}: OCR text preview is not visible in the page selection grid`);
  check(await reprocessFlow.locator(".st-page-preview-card img, .st-page-preview-card canvas").count() === 0, `${label}: page selection preview rendered images or canvases`);
  const previewHelp = reprocessFlow.getByRole("button", { name: "Help: Page text preview", exact: true });
  check(await previewHelp.getAttribute("aria-expanded") === "false", `${label}: page preview explanation is not collapsed behind its help icon`);
  await previewHelp.click();
  check(await reprocessFlow.getByText(/cards show read-only OCR text\. Preview opens the original page image locally; no recognition request or AI is used\./i).isVisible(), `${label}: page preview help does not explain text and original-image preview behavior`);
  await previewHelp.click();
  await reprocessFlow.locator(".st-page-preview-card .st-page-preview-select").first().click();
  if (platform === "nomad") {
    const visibleTextLines = await reprocessFlow.locator(".st-page-preview-card").first().locator(".st-page-preview-text").evaluate((text) => {
      const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
      return { visible: text.clientHeight, lineHeight, cardHeight: text.closest(".st-page-preview-card").getBoundingClientRect().height };
    });
    check(visibleTextLines.visible >= visibleTextLines.lineHeight * 3 - 1, `${label}: Nomad OCR excerpt shows fewer than 3 full lines: ${JSON.stringify(visibleTextLines)}`);
  }
  check(await pageRange.inputValue() === "1", `${label}: selecting a page card did not update the page range`);
  check(await reprocessFlow.locator(".st-page-preview-select").first().getAttribute("aria-pressed") === "true", `${label}: selected page button does not expose its selected state accessibly`);
  check(await reprocessFlow.getByText(/1 selected page · 1 request/).isVisible(), `${label}: singular selected page/request estimate is not grammatically correct`);
  await pageRange.fill("1-2");
  check(await reprocessFlow.locator(".st-page-preview-select").evaluateAll((cards) => cards.slice(0, 2).every((card) => card.getAttribute("aria-pressed") === "true") && cards.slice(2).every((card) => card.getAttribute("aria-pressed") === "false")), `${label}: typing a page range did not synchronize visible page selection`);
  const previewPageSize = platform === "nomad" || viewport.width <= 700 ? 6 : 9;
  check(await reprocessFlow.locator(".st-page-preview-card").count() === previewPageSize, `${label}: page preview renders more than one bounded page of cards`);
  await reprocessFlow.getByRole("button", { name: "Next", exact: true }).click();
  await reprocessFlow.getByText(`Synthetic OCR page ${previewPageSize + 1}.`, { exact: false }).waitFor();
  check(await reprocessFlow.locator(".st-page-preview-card").count() === previewPageSize && await reprocessFlow.getByText(`Page 2 of ${Math.ceil(20 / previewPageSize)}`, { exact: true }).isVisible(), `${label}: page preview pagination did not load the next bounded window`);
  check(await page.evaluate((pageSize) => window.__streamlinedFixture.controller.workflowCapture.previewCalls.some((call) => call.start === pageSize + 1 && call.count === pageSize), previewPageSize), `${label}: page preview requested more than the visible window from the controller`);
  await reprocessFlow.getByRole("button", { name: "Previous", exact: true }).click();
  await reprocessFlow.getByText("Synthetic OCR page 1.", { exact: false }).waitFor();
  check(await reprocessFlow.getByText(/2 selected pages · 1 request/).isVisible() && await root.getByRole("button", { name: "Re-recognize selected pages", exact: true }).isEnabled(), `${label}: valid reprocess range did not refresh estimate or enable Run`);
  const previewImage = reprocessFlow.getByRole("button", { name: "Preview page 1", exact: true });
  check(await previewImage.isVisible(), `${label}: page card lacks its separate original-image Preview action`);
  const previewHitArea = await previewImage.boundingBox();
  const minimumPreviewHitArea = platform === "nomad" ? 44 : 28;
  if (previewHitArea) previewHitAreas.push({ page: 1, width: previewHitArea.width, height: previewHitArea.height });
  check(!!previewHitArea && previewHitArea.width >= minimumPreviewHitArea && previewHitArea.height >= minimumPreviewHitArea, `${label}: original-page Preview hit area is smaller than ${minimumPreviewHitArea}px: ${JSON.stringify(previewHitArea)}`);
  await page.evaluate(() => { window.__streamlinedFixture.controller.workflowCapture.deferImagePreview = true; });
  await previewImage.click();
  await page.waitForFunction(() => document.querySelector(".st-page-preview-image")?.disabled === true);
  const pendingPreviewImage = reprocessFlow.locator(".st-page-preview-image").first();
  check(await pendingPreviewImage.isDisabled() && await reprocessFlow.getByText("Loading page preview…", { exact: true }).isVisible(), `${label}: original-page preview does not expose its pending state`);
  const pendingCardState = await pendingPreviewImage.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' st-page-preview-card ')]").getAttribute("aria-busy");
  check(pendingCardState === "true", `${label}: pending image preview card lacks its busy state (${pendingCardState}; ${await pendingPreviewImage.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' st-page-preview-card ')]").evaluate((card) => card.outerHTML)})`);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForFunction(() => document.querySelector(".st-page-preview-card")?.getAttribute("aria-busy") === "true");
  check(await reprocessFlow.locator(".st-page-preview-image").first().isDisabled() && await reprocessFlow.getByText("Loading page preview…", { exact: true }).isVisible(), `${label}: resize rerender lost the pending preview state`);
  await reprocessFlow.locator(".st-page-preview-image").first().evaluate((button) => button.click());
  check(await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.imagePreviewCalls.length) === 1, `${label}: clicking a pending preview issued a duplicate render`);
  await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.resolveImagePreview?.());
  await page.waitForFunction(() => document.querySelectorAll(".st-preview-modal").length === 1);
  await page.waitForFunction(() => {
    const image = document.querySelector(".st-preview-image");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  await page.waitForFunction(() => !document.querySelector(".st-page-preview-image")?.disabled && document.querySelector(".st-page-preview-image-status")?.hidden === true);
  check(await pageRange.inputValue() === "1-2" && await reprocessFlow.getByRole("button", { name: "Select page 1", exact: true }).getAttribute("aria-pressed") === "true", `${label}: original-image Preview changed page selection`);
  await screenshot("original-page-preview");
  await page.evaluate(() => document.querySelector(".st-preview-modal")?.remove());
  await screenshot("reprocess-workflow");
  await page.evaluate(() => { const capture = window.__streamlinedFixture.controller.workflowCapture; capture.deferImagePreview = false; capture.rejectImagePreview = true; });
  await reprocessFlow.getByRole("button", { name: "Preview page 2", exact: true }).click();
  await reprocessFlow.locator(".st-page-preview-image-error.is-error").waitFor({ state: "visible" });
  check(await page.locator(".st-preview-modal").count() === 0, `${label}: failed original-page Preview opened a modal`);
  await page.evaluate(() => { window.__streamlinedFixture.controller.workflowCapture.rejectImagePreview = false; });
  await assertLayout("Reprocess workflow");
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await root.locator(".st-detail-controls").isVisible(), `${label}: reprocess Cancel did not return to notebook detail`);
  const afterCancel = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    return { config: JSON.stringify(c.config), output: state.output, cleanup: JSON.stringify(state.cleanup), counters: { ...c.actionCounters } };
  });
  check(afterCancel.config === initialConfig, `${label}: cancelled workflows changed saved source or model configuration`);
  check(afterCancel.output === "Fixture Output/Reflection" && afterCancel.cleanup.includes("synthetic-cleanup-output"), `${label}: cancelled workflows changed transcript destination or cleanup receipt`);
  check(afterCancel.counters.cleanupDocument === 0 && afterCancel.counters.reprocessPages === 0 && afterCancel.counters.saveConfig === 0, `${label}: opening/cancelling an action workflow invoked an action or saved settings`);
  const blockedAiState = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const wasEnabled = c.aiEnabled;
    c.aiEnabled = false;
    c.notify();
    return wasEnabled;
  });
  await detail.getByRole("button", { name: "Clean up document", exact: true }).click();
  check(await root.locator(".st-cleanup-workflow").isVisible() && await root.getByText("Turn on AI recognition in Settings to run this action.", { exact: true }).isVisible() && await root.getByRole("button", { name: "Clean up document", exact: true }).isDisabled(), `${label}: AI-off cleanup form is not inspectable with an actionable disabled reason`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate((enabled) => { const c = window.__streamlinedFixture.controller; c.aiEnabled = enabled; c.notify(); }, blockedAiState);
  const wasPaused = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    const prior = state.paused;
    state.paused = true;
    c.notify();
    return prior;
  });
  await root.locator(".st-detail-controls").getByRole("button", { name: "Clean up document", exact: true }).click();
  check(await root.getByText("Resume this notebook before running it.", { exact: true }).isVisible() && await root.getByRole("button", { name: "Clean up document", exact: true }).isDisabled(), `${label}: paused cleanup is not inspectable with a specific disabled reason`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate((paused) => { const c = window.__streamlinedFixture.controller; const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single"); state.paused = paused; c.notify(); }, wasPaused);
  const removedPage = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    const page = state.pages[state.desired[0].id];
    delete state.pages[state.desired[0].id];
    c.notify();
    return page;
  });
  await root.locator(".st-detail-controls").getByRole("button", { name: "Clean up document", exact: true }).click();
  check(await root.getByText("Recognize all pages before cleanup.", { exact: true }).isVisible() && await root.getByRole("button", { name: "Clean up document", exact: true }).isDisabled(), `${label}: incomplete cleanup is not inspectable with a specific disabled reason`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate((page) => {
    const c = window.__streamlinedFixture.controller;
    const state = Object.values(c.store.notebooks).find((item) => item.ruleId === "reflection-single");
    state.pages[page.id] = page;
    for (const descriptor of state.desired) state.pages[descriptor.id] ??= {
      fingerprint: descriptor.fingerprint, text: `Synthetic reflection page ${descriptor.number}.`, recipe: "fixture", number: descriptor.number,
    };
    c.notify();
  }, removedPage);
  await detail.getByRole("button", { name: "Clean up document", exact: true }).click();
  await root.locator(".st-cleanup-workflow").waitFor();
  check(await root.getByRole("button", { name: "Clean up document", exact: true }).isEnabled(), `${label}: restored complete cleanup is still disabled: ${await root.locator(".st-cleanup-workflow").innerText()}`);
  const extraInstructions = root.locator(".st-cleanup-workflow").getByLabel("Extra instructions for this run", { exact: true });
  await extraInstructions.fill("Keep Sanskrit diacritics and page order.");
  await root.locator(".st-cleanup-workflow").getByLabel("Save cleaned text as a separate copy", { exact: true }).check();
  await root.locator(".st-cleanup-workflow").getByLabel("Remove page comments from the cleaned copy", { exact: true }).check();
  await root.getByRole("button", { name: "Clean up document", exact: true }).click();
  await detail.waitFor();
  check(await root.locator(".st-cleanup-workflow").count() === 0, `${label}: successful cleanup did not redraw the returned detail screen`);
  await detail.getByRole("button", { name: "Clean up document", exact: true }).click();
  check(await root.getByRole("button", { name: "Clean up document", exact: true }).isEnabled(), `${label}: successful cleanup left its run control busy`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await detail.getByRole("button", { name: "Re-recognize pages", exact: true }).click();
  await root.locator(".st-reprocess-workflow").waitFor();
  await root.locator(".st-reprocess-workflow").getByLabel("Pages", { exact: true }).fill("1");
  await root.getByRole("button", { name: "Re-recognize selected pages", exact: true }).click();
  await detail.waitFor();
  check(await root.locator(".st-reprocess-workflow").count() === 0, `${label}: successful reprocess did not redraw the returned detail screen`);
  await detail.getByRole("button", { name: "Re-recognize pages", exact: true }).click();
  check(await root.getByRole("button", { name: "Re-recognize selected pages", exact: true }).isVisible(), `${label}: successful reprocess left its workflow busy`);
  const stalePreview = root.locator(".st-reprocess-workflow").getByRole("button", { name: "Preview page 1", exact: true });
  await page.evaluate(() => { window.__streamlinedFixture.controller.workflowCapture.deferImagePreview = true; });
  await stalePreview.click();
  await page.waitForFunction(() => document.querySelector(".st-page-preview-image")?.disabled === true);
  const modalCountBeforeNavigation = await page.locator(".st-preview-modal").count();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.resolveImagePreview?.());
  await page.waitForTimeout(50);
  check(await page.locator(".st-preview-modal").count() === modalCountBeforeNavigation, `${label}: a page image opened after navigating away from its pending preview`);
  await page.evaluate(() => { window.__streamlinedFixture.controller.workflowCapture.deferImagePreview = false; });
  const stubCompletionCalls = await page.evaluate(() => ({ ...window.__streamlinedFixture.controller.workflowCapture }));
  check(stubCompletionCalls.cleanupCalls.length === 1 && stubCompletionCalls.reprocessCalls.length === 1, `${label}: expected only the explicitly controlled workflow success stubs to run: ${JSON.stringify(stubCompletionCalls)}`);
  check(stubCompletionCalls.cleanupCalls[0].extraInstructions === "Keep Sanskrit diacritics and page order." && stubCompletionCalls.cleanupCalls[0].removePageComments === true && stubCompletionCalls.cleanupCalls[0].saveCopy === true, `${label}: cleanup did not pass per-run instructions and copy-only comment removal options to the controller: ${JSON.stringify(stubCompletionCalls.cleanupCalls[0])}`);
  check(stubCompletionCalls.previewCalls.length >= 1 && stubCompletionCalls.imagePreviewCalls.length >= 2 && stubCompletionCalls.restoreCalls.length === 1, `${label}: text/image preview or restore UI did not call its controller method as expected: ${JSON.stringify({ previews: stubCompletionCalls.previewCalls, images: stubCompletionCalls.imagePreviewCalls, restores: stubCompletionCalls.restoreCalls })}`);
  await assertLayout("Reflection detail");
  await screenshot("reflection-detail-actions");
  const actionCounts = await page.evaluate(() => ({ ...window.__streamlinedFixture.controller.actionCounters }));
  check(actionCounts.cleanupDocument === 0 && actionCounts.reprocessPages === 0 && actionCounts.update === 0, `${label}: synthetic verification invoked an AI or recognition action: ${JSON.stringify(actionCounts)}`);

  // Satsang folder editor, with the folder scope and chooser also available at narrow widths.
  await root.getByRole("button", { name: "Back", exact: true }).click();
  const reflectionConfigure = root.locator('button.st-edit[data-config-id="reflection-single"]');
  check(await reflectionConfigure.isVisible(), `${label}: standalone Reflection Configure button missing`);
  await reflectionConfigure.click();
  await root.locator(".st-notebook-actions").waitFor();
  await page.evaluate(() => { window.__streamlinedFixture.controller.workflowCapture.deferCleanup = true; });
  await root.locator(".st-notebook-actions").getByRole("button", { name: "Clean up document", exact: true }).click();
  await root.locator(".st-cleanup-workflow").waitFor();
  await root.getByRole("button", { name: "Clean up document", exact: true }).click();
  await root.getByRole("button", { name: "Settings", exact: true }).click();
  await root.locator(".st-form").waitFor();
  await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.resolveCleanup?.());
  await page.waitForFunction(() => window.__streamlinedFixture.controller.workflowCapture.cleanupResolved);
  check(await root.locator(".st-form").isVisible() && await root.locator(".st-cleanup-workflow").count() === 0, `${label}: completed cleanup pulled the user back from Settings`);
  await root.getByRole("button", { name: "Close settings", exact: true }).click();
  await root.locator(".st-cleanup-workflow").waitFor();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await root.locator(".st-notebook-actions").isVisible(), `${label}: cancelled pending cleanup did not return to source settings`);
  await page.evaluate(() => { window.__streamlinedFixture.controller.workflowCapture.deferCleanup = false; });
  await root.locator(".st-notebook-actions").getByRole("button", { name: "Clean up document", exact: true }).click();
  await root.getByRole("button", { name: "Clean up document", exact: true }).click();
  await root.locator(".st-notebook-actions").waitFor();
  check(await root.locator(".st-notebook-actions").isVisible(), `${label}: successful cleanup did not return to source settings`);
  await root.locator(".st-notebook-actions").getByRole("button", { name: "Clean up document", exact: true }).click();
  check(await root.getByRole("button", { name: "Clean up document", exact: true }).isEnabled(), `${label}: successful source-settings cleanup left the run button busy`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await root.locator(".st-form .st-source-title").waitFor();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await root.locator('button.st-edit[data-config-id="research-source"]').waitFor();
  const successfulStubs = await page.evaluate(() => ({ cleanup: window.__streamlinedFixture.controller.workflowCapture.cleanupCalls.length, reprocess: window.__streamlinedFixture.controller.workflowCapture.reprocessCalls.length }));
  check(successfulStubs.cleanup === 3 && successfulStubs.reprocess === 1, `${label}: controlled success path stubs did not run the expected cleanup/reprocess count: ${JSON.stringify(successfulStubs)}`);
  const satsangConfigure = root.locator('button.st-edit[data-config-id="research-source"]');
  check(await satsangConfigure.isVisible(), `${label}: Satsang folder Configure button missing`);
  await satsangConfigure.click();
  await root.locator(".st-form").waitFor();
  check(await root.locator(".st-source-title").innerText() === "Satsang", `${label}: Satsang folder editor did not open`);
  await assertLayout("Satsang folder editor");
  await screenshot("satsang-folder-editor");
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  const finalStandalone = root.locator('article.st-rule-row .st-notebook-details-action[aria-label="Notebook details: Reflection"]').last();
  await finalStandalone.click();
  const finalDetail = root.locator(".st-detail-controls");
  const excludeButton = finalDetail.locator(".st-exclude-open");
  const beforeExclude = await page.evaluate(() => JSON.stringify(window.__streamlinedFixture.controller.config));
  await excludeButton.click();
  const excludeConfirmation = root.locator(".st-exclude-confirmation");
  await excludeConfirmation.waitFor();
  await screenshot("exclude-confirmation");
  check(await root.locator(".st-exclude-confirm").isVisible(), `${label}: exclusion confirmation lacks its explicit confirm action`);
  check(await excludeConfirmation.getByText(/original notebook and existing transcript are kept\. You can include it again in Source settings/i).isVisible(), `${label}: exclusion confirmation does not explain transcript retention or how to re-include the notebook`);
  await root.locator(".st-exclude-cancel").click();
  check(await finalDetail.isVisible() && await page.evaluate(() => JSON.stringify(window.__streamlinedFixture.controller.config)) === beforeExclude, `${label}: cancelling exclusion changed configuration or left notebook details`);
  check(await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.excludeCalls.length) === 0, `${label}: cancelling exclusion called the controller`);
  await excludeButton.click();
  await excludeConfirmation.waitFor();
  await root.locator(".st-exclude-confirm").click();
  await root.getByRole("button", { name: "Sources", exact: true }).waitFor();
  check(await page.evaluate(() => window.__streamlinedFixture.controller.workflowCapture.excludeCalls.length) === 1, `${label}: confirming exclusion did not call the controller exactly once`);
  const excludedRule = root.locator('button.st-edit[data-config-id="reflection-single"]');
  await excludedRule.click();
  await root.locator(".st-form").waitFor();
  const mirrorToggle = root.locator(".st-source-header").getByLabel("Mirror this source", { exact: true });
  const mirrorExcludedState = { count: await mirrorToggle.count(), checked: await mirrorToggle.isChecked(), savedRule: await page.evaluate(() => window.__streamlinedFixture.controller.config.rules.find((item) => item.id === "reflection-single")) };
  check(mirrorExcludedState.count === 1 && !mirrorExcludedState.checked, `${label}: excluded standalone notebook does not show Mirror this source as off in Source settings (${JSON.stringify(mirrorExcludedState)})`);
  const excludedConfig = await page.evaluate(() => JSON.stringify(window.__streamlinedFixture.controller.config));
  await mirrorToggle.check();
  check(await mirrorToggle.isChecked(), `${label}: enabling an excluded standalone notebook did not draft it as included`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  check(await page.evaluate(() => JSON.stringify(window.__streamlinedFixture.controller.config)) === excludedConfig, `${label}: cancelling the re-include draft changed the saved exclusion`);

  // One-shot recognition remains distinct from the saved pause preference.
  const manualFolder = await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const base = window.__streamlinedFixture.paths.working.replace(/\/Journal\/Reflection\.note$/i, "");
    const rule = { id: "manual-fixture-folder", enabled: true, source: `${base}/Manual fixture`, output: "Fixture Output/Manual fixture", recursive: true, exclude: [], profileId: "general", paused: false };
    c.config.rules.push(rule);
    c.notify();
    return rule;
  });
  const folderPlay = root.getByRole("button", { name: "Recognize now: Manual fixture", exact: true });
  check(await folderPlay.isVisible() && await folderPlay.isEnabled(), `${label}: source folder without notebook state has no manual recognition action`);
  await folderPlay.click();
  await page.waitForTimeout(30);
  const folderPlayState = await root.locator("button.st-recognize-now").evaluateAll((buttons) => buttons.map((button) => [button.getAttribute("aria-label"), button.disabled]));
  const queuedFolderPlay = root.getByRole("button", { name: /^(Queued|Recognizing): Manual fixture$/ });
  check(await queuedFolderPlay.count() === 1 && await queuedFolderPlay.isDisabled(), `${label}: queued folder request can be submitted again (buttons=${JSON.stringify(folderPlayState)})`);
  check(JSON.stringify(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.recognitionNow.at(-1))) === JSON.stringify({ ruleId: "manual-fixture-folder" }), `${label}: folder action did not send the exact ruleId target`);
  await root.getByRole("button", { name: /Pause manual recognition: Manual fixture/ }).click();
  check(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.sourcePause.at(-1)?.paused) === true, `${label}: folder pause control did not cancel manual work at folder scope`);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    const rule = c.config.rules.find((item) => item.id === "manual-fixture-folder");
    const source = `${rule.source}/Second fixture notebook.note`;
    const template = Object.values(c.store.notebooks)[0];
    c.store.notebooks[source] = { ...JSON.parse(JSON.stringify(template)), source, id: "manual-child-fixture", ruleId: rule.id, status: "queued", paused: false };
    c.notify();
  });
  const folderDisclosure = root.getByRole("button", { name: "Expand Manual fixture", exact: true });
  await folderDisclosure.click();
  const manualChild = root.locator(".st-folder-contents[data-rule-id='manual-fixture-folder'] .st-notebook-child");
  const childRow = manualChild.filter({ hasText: "Second fixture notebook" });
  await childRow.waitFor();
  const childPlay = childRow.getByRole("button", { name: "Recognize now: Second fixture notebook", exact: true });
  check(await childPlay.isEnabled(), `${label}: notebook child manual recognition action is disabled by the automatic pause`);
  await childPlay.click();
  const queuedChild = childRow.locator("button.st-recognize-now");
  check(await queuedChild.isVisible() && await queuedChild.isDisabled(), `${label}: repeated notebook child request is not blocked while queued`);
  const childRequest = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.recognitionNow.at(-1));
  check(JSON.stringify(childRequest) === JSON.stringify({ source: manualFolder.source + "/Second fixture notebook.note" }), `${label}: child action did not send the exact notebook source target: ${JSON.stringify(childRequest)}`);
  await childRow.getByRole("button", { name: /Pause manual recognition: Second fixture notebook/ }).click();
  check(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.notebookPause.at(-1)?.paused) === true, `${label}: child pause control did not cancel manual work at notebook scope`);
  const mainPause = root.getByRole("button", { name: "Pause", exact: true });
  check(await mainPause.isVisible(), `${label}: main action does not present Pause while manual work is active`);
  check(await root.locator(".st-summary-title").innerText() === "Manual request queued", `${label}: main status still reports saved global pause instead of manual work`);
  const priorGlobalPauses = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.pause);
  const priorFolderPaused = await page.evaluate(() => window.__streamlinedFixture.controller.config.rules.find((rule) => rule.id === "manual-fixture-folder").paused);
  await mainPause.click();
  const mainPauseResult = await page.evaluate(() => ({ pause: window.__streamlinedFixture.controller.actionCounters.pause, resume: window.__streamlinedFixture.controller.actionCounters.resume, update: window.__streamlinedFixture.controller.actionCounters.update, folderPaused: window.__streamlinedFixture.controller.config.rules.find((rule) => rule.id === "manual-fixture-folder").paused }));
  check(mainPauseResult.pause === priorGlobalPauses + 1 && mainPauseResult.resume === 0 && mainPauseResult.update === 0 && mainPauseResult.folderPaused === priorFolderPaused, `${label}: main Pause resumed/updated or changed source-level pause preferences during manual work`);

  const finalCounters = await page.evaluate(() => ({ ...window.__streamlinedFixture.controller.actionCounters }));
  check(finalCounters.cleanupDocument === 0 && finalCounters.reprocessPages === 0 && finalCounters.update === 0, `${label}: fixture action counters changed unexpectedly: ${JSON.stringify(finalCounters)}`);
  check(errors.length === 0, `${label}: browser errors: ${errors.join("; ")}`);
  check(externalRequests.length === 0, `${label}: fixture attempted external requests: ${externalRequests.join(", ")}`);
  const successfulWorkflowStubs = await page.evaluate(() => ({ cleanup: window.__streamlinedFixture.controller.workflowCapture.cleanupCalls.length, reprocess: window.__streamlinedFixture.controller.workflowCapture.reprocessCalls.length }));
  reports.push({ label, viewport, browserErrors: errors, externalRequests, previewHitAreas, syntheticActionCounts: finalCounters, successfulWorkflowStubs });
  await browser.close();
}

await inspectViewport("desktop", { width: 1280, height: 800 }, "desktop");
await inspectViewport("desktop", { width: 470, height: 799 }, "desktop-narrow");
await inspectViewport("nomad", { width: 749, height: 999 }, "nomad-mobile");
const result = {
  verification: "local Playwright browser against current mocked fixture",
  productionObsidianUsed: false,
  productionConfigTouched: false,
  syntheticDataOnly: true,
  externalRequests: 0,
  recognitionCalls: 0,
  assertions,
  reports,
  evidenceDir,
};
await writeFile(join(evidenceDir, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
