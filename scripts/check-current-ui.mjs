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
    };
    c.aiEnabled = true;
    c.progress.running = false;
    c.progress.paused = false;
    c.actionCounters.cleanupDocument = 0;
    c.actionCounters.reprocessPages = 0;
    c.cleanupEstimate = () => ({ pages: 2, requests: 1, usd: 0.001 });
    c.reprocessEstimate = () => ({ pages: 2, requests: 1, usd: 0.001 });
    c.cleanupDocument = async () => { c.actionCounters.cleanupDocument++; };
    c.reprocessPages = async () => { c.actionCounters.reprocessPages++; };
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
  const childCleanup = child.getByRole("button", { name: "Clean up document", exact: true });
  check(await childCleanup.isVisible() && !(await childCleanup.isDisabled()), `${label}: Satsang child cleanup action missing or disabled`);
  check(await child.getByRole("button", { name: "Re-recognize selected pages", exact: true }).isVisible(), `${label}: Satsang child reprocess action missing`);
  await screenshot("satsang-expanded-child-actions");

  // Queue navigation and status view.
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
  await estimateInfo.locator("summary").click();
  check(await estimateInfo.locator("p").first().innerText().then((text) => /after you press Update or Resume\. Individually paused or blocked notebooks are excluded/i.test(text)), `${label}: total estimate scope does not distinguish eligible work from paused or blocked sources`);
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
  check(await estimateInfo.locator("p").first().innerText().then((text) => /spending or execution limits can still stop requests/i.test(text)), `${label}: budget-blocked state hides the estimate scope explanation`);
  await assertLayout("Budget-blocked queue");
  await screenshot("queue-spending-paused");
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.progress.running = false;
    c.progress.budgetBlocked = undefined;
    c.aiEnabled = true;
    c.notify();
  });

  // Settings: compact rows and keyboard-operable contextual help.
  await root.getByRole("button", { name: "Settings", exact: true }).click();
  await root.locator(".st-settings-section").first().waitFor();
  await assertLayout("Settings");
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
  if (platform === "desktop" && viewport.width >= 701) {
    for (const fieldName of ["API key", "Simultaneous requests", "Check interval (minutes)"]) {
      const label = root.locator(".st-settings-section label").filter({ hasText: new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
      const geometry = await label.evaluate((element) => {
        const field = element.closest(".st-field");
        const rect = (node) => {
          const r = node?.getBoundingClientRect();
          return r && { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return { label: rect(element), input: rect(field?.querySelector("input, select")), help: rect(field?.querySelector("button.st-help-button")) };
      });
      const { label: labelBounds, input: inputBounds, help: helpBounds } = geometry;
      check(labelBounds && inputBounds && helpBounds, `${label}: ${fieldName} settings row is missing label/input/help geometry`);
      const centers = [labelBounds.y + labelBounds.height / 2, inputBounds.y + inputBounds.height / 2, helpBounds.y + helpBounds.height / 2];
      check(Math.max(...centers) - Math.min(...centers) <= 2, `${label}: ${fieldName} label, input, and help button are not on one aligned row: ${JSON.stringify({ labelBounds, inputBounds, helpBounds })}`);
    }
  }
  const helpButton = root.locator("button.st-help-button").first();
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
  await root.locator(".st-settings-connection select").selectOption("subscription");
  await assertOneSettingsLabel("changing provider");
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
  if (platform === "desktop" && viewport.width >= 701) {
    const quality = root.locator(".st-quality-control");
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
  const mirrorHelp = root.locator(".st-form .st-help-button[aria-label='Help: Shared mirror']");
  await mirrorHelp.focus();
  await page.keyboard.press("Enter");
  const mirrorHelpText = root.locator(`#${await mirrorHelp.getAttribute("aria-controls")}`);
  check(await mirrorHelpText.innerText().then((text) => /configuration folder separate/i.test(text) && /queue state/i.test(text) && /Shared Data and Markdown transcripts/i.test(text)), `${label}: Shared mirror help omits separate device configuration guidance`);
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
  await screenshot("reflection-editor");
  await chooseFolder.click();
  await root.locator(".st-output-browser").waitFor();
  await root.getByRole("button", { name: "Choose this folder", exact: true }).waitFor();
  await assertLayout("Output folder picker");
  await screenshot("output-folder-picker");
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await root.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();

  // Open standalone notebook detail and assert actions are outside any collapsed Advanced section.
  await root.locator('article.st-rule-row[role="button"]').filter({ hasText: "Reflection" }).last().click();
  await root.locator(".st-detail-controls").waitFor();
  const detail = root.locator(".st-detail-controls");
  check(await detail.locator(".st-notebook-advanced").count() === 0, `${label}: single-note detail still has a separate Advanced disclosure`);
  const cleanup = detail.getByRole("button", { name: "Clean up document", exact: true });
  const reprocess = detail.getByRole("button", { name: "Re-recognize selected pages", exact: true });
  check(await cleanup.isVisible() && !(await cleanup.evaluate((button) => !!button.closest("details"))), `${label}: cleanup action is not directly visible`);
  check(await reprocess.isVisible() && !(await reprocess.evaluate((button) => !!button.closest("details"))), `${label}: reprocess action is not directly visible`);
  check(!(await cleanup.isDisabled()) && !(await reprocess.isDisabled()), `${label}: complete standalone note cleanup/reprocess action is disabled`);
  const helpLabel = detail.getByRole("button", { name: "Help: Clean up document", exact: true });
  await helpLabel.focus();
  await page.keyboard.press("Enter");
  check(await helpLabel.getAttribute("aria-expanded") === "true", `${label}: document action help is not keyboard-operable`);
  check(await detail.locator(".st-help-text:visible").count() === 1, `${label}: opening one help action expands too much inline text`);
  await assertLayout("Reflection detail");
  await screenshot("reflection-detail-actions");
  const actionCounts = await page.evaluate(() => ({ ...window.__streamlinedFixture.controller.actionCounters }));
  check(actionCounts.cleanupDocument === 0 && actionCounts.reprocessPages === 0 && actionCounts.update === 0, `${label}: synthetic verification invoked an AI or recognition action: ${JSON.stringify(actionCounts)}`);

  // Satsang folder editor, with the folder scope and chooser also available at narrow widths.
  await root.getByRole("button", { name: "Back", exact: true }).click();
  const satsangConfigure = root.locator('button.st-edit[data-config-id="research-source"]');
  check(await satsangConfigure.isVisible(), `${label}: Satsang folder Configure button missing`);
  await satsangConfigure.click();
  await root.locator(".st-form").waitFor();
  check(await root.locator(".st-source-title").innerText() === "Satsang", `${label}: Satsang folder editor did not open`);
  await assertLayout("Satsang folder editor");
  await screenshot("satsang-folder-editor");

  const finalCounters = await page.evaluate(() => ({ ...window.__streamlinedFixture.controller.actionCounters }));
  check(finalCounters.cleanupDocument === 0 && finalCounters.reprocessPages === 0 && finalCounters.update === 0, `${label}: fixture action counters changed unexpectedly: ${JSON.stringify(finalCounters)}`);
  check(errors.length === 0, `${label}: browser errors: ${errors.join("; ")}`);
  check(externalRequests.length === 0, `${label}: fixture attempted external requests: ${externalRequests.join(", ")}`);
  reports.push({ label, viewport, browserErrors: errors, externalRequests, syntheticActionCounts: finalCounters });
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
