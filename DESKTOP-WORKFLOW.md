# Desktop Cloud Sync and Nomad workflow

New to the setup? Start with the [complete installation and workflow walkthrough](docs/workflow.md), which explains each service, both devices, exclusions, shared settings and page links. This page is a shorter operational reference.

Use the same Obsidian Sync vault for transcripts and shared recognition data. Each device chooses its own local location for original notebooks.

## Desktop setup

1. In **Obsidian Settings → Sync → Excluded folders**, exclude the folder that will contain the Cloud Sync mirror **before downloading or copying notebooks**. For this setup it is `Supernote`. This is an Obsidian Sync exclusion; excluding a folder in the file explorer alone is insufficient.
2. Install and enable **Supernote Cloud Sync** in the desktop vault. Choose that excluded folder as its mirror destination. Sign in to Supernote Cloud and choose the notebooks/folders to download. Keep its separate transcription feature and uploads off when Supernote Transcripts handles recognition.
3. In **Supernote Transcripts**, choose the desktop `.note` files/folders as sources. Keep their logical mirror connections and transcript destinations the same as on the Nomad. Desktop source paths are local to that device.
4. Keep `Supernote Transcripts/Shared Data`, transcript Markdown and reference files included in Obsidian Sync. Prefer `.md` reference/glossary files: a `.txt` reference may be excluded by Sync's attachment-type settings even when its folder is included. Shared data contains recognition results, publication receipts and mirror definitions. It contains no account tokens or API keys.
5. If Cloud Sync is the enabled desktop `.note` viewer, a transcript page chip can open its local notebook at the requested page. This compatibility is verified against the viewer's source; live foreground viewer acceptance remains pending. Without a compatible viewer, Transcripts provides a read-only page preview. Only one plugin should own the `.note` extension.

Cloud Sync downloads original files from Supernote Cloud. Obsidian Sync distributes the resulting Markdown and shared recognition state. Neither sync service performs AI recognition itself.

## Nomad setup and sign-in

The Nomad source is the original notebook under its native `Note` folder, outside the Obsidian vault. Use the same logical mirror connection as desktop. Credentials, workers and automatic/manual execution preferences remain device-local.

For desktop-assisted ChatGPT sign-in:

1. On desktop choose **Connect a Nomad** and leave Obsidian open.
2. On Nomad choose **Discover** beside Desktop address. Both copies of the vault must be syncing; both devices must be on the same Wi-Fi. Discovery reads a short-lived public locator from the vault, then checks its private LAN endpoint. It does not scan the network or sync the pairing code.
3. Enter the temporary code shown on desktop and choose **Connect**. New codes have 20 characters, grouped into five blocks; old 32-character codes remain supported.
4. Complete account approval in the desktop browser. The Nomad stores its own session and can then operate independently.

If discovery finds nothing, wait for Obsidian Sync and try again, or copy the full desktop address including its port. A firewall or Wi-Fi client isolation can prevent the LAN check.

## Recognize, clean up and edit

1. Save handwriting in Native Notes. Sync the device to Supernote Cloud when desktop needs the latest originals, then update the desktop Cloud Sync mirror.
2. Update the notebook in Supernote Transcripts. Only new/changed page fingerprints need recognition; matching saved pages remain reusable. Changing model/quality does not automatically discard earlier recognition.
3. Once all pages are recognized against the current original, choose **Clean up document**. It sends the complete transcript text and reference files in one request using high reasoning. It sends no original page images. The normal option replaces the transcript with a History backup; **Save a separate copy** is optional.
4. Tap an inline page chip to open Native Notes on Nomad or the local Cloud Sync viewer on desktop. The link resolves native page identity against the current notebook rather than trusting an old page number.
5. After handwriting edits, return to Obsidian and update. Only changed pages lose their old cleanup overlay; cleanup on unchanged pages remains. No second whole-document cleanup is automatic.
6. Wait for Obsidian Sync on both devices before checking the other copy. If desktop still has an older original, update Cloud Sync first; the plugin preserves a newer transcript rather than replacing it from a stale source.

Manual edits to generated Markdown use the separate **Resolve edits** workflow. They are preserved as conflicts until explicitly kept or replaced; handwriting changes and Markdown edits are different operations.

## Testing without processing the backlog

Keep the global queue paused and use a notebook-specific operation. Temporarily disable automatic recognition while running an operator test, then pause before restoring that setting. Do not press global Resume merely to test one notebook. API budgets and the local subscription request limit still apply to explicit operations.
