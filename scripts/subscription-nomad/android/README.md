# Nomad open-note helper

This optional Android companion enables transcript page links to open native Notes on a Nomad. Ordinary Markdown reading, AI recognition and desktop-assisted account pairing work without it. It is not the retired `nomad-subscription-test` Obsidian plugin; do not install that test plugin.

## Build and install from source

There is currently no published APK. This step needs an Android development environment; skip it if you only want transcripts for now.

1. Install JDK 17, Gradle 8.13 and Android SDK platform 35 with its build tools. Configure `ANDROID_HOME` for your SDK, or create an ignored `local.properties` with `sdk.dir` pointing to it. This folder does not include a Gradle wrapper.
2. From this directory, run:

   ```sh
   gradle assembleDebug
   ```

3. Find the generated debug APK under `build/outputs/apk/debug/`. With the Nomad's sideloading enabled and a working Android platform-tools connection, install that APK using `adb install -r <path-to-apk>`; substitute the actual generated filename. Approve any device prompt. USB is needed only for this installation method, not ordinary page navigation.
4. Open a managed transcript in Obsidian Reading view, enable notebook page links in Transcripts, and tap **p.N ↗**. The corresponding source must also be configured locally on Nomad. See [page navigation](../../../PAGE_LINKS.md) and the [full workflow](../../../docs/workflow.md).

Android upgrades must use the same signing key as the existing helper. Keep your signing key private and backed up. A signature mismatch is an installation failure, not a reason to erase application state. The native Notes handoff was tested on the firmware recorded in the page-navigation document; compatibility with every firmware version is not guaranteed.

## Integration details

The existing app identity `tools.supernote.logincallback` is shared with the OAuth callback helper. Keep that application ID and signing key stable so upgrades preserve the installed app and its state.

Obsidian can request a note page with:

```text
supernote-transcripts://open-note?file=<percent-encoded-absolute-path>&page=<positive-1-based-page>
```

`OpenNoteActivity` accepts only `ACTION_VIEW` links with that exact scheme and authority, one `file` and one `page` query value, and a positive decimal page. It requires a case-insensitive `.note` path whose canonical location stays below `/storage/emulated/0/Note`, rejects dot segments, controls, backslashes, and encoded separator remnants, then sends only `file_path` and the 1-based `page` to the explicit Supernote Note editor activity. It does not request storage access or read or modify note content. It does not relay arbitrary intents or invoke a shell. Errors stay on the helper screen and contain no path or query data.

The target component and extras match the existing SuperTask `NoteOpenerModule` implementation. Preserve the signing key when upgrading an installed helper.
