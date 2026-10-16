# Production readiness review — 0.12.1

Reviewed 16 October 2026. This is a release candidate assessment, not a claim that every device, provider or handwriting format has been validated.

## Issues found and fixed

| Priority | Finding | Fix and evidence |
| --- | --- | --- |
| High | Shared settings could be published before the local Save succeeded. A rejected form could leave another device with settings the user believed were not saved. | Save a deep-cloned local snapshot and publication intent first. Publish only after that save succeeds. Failure-injection tests verify no uncommitted publication, including explicit conflict resolution. |
| High | A failed disk save after receiving remote settings could remain only in memory indefinitely: the next identical refresh did not retry it. | Track pending persistence independently of value equality. Retry before further processing and block recognition until settings are durable. Tests cover failed remote saves and publication acknowledgements, recovery, and zero provider calls. |
| Medium | A transient shared-catalog read error during startup could fail plugin loading instead of exposing a recoverable problem. | Keep the plugin loaded, show the settings issue and block affected work until Retry Sync succeeds. Startup/retry tests pass. |
| Medium | Queue estimates included individually paused and blocked notebooks, overstating work that could run. | Aggregate estimates exclude those notebooks; global Pause still forecasts work after Resume. Explicit notebook/range estimates remain available. Regression tests cover blocked statuses, pauses and settings issues. |
| Medium | Storage and synchronization errors were presented as settings conflicts, offering inappropriate Keep/Use choices. | Fieldless failures use **Settings need attention** with **Retry Sync**. Actual divergent edits retain explicit version choices. Browser checks exercise both states. |
| Medium | Budget recovery actions could appear below the queue sections, away from the stop reason. | Place the reason and **Review Costs** beside the queue overview; check visible bounds in rendered layouts. |
| Medium | A stale-original warning said “retry” without naming an available recovery action. | Direct users to sync the original to this device and choose **Update or Resume on Sources**. Keep the inventory protection: a retry must not force an older original over a newer synced transcript. Live desktop inspection identified the copy gap; the presentation regression test now checks the named action. |
| Medium | Setup guidance did not adequately explain how ordinary Obsidian configuration synchronization can overwrite device-local plugin files. | Require separate desktop/Nomad configuration folders in the installation guide. Portable settings and results synchronize through Shared Data; local configuration/state files must not be copied between device profiles. |
| Low | The repository entry page was mostly development chronology and lacked a complete installation guide. | Add focused installation, user and troubleshooting guides with synthetic screenshots. Preserve the previous README in HISTORY.md and add CI for tests, type checking and builds. |

## Verification boundaries

See [VALIDATION.md](VALIDATION.md) for exact test counts, artifact hashes and installed-version evidence. Screenshots in [the user guide](docs/user-guide.md) use synthetic notebooks and rendered plugin code; they contain no account credentials or personal notes. They do not establish live provider quality.

The pass makes no recognition requests. Fault injection uses mocked providers and local test storage. Live installation checks preserve notes, transcripts, configuration, session and accounting and keep recognition paused.

## Remaining release gates

- Activate and check the final Nomad candidate after the existing source-settings draft is saved or cancelled. Do not discard a user's draft to install an update.
- Verify a real portable source-setting change through Obsidian Sync between the updated desktop and Nomad, then restore it. Mocked reconciliation is not proof of a network transfer.
- Align the desktop Cloud Sync original with the native 2610 Satsang notebook before completing the handwriting-edit → cloud → incremental recognition → transcript Sync workflow. Equal page counts do not prove equal handwriting.
- Finish foreground desktop original-page viewer acceptance and independently verify the requested native page ordinal.
- Provider output quality, broader Android/Obsidian compatibility and public distribution remain separate release acceptance. The manifest's minimum Obsidian version is not evidence that subscription sign-in works without encrypted SecretStorage.

Delayed file synchronization cannot guarantee exactly-once recognition across devices. Limits and accounting are device-local; in-flight requests can finish after Pause. These constraints remain documented rather than hidden behind a production-ready label.

Native Digests integration remains deferred. Public release tags and repository visibility changes are outside this pass.
