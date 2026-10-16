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

## Estimates look uncertain or a limit stops work

Estimates are provisional when there is little comparable history. They are guidance, not invoices or provider-enforced ceilings. Check the plugin’s local daily, monthly and per-run budgets, as well as provider-side limits. Subscription-mode local attempt counts do not reveal the account’s remaining subscription quota. Accounting storage errors block new paid work so limits are not bypassed.

## Devices do not show the same sources or queue

Queues, source file paths, provider credentials, execution switches, budgets and pause state are local to each device. Confirm each device uses its own Obsidian configuration folder/profile and that the plugin is installed in that active folder. The local plugin `data.json` and state slots live there; do not copy them between devices. If the same profile/config folder is shared, Obsidian Sync can overwrite device-local mounts or state. Use Obsidian’s [configuration profile settings](https://obsidian.md/help/sync/settings) to keep them separate. Shared mirror settings and page records are vault files, so confirm both devices sync `Supernote Transcripts/Shared Data/` and have a version that supports shared settings. Sync may be delayed. It cannot guarantee exactly-once recognition or simultaneous-write safety; inspect Obsidian conflict copies before choosing which transcript to keep.

## Settings will not save or sync

If the plugin says settings could not be saved on this device, check that the vault and plugin configuration folders are writable and that the device has free storage. Recognition is paused until settings are saved. After correcting storage access, open Sources and choose **Retry Sync**; this retries local persistence and settings publication, without starting recognition. If settings saved locally but could not sync, **Retry Sync** retries publication and does not send recognition. For a **Settings conflict**, choose **Keep this device** or **Use synced settings** only after reviewing which values you want. If a shared record is damaged or a Sync conflict copy remains, preserve the files and resolve the conflict copies before editing that source again.

## Transcript differs from the latest notebook

Confirm the native notebook has finished uploading/syncing and that the desktop source points to the updated local original. Then run **Update**. Do not use a potentially stale desktop copy to overwrite newer transcript work. Verify the page count and review changed pages before relying on the output.

If the plugin reports a newer or conflicting shared page inventory, sync the original notebook to this device first. Return to **Sources** and choose **Update** or **Resume**; this checks the source again and can process other eligible queued pages. **Retry page** and forced transcript replacement cannot repair an outdated original.

## A page link has no enhanced view

Page links are optional and work without an MD Reader enhancement. Confirm the source identity and saved page ID still match the local notebook. On Nomad, native Notes navigation requires the separate Supernote login helper app version 0.2.0 or later; check that it is installed if the link does not open Notes. On desktop, a compatible enabled `.note` viewer may handle in-vault notebooks; otherwise Transcripts uses its own read-only page preview, including for external local sources.

## Saved plugin state is blocked

Stop updates. Do not repeatedly click Update or delete plugin state files. Follow the project’s [recovery guide](../RECOVERY.md), which explains how to restore a valid state snapshot from a plugin backup. Recovery changes saved state and should be used only when the plugin explicitly directs you there. If you do not have a known-good backup, preserve the current plugin folder and contact the project maintainer before attempting recovery.

## Remove or update the plugin

Pause updates and let active requests finish. Back up the plugin folder and transcript destination. To update, replace only `main.js`, `manifest.json`, and `styles.css`, then reload Obsidian and confirm the active version. To uninstall, disable and remove the plugin folder from that vault; transcript Markdown and source `.note` files are separate and are not removed by deleting the plugin code. Keep any plugin data or backups you may need before removing the folder.
