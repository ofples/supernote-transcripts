# Project guidance

This repository is the Obsidian Supernote Transcripts plugin plus local build, validation, and device-operator scripts. Keep changes focused on the requested files and preserve established plugin data, configuration, callback, and page-link contracts.

## Delegation and review

- Use Luna agents by default for routine implementation, UI/settings changes, documentation, quick device checks, and UI verification.
- Reserve Sol for architecture and correctness work, complex implementation, review, and coordination. Escalate a routine task only when a concrete correctness issue warrants it.
- Give delegated work focused file ownership. Coordinate access to the shared Nomad so only one agent interacts with it at a time. Report whether device evidence came from staged files or active code.

## Privacy and live operations

- Keep credentials, tokens, signing keys, local configs, raw notes, private backups, and private evidence out of tracked source. Root `.gitignore` keeps `private/` and `test-artifacts/` local; do not force-add their contents.
- Tests and validation must not make paid recognition requests unless the user explicitly authorizes them. Prefer fixtures and mocks for UI or provider-shape checks.
- Scripts named for activation, staging, migration, cleanup, reload, recovery, or device state may change a real vault or device. Read them before running and obtain the corresponding user request for installation, note modification, publishing, or destructive recovery.
- Preserve package lockfiles and use npm for this npm project. Do not modify third-party clones or their dependencies as a shortcut.

## Build and test

- Install from the checked-in lockfile with `npm ci`.
- Run `npm test`, `npm run check`, and `npm run build` for relevant production changes. The root `main.js` is a generated build output and remains ignored.
- For Android helper changes, use the project instructions in `scripts/subscription-nomad/android/README.md`. This is an ordinary Android OAuth callback/page-link helper, not a Supernote PluginHost SDK project; do not apply native-plugin package/install procedures to the Obsidian plugin.
- Report build/test evidence separately from live desktop or device verification. Never imply a staged artifact is active code.
