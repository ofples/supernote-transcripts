# Source settings across devices

Version 0.12 shares the recognition settings of a source continuously through ordinary Markdown files in `Supernote Transcripts/Shared Data/Mirrors`. Both devices must use the same Shared mirror identity, and Obsidian Sync must include Shared Data and glossary/reference files.

Global defaults are also shared through `Shared Data/Preferences/global-preferences.md`: the General profile's model, endpoint (without credentials or query parameters), prompt, glossary paths, quality and formatting preferences, plus the default cleanup prompt and page-heading preference. These apply to the General profile and future/unbound sources; a source already connected to a Shared mirror keeps that mirror's own profile. Independent field changes merge. Concurrent edits to the same field require an explicit local-or-synced choice. On a first connection with no saved baseline, differing local defaults also require that choice; the plugin does not assume which device's settings should win. Receiving defaults saves settings only; it does not start recognition or change the device's automatic-run or pause state.

| Shared settings | Device-local settings |
| --- | --- |
| Source model, quality, prompt, endpoint without credentials/query parameters, glossary paths, recursive selection, exclusions, source check depth, vault-relative Markdown destination and Digest category name | Provider selection and login/API key or ChatGPT session |
| General profile defaults (model, quality, prompt, endpoint, glossary paths and formatting preferences), cleanup prompt and page-heading preference | Native or desktop `.note` source paths and per-notebook output overrides |
| | Global automatic-run and catch-up switches, source/notebook enable and pause, queue and progress |
| | Workers/concurrency, refresh interval and run mode |
| | Request/spending limits, usage ledgers and support-storage visibility controls |

The shared Markdown files contain no account tokens, API keys or ChatGPT session data. Each device keeps ChatGPT credentials in Obsidian's encrypted device-local Secret Storage. Use the existing **Connect a Nomad** pairing flow to authorize the Nomad from the desktop browser; pairing gives the Nomad its own encrypted session and does not copy or sync desktop tokens. Adding a mirror on another device still requires choosing its local source path. Removing a local source does not delete the other device's source.

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
