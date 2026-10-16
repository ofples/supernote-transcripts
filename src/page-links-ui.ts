import { editorInfoField, editorLivePreviewField, MarkdownRenderer, MarkdownRenderChild, MarkdownView, TFile, type Component, type Plugin } from "obsidian";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { pageMarkerGroups, pageMarkerTableAnchor, parsePageLinkToken, parsePageMarkers } from "./page-links.mjs";
import { isManagedTranscript } from "./page-navigation";

export type PageLinkOpen = (outputPath: string, pageId: string, displayNumber: number) => Promise<void>;
const refreshPageLinks = StateEffect.define<void>();

export interface ReaderPageLinkSection {
  element: HTMLElement;
  sourcePath: string;
  markdown: string;
  /** One zero-based source-file line per rendered line; null marks inserted separators. */
  sourceLineMap: Array<number | null>;
  component: Component;
}

export interface ReaderPageLinksApi {
  /** Stable cross-plugin contract version. Additive fields do not require a version bump. */
  apiVersion: 1;
  /** Optional features exposed by this API version. */
  capabilities: readonly ["renderSection"];
  enabled(): boolean;
  /** Render a reader chapter with validated chips. Returns false when it is not a managed transcript. */
  renderSection(section: ReaderPageLinkSection): Promise<boolean>;
}

type PluginWithReaderPageLinks = Plugin & { pageLinks?: ReaderPageLinksApi };

function pageButton(number: number, open: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  const label = `p.${number} ↗`;
  const title = `Open notebook page ${number}`;
  button.type = "button";
  button.className = "st-page-link";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = `p.${number} …`;
    button.title = `Opening notebook page ${number}`;
    button.setAttribute("aria-label", `Opening notebook page ${number}`);
    button.setAttribute("aria-busy", "true");
    void open().catch(error => console.error("Could not open Supernote page", error)).finally(() => {
      button.disabled = false;
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.removeAttribute("aria-busy");
    });
  });
  return button;
}

class PageLinkWidget extends WidgetType {
  constructor(private readonly path: string, private readonly pageId: string,
    private readonly number: number, private readonly openPage: PageLinkOpen) { super(); }
  eq(other: PageLinkWidget) {
    return this.path === other.path && this.pageId === other.pageId && this.number === other.number && this.openPage === other.openPage;
  }
  toDOM() { return pageButton(this.number, () => this.openPage(this.path, this.pageId, this.number)); }
  ignoreEvent() { return false; }
}

class PageLinkGroupWidget extends WidgetType {
  constructor(private readonly path: string, private readonly markers: ReturnType<typeof parsePageMarkers>,
    private readonly openPage: PageLinkOpen) { super(); }
  eq(other: PageLinkGroupWidget) {
    return this.path === other.path && this.openPage === other.openPage &&
      this.markers.length === other.markers.length && this.markers.every((marker, i) =>
        marker.pageId === other.markers[i].pageId && marker.number === other.markers[i].number);
  }
  toDOM() {
    const group = document.createElement("span");
    group.className = "st-page-link-group";
    for (const marker of this.markers) group.append(pageButton(marker.number, () => this.openPage(this.path, marker.pageId, marker.number)));
    return group;
  }
  ignoreEvent() { return false; }
}

function sectionElementForGroup(root: ParentNode, sectionStart: number, sectionEnd: number,
  fullLines: string[], group: (ReturnType<typeof pageMarkerGroups>)[number]): HTMLElement | null {
  const line = group.targetLine === null ? null : fullLines[group.targetLine];
  const sectionLines = fullLines.slice(sectionStart, sectionEnd + 1);
  const localLine = group.targetLine === null ? -1 : group.targetLine - sectionStart;
  const selectors = "p,h1,h2,h3,h4,h5,h6,li,td,th";
  const candidates = [
    ...(root instanceof HTMLElement && root.matches(selectors) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(selectors)),
  ];
  if (group.eof && localLine >= 0) {
    const textBlocks = candidates.filter(node => node.matches("p,h1,h2,h3,h4,h5,h6,li,td,th"));
    return textBlocks[textBlocks.length - 1] ?? root.querySelector<HTMLElement>("pre");
  }
  if (line && /^\s*\|/.test(line)) {
    const table = root instanceof HTMLElement && root.matches("table") ? root : root.querySelector("table");
    if (!table) return null;
    const rowOrdinal = sectionLines.slice(0, localLine).filter(value => /^\s*\|/.test(value) &&
      !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value)).length;
    const row = table.querySelectorAll("tr").item(rowOrdinal);
    return row?.querySelector("th,td") ?? null;
  }
  const heading = line?.match(/^\s*(#{1,6})\s+/);
  if (heading) return root.querySelector(`h${heading[1].length}`);
  if (line && /^\s*(?:[-+*]|\d+[.)])\s/.test(line)) {
    const listOrdinal = sectionLines.slice(0, localLine).filter(value => /^\s*(?:[-+*]|\d+[.)])\s/.test(value)).length;
    return root.querySelectorAll("li").item(listOrdinal);
  }
  if (line && /^\s*>/.test(line)) return root.querySelector("blockquote p, blockquote") as HTMLElement | null;
  return candidates.find(node => node.matches("p,h1,h2,h3,h4,h5,h6")) ?? candidates[0] ?? root.querySelector<HTMLElement>("pre");
}

