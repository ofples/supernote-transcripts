# Supernote Bridge

Supernote Bridge is an optional Android companion for transcript page links, the older direct-browser OAuth loopback callback, and Obsidian Digest capture. Ordinary Markdown reading, AI recognition, and desktop-assisted account pairing work without it. Digest entries can retain a notebook/page as reference provenance; this build does not create embedded `.note` Digest links or claim native Digest page-jump support. Supernote Bridge is not the retired `nomad-subscription-test` Obsidian plugin; do not install that test plugin.

Bridge opens from Obsidian's page-link or Digest action. It does not add a separate launcher icon; its installed name is visible in Android's app settings.

## Build and install from source

Build the local debug APK with an Android development environment; skip this step if you only want transcripts for now.

1. Install JDK 17, Gradle 8.13 and Android SDK platform 35 with its build tools. Configure `ANDROID_HOME` for your SDK, or create an ignored `local.properties` with `sdk.dir` pointing to it. This folder does not include a Gradle wrapper.
2. From this directory, run:

   ```sh
   gradle assembleDebug
   ```

3. Find the generated debug APK under `build/outputs/apk/debug/`. With the Nomad's sideloading enabled and a working Android platform-tools connection, install that APK using `adb install -r <path-to-apk>`; substitute the actual generated filename. Approve any device prompt. USB is needed only for this installation method, not ordinary page navigation.
4. Open a managed transcript in Obsidian Reading view, enable notebook page links in Transcripts, and tap **p.N ↗**. The corresponding source must also be configured locally on Nomad. See [page navigation](../../../PAGE_LINKS.md) and the [full workflow](../../../docs/workflow.md).

Android upgrades must use the same signing key as the existing helper. Keep your signing key private and backed up. A signature mismatch is an installation failure, not a reason to erase application state. The native Notes handoff was tested on the firmware recorded in the page-navigation document; compatibility with every firmware version is not guaranteed.

## Current architecture and integration details

The app keeps the application ID `tools.supernote.logincallback`, existing login and Note routes, and signing identity so upgrades preserve the installed app and its state. The exported `LoginActivity` validates an older direct-browser authorization link and starts `CallbackService`, which accepts the OAuth return on loopback; desktop-assisted account pairing does not use this helper. The exported `OpenNoteActivity` validates transcript links and opens the native Note editor.

The exported `DigestActivity` accepts bounded v1 requests at `supernote-bridge://digest`. The default review flow shows the selected text, a concise source, a native Digest-list selector, and an optional comment before the user saves. It reads only the provider's bounded list route, keeps a chosen list's local unique attribute, and lets the user choose which list Quick Digest uses by default. The `supernote-bridge://digest-settings` route manages that default and revokes trusted Reader clients. After revoking a client, use **Reconnect Quick Digest** in MD Reader settings to clear that vault's local pairing; the next Quick Digest action asks for Bridge enrollment again. A provided notebook/page remains reference provenance; **Open original notebook** uses the existing constrained Note route after a verified save. Digest rows use manual-entry source type and retain notebook IDs only inside `supernote_bridge.note` metadata.

The `supernote-bridge://digest-receipt?request=<64-lowercase-hex>&id=<positive-decimal>` route opens a saved entry from Reader's **Open Digest** tap-menu action on an associated Reader Highlight. Bridge accepts it only when the request resolves to a locally recorded `SAVED` receipt and the supplied row ID exactly matches the saved ID. Unknown requests, non-saved receipts, and mismatched row IDs are rejected before launch. Bridge does not check whether the native row still exists; the native app handles a deleted or unavailable entry after a valid launch. The Reader Highlight is a regular Markdown record that Obsidian Sync can carry, but the receipt is device-local; a synced highlight on another device may not have a receipt that can authorize opening the Digest. Removing the highlight does not delete the native Digest. Bridge validates the known Knowledge provider and exported native detail activity, and launches that exact activity with only `knowledge_id` and `from_app=knowledge`. It does not query, create, update, or delete a provider row on this route. The native Digest screen provides its own **Edit** control.

Quick Digest requires a separate explicit enrollment confirmation on the Bridge. During first enrollment, the selected list becomes the Quick Digest default; **Save once** saves the current item without enrolling the Reader. After enrollment, Reader signs requests with a per-vault secret kept in device-local Reader `localStorage`; that secret is not part of synced Obsidian plugin settings. Bridge keeps its copy in Android Keystore-encrypted app preferences. The Bridge validates the signature, timestamp, vault, and replay ledger before saving without per-item confirmation. Neither copy is written to logs. A quick request that cannot be authenticated or has no valid saved default falls back to review; it never falls back to an unassociated write. The unchanged payload JSON remains the identity input for the request hash and deduplication ledger. The ledger stores request ID, payload hash, status, returned row ID, selected comment, and list association, but never the selected quote text. Existing ledger entries are upgraded in place; legacy receipts retain their original comment verification and skip list-association checks because older ledger rows did not record the selected list.

Every write requires the exact Supernote Knowledge provider component, package and read/write permissions; the provider list query and writes use fixed URIs with no caller-supplied SQL. The Bridge writes at most once per request ID, verifies only the returned row ID and expected row fields before reporting success, and permits only the provider-generated root `unique_identifier` as an extra metadata field. Uncertain writes are not retried. Saved, uncertain, and cancelled outcomes use one fixed Obsidian result URI; the Reader can also confirm an enrolled Quick Digest callback.

Obsidian can request a note page with:

```text
supernote-transcripts://open-note?file=<percent-encoded-absolute-path>&page=<positive-1-based-page>
```

`OpenNoteActivity` accepts only `ACTION_VIEW` links with that exact scheme and authority, one `file` and one `page` query value, and a positive decimal page. It requires a case-insensitive `.note` path whose canonical location stays below `/storage/emulated/0/Note`, rejects dot segments, controls, backslashes, and encoded separator remnants, then sends only `file_path` and the 1-based `page` to the explicit Supernote Note editor activity. It does not request storage access or read or modify note content. It does not relay arbitrary intents or invoke a shell. Errors stay on the helper screen and contain no path or query data.

The target component and extras match the existing SuperTask `NoteOpenerModule` implementation. Preserve the signing key when upgrading an installed helper.
