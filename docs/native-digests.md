# Save Reader selections as native Digests

Supernote Transcripts 0.15.0, MD Reader 2.2.0, and Supernote Bridge 0.6.0 provide an optional Android workflow for saving selected Reader text as a native Supernote Digest. Transcripts supplies validated notebook/page provenance for managed transcripts; ordinary Markdown selections work without Transcripts. Bridge is a separate Android app and its release is independent of the Transcripts plugin release.

## Requirements and installation

- Obsidian and MD Reader 2.2.0 on a compatible Supernote Android device.
- Supernote Bridge 0.6.0 for native Digest creation and opening saved entries from linked Reader Highlights. Download `Supernote-Bridge-0.6.0.apk` from the [Bridge 0.6.0 release](https://github.com/ofples/supernote-transcripts/releases/tag/bridge-v0.6.0). The app is optional for ordinary Reader use, transcription, and desktop-assisted account pairing.
- For managed transcript selections, Supernote Transcripts 0.15.0 with a matching local `.note` mirror. Its adapter validates the current notebook and page identities before handoff. Hidden page chips do not remove the underlying source anchors or provenance.

This workflow does not depend on Paper. Paper and Sidebar remain separate optional components.

Install or update Bridge in place; do not uninstall an existing signed installation. See the [Bridge build and signing guide](../scripts/subscription-nomad/android/README.md). Transcripts remains at version 0.15.0; Bridge 0.6.0 is a separate release, not a Transcripts plugin update.

## Reader selection actions

Reader offers four primary actions for a selection on Android:

| Action | Result |
| --- | --- |
| **Digest** | Quick Digest. The first use requires a visible, one-time approval in Bridge. The list selected during approval becomes the local Quick Digest default. Later authenticated requests save to that list without an item-by-item confirmation. |
| **Digest with note…** | Opens Bridge's review screen with the selected text, a native Digest-list selector, and an optional user note. Review the destination and text, then explicitly choose **Save Digest**. |
| **Highlight** | Saves or removes a persistent Reader Highlight record. The record is a regular Markdown file under the vault's `Reader Highlights/` folder and syncs through Obsidian Sync. The source transcript is not edited. |
| **Copy** | Copies the selected plain text to the clipboard. |

The selection context menu also has a secondary **Save quote to Obsidian** action. It saves the quote to Reader's configured quote collection; it is separate from the transcript and from native Digest creation.

When a Reader Highlight is associated with a successfully saved Digest, tap the highlight and choose **Open Digest**. Bridge checks that the request has a local saved receipt and that the supplied Digest ID matches that receipt, then opens the entry in the native Digest detail screen. Use the native screen's **Edit** control to change the saved entry. The highlight is a regular Markdown record carried by Obsidian Sync, but the receipt that authorizes opening the native Digest is device-local; a synced highlight on another device may not have a matching local receipt. Bridge does not issue provider reads or writes for this handoff and cannot open arbitrary Digest IDs. A missing or mismatched local receipt is rejected. Removing the Reader Highlight removes its Markdown record only; it does not remove the native Digest.

Quick Digest trust and the Bridge default list are local to the device and are not synchronized. If you revoke a Reader client in Bridge's **Digest settings**, use **Reconnect Quick Digest** in MD Reader settings. This clears that vault's local Quick Digest pairing so the next request can ask Bridge for approval again; it does not erase ordinary Digest receipt status.

For managed transcripts, Bridge stores notebook/page identifiers as provenance. For ordinary Markdown, it stores the vault-relative file and nearby source context. Bridge uses the fixed Supernote provider interface to write and read back a native Manual Entry. It does not make AI requests or edit `.note` files.

## Save and return

For **Digest with note…**, review the excerpt, choose the destination list, optionally add a note, and tap **Save Digest**. Quick Digest requires the separate first-use approval; later authenticated Quick Digest requests use the saved local list. Bridge returns a fixed success, uncertain, or cancelled acknowledgement to Reader. Opening Bridge alone is never proof that a Digest was saved.

Bridge keeps a durable per-request ledger. Reopening a saved deterministic request verifies the prior receipt instead of inserting another row. An unfinished or uncertain provider write blocks retries. A cancelled request can be reviewed and explicitly saved later. Reader also records selection highlights as Markdown independently of the source transcript.

After a verified save with notebook provenance, Bridge offers **Open original notebook** through the existing constrained Notes route. This action was not verified in the final integrated live-check pass. The native Digest source action does not currently navigate back to the notebook: Notes requires an embedded Digest reference in the `.note` file, which this workflow does not write. Native Digest-to-notebook backlink support is unavailable.

## Verification status

Live acceptance on the Nomad verified first-time Quick Digest approval and Reader acknowledgement, reopening that same request without another insert, and a distinct trusted Quick Digest save with Reader acknowledgement. Those Quick Digest checks ran on Bridge 0.5.1; an in-place upgrade to Bridge 0.6.0 preserved the local ledger and Quick Digest trust. On Bridge 0.6.0, a detailed save added a user note and used an existing nondefault Digest list with the default checkbox off. Tapping the associated Obsidian Highlight and choosing **Open Digest** opened the matching entry in the native Knowledge detail screen; **Edit** appended a marker to the synthetic Digest excerpt, and the typed note appeared in the native Keyboard annotation tab. The chosen list remained intact. After testing, all three synthetic Digest entries were individually deleted through the native UI, all associated Reader Highlights were removed, and the synthetic fixture was deleted after a hash guard. The original Reader position and clipboard state were restored. No real Markdown or `.note` source was changed, and no AI request was made.

Automated verification: 28 JVM tests pass, and the Bridge 0.6.0 APK builds and passes signing checks. The verified live checks above cover Quick Digest approval/reuse, detailed save to a nondefault list with a note, and saved-Highlight **Open Digest** plus native editing. The **Open original notebook** handoff has not been live-verified. Native Digest-to-notebook tapping remains unsupported. Native cloud sync, Partner behavior, rename handling, and cross-device resolution are also unverified.

These results apply to the checked app/provider versions and device only; they do not establish behavior across other firmware versions or sync configurations. See [page-link history](../PAGE_LINKS.md) for the separate existing page-chip navigation workflow and its evidence.
