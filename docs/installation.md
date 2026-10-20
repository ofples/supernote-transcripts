# Installation

Supernote Transcripts is an Obsidian community plugin package. The plugin ID is `nomad-transcripts`; its manifest requires Obsidian 1.7.2 or later. Install version 0.16.0 from the [GitHub prerelease](https://github.com/ofples/supernote-transcripts/releases/tag/v0.16.0). There is no confirmed Community Plugins listing, and BRAT is not a supported installation path.

For the complete Nomad-to-desktop setup, including the roles of both Supernote Cloud Sync and Obsidian Sync, follow the [end-to-end workflow](workflow.md) first.

## Requirements

- Obsidian 1.7.2 or later. Desktop and Nomad/mobile use the same plugin package; the plugin is not desktop-only.
- A current Obsidian release with encrypted SecretStorage for ChatGPT subscription sign-in. The manifest minimum alone does not guarantee subscription sign-in support. Ordinary API-key mode is separate.
- Node.js 22 with npm only if you plan to build from source. Dependencies and versions are pinned in `package-lock.json`.
- Supernote `.note` files available as local files to Obsidian. Cloud-only placeholders are not readable.
- An AI provider configured in plugin settings only if you want recognition. The plugin does not include provider credentials.

## Install the prerelease ZIP

Download `supernote-transcripts-0.16.0.zip` from the [GitHub v0.16.0 release](https://github.com/ofples/supernote-transcripts/releases/tag/v0.16.0) and extract it. The archive contains a `nomad-transcripts` folder with the three plugin runtime files plus its license and notices. Copy that folder into the active vault configuration's `plugins` directory:

- Desktop: `.obsidian/plugins/nomad-transcripts/`
- Nomad: `.obsidian-supernote/plugins/nomad-transcripts/` after setting **Settings → Files and links → Override config folder** to `.obsidian-supernote` and restarting Obsidian.

For an existing installation, back up the plugin folder, then replace only `main.js`, `manifest.json`, and `styles.css`. Keep the folder and its `data.json` intact. Enable or reload **Supernote Transcripts** in **Settings → Community plugins**, then confirm the version shown by Obsidian. Keep updates paused while reviewing sources and settings. The release is an early prerelease.

## Build from source

Download or clone the public [`supernote-transcripts` repository](https://github.com/ofples/supernote-transcripts). A fresh clone uses the repository's default branch. In a terminal, run:

```powershell
git clone https://github.com/ofples/supernote-transcripts.git
cd supernote-transcripts
npm ci
npm run build
```

This generates `main.js` in the project root. Copy these three runtime files from that `supernote-transcripts` folder into the Obsidian plugin folder:

```text
main.js
manifest.json
styles.css
```

Do not copy source code or `node_modules` as a substitute for those files. **Supernote Bridge 0.6.1** is a separate optional Android app for native Notes page links, Reader-to-Digest capture, and opening a linked saved Digest in its native detail screen. Download `Supernote-Bridge-0.6.1.apk` from the [Bridge 0.6.1 release](https://github.com/ofples/supernote-transcripts/releases/tag/bridge-v0.6.1) and open it on the Nomad to install; approve sideloading if prompted. Update an existing helper in place without uninstalling it. Bridge opens from Obsidian rather than adding a launcher icon. Ordinary reading, transcription, and desktop-assisted account pairing do not require it. See the [helper guide](../scripts/subscription-nomad/android/README.md) for source builds and signing compatibility.

## Install in Obsidian desktop

1. In the vault, create `.obsidian/plugins/nomad-transcripts/`. On Windows, `.obsidian` may be hidden; enter the path directly in Explorer or enable hidden files.
2. Copy `main.js`, `manifest.json`, and `styles.css` from the build into that folder.
3. Open Obsidian and go to **Settings → Community plugins**. Enable **Supernote Transcripts**. If it is missing, reload the app or close and reopen Obsidian.
4. Open the command palette and run **Supernote Transcripts: Open mirrors**. Keep the worker paused while you set up sources and review costs.

## Install on Nomad

On Nomad, first set **Settings → Files and links → Override config folder** to `.obsidian-supernote`, then restart Obsidian. Install to that active profile's plugin directory, `.obsidian-supernote/plugins/nomad-transcripts/`. Use the same three runtime files from the build, preserving the folder name and plugin ID `nomad-transcripts`.

1. Close the plugin panel and let any active request finish. Pause updates from the plugin first.
2. Connect Nomad to the computer using its supported USB file access, or use the established local device file-transfer workflow. Locate the vault’s `.obsidian-supernote/plugins/nomad-transcripts/` folder; hidden folders may require an option in the file browser.
3. Back up the existing plugin folder before replacing the three runtime files. Keep the directory and `data.json` intact; the plugin files are `main.js`, `manifest.json`, and `styles.css`.
4. Safely eject/disconnect, reopen Obsidian on Nomad, and enable the plugin in **Settings → Community plugins** if needed.
5. Open the plugin, confirm the version shown by Obsidian, and leave updates paused until you have reviewed its sources and settings.

Copying files is preparation, not proof that a version is active. Confirm the version shown by Obsidian after reload. A build or staged file copy does not establish Nomad acceptance. Do not use recovery tools as routine installation steps.

## Prepare notebooks and sync safely

Keep native `.note` originals in a local `Supernote/` folder. Before copying notebook files into an Obsidian vault that uses Obsidian Sync, exclude the raw `Supernote/` folder from Sync. If the desktop Supernote Cloud Sync plugin writes `.note` files into the vault, exclude that folder before enabling its download/sync. Then keep only the notebooks you need locally for Transcripts. This avoids uploading the large and frequently rewritten originals. Confirm the Sync exclusion is active before the copy and verify after Sync that no raw `Supernote/` paths were uploaded.

The plugin reads its source files without intentionally editing them. The Supernote app or Cloud Sync may update the local original; do not treat an older desktop copy as current until its synchronization is complete. Source paths are local to each device.

Use a separate Obsidian configuration folder for each device, for example `.obsidian` on desktop and `.obsidian-supernote` on Nomad. Configure each installation to use its own profile/configuration folder, and install or update the plugin in that folder. The plugin keeps local source mounts and state slots under the active configuration folder; do not copy `data.json` or `state-a.json`/`state-b.json` between devices. Obsidian Sync settings can synchronize configuration data, so configure its profiles to keep the device-local settings and plugin files in their intended folders. This separation is managed by Obsidian’s vault and Sync configuration; the plugin does not filter arbitrary configuration-folder Sync. See [Obsidian Sync settings](https://obsidian.md/help/sync/settings) for profiles and configuration syncing.

Generated transcript Markdown is saved in the selected vault folder, which defaults to `Supernote Transcripts/`. To make it available across devices, include that destination in Obsidian Sync. For shared cache and same-source coordination, include `_supernote/Shared Data/` and its Markdown files on both devices. The plugin also stores restore points, archives and glossaries under `_supernote/History/`, `_supernote/Archive/` and `_supernote/Glossaries/`; keep these folders synced if you rely on them across devices. Do not exclude or pause Obsidian Sync for these folders. This content is separate from Supernote's native Cloud Sync service and the desktop Supernote Cloud Sync plugin. Sync is delayed file transfer, not a lock service; duplicate work and publication conflicts are possible.

For multiple devices, create or choose the same **Shared mirror** identity for corresponding notebook sources, while selecting each device’s own local source path in its own configuration folder. The shared identity connects portable source settings and page records. It does not share local queues, progress, credentials, provider, account session, budget, automatic-run switch, pause state, or concurrency. Both devices need a version with shared-settings support; after Sync delivers changes, review any explicit conflict choices in Sources.

## First launch

Open **Supernote Transcripts: Open mirrors**, add one small notebook, choose an output folder, and inspect the recognition profile. Keep automatic catch-up off initially and keep the worker paused while checking the model, prompt, glossary, quality and estimated usage. Configure a provider with the [user guide](user-guide.md#connect-a-provider). When ready, unpause and select **Update** for an explicit run.

## Optional companions

Transcripts works independently. MD Reader 2.2.1 is an optional compatible reader that provides selection actions, including Reader Highlights and Android Digest handoff. Supernote Bridge 0.6.1 is a separate optional Android companion for native Digest creation, opening a saved entry from a linked Highlight's tap menu (**Open Digest**, then use native **Edit**), and Notes page links. Highlights sync as Markdown; the Bridge receipt that authorizes opening a Digest is device-local, and removing a Highlight does not remove the native Digest. Neither Reader nor Bridge is required for ordinary Markdown reading or transcription. Paper and Sidebar are also optional; Transcripts does not install or enable them. See [component boundaries](../INTEGRATION.md), [page links](../PAGE_LINKS.md), and [Native Digests](native-digests.md).
