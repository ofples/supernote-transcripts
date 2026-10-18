# Supernote Bridge 0.6.0

Supernote Bridge 0.6.0 is an optional Android companion for MD Reader 2.2.0. It is distributed separately from Supernote Transcripts 0.15.0. See the [Bridge 0.6.0 release page](https://github.com/ofples/supernote-transcripts/releases/tag/bridge-v0.6.0) and the [installation guide](../docs/native-digests.md#requirements-and-installation).

## Open a saved Digest

Tap a Reader Highlight associated with a verified saved Digest and choose **Open Digest**. Bridge accepts only a fixed receipt URI containing the deterministic request ID and asserted Digest row ID. It opens the entry only when the request maps to a device-local `SAVED` receipt and the row ID exactly matches that receipt. It then verifies the expected Knowledge provider permissions/identity and exported native detail activity before launching the exact native component with the row ID. Use the native Digest detail screen's **Edit** control to change the entry. Highlights sync as Markdown records, but the receipt is local to the device, so a synced highlight on another device may not open its Digest. Removing the highlight does not delete the native Digest.

This handoff does not query or mutate provider rows, create a Digest, retry a save, accept caller-provided activity components, or write to a `.note` file. Unknown requests, non-saved receipts, and mismatched row IDs are rejected before launch. Bridge does not check whether the native row still exists; the native app handles a deleted or unavailable entry after a valid launch. Changes happen in the native Digest app's own editor.

## Existing Digest actions

Bridge retains the reviewed **Digest with note…** flow and the enrolled Quick Digest flow. First-time Quick Digest use still requires explicit approval; the selected list becomes the device-local default. Quick Digest trust and list defaults are not synced with the vault. If a client is revoked in Bridge **Digest settings**, use **Reconnect Quick Digest** in Reader settings to clear the Reader's local pairing and request approval again.

Bridge continues to create native Manual Entries through the permissioned provider, retain notebook/source details as reference provenance, and use a local one-shot ledger for duplicate prevention. It does not write Digest backlinks into `.note` files. Native Digest-to-notebook source tapping remains unsupported; **Open original notebook** live verification remains pending.

## Verification status

All 28 JVM tests pass, and the APK build/signature checks pass. Live checks verified detailed save with a user note to a nondefault list, then tapping the associated Obsidian Highlight and choosing **Open Digest** to reach the matching native Digest entry. Native **Edit** changed the synthetic excerpt, and the typed note appeared in the Keyboard annotation tab. First-use Quick Digest approval, same-request reopen without a second insert, and trusted Quick Digest reuse were tested on Bridge 0.5.1; in-place upgrade to 0.6.0 preserved the local ledger and trust. After testing, all three synthetic Digest entries were deleted individually through the native UI, their Reader Highlights were removed, and the fixture was deleted after a hash guard. The original Reader position and clipboard state were restored. No real Markdown or `.note` source was changed, and no AI requests were made. The **Open original notebook** handoff remains unverified; native Digest-to-notebook backlinks are unsupported. See [Native Digests](../docs/native-digests.md) for current workflow and remaining verification limits.
