# Troubleshooting

## The plugin does not appear in Community plugins

Confirm the folder is named `.obsidian/plugins/nomad-transcripts/` and contains `main.js`, `manifest.json`, and `styles.css`. Check that Obsidian is version 1.7.2 or later, then reload or restart Obsidian. Rebuild with `npm ci` and `npm run build` if the generated bundle is missing.

## A notebook does not appear or cannot be read

Confirm the path points to an actual local `.note` file or folder and that Obsidian can access it. Cloud placeholders must be downloaded first. On Nomad, check file permissions and the path exposed to Obsidian. For folders, check recursive selection and exclusions. If a file is being updated by the native app or Cloud Sync, wait for synchronization to finish, then run **Update** again.

The plugin’s native source reader is read-only, but other apps can modify originals. Keep a backup of important notebooks. Mixed portrait and landscape pages in one notebook are currently unsupported by the renderer; an oversized read block can also fail. See [validation notes](../VALIDATION.md) for implementation boundaries.

## Nothing is being recognized

Check that provider settings are connected, AI recognition is enabled, the global and source queues are not paused, and the source is enabled. Inspect Queue for a visible failure or saved-state block. Automatic catch-up is off by default for new desktop profiles; use **Update** to run manually. An already paused queue needs an explicit resume.

## A page failed or was interrupted

Failures are shown in Queue and are not retried automatically. Review the reason, then choose **Retry** or **Skip**. An interrupted request may have reached the provider even when no result was returned; local accounting can hold its estimated usage. Avoid repeated retries until you understand the error.

In Careful mode, Queue may show a **Context page** while neighboring images are prepared. That page provides context and is not an extra recognition target. If you pause during image rendering, the current render completes and the plugin stops starting new images. An AI request already in flight may finish.

## Estimates look uncertain or a limit stops work

Estimates are provisional when there is little comparable history. They are guidance, not invoices or provider-enforced ceilings. Check the plugin’s local daily, monthly and per-run budgets, as well as provider-side limits. Subscription-mode local attempt counts do not reveal the account’s remaining subscription quota. Accounting storage errors block new paid work so limits are not bypassed.

## Devices do not show the same sources or queue

