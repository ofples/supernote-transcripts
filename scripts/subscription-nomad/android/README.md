# Supernote Bridge

Supernote Bridge is an optional Android companion for opening transcript page links in native Notes, the older direct-browser OAuth loopback callback, and user-reviewed Obsidian Digest entries. Ordinary Markdown reading, AI recognition, and desktop-assisted account pairing work without it. Digest entries retain an optional notebook/page as reference provenance; native Digest page-jump requires an embedded reference in the `.note` file and is not supported by this build. Supernote Bridge is not the retired `nomad-subscription-test` Obsidian plugin; do not install that test plugin.

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

The app keeps the application ID `tools.supernote.logincallback`, existing login and Note routes, and signing identity so upgrades preserve the installed app and its state. The exported `LoginActivity` validates an older direct-browser authorization link and starts `CallbackService`, which accepts the OAuth return on loopback; desktop-assisted account pairing does not use this helper. The exported `OpenNoteActivity` validates transcript links and opens the native Note editor. The separate exported `DigestActivity` accepts only `supernote-bridge://digest?payload=<percent-encoded JSON>` requests and shows the selected text with a short source label for explicit confirmation. Vault, full paths, context, and notebook IDs are behind **Show Details**. A supplied notebook/page is retained as reference-only provenance, and **Open original notebook** launches the existing constrained Note route after a verified save. Digest rows always use manual-entry source type; notebook identifiers are nested under `supernote_bridge.note`, with no native Note-source fields. The activity validates a bounded v1 payload, requires the exact knowledge provider component/package/permissions, stores request ID and payload hash (never digest text) in a local deduplication ledger, writes once to the fixed insert URI, and verifies only the returned row ID and expected row fields before reporting success. Verification permits only the provider-generated root `unique_identifier` (32 hexadecimal characters) as an extra metadata field while requiring every application-supplied metadata field to match. Uncertain writes are not retried. Successful, uncertain, and cancelled requests return through one fixed Obsidian result URI; cancellation returns automatically after it is recorded locally.

Obsidian can request a note page with:

```text
supernote-transcripts://open-note?file=<percent-encoded-absolute-path>&page=<positive-1-based-page>
```

`OpenNoteActivity` accepts only `ACTION_VIEW` links with that exact scheme and authority, one `file` and one `page` query value, and a positive decimal page. It requires a case-insensitive `.note` path whose canonical location stays below `/storage/emulated/0/Note`, rejects dot segments, controls, backslashes, and encoded separator remnants, then sends only `file_path` and the 1-based `page` to the explicit Supernote Note editor activity. It does not request storage access or read or modify note content. It does not relay arbitrary intents or invoke a shell. Errors stay on the helper screen and contain no path or query data.

The target component and extras match the existing SuperTask `NoteOpenerModule` implementation. Preserve the signing key when upgrading an installed helper.
