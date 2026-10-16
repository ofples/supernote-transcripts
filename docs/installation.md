# Installation

Supernote Transcripts is an Obsidian community plugin package. The plugin ID is `nomad-transcripts`; its manifest requires Obsidian 1.7.2 or later. There are no published release assets or confirmed public listing at this time, so install a local build. BRAT is not a usable installation path for this unpublished package.

## Requirements

- Obsidian 1.7.2 or later. Desktop and Nomad/mobile use the same plugin package; the plugin is not desktop-only.
- A current Obsidian release with encrypted SecretStorage for ChatGPT subscription sign-in. The manifest minimum alone does not guarantee subscription sign-in support. Ordinary API-key mode is separate.
- Node.js 22 with npm to build from source, matching the project’s CI environment. Dependencies and versions are pinned in `package-lock.json`.
- Supernote `.note` files available as local files to Obsidian. Cloud-only placeholders are not readable.
- An AI provider configured in plugin settings only if you want recognition. The plugin does not include provider credentials.

## Build the plugin

In a terminal, open the `nomad-transcripts` project folder and run:

```sh
npm ci
npm run build
```

This generates `main.js` in the project root. The plugin needs these three runtime files in its plugin folder:

```text
main.js
manifest.json
styles.css
```

Do not copy source code, `node_modules`, or the separate Android helper as a substitute for those files. The Android callback/page-link helper under `scripts/subscription-nomad/android/` is an ordinary Android app, not a native Supernote PluginHost SDK plugin. It is optional and only relevant to the helper flows documented separately.

## Install in Obsidian desktop

1. In the vault, create `.obsidian/plugins/nomad-transcripts/`. On Windows, `.obsidian` may be hidden; enter the path directly in Explorer or enable hidden files.
2. Copy `main.js`, `manifest.json`, and `styles.css` from the build into that folder.
3. Open Obsidian and go to **Settings → Community plugins**. Enable **Supernote Transcripts**. If it is missing, reload the app or close and reopen Obsidian.
4. Open the command palette and run **Supernote Transcripts: Open mirrors**. Keep the worker paused while you set up sources and review costs.

## Install on Nomad

Install to the Obsidian vault’s plugin directory on Nomad. Use the same three runtime files from the build, preserving the folder name and plugin ID `nomad-transcripts`.

1. Close the plugin panel and let any active request finish. Pause updates from the plugin first.
2. Connect Nomad to the computer using its supported USB file access, or use the established local device file-transfer workflow. Locate the vault’s `.obsidian/plugins/nomad-transcripts/` folder; hidden folders may require an option in the file browser.
3. Back up the existing plugin folder before replacing the three runtime files. Keep the directory and `data.json` intact; the plugin files are `main.js`, `manifest.json`, and `styles.css`.
4. Safely eject/disconnect, reopen Obsidian on Nomad, and enable the plugin in **Settings → Community plugins** if needed.
5. Open the plugin, confirm the version shown by Obsidian, and leave updates paused until you have reviewed its sources and settings.

Copying files is preparation, not proof that a version is active. Confirm the version shown by Obsidian after reload. A build or staged file copy does not establish Nomad acceptance. Do not use recovery tools as routine installation steps.

## Prepare notebooks and sync safely

Keep native `.note` originals in a local `Supernote/` folder. Before copying notebook files into an Obsidian vault that uses Obsidian Sync, exclude the raw `Supernote/` folder from Sync. Then copy only the notebooks you need into the intended local source folder. This avoids uploading the large and frequently rewritten originals. Confirm the Sync exclusion is active before the copy and verify after Sync that no `Supernote/` paths were uploaded.

The plugin reads its source files without intentionally editing them. The Supernote app or Cloud Sync may update the local original; do not treat an older desktop copy as current until its synchronization is complete. Source paths are local to each device.

Use a separate Obsidian configuration folder for each device, for example `.obsidian` on desktop and `.obsidian-supernote` on Nomad. Configure each installation to use its own profile/configuration folder, and install or update the plugin in that folder. The plugin keeps local source mounts and state slots under the active configuration folder; do not copy `data.json` or `state-a.json`/`state-b.json` between devices. Obsidian Sync settings can synchronize configuration data, so configure its profiles to keep the device-local settings and plugin files in their intended folders. This separation is managed by Obsidian’s vault and Sync configuration; the plugin does not filter arbitrary configuration-folder Sync. See [Obsidian Sync settings](https://obsidian.md/help/sync/settings) for profiles and configuration syncing.

Generated transcript Markdown is saved in the selected vault folder. To make it available across devices, include that destination in Obsidian Sync. For shared cache and same-source coordination, also include `Supernote Transcripts/Shared Data/` and its Markdown files on both devices. Do not exclude or pause Sync for this folder if you rely on it. Sync is delayed file transfer, not a lock service; duplicate work and publication conflicts are possible.

For multiple devices, create or choose the same **Shared mirror** identity for corresponding notebook sources, while selecting each device’s own local source path in its own configuration folder. The shared identity connects portable source settings and page records. It does not share local queues, progress, credentials, provider, account session, budget, automatic-run switch, pause state, or concurrency. Both devices need a version with shared-settings support; after Sync delivers changes, review any explicit conflict choices in Sources.

## First launch

Open **Supernote Transcripts: Open mirrors**, add one small notebook, choose an output folder, and inspect the recognition profile. Keep automatic catch-up off initially and keep the worker paused while checking the model, prompt, glossary, quality and estimated usage. Configure a provider with the [user guide](user-guide.md#connect-a-provider). When ready, unpause and select **Update** for an explicit run.

## Optional companions

Transcripts works independently. An optional compatible MD Reader can enhance page-link display; ordinary Markdown remains available without a reader. Paper and Sidebar are also optional. They are not installed or enabled by Transcripts. See [component boundaries](../INTEGRATION.md) and [page links](../PAGE_LINKS.md). This source-only installation path may be superseded if a public package or release is published later.
