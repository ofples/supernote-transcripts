# Independent components — release preparation

## Candidate versions

| Component | Source | Candidate | Installation boundary |
| --- | --- | --- | --- |
| Supernote Transcripts | `ofples/supernote-transcripts` | 0.12.0 | Standalone plugin; no theme or reader requirement |
| MD Reader fork | `ofples/obsidian-md-reader` | 2.1.2 | Optional pagination; replaces upstream under the same `md-reader` ID |
| Paper | `ofples/obsidian-paper` | 0.5.10 | Optional theme |
| Sidebar | Paper repository, separate plugin | 0.4.1 | Optional navigation; normal Markdown fallback without a reader |

The user-facing package can group these components, while each remains separately selectable. Sidebar is a fourth technical component rather than theme JavaScript.

## Agreed ownership

- Reader implementation and reader-owned styles live in the canonical MD Reader fork.
- Transcripts owns recognition, original notebook navigation and its versioned optional rendering API.
- Paper owns theme appearance and Sidebar. Its distribution consumes a pinned, integrity-checked canonical reader snapshot, with explicit network updates and an offline build.
- A package must not install/enable components automatically or distribute personal settings/reading positions. In particular, it must not overwrite `data.json` or change recognition/provider preferences.

See [the integration contract and fallback matrix](INTEGRATION.md).

## Verified source checks

- Transcripts 0.12.0: 432 tests pass; TypeScript check and production build pass. The rendered-browser checker passes 264 assertions across wide desktop, narrow desktop and Nomad layouts, without outbound requests or recognition.
- Canonical Reader 2.1.2 at `2c05d4b0a8d2ec2dcb3e7be6b553947302efdbe3`: 123 logic and 113 UI checks pass.
- A headless Chromium check combines the actual Reader chapter renderer with the actual Transcripts adapter, without Paper or Sidebar. It checks inline chips, provider unload, disabled and unsupported adapters, and partial-render errors with ordinary Markdown fallback.
- Paper's coordinated source checks: offline build, all pinned Reader hashes, 24 Node tests and 10 synthetic Chromium component/fullscreen combinations pass. These synthetic checks are not live Obsidian or device acceptance.

Run the opt-in combined check with `node scripts/check-optional-reader-integration.mjs`. It uses the sibling reader checkout by default; pass `--reader /path/to/main.js` or set `MD_READER_PATH` to select another candidate. Playwright must be available locally or through `PLAYWRIGHT_MODULE_ROOT`; `CHROME_EXECUTABLE_PATH` can select an installed Chromium browser. These are test tools, not plugin runtime dependencies.

## Release gates

Source and fixture checks cover optional provider absence, disabled/legacy/incompatible adapters, errors and partial rendering, lifecycle refresh and Sidebar failure. They do not establish that a new build is installed or that every theme/device combination has passed visual verification.

Keep public release tags, repository visibility changes and device deployment separate from this preparation. The user selected MIT for Paper/Sidebar's original code on 2026-10-16; the Paper repository owns that license implementation and its distribution notices. MD Reader's MIT attribution, Transcripts' GPL-3.0-or-later and the fonts' SIL OFL notices remain separate.

Desktop Transcripts 0.12.0 is installed and active with preservation checks and live Sources/Queue/Settings/source-form verification. Nomad 0.12.0 files are staged and hash-verified; its active version remains 0.11.2 while a Reflection source-settings form is open. Nomad MD Reader remains 2.1.1. Live settings propagation needs both devices updated and is still pending. The handwriting-edit/native Cloud upload and foreground desktop page-viewer checks from [workflow validation](VALIDATION.md) remain open. See [the cumulative checklist](FEEDBACK-TRACKER.md).
