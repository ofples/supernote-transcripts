# Nomad open-note helper

The existing app identity `tools.supernote.logincallback` is shared with the OAuth callback helper. Keep that application ID and signing key stable so upgrades preserve the installed app and its state.

Obsidian can request a note page with:

```text
supernote-transcripts://open-note?file=<percent-encoded-absolute-path>&page=<positive-1-based-page>
```

`OpenNoteActivity` accepts only `ACTION_VIEW` links with that exact scheme and authority, one `file` and one `page` query value, and a positive decimal page. It requires a case-insensitive `.note` path whose canonical location stays below `/storage/emulated/0/Note`, rejects dot segments, controls, backslashes, and encoded separator remnants, then sends only `file_path` and the 1-based `page` to the explicit Supernote Note editor activity. It does not request storage access or read or modify note content. It does not relay arbitrary intents or invoke a shell. Errors stay on the helper screen and contain no path or query data.

The target component and extras match the existing SuperTask `NoteOpenerModule` implementation. Build the local debug APK with the Gradle installation and Android SDK already configured on this machine; the default debug signing key must remain the one used by the current installed helper.
