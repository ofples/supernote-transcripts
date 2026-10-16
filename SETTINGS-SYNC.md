# Source settings across devices

Version 0.12 shares the recognition settings of a source continuously through ordinary Markdown files in `Supernote Transcripts/Shared Data/Mirrors`. Both devices must use the same Shared mirror identity, and Obsidian Sync must include Shared Data and glossary/reference files.

| Shared source settings | Local device settings |
| --- | --- |
| Model and quality | Provider selection and login/API key |
| Prompt and glossary paths | Native or desktop `.note` source path |
| Endpoint without credentials/query parameters | Automatic recognition and catch-up |
| Recursive selection and exclusions | Source/notebook enable and pause, queue and progress |
| Vault-relative Markdown destination | Workers, intervals, request/spending limits and ledgers |

The files contain no account tokens or API keys. Adding a mirror on another device still requires choosing its local source path. Removing a local source does not delete the other device's source.

Use separate Obsidian configuration folders on desktop and Nomad (for example `.obsidian` and `.obsidian-supernote`). The plugin's `data.json` and state snapshots contain device-local paths and state; ordinary synchronization of the same configuration profile can overwrite them. Do not copy these files between devices. See [installation](docs/installation.md#prepare-notebooks-and-sync-safely) and Obsidian's [settings profiles](https://obsidian.md/help/sync/settings). The portable settings mechanism does not intercept arbitrary synchronization of plugin configuration files.

## Receiving changes

The plugin checks settings after startup, when mirror files arrive/change through Sync, on focus, periodically while open, and before recognition. It applies changes when local recognition is idle. These checks do not send recognition requests or resume a paused queue. An open source draft stays open; stale conflicting edits are checked when saved.

Each binding retains its last agreed portable settings. Independent field edits can merge; conflicting changes show **Keep this device** and **Use synced settings** on Sources. Settings records carry bounded causal history so concurrent offline publications are not mistaken for later sequential changes. Changed records from an older writer without history require an explicit choice. A damaged record or unresolved Sync conflict copy blocks that source's settings changes and recognition, preserving saved results.

Saved changes whose publication fails retain local retry intent. The plugin retries when idle without losing the local edit. Obsidian Sync is delayed and has no cross-device atomic transaction; conflict detection protects observed histories, not instant distributed locking. Update both devices to 0.12 before relying on continuous settings synchronization.

From 0.12.1, local settings must save successfully before publication. A later acknowledgement or remote-import save failure blocks recognition until persistence succeeds, even if the next received settings are identical. **Settings need attention → Retry Sync** retries this work without starting recognition; **Settings conflict** offers version choices only for genuinely divergent values.

## Existing recognition and output

Changing a model, prompt or quality does not automatically recognize historical pages again. **Re-recognize pages** can select a range or pages using outdated settings. New or edited handwriting uses the effective current settings on the device doing the work.

A received destination change updates the source's vault-relative output setting. The next normal update uses the existing guarded output-move/publication flow and cached recognition; receiving settings alone does not move or overwrite Markdown. Explicit per-notebook destination overrides remain local.

Queues, progress bars and accounting describe this device's work. Synced transcript text and immutable page results can be reused by the other device once its local original notebook matches. Different originals must be synchronized separately through native Supernote Cloud/desktop Cloud Sync; equal page counts do not establish equal handwriting.
