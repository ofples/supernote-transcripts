# Local scripts

This directory contains project build helpers, offline fixtures, validation utilities, and historical machine-specific operator scripts. It is not a single command-line interface; inspect a script before running it and check its inputs and side effects.

## Normal project checks

From the repository root:

```text
npm test
npm run check
npm run build
```

These run the Node test suite, TypeScript check, and Obsidian bundle build. The build writes the generated root `main.js`, which is intentionally ignored. Test and mock UI scripts are named `check-*`, `build-*-fixture`, or `*-fixture`; read each script for its output paths. Local private inputs and backups live under `private/`, while generated evidence is under `test-artifacts/`. Both directories are ignored by the root `.gitignore`, so their contents remain local.

## Operator and device scripts

Scripts such as `activate-*`, `stage-*`, `preflight-*`, `verify-install-*`, `pause-*`, `reload-*`, `remove-*`, and several `open-*` / `close-*` helpers were written for specific desktop or Nomad sessions. Some target real vaults, plugins, files, settings, network services, or devices; others are read-only. Filenames are not a safety guarantee. Inspect the script and confirm its configured path, vault, device, and effect before use. Do not run installation, note-editing, publishing, or destructive recovery steps without the user's corresponding request. A successful staging step does not prove the staged artifact is active.

`scripts/subscription-nomad/` contains source/build helpers for the desktop-assisted sign-in flow. The sibling `subscription-probe/` is experimental and may perform authentication/network operations; do not invoke it as a routine check. Keep the local helper inputs and outputs in `private/` or `test-artifacts/` as intended; never add credentials, callback URLs containing state, raw notes, or account data to tracked files.

## Android callback and page-link helper

`scripts/subscription-nomad/android/` builds the ordinary Android app `tools.supernote.logincallback`. It handles the OAuth callback used by the plugin and the `supernote-transcripts://open-note` page-link handoff. It is not a PluginHost plugin and does not use the Supernote plugin SDK. Follow [its README](subscription-nomad/android/README.md) and build locally from that directory with:

```text
gradle assembleDebug
```

Use the machine's existing Android SDK and Gradle installation. Preserve the application ID and the debug signing identity so an upgrade remains compatible with the installed helper. The generated APK, Gradle cache, and build tree are ignored. Building does not install the helper; device installation and live verification remain separate actions.

## Keeping this directory tidy

Do not delete or reorganize scripts just because their release has passed; historical operator scripts are retained for traceability. Keep private inputs, backups, temporary browser fixtures, and test evidence in their existing ignored locations. Add a short README entry when a new script family changes the normal build or device workflow.
