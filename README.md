# Supernote Transcripts

Supernote Transcripts is an Obsidian plugin that reads selected Supernote `.note` notebooks and creates or updates Markdown transcripts using an AI provider you configure. It keeps notebook files as read-only source material. You choose which notebooks to mirror and where to save the Markdown.

This working tree is preparing candidate **0.12.2**. It has not been published; there are no release assets or confirmed public distribution listing, so installation currently requires a local build. See [validation notes](VALIDATION.md) for the distinct build, desktop, and Nomad status.

## Start here

- [Installation](docs/installation.md): requirements, local build, and manual desktop or Nomad installation.
- [User guide](docs/user-guide.md): add notebooks, configure recognition, manage the queue, and maintain transcripts.
- [Troubleshooting](docs/troubleshooting.md): common source, sync, provider, and recovery problems.
- [Screenshots](docs/screenshots/README.md): synthetic examples of the current interface.
- [Project history](HISTORY.md): earlier release notes and development record.

## Important setup choices

Keep original `.note` files in a local source folder. If Obsidian Sync is used, exclude the raw `Supernote/` folder before copying the notebooks into a vault. Use separate Obsidian configuration folders for Nomad and desktop so local source mounts and state are not synchronized over one another. See the [installation guide](docs/installation.md#prepare-notebooks-and-sync-safely).

Recognition can use paid provider capacity. Start paused, select only the notebooks you want, inspect the model, prompt, glossary, quality and estimates, then choose **Update**. Automatic catch-up is optional. The [user guide](docs/user-guide.md#review-costs-and-run-safely) explains estimates, local budgets, pausing, and retries.

The plugin is independent of optional page viewers and themes. Page links can be used without an optional reader; a compatible reader may provide an enhanced view. See [page links](PAGE_LINKS.md) and [component boundaries](INTEGRATION.md).

## Build from source

Use Node.js 22 and npm, matching the project’s CI build environment. From this directory, run:

```sh
npm ci
npm run build
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` into the Obsidian plugin folder `nomad-transcripts/`, then enable **Supernote Transcripts**. See [installation](docs/installation.md) for full steps and platform-specific notes. The Android callback/page-link helper is a separate optional Android application; it is not a Supernote PluginHost SDK package and is not required for ordinary transcript creation.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
