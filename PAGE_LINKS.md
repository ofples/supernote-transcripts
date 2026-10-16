# Open original notebook pages

Version 0.9.2 displays existing `supernote-page` metadata comments as small inline **p.N ↗** buttons in Obsidian Reading view and Live Preview. Source Mode leaves the literal comments editable. The source Markdown is not rewritten and recognition is not requested. **Supernote Transcripts: Show or hide notebook page links** toggles the display on this device.

The 0.9.2 layout attaches standalone markers to the following text block and appends trailing markers to the preceding text. Consecutive blank-page markers are grouped, with wrapping for long groups. Reading view places links inside paragraph, heading, list, task and table text without introducing a separate chip paragraph. Live Preview uses direct editor decorations to collapse marker-only lines; a boundary before a block-rendered table can trail the immediately preceding prose or heading. Existing paragraph boundaries and Markdown block types are retained.

## Use

1. Open an existing generated transcript in standard Reading view or Live Preview on the Nomad.
2. Tap **p.N ↗** where the original page begins. The button shows a waiting state while the current notebook is checked, then opens Notes.
3. Return to Obsidian with Android Back or the app switcher. Recognition does not need to be running for navigation.

No prompt, model, recognition-quality or sync setting needs changing. In Live Preview, placing the editing cursor inside a marker reveals the original comment; move the cursor away to restore its button. For a fresh installation, install the matching Android helper as well as the Obsidian plugin. Existing users can upgrade helper package `tools.supernote.logincallback` in place with the same signing certificate.

## Navigation

On the Nomad, tapping a chip resolves the transcript's local notebook mapping, reads its current page index and locates the saved page identity. The old displayed page number is a label, never a fallback target. Unique native PAGEIDs survive page insertions and reordering. Removed pages and ambiguous content-based identities produce an explanation instead of opening an unrelated page.

When a desktop-generated transcript has a different vault path, an exact matching shared publication receipt can bind it to the corresponding local notebook. Each device keeps its own native source paths; Windows paths are never passed to the Notes app. A transcript without a matching local source/receipt needs its mirror configured on the Nomad first.

The plugin launches `supernote-transcripts://open-note?file=...&page=N`. Version 0.2.0 of the existing **Supernote login helper** receives that link and starts the native Notes activity at the resolved, one-based page. The helper package remains `tools.supernote.logincallback`; it is upgraded in place, retaining the existing OAuth callback behavior. It does not require USB, Wi-Fi, a desktop server or AI during normal navigation.

Helper 0.2.0 is the minimum version for page navigation. Version 0.2.1 preserves that route and fixes sign-in retries by replacing the current attempt state and clearing an earlier callback result while keeping one loopback listener. It uses the existing signing certificate and is installed on the Nomad. The current device pass verified Sources/Queue navigation and source editor open/Cancel; it did not tap a page link after the upgrade, and sign-in retry was not exercised because auth was intentionally held at the saved-account chooser.

The installed helper targets `com.ratta.supernote.note.view.NoteInsidePagesActivity` using `ACTION_VIEW`, `file_path` and the one-based `page` extra. This Android activity handoff is distinct from the native PluginHost SDK's zero-based page APIs. It was verified on Nomad firmware `Chauvet.E103.2609111001.2505_beta`, including a physical chip tap opening native page **3 / 122**.

The helper accepts only the expected scheme/host, a single encoded file and positive integer page, and a canonical `.note` path within `/storage/emulated/0/Note`. It is not a generic intent launcher. It requests no new storage permission and does not read or modify notebook content; Obsidian verifies the source before launch. Native Notes may update ordinary last-viewed metadata when opening a page.

This release targets standard Obsidian Reading view and Live Preview. Custom reader plugins may need a rendering adapter; those views are not yet verified.

On desktop, tapping explains that native page navigation is available on Supernote. Standard comments remain usable as provenance when this plugin is absent. Older transcripts with visible page headings but no metadata comments do not acquire stable page links through this feature.

## Checks

Unit checks cover valid/invalid metadata, code blocks, stable-ID reordering, missing/ambiguous pages, revision changes, shared receipt mapping, handle cleanup and URI encoding. A real Nomad test is required to verify the helper handoff and the installed rendering; mock tests alone do not establish this.