function addInlinePageGroup(target: HTMLElement, group: (ReturnType<typeof pageMarkerGroups>)[number],
  path: string, openPage: PageLinkOpen, append: boolean): void {
  const wrapper = document.createElement("span");
  wrapper.className = "st-page-link-group";
  for (const marker of group.markers) wrapper.append(pageButton(marker.number, () => openPage(path, marker.pageId, marker.number)));
  if (append) target.append(wrapper);
  else {
    const checkbox = Array.from(target.children).find(child => child.matches("input[type=checkbox], .task-list-item-checkbox"));
    if (checkbox) target.insertBefore(wrapper, checkbox.nextSibling);
    else target.insertBefore(wrapper, target.firstChild);
  }
}

async function renderReaderPageLinkSection(plugin: Plugin, onOpen: PageLinkOpen, enabled: () => boolean,
  section: ReaderPageLinkSection): Promise<boolean> {
  if (!enabled() || !section?.element || !section.sourcePath || !section.component || typeof section.markdown !== "string") return false;
  const parts = section.sourcePath.split("/");
  if (section.sourcePath.startsWith("/") || section.sourcePath.includes("\\") ||
      /[\u0000-\u001f]/.test(section.sourcePath) || parts.some(part => !part || part === "." || part === ".." || part.includes(":"))) return false;
  const file = plugin.app.vault.getAbstractFileByPath(section.sourcePath);
  if (!(file instanceof TFile) || file.path !== section.sourcePath || file.extension.toLowerCase() !== "md") return false;
  const canonical = await plugin.app.vault.cachedRead(file);
  if (!isManagedTranscript(canonical)) return false;

  const renderedLines = section.markdown.split(/\r?\n/);
  const sourceLineMap = section.sourceLineMap;
  if (!Array.isArray(sourceLineMap) || sourceLineMap.length !== renderedLines.length) return false;
  const selectedLines = new Set<number>();
  let previousLine = -1;
  for (const line of sourceLineMap) {
    if (line === null) continue;
    if (!Number.isSafeInteger(line) || line < 0 || line <= previousLine) return false;
    selectedLines.add(line);
    previousLine = line;
  }
  const markers = parsePageMarkers(section.markdown);
  if (!markers.length) return false;
  const canonicalMarkers = parsePageMarkers(canonical).filter(marker => selectedLines.has(marker.line));
  const renderedIdentities = markers.map(marker => {
    const sourceLine = sourceLineMap[marker.line];
    return sourceLine === null || sourceLine === undefined ? null : `${sourceLine}\u0000${marker.pageId}\u0000${marker.number}`;
  });
  const canonicalIdentities = canonicalMarkers.map(marker => `${marker.line}\u0000${marker.pageId}\u0000${marker.number}`);
  if (renderedIdentities.some(identity => identity === null) ||
      renderedIdentities.length !== canonicalIdentities.length ||
      renderedIdentities.some((identity, index) => identity !== canonicalIdentities[index])) return false;

  const linkTokens = new Map<string, (typeof markers)[number]>();
  const linkFor = (marker: (typeof markers)[number]) => {
    const token = `${marker.from}-${marker.number}-${linkTokens.size}`;
    linkTokens.set(token, marker);
    return `[p.${marker.number} ↗](obsidian://nomad-transcripts-page-link?token=${encodeURIComponent(token)})`;
  };
  const groups = pageMarkerGroups(section.markdown, markers);
  const groupedMarkers = new Set(groups.flatMap(group => group.markers.map(marker => marker.from)));
  const replacements: Array<{ from: number; to: number; text: string }> = [];
  for (const group of groups) {
    const links = group.markers.map(marker => linkFor(marker)).join(" ");
    // Keep each page chip adjacent to its source block. EOF groups follow the
    // preceding text; other groups occupy the marker's original standalone lines.
    const text = group.eof && group.targetLine !== null ? `\n\n${links}`
      : group.targetLine !== null ? `${links}\n\n` : links;
    replacements.push({ from: group.from, to: group.to, text });
  }
  for (const marker of markers) {
    if (groupedMarkers.has(marker.from)) continue;
    replacements.push({ from: marker.from, to: marker.to, text: linkFor(marker) });
  }
  replacements.sort((a, b) => a.from - b.from || a.to - b.to);
  let rendered = "";
  let offset = 0;
  for (const replacement of replacements) {
    if (replacement.from < offset || replacement.to < replacement.from) return false;
    rendered += section.markdown.slice(offset, replacement.from) + replacement.text;
    offset = replacement.to;
  }
  rendered += section.markdown.slice(offset);

  const fragment = document.createElement("div");
  fragment.dataset.stPageLinksRender = "true";
  await MarkdownRenderer.render(plugin.app, rendered, fragment, section.sourcePath, section.component);
  for (const anchor of Array.from(fragment.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const token = parsePageLinkToken(anchor.getAttribute("href") ?? "") ?? parsePageLinkToken(anchor.getAttribute("data-href") ?? "");
    const marker = token ? linkTokens.get(token) : undefined;
    if (marker) anchor.replaceWith(pageButton(marker.number, () => onOpen(section.sourcePath, marker.pageId, marker.number)));
  }
  // Standalone metadata must not become a paragraph of its own in a paginated
  // reader. Move chip-only paragraphs into adjacent text before it measures.
  for (const paragraph of Array.from(fragment.querySelectorAll<HTMLParagraphElement>("p"))) {
    const nodes = Array.from(paragraph.childNodes);
    if (!nodes.length || !nodes.some(node => node instanceof HTMLElement && node.matches("button.st-page-link")) ||
        !nodes.every(node => node.nodeType === 3 ? !node.textContent?.trim() : node instanceof HTMLElement && node.matches("button.st-page-link"))) continue;
    const next = paragraph.nextElementSibling as HTMLElement | null;
    const previous = paragraph.previousElementSibling as HTMLElement | null;
    const adjacent = next ?? previous;
    if (!adjacent) continue;
    const target = adjacent.matches("p,h1,h2,h3,h4,h5,h6,li,td,th") ? adjacent : adjacent.querySelector<HTMLElement>("li,p,th,td");
    if (!target) continue;
    const wrapper = document.createElement("span");wrapper.className="st-page-link-group";wrapper.append(...nodes);
    if (next) {
      const checkbox=Array.from(target.children).find(child=>child.matches("input[type=checkbox],.task-list-item-checkbox"));
      target.insertBefore(wrapper,checkbox?checkbox.nextSibling:target.firstChild);
    } else target.append(wrapper);
    paragraph.remove();
  }
  section.element.replaceChildren(...Array.from(fragment.childNodes));
  return true;
}

/** Install view-only page chips. Marker comments remain untouched in Markdown. */
export function installPageLinks(plugin: Plugin, onOpen: PageLinkOpen, enabled: () => boolean = () => true): { refresh: () => void } {
  const editorViews = new Set<EditorView>();
  type DecorationState = { source: string; markers: ReturnType<typeof parsePageMarkers>; decorations: ReturnType<RangeSetBuilder<Decoration>["finish"]> };
  const buildDecorations = (state: EditorState, previous?: DecorationState): DecorationState => {
      const source = state.doc.toString();
      const sameSource = previous?.source === source;
      const markers = sameSource ? previous.markers : (isManagedTranscript(source) ? parsePageMarkers(source) : []);
      const builder = new RangeSetBuilder<Decoration>();
      const empty = () => ({ source, markers, decorations: builder.finish() });
      if (state.field(editorLivePreviewField, false) !== true) return empty();
      const path = state.field(editorInfoField, false)?.file?.path;
      if (!path || !enabled() || !markers.length) return empty();
      const selected = (from: number, to: number) => state.selection.ranges.some(range => range.empty
        ? range.head >= from && range.head < to : range.from < to && range.to > from);
      const groups = pageMarkerGroups(source, markers);
      const grouped = new Set(groups.flatMap(group => group.markers.map(marker => marker.from)));
      const items: Array<{ from: number; to: number; marker: (typeof markers)[number]; group?: (typeof groups)[number]; empty?: boolean; anchor?: boolean }> = [];
      const tableAnchors = new Map<number, (typeof groups)[number]>();
      for (const group of groups) {
        if (selected(group.from, group.to)) continue;
        const targetText = group.targetLine === null ? "" : state.doc.line(group.targetLine + 1).text;
        const anchor = targetText.includes("|") ? pageMarkerTableAnchor(source, group, groups) : null;
        if (anchor !== null) {
          items.push({ from: group.from, to: group.to, marker: group.markers[0], empty: true });
          const previous = tableAnchors.get(anchor);
          tableAnchors.set(anchor, previous ? { ...previous, markers: [...previous.markers, ...group.markers] } : group);
          continue;
        }
        items.push({ from: group.from, to: group.to, marker: group.markers[0], group });
      }
      for (const [anchor, group] of tableAnchors) items.push({ from: anchor, to: anchor, marker: group.markers[0], group, anchor: true });
      for (const marker of markers) {
        if (grouped.has(marker.from) || selected(marker.from, marker.to)) continue;
        items.push({ from: marker.from, to: marker.to, marker });
      }
      items.sort((a, b) => a.from - b.from || a.to - b.to);
      let previousTo = -1;
      for (const item of items) {
        if (item.from < previousTo) continue;
        if (item.empty) {
          builder.add(item.from, item.to, Decoration.replace({ inclusive: false }));
          previousTo = item.to;
          continue;
        }
        if (item.anchor) {
          builder.add(item.from, item.to, Decoration.widget({ widget: new PageLinkGroupWidget(path, item.group!.markers, onOpen), side: 1 }));
          continue;
        }
        builder.add(item.from, item.to, Decoration.replace({
          widget: item.group
            ? new PageLinkGroupWidget(path, item.group.markers, onOpen)
            : new PageLinkWidget(path, item.marker.pageId, item.marker.number, onOpen),
          inclusive: false,
        }));
        previousTo = item.to;
      }
      return { source, markers, decorations: builder.finish() };
  };
  const pageLinkField = StateField.define<DecorationState>({
    create: state => buildDecorations(state),
    update(value, transaction) {
      const modeChanged = transaction.startState.field(editorLivePreviewField, false) !== transaction.state.field(editorLivePreviewField, false);
      const fileChanged = transaction.startState.field(editorInfoField, false)?.file?.path !== transaction.state.field(editorInfoField, false)?.file?.path;
      const refreshed = transaction.effects.some(effect => effect.is(refreshPageLinks));
      const selectionChanged = !transaction.startState.selection.eq(transaction.state.selection);
      if (!transaction.docChanged && !selectionChanged && !modeChanged && !fileChanged && !refreshed) return value;
      return buildDecorations(transaction.state, value);
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
  const editorTracker = ViewPlugin.fromClass(class {
    constructor(private view: EditorView) { editorViews.add(view); }
    destroy() { editorViews.delete(this.view); }
  });
  plugin.registerEditorExtension([pageLinkField, editorTracker]);

  const integration: ReaderPageLinksApi = {
    apiVersion: 1,
    capabilities: ["renderSection"],
    enabled,
    renderSection: section => renderReaderPageLinkSection(plugin, onOpen, enabled, section),
  };
  const pluginWithApi = plugin as PluginWithReaderPageLinks;
  const notifyReader = () => {
    const reader = (plugin.app as typeof plugin.app & { plugins?: { plugins?: Record<string, { refreshTranscriptLinks?: () => unknown }> } })
      .plugins?.plugins?.["md-reader"];
    if (typeof reader?.refreshTranscriptLinks !== "function") return;
    try {
      const result = reader.refreshTranscriptLinks();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        void Promise.resolve(result).catch(() => { /* Optional reader notification failed. */ });
      }
    } catch { /* Optional reader notification failed. */ }
  };
  pluginWithApi.pageLinks = integration;
  plugin.register(() => {
    if (pluginWithApi.pageLinks === integration) {
      delete pluginWithApi.pageLinks;
      notifyReader();
    }
  });
  notifyReader();

  plugin.registerMarkdownPostProcessor(async (el, ctx) => {
    if (el.closest("[data-st-page-links-render]") || el.hasAttribute("data-st-page-links-render")) return;
    if (!enabled()) return;
    const section = ctx.getSectionInfo(el);
    if (!section) return;
    let fullSource = section.text;
    if (!isManagedTranscript(fullSource)) {
      if (ctx.frontmatter?.nomad_transcripts !== true) return;
      const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!(file instanceof TFile)) return;
      try { fullSource = await plugin.app.vault.cachedRead(file); } catch { return; }
    }
    if (!isManagedTranscript(fullSource)) return;
    const allMarkers = parsePageMarkers(fullSource);
    if (!allMarkers.length) return;
    const groups = pageMarkerGroups(fullSource, allMarkers);
    const fullLines = fullSource.split(/\r?\n/);
    const startLine = section.lineStart;
    const endLine = section.lineEnd;
    const source = fullLines.slice(startLine, endLine + 1).join("\n");
    if (!source) return;
    const sectionMarkers = allMarkers.filter(marker => marker.line >= startLine && marker.line <= endLine);
    const markerOnlyLines = new Set(groups.flatMap(group => group.markerLines));
    const isMarkerOnlySection = fullLines.slice(startLine, endLine + 1).every((line, index) => {
      if (!line.trim()) return true;
      const globalLine = startLine + index;
      return markerOnlyLines.has(globalLine) && !line.replace(/<!--[ \t]*supernote-page:[^\s]+[ \t]+number:\d+[ \t]*-->/g, "").trim();
    });
    if (isMarkerOnlySection && sectionMarkers.length) {
      const unbound = groups.filter(group => group.targetLine === null && group.markerLines.some(line => line >= startLine && line <= endLine));
      for (const group of unbound) addInlinePageGroup(el, group, ctx.sourcePath, onOpen, false);
      return;
    }
    const groupedLines = new Set(groups.flatMap(group => group.markerLines));
    const inlineMarkers = parsePageMarkers(source).filter(marker => !groupedLines.has(marker.line + startLine));
    const targetGroups = groups.filter(group => group.targetLine !== null && group.targetLine >= startLine && group.targetLine <= endLine);
    if (!inlineMarkers.length && !targetGroups.length) return;
    const linkTokens = new Map<string, (typeof allMarkers)[number]>();
    let renderRoot: ParentNode = el;
    if (inlineMarkers.length) {
      const child = new MarkdownRenderChild(el);
      ctx.addChild(child);
      let rendered = "";
      let offset = 0;
      const replacements: Array<{ at: number; to: number; token: string }> = [];
      for (const marker of inlineMarkers) {
        const token = `${marker.from}-${marker.number}-${linkTokens.size}`;
        linkTokens.set(token, marker);
        replacements.push({ at: marker.from, to: marker.to, token });
      }
      replacements.sort((a, b) => a.at - b.at);
      for (const item of replacements) {
        rendered += source.slice(offset, item.at) + `[p.${linkTokens.get(item.token)!.number} ↗](obsidian://nomad-transcripts-page-link?token=${encodeURIComponent(item.token)})`;
        offset = item.to;
      }
      rendered += source.slice(offset);
      const fragment = document.createElement("div");
      fragment.dataset.stPageLinksRender = "true";
      await MarkdownRenderer.render(plugin.app, rendered, fragment, ctx.sourcePath, child);
      for (const anchor of Array.from(fragment.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        const token = parsePageLinkToken(anchor.getAttribute("href")) ?? parsePageLinkToken(anchor.getAttribute("data-href"));
        const marker = token ? linkTokens.get(token) : undefined;
        if (marker) anchor.replaceWith(pageButton(marker.number, () => onOpen(ctx.sourcePath, marker.pageId, marker.number)));
      }
      const matchingRoot = Array.from(fragment.children).find(node => node.tagName === el.tagName);
      renderRoot = matchingRoot ?? fragment;
      el.replaceChildren(...Array.from(renderRoot.childNodes));
      renderRoot = el;
    }
    for (const group of targetGroups) {
      const target = sectionElementForGroup(renderRoot, startLine, endLine, fullLines, group);
      if (target) addInlinePageGroup(target, group, ctx.sourcePath, onOpen, group.eof);
    }
  });

  return {
    refresh: () => {
      plugin.app.workspace.updateOptions();
      const leaves = plugin.app.workspace.getLeavesOfType("markdown") as unknown as Array<{ view: MarkdownView }>;
      for (const view of editorViews) view.dispatch({ effects: refreshPageLinks.of() });
      for (const leaf of leaves) leaf.view.previewMode.rerender(true);
      notifyReader();
    },
  };
}
