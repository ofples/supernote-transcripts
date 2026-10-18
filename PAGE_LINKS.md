# Open original notebook pages

Transcripts displays existing `supernote-page` metadata comments as inline **p.N ↗** buttons in standard Obsidian Reading view, Live Preview, and the optional compatible MD Reader adapter. Source Mode leaves the comments editable. The source Markdown is not rewritten and recognition is not requested. The reader adapter verifies each marker against the canonical managed transcript and renders it before pagination, including prefetched chapters; the toggle refresh preserves the reader's place.

In version **0.13.2**, a link icon beside the document's reading/editing control shows or hides page buttons for that document. It appears only for managed transcripts containing page references. Visibility is remembered per file on the current device, and applies to both core Markdown and compatible paginated reading. Paper and Sidebar are optional. The command **Supernote Transcripts: Show or hide notebook page links by default** changes the default for documents without a file-specific preference. Neither control changes source comments or triggers recognition.

The layout attaches standalone markers to the following text block and trailing markers to preceding text. Consecutive markers are grouped, with wrapping for long groups. Reading view places links inside paragraph, heading, list, task and table text without a separate chip paragraph. Live Preview uses editor decorations to collapse marker-only lines. MD Reader retains canonical source-line maps across frontmatter removal, footnote handling and chapter packing; repeated chapter text is resolved by its source range, not by searching for matching text. Existing paragraph boundaries and Markdown block types are retained.

## Use

1. Open an existing generated transcript in standard Reading view or Live Preview, or open it in MD Reader 2.1.1 with the Nomad Transcripts plugin enabled.
2. Tap **p.N ↗** where the original page begins. The button shows a waiting state while the current notebook is checked. On Nomad it opens Notes; on desktop it opens the configured viewer or read-only preview.
3. Return to Obsidian with Android Back or the app switcher on Nomad. Recognition does not need to be running for navigation.

No prompt, model, recognition-quality or sync setting needs changing. In Live Preview, placing the editing cursor inside a marker reveals the original comment; move the cursor away to restore its button. A fresh Nomad installation also needs the matching Android helper. Existing users can upgrade helper package `tools.supernote.logincallback` in place with the same signing certificate.

## Navigation

On the Nomad, tapping a chip resolves the transcript's local notebook mapping, reads its current page index and locates the saved page identity. The old displayed page number is a label, never a fallback target. Unique native PAGEIDs survive page insertions and reordering. Removed pages and ambiguous content-based identities produce an explanation instead of opening an unrelated page.

When a desktop-generated transcript has a different vault path, an exact matching shared publication receipt can bind it to the corresponding local notebook. Each device keeps its own native source paths; Windows paths are never passed to the Notes app. A transcript without a matching local source/receipt needs its mirror configured on the Nomad first.

The plugin launches `supernote-transcripts://open-note?file=...&page=N`. Version 0.2.0 of the existing **Supernote login helper** receives that link and starts the native Notes activity at the resolved, one-based page. The helper package remains `tools.supernote.logincallback`; it is upgraded in place, retaining the existing OAuth callback behavior. It does not require USB, Wi-Fi, a desktop server or AI during normal navigation.

Helper 0.2.0 is the minimum version for page navigation. Version 0.2.1 preserves that route and fixes sign-in retries by replacing the current attempt state and clearing an earlier callback result while keeping one loopback listener. It uses the existing signing certificate and was installed on the Nomad during the 0.10.1 verification. That device pass verified Sources/Queue navigation and source editor open/Cancel; it did not tap a page link after the upgrade, and sign-in retry was not exercised because auth was intentionally held at the saved-account chooser.

The installed helper targets `com.ratta.supernote.note.view.NoteInsidePagesActivity` using `ACTION_VIEW`, `file_path` and the one-based `page` extra. This Android activity handoff is distinct from the native PluginHost SDK's zero-based page APIs. It was verified on Nomad firmware `Chauvet.E103.2609111001.2505_beta`, including a physical chip tap opening native page **3 / 122**.

The helper accepts only the expected scheme/host, a single encoded file and positive integer page, and a canonical `.note` path within `/storage/emulated/0/Note`. It is not a generic intent launcher. It requests no new storage permission and does not read or modify notebook content; Obsidian verifies the source before launch. Native Notes may update ordinary last-viewed metadata when opening a page.

The MD Reader adapter is active on the Nomad with version 2.1.1; desktop Vedas does not have MD Reader installed. Nomad Transcripts 0.11.0 is active on both Nomad and desktop Vedas. Desktop and Nomad live UI checks passed; existing generated Markdown rendered **19/19** enabled chips across 19 groups in MD Reader without error. Activation hashes, protected-state preservation and UI evidence are recorded in the private `device-evidence/2026-10-16/` evidence files. The historical Nomad handoff details above describe the previously installed helper and its verification.

On desktop, the current `.note` is resolved by stable page identity. If an enabled notebook viewer owns an in-vault `.note`, the plugin opens its `#page=N` target. This is source-verified against [Supernote Cloud Sync v1.0.4 (`note-view.ts`)](https://github.com/raaneem/supernote-cloud-sync/blob/442c118803d26714cc77fc2a26bc26210c345cf7/src/viewer/note-view.ts) and [`viewer/state.ts`](https://github.com/raaneem/supernote-cloud-sync/blob/442c118803d26714cc77fc2a26bc26210c345cf7/src/viewer/state.ts), which handle Obsidian's page subpath and navigate via `goToPage`; [Supernote v3.1.3](https://github.com/philips/supernote-obsidian-plugin/blob/855b08b7abd8cca0fb00d590bbddcc66fb36f646/src/main.ts) implements the same page-anchor behavior. This establishes source-level compatibility, not runtime verification: the production Vedas vault does not have the Cloud Sync viewer installed. Runtime behavior with that viewer remains unverified. Otherwise, including for external local notebook paths, the plugin shows a read-only preview of the original page. Desktop navigation does not invoke the native Supernote Notes activity. Standard comments remain usable as provenance when this plugin is absent. Older transcripts with visible page headings but no metadata comments do not acquire stable page links through this feature.

## Reader selections and native Digests (0.15.0)

The optional Reader-to-Digest handoff is separate from these `supernote-page` chips. On Android, MD Reader 2.1.3 can send selected text to Supernote Bridge 0.4.0 for user review and creation as a native Manual Entry. Managed transcripts require a matching local mirror; their page provenance remains available when chip visibility is off. Ordinary Markdown source paths are stored as provenance without claiming a native jump.

Bridge provides an **Open original notebook** action after save. The native Digest app's source action requires an embedded reference in the `.note` file, which Transcripts and Bridge do not modify. Controlled provider creation/readback/native visibility and actual Reader-to-Bridge confirmation/Cancel were verified separately. The complete production Save/acknowledgement/Open-original sequence remains unverified. See [Native Digests](docs/native-digests.md) for boundaries and installation. These notes do not change the earlier page-chip navigation evidence above.

## Checks

Unit checks cover valid/invalid metadata, code blocks, stable-ID reordering, missing/ambiguous pages, revision changes, shared receipt mapping, handle cleanup and URI encoding. Current page-link browser/integration checks pass **5/5** and exercise real DOM placement, canonical chapter mappings, and toggle refresh. No real recognition or cleanup provider call was made.
