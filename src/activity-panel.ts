import { Modal, Plugin, setIcon } from "obsidian";
import type { Controller } from "./types";
// @ts-ignore JavaScript helper shared with focused unit tests.
import { createActivityLog } from "./activity-model.mjs";
import type { createActivityLog as CreateActivityLog } from "./activity-model.mjs";
type ActivityLog = ReturnType<typeof CreateActivityLog>;
export type ActivityIssue = { source: string; label: string; nextAction: string; ruleId?: string; pageId?: string; pageNumber?: number };
const timeLabel = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

class ActivityModal extends Modal {
  private off?: () => void;
  private timer?: number;
  private heading!: HTMLElement;
  private status!: HTMLElement;
  private elapsed!: HTMLElement;
  private log!: HTMLElement;
  private issues!: HTMLElement;

  constructor(app: Plugin["app"], private readonly controller: Controller, private readonly activity: ActivityLog, private readonly onIssue?: (issue: ActivityIssue) => void, private readonly openQueue?: () => void) {
    super(app);
    this.modalEl.addClass("st-activity-modal");
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "Transcript activity" });
    this.status = content.createEl("strong", { cls: "st-activity-status" });
    this.elapsed = content.createEl("p", { cls: "st-caption" });
    this.issues = content.createDiv({ cls: "st-activity-issues" });
    const actions = content.createDiv({ cls: "st-activity-actions" });
    if (this.openQueue) {
      const queue = actions.createEl("button", { text: "Open Queue", cls: "st-button st-text-button" });
      queue.type = "button";
      queue.addEventListener("click", () => { this.close(); this.openQueue?.(); });
    }
    const copy = actions.createEl("button", { text: "Copy log", cls: "st-button st-text-button" });
    copy.type = "button";
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.activity.copyText()).then(() => {
        copy.textContent = "Copied";
        window.setTimeout(() => { if (copy.isConnected) copy.textContent = "Copy log"; }, 1200);
      }).catch(() => { copy.textContent = "Copy unavailable"; });
    });
    const close = actions.createEl("button", { text: "Close", cls: "st-button st-text-button" });
    close.type = "button";
    close.addEventListener("click", () => this.close());
    this.log = content.createDiv({ cls: "st-activity-log" });
    this.off = this.controller.subscribe(() => this.refresh());
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 1000);
  }

  onClose() {
    this.off?.();
    this.off = undefined;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.contentEl.empty();
  }

  private refresh() {
    const state = this.activity.update(this.controller.progress, this.controller.displayStore ?? this.controller.store);
    this.status.textContent = state.status;
    this.elapsed.textContent = state.phase === "Checking"
      ? `${state.checked}/${state.checkTotal} notebooks checked${state.outcome === "running" ? ` · ${formatElapsed(state.elapsedMs)}` : ""}`
      : state.outcome === "running"
        ? state.source ? `${state.source} · ${state.ready}/${state.total} pages ready · ${formatElapsed(state.elapsedMs)}` : `${state.status} · ${formatElapsed(state.elapsedMs)}`
        : state.phase === "Paused" ? "Work is paused"
          : state.phase === "Current" ? "Saved notebooks are current"
            : state.phase === "Needs attention" ? (state.issues.length ? "Review the unresolved items below" : "Open Queue to review the last update")
              : state.phase === "Waiting" ? "Some work is still queued"
                : "No notebook update is running";
    this.issues.empty();
    if (state.issues.length) {
      this.issues.createEl("h3", { text: "Needs attention" });
      for (const issue of state.issues) {
        const row = this.issues.createDiv({ cls: "st-activity-issue" });
        const action = row.createEl(this.onIssue ? "button" : "div", { text: issue.label, cls: this.onIssue ? "st-button st-text-button" : "" });
        if (this.onIssue) {
          (action as HTMLButtonElement).type = "button";
          action.setAttribute("aria-label", `${issue.label}: ${issue.nextAction}`);
          action.addEventListener("click", () => {
            (action as HTMLButtonElement).disabled = true;
            this.close();
            window.setTimeout(() => this.onIssue?.(issue), 0);
          });
        }
        row.createEl("p", { text: issue.nextAction, cls: "st-caption" });
      }
    }
    this.log.empty();
    for (const entry of [...this.activity.entries].reverse()) {
      const row = this.log.createDiv({ cls: "st-activity-row" });
      row.createEl("time", { text: timeLabel(entry.at) });
      const elapsed = formatElapsed(entry.elapsedMs);
      const summary = `${entry.source} · ${entry.ready}/${entry.total} pages · ${elapsed} · ${entry.outcome}${entry.reason ? ` · ${entry.reason}` : ""}`;
      row.createEl("span", { text: summary });
    }
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

export function installActivityPanel(plugin: Plugin, controller: Controller, onIssue?: (issue: ActivityIssue) => void, openQueue?: () => void) {
  if (controller.platform !== "desktop") return;
  const item = plugin.addStatusBarItem();
  item.addClass("st-activity-statusbar");
  item.setAttribute("role", "button");
  item.setAttribute("tabindex", "0");
  item.setAttribute("title", "Transcript activity");
  const icon = item.createEl("span", { cls: "st-activity-statusbar-icon" });
  icon.setAttribute("aria-hidden", "true");
  setIcon(icon, "scan-text");
  const label = item.createEl("span");
  const activity = createActivityLog();
  let modal: ActivityModal | undefined;
  const refresh = () => {
    const state = activity.update(controller.progress, controller.displayStore ?? controller.store);
    label.textContent = `Transcripts · ${state.status}`;
    item.setAttribute("aria-label", `Transcript activity: ${state.status}`);
  };
  const open = () => {
    if (modal?.modalEl.isConnected) return;
    modal = new ActivityModal(plugin.app, controller, activity, onIssue, openQueue);
    modal.open();
  };
  item.addEventListener("click", open);
  item.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  });
  const off = controller.subscribe(refresh);
  refresh();
  plugin.register(() => { off(); modal?.close(); item.remove(); });
}