Queues, source file paths, provider credentials, execution switches, budgets and pause state are local to each device. Confirm each device uses its own Obsidian configuration folder/profile and that the plugin is installed in that active folder. The local plugin `data.json` and state slots live there; do not copy them between devices. If the same profile/config folder is shared, Obsidian Sync can overwrite device-local mounts or state. Use Obsidian’s [configuration profile settings](https://obsidian.md/help/sync/settings) to keep them separate. Shared mirror settings and page records are vault files, so confirm both devices sync `Supernote Transcripts/Shared Data/` and have a version that supports shared settings. Sync may be delayed. It cannot guarantee exactly-once recognition or simultaneous-write safety; inspect Obsidian conflict copies before choosing which transcript to keep.

## Settings will not save or sync

If the plugin says settings could not be saved on this device, check that the vault and plugin configuration folders are writable and that the device has free storage. Recognition is paused until settings are saved. After correcting storage access, open Sources and choose **Retry Sync**; this retries local persistence and settings publication, without starting recognition. If settings saved locally but could not sync, **Retry Sync** retries publication and does not send recognition. For a **Settings conflict**, choose **Keep this device** or **Use synced settings** only after reviewing which values you want. If a shared record is damaged or a Sync conflict copy remains, preserve the files and resolve the conflict copies before editing that source again.

## A shared page inventory is newer or conflicting

This message means the shared publication history and the local page inventory cannot be safely reconciled. It does not by itself prove that Obsidian Sync is missing or delayed. Different saved recognition versions can need resolution even after all shared page results have arrived. First compare the actual notebook originals on the devices. If this device has an older original, finish its native Supernote Cloud/Cloud Sync update, then choose **Update** or **Resume** to refresh its local page inventory. Matching page counts alone do not prove the originals are the same.

If the local original is already current, inspect the current Markdown and any Obsidian conflict copies. There may be newer or conflicting local transcript text. Preserve edits before choosing a recovery. For an ordinary transcript edit conflict, open notebook details and compare **Your edited version** with **Saved recognition**; choose whether to keep edits in a new mirror or back up edits and restore the generated mirror. For a shared page-inventory conflict, **Force update** is available as a deliberate choice after comparing source versions and settings; it backs up the current transcript and recognition cache but can replace newer shared text or create duplicate requests. See [Force update](user-guide.md#force-update-for-a-notebook-in-conflict).

The update inventory step refreshes changed notebook metadata before AI work: up to two open notebooks on Nomad or four on desktop, with no page-image rendering during that pass. Unchanged reported filesystem revisions reuse their prior inventory. The temporary Sources/Queue page-order and provenance overlay is an in-memory view, not a shared queue.

## A page link has no enhanced view

Page links are optional and work without an MD Reader enhancement. Confirm the source identity and saved page ID still match the local notebook. On Nomad, native Notes navigation requires the separate Supernote login helper app version 0.2.0 or later; check that it is installed if the link does not open Notes. On desktop, a compatible enabled `.note` viewer may handle in-vault notebooks; otherwise Transcripts uses its own read-only page preview, including for external local sources.

## Restore last version is unavailable or the notebook stays paused

The restore action appears only when that notebook has a valid saved restore point. It restores the exact saved Markdown together with its matching recognition snapshot, then pauses the notebook to give you time to review it. The next explicit **Update** checks the current local `.note` file and current settings. If the transcript was edited or a Sync conflict appeared, resolve and preserve the version you want before restoring; the action will stop if it detects that the transcript or settings changed during the operation. Obsidian Sync history can recover vault file versions, but it does not contain the recognition snapshot or provenance stored with the Transcripts restore point.

## Storage cleanup shows no removable files

Open **Settings → Storage → Review storage** and review the counts. Cleanup deliberately keeps current and latest page results, the newest publication, the last restore point and its recognition data, unresolved or unknown notebooks, malformed/conflicting records, active claims and mirrors, newly arrived files, and local account cost records. It only removes safe old files that are no longer referenced. Sources removed from configuration are treated as unknown and retained. Plugin-local `state-a` and `state-b` recovery snapshots are not part of this cleanup. If nothing is marked removable, there is nothing safe for this action to remove.

## Page selection preview is empty or not the text I expected

The preview grid reads device OCR first, then uses a matching cached recognition result if OCR is unavailable. It is a read-only text preview: it does not render page images or make a recognition request. If both sources are empty, the card may have no preview text. Use the original notebook to inspect handwriting; select the page and run **Re-recognize pages** only when you intend to send its image to the configured provider.

## Cleanup cannot remove page comments

Removing page comments is supported only for a separate cleaned copy. Turn on **Save cleaned text as a separate copy** and choose a new Markdown destination. In-place cleanup preserves page references and first saves the previous transcript version. The default cleanup instructions are in plugin settings; additional instructions entered for one run are added only to that run.

## Saved plugin state is blocked

Stop updates. Do not repeatedly click Update or delete plugin state files. Follow the project’s [recovery guide](../RECOVERY.md), which explains how to restore a valid state snapshot from a plugin backup. Recovery changes saved state and should be used only when the plugin explicitly directs you there. If you do not have a known-good backup, preserve the current plugin folder and contact the project maintainer before attempting recovery.

## Remove or update the plugin

Pause updates and let active requests finish. Back up the plugin folder and transcript destination. To update, replace only `main.js`, `manifest.json`, and `styles.css`, then reload Obsidian and confirm the active version. To uninstall, disable and remove the plugin folder from that vault; transcript Markdown and source `.note` files are separate and are not removed by deleting the plugin code. Keep any plugin data or backups you may need before removing the folder.
