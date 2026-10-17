# Independent components — release preparation

## Candidate versions

| Component | Source | Candidate | Installation boundary |
| --- | --- | --- | --- |
| Supernote Transcripts | `ofples/supernote-transcripts` | 0.13.1 | Standalone plugin; no theme or reader requirement |
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

- Transcripts 0.13.1: **504/504 tests**, TypeScript checking, production build, and the synthetic browser checker (**855 assertions**) pass. Browser fixtures recorded no errors, external requests or real provider calls. They cover undo, storage collection, OCR selection, selected-page preview and notebook workflows with controlled operations. Desktop and Nomad activation is recorded separately in [Validation](VALIDATION.md). [Readiness findings](PRODUCTION-READINESS.md) document safeguards; [user documentation](docs/installation.md) includes setup and synthetic screenshots.
- Canonical Reader 2.1.2 at `2c05d4b0a8d2ec2dcb3e7be6b553947302efdbe3`: 123 logic and 113 UI checks pass.
- A headless Chromium check combines the actual Reader chapter renderer with the actual Transcripts adapter, without Paper or Sidebar. It checks inline chips, provider unload, disabled and unsupported adapters, and partial-render errors with ordinary Markdown fallback.
- Paper's coordinated source checks: offline build, all pinned Reader hashes, 24 Node tests and 10 synthetic Chromium component/fullscreen combinations pass. These synthetic checks are not live Obsidian or device acceptance.

Run the opt-in combined check with `node scripts/check-optional-reader-integration.mjs`. It uses the sibling reader checkout by default; pass `--reader /path/to/main.js` or set `MD_READER_PATH` to select another candidate. Playwright must be available locally or through `PLAYWRIGHT_MODULE_ROOT`; `CHROME_EXECUTABLE_PATH` can select an installed Chromium browser. These are test tools, not plugin runtime dependencies.

## Release gates

Source and fixture checks cover optional provider absence, disabled/legacy/incompatible adapters, errors and partial rendering, lifecycle refresh and Sidebar failure. They do not establish that a new build is installed or that every theme/device combination has passed visual verification.

The user authorized public repository visibility on 2026-10-16. Public source availability is separate from publishing release tags/assets or a community-plugin listing. The user selected MIT for Paper/Sidebar's original code on 2026-10-16; the Paper repository owns that license implementation and its distribution notices. MD Reader's MIT attribution, Transcripts' GPL-3.0-or-later and the fonts' SIL OFL notices remain separate.

Current installed versions, exact artifact hashes, preservation checks and live UI evidence are recorded in [Validation](VALIDATION.md), separately from source and synthetic checks. Live settings propagation, provider-quality testing of the new pipeline, handwriting-edit/native Cloud upload, and foreground desktop page-viewer checks remain open there. Recognition stays paused after guarded UI updates. See [the cumulative checklist](FEEDBACK-TRACKER.md).
