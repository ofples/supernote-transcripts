# Optional integrations and package boundaries

Supernote Transcripts is a standalone Obsidian plugin. It does not require a theme, MD Reader, Sidebar or Cloud Sync. Original `.note` files can come from the device or any supported local desktop source. Core Reading and Live Preview page links are provided by Transcripts itself.

## Component ownership

| Component | Owns | Optional behavior |
| --- | --- | --- |
| Supernote Transcripts | Recognition, references, budgets, queue, managed Markdown, page identity and native notebook links | Offers an adapter to paginated readers; can open a local `.note` viewer when installed |
| Canonical MD Reader fork | Paginated reading, positions, navigation, reader controls and their base styles | Uses Transcripts page chips or Sidebar navigation when their supported hooks are available |
| Paper theme | Appearance and theme fonts | Styles the normal app and installed plugins; no recognition or reader runtime is embedded in the theme |
| Sidebar companion | Optional navigation and reading controls | Uses paginated mode if a compatible reader is installed; otherwise retains normal Markdown navigation |

Each component keeps its own manifest, settings, license and release version. The canonical reader is [ofples/obsidian-md-reader](https://github.com/ofples/obsidian-md-reader). A distribution may pin a verified reader artifact; it must not maintain a second patch pipeline against upstream or silently replace an installed reader.

## Reader page-link API, version 1

An enabled provider exposes `app.plugins.plugins['nomad-transcripts'].pageLinks`:

```ts
interface ReaderPageLinksV1 {
  apiVersion: 1;
  capabilities: readonly ('renderSection' | 'selectionProvenance')[];
  enabled(sourcePath?: string): boolean;
  renderSection(section: {
    element: HTMLElement;
    sourcePath: string;          // vault-relative Markdown file
    markdown: string;            // exact chapter before rendering
    sourceLineMap: (number | null)[]; // zero-based canonical file lines
    component: Component;        // reader-owned Obsidian render lifecycle
    selectionProvenance?: boolean; // request selected-range source mapping
  }): Promise<boolean>;
  // Available only when `selectionProvenance` is listed above. Returns null
  // for ordinary Markdown, or validated notebook/page provenance.
  selectionSource?(request: {
    element: HTMLElement;
    sourcePath: string;          // vault-relative Markdown file
    range: Range;                // cloned selected range
  }): Promise<null | {
    path: string;                // current local .note path
    page: number;                // one-based page
    pageId: string;
    pageIds: string[];
    fileId?: string;             // native notebook FILE_ID when available
  }>;
}
```

The provider validates the managed transcript and canonical source mapping before adding chips. The reader does not parse device paths, call recognition, own credentials or write transcript metadata. Page chips retain inline placement and are applied before pagination, including prefetched chapters.

For Digest selection, Reader requests `selectionProvenance: true` while rendering and calls `selectionSource` only when the provider advertises that capability. Transcripts verifies that a managed transcript's current local notebook and selected text's page identities match its canonical source. The native notebook `FILE_ID` and `PAGEID` values are carried as provenance where available. An adapter that is absent, lacks this capability, or fails cannot supply managed-transcript provenance; Reader must explain how to enable or update Transcripts instead of treating that selection as ordinary Markdown. A `null` result means the file is ordinary Markdown and may use its vault-relative file and quote context without Transcripts. Provenance is available independently of page-chip visibility.

The optional `sourcePath` argument returns effective visibility for that document. Without an argument, `enabled()` remains a compatibility precheck: it is true if the default or a document override enables links. `renderSection` always checks its own document's preference. The provider owns a contextual header button in core Markdown and compatible reader views, beside the optional Sidebar mode control when present. This integration does not require a Sidebar or theme change.

Consumers resolve the optional provider for each render. Version 1 is supported; a structurally compatible older adapter with no `apiVersion` is accepted for existing installations. Unknown versions, missing methods, disabled providers, a false result or an adapter error all fall back to ordinary Obsidian Markdown rendering. Clear partial adapter output before fallback. Ordinary notes remain readable without either the provider or its theme.

An optional `md-reader.refreshTranscriptLinks()` hook invalidates current and prefetched rendering while preserving the reader position. Transcripts notifies it when its adapter becomes available, is removed, or page links are toggled. Missing, malformed or failing refresh hooks must not interrupt core Reading/Live Preview. A reader without this hook remains usable; its decorations are refreshed on its next normal render.

## Theme and settings isolation

Plugin-owned controls must ship their functional layout, contrast and fonts fallback in the plugin. Paper may enhance them through scoped CSS; it must not be the only source of styling needed to use those controls. Missing Paper fonts fall back to the configured reader/theme/system fonts.

Do not copy `data.json`, personal reading positions, vault configuration, API keys or device execution preferences into a package. Suggested e-ink presets are documentation or explicit user choices. Installing a theme must not enable plugins, change provider/model choices or start recognition.

## Release checks

- Verify Transcripts alone in core Reading and Live Preview with a normal theme.
- Verify MD Reader alone, and with Sidebar absent or disabled.
- Verify both together with Paper absent, then with Paper enabled.
- Verify missing, disabled, legacy, incompatible and failing adapters; enable/disable after a reader chapter is open.
- Preserve upstream-reader use: an unmodified reader still renders ordinary Markdown, although its custom pagination may not expose inline notebook chips.
- Verify a bundle pins version, commit, file hashes and license for each optional component, builds offline, and has no installation or user-data side effects.

Source/fixture checks and installed-device checks are separate release gates. This release-preparation pass does not publish a tag, change repository visibility, install components or make AI requests.
