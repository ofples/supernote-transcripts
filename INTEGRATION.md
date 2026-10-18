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

### Optional Android Digest actions

MD Reader 2.2.0 exposes **Digest** (Quick Digest) and **Digest with note…** (reviewed save) on Android. **Digest** requires a visible one-time approval in Supernote Bridge 0.6.0; the list selected during approval becomes that device's local Quick Digest default. Later authenticated selections save to that list without a per-item confirmation. The detailed action opens Bridge's review UI with a native list selector and optional user note. Revoke a Reader client in Bridge **Digest settings**, then use **Reconnect Quick Digest** in Reader settings to clear the vault's local client pairing and ask for approval again. Reader trust secrets and Bridge list defaults are device-local and do not sync with the vault.

Reader also provides **Highlight** and **Copy** for selections. Persistent Reader Highlights are regular Markdown records carried by Obsidian Sync; they do not change the source transcript. Removing a highlight removes that Markdown record, not its native Digest. **Save quote to Obsidian** is a secondary action that writes to Reader's quote collection. These actions are separate from native Digest creation. Bridge writes a Manual Entry through the permissioned provider and does not edit `.note` files. Tap a linked saved Highlight and choose **Open Digest**; Bridge checks its device-local `SAVED` receipt and exact row ID, then opens that entry in the exported native Digest detail screen, whose native **Edit** control handles changes. The highlight may sync to another device without its local receipt, so the Digest may not open there. Bridge performs no provider query or write for this handoff. Native Digest-to-notebook source tapping remains unsupported; **Open original notebook** is offered in Bridge after a verified save but is not yet live-verified in the final integrated pass.

Bridge 0.6.0 is distributed separately from Transcripts 0.15.0. Live checks verified Quick Digest approval/reuse, a detailed save with a note to a nondefault list, and the saved-Highlight **Open Digest** route through native detail and Edit. The Quick Digest checks began on Bridge 0.5.1; upgrading in place to 0.6.0 preserved the local ledger and trust. Test Digests and Highlights were removed after testing, with no real Markdown or `.note` source changes. Automated verification includes 28 passing JVM tests and a successful APK build/signature check. The **Open original notebook** handoff remains unverified, and native Digest-to-notebook source tapping is unsupported. See [Native Digests](docs/native-digests.md) for scope and other verification limits.

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
