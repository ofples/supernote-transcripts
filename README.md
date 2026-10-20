# Supernote Transcripts

Supernote Transcripts is an Obsidian plugin that reads selected Supernote `.note` notebooks and creates or updates Markdown transcripts using an AI provider you configure. It keeps notebook files as read-only source material. You choose which notebooks to mirror and where to save the Markdown.

Version **0.16.0** is an early prerelease. Download the Transcripts manual-install ZIP from the [v0.16.0 GitHub release](https://github.com/ofples/supernote-transcripts/releases/tag/v0.16.0). The optional **Supernote Bridge 0.6.1** Android app is distributed separately; download its APK from the [Bridge 0.6.1 release](https://github.com/ofples/supernote-transcripts/releases/tag/bridge-v0.6.1). There is no confirmed Community Plugins listing. See [installation](docs/installation.md) and [validation notes](VALIDATION.md) for setup and build/device verification boundaries.

## Start here

- [End-to-end workflow](docs/workflow.md): how Nomad, desktop Obsidian, Supernote Cloud Sync, and Obsidian Sync fit together.
- [Installation](docs/installation.md): manual ZIP installation on desktop or Nomad, with source-build steps as an alternative.
- [User guide](docs/user-guide.md): add notebooks, configure recognition, manage the queue, and maintain transcripts.
- [Troubleshooting](docs/troubleshooting.md): common source, sync, provider, and recovery problems.
- [Screenshots](docs/screenshots/README.md): synthetic examples of the current interface.
- [Project history](HISTORY.md): earlier release notes and development record.
- [Native Digest workflow](docs/native-digests.md): optional Android handoff from a selected Reader excerpt.

## Important setup choices

Keep original `.note` files in a local source folder. If Obsidian Sync is used, exclude the raw `Supernote/` folder before copying the notebooks into a vault. Sync generated Markdown and `_supernote/Shared Data/` between devices. Use separate Obsidian configuration folders for Nomad and desktop so local source mounts and state are not synchronized over one another. The [end-to-end workflow](docs/workflow.md) explains how this relates to native Supernote Cloud Sync and the optional desktop Cloud Sync plugin.

Recognition can use paid provider capacity. Start paused, select only the notebooks you want, inspect the model, prompt, glossary, quality and estimates, then choose **Update**. Automatic catch-up is optional. The [user guide](docs/user-guide.md#review-costs-and-run-safely) explains estimates, local budgets, pausing, and retries.

The plugin is independent of optional page viewers and themes. Page links can be used without an optional reader; a compatible desktop `.note` viewer may open the selected page, and otherwise Transcripts shows a read-only page preview. See [page links](PAGE_LINKS.md), [Native Digests](docs/native-digests.md), and [component boundaries](INTEGRATION.md).

## Build from source

Most users can install the prerelease ZIP using the [installation guide](docs/installation.md). To build the plugin yourself, use Node.js 22 and npm, matching the project’s CI build environment. From this directory, run:

```sh
npm ci
npm run build
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` into the Obsidian plugin folder `nomad-transcripts/`, then enable **Supernote Transcripts**. See [installation](docs/installation.md) for full steps. Supernote Bridge is a separate Android app for native Notes page links and Digest capture; ordinary reading, transcription and desktop page previews work without it.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
