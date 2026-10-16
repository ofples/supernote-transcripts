# Current feedback and release checklist

This checklist is cumulative. Later feedback does not replace earlier requests.
Source implementation, fixture checks, installed builds and live verification are separate states.

## Production readiness pass — 0.12.1

- [x] Commit local settings before publishing; retry failed acknowledgements and remote-import saves before recognition.
- [x] Keep the plugin loaded with actionable recovery after a transient catalog startup error.
- [x] Exclude blocked/individually paused work from aggregate forecasts; retain explicit page/range estimates.
- [x] Separate settings conflicts from storage/sync errors, humanize field names and expose Retry Sync.
- [x] Keep budget stop/recovery controls visible beside the Queue overview.
- [x] Replace vague stale-source retry copy with the original-sync prerequisite and the actual Update/Resume action on Sources.
- [x] Document separate device configuration folders so Sync does not overwrite local source paths/state.
- [x] Add clean installation, provider setup, user and troubleshooting guides with eight synthetic screenshots; retain historical notes.
- [x] Add Node 22 CI and pass 439 tests, TypeScript checking, build and 375 rendered-browser assertions without recognition.
- [x] Install desktop 0.12.1 with notes, state, settings, credentials and accounting preserved.
- [x] Luna visually verify live Sources, Queue, Settings, single-note/folder settings and child controls; cancel drafts and leave recognition paused.
- [x] Stage and readback-verify 0.12.1 on Nomad; preserve the open form and active 0.11.2 code.
- [ ] Activate and visually verify final Nomad 0.12.1 after its source-settings form is saved or cancelled.
- [ ] Verify live source-setting propagation between updated devices and restore the selected test value.

See [the readiness findings](PRODUCTION-READINESS.md) for severity, fixes and remaining release gates.

## Previous source settings and UI pass — 0.12.0

- [x] Keep queue/progress local to each device. Do not build a unified coordinator.
- [x] Implement continuous source model, quality, prompt, glossary, exclusion and destination sync; verify three-way and offline-conflict behavior with fixtures.
- [x] Preserve local source paths, sign-in, execution/automatic settings, pause, concurrency and budgets.
- [x] Resolve conflicting source-setting edits explicitly; never silently overwrite or start paid recognition.
- [x] Refresh shared settings when Sync files arrive and before processing; merge Settings drafts without discarding newly arrived profiles.
- [x] Remove the source-specific recognition bounding box.
- [x] Put long help/descriptions behind accessible question-mark buttons at the end of the relevant row. Keep critical errors, action consequences and estimates readable.
- [x] Flatten Advanced sections containing only one or two items.
- [x] Use consistent padded text-and-icon buttons on desktop; keep compact Nomad controls.
- [x] Align output-folder input and **Choose folder** on one row; preserve existing-folder selection.
- [x] Use one page title, clear section headings and ordinary field labels; remove stacked/redundant headings such as Provider and device options above Shared mirror.
- [x] Apply compact desktop layout to Sources, Queue, Settings, source forms and notebook actions, including narrow windows.
- [x] Make Clean up document and Re-recognize pages reachable for single-note sources and folder children through shared UI. Guard paid actions against unsaved source drafts.
- [x] Remove duplicate separators around notebook operations.
- [x] Default prompts reflow handwriting line wraps and supported page continuations while preserving wording and meaningful structure.
- [x] Preserve existing custom prompts, saved results and re-recognition as an explicit action.
- [x] Run 432 source tests and 264 rendered-browser assertions with zero paid recognition calls.
- [x] Install desktop 0.12.0 with configuration, state, transcripts, sign-in and accounting preserved.
- [x] Verify actual desktop Sources, Queue, Settings, Reflection source form and notebook-action presence. Folder-child flows and wide/Nomad layouts additionally pass the mocked browser checks.
- [x] Stage and hash-verify the same 0.12.0 artifacts on Nomad without replacing active code or discarding its open form.
- [ ] Activate the newer Nomad 0.12.1 candidate after its Reflection source-settings form is saved or cancelled. Active version remains 0.11.2, idle and paused.
- [ ] Verify Nomad when available; do not claim desktop checks establish Nomad behavior.
- [ ] Verify a real source-settings change propagates between the two installed devices, then restore the selected value. Source tests establish logic; live Sync remains a separate gate.

## Existing workflow checks still open

- [ ] Align native and Cloud Sync originals for 2610 Satsang before accepting a conflicting publication. The current desktop source has 39 pages but differs from the received transcript on 12 page fingerprints.
- [ ] Complete the physical handwriting edit → native Cloud upload → desktop source update → incremental recognition → Markdown Sync workflow.
- [ ] Complete foreground desktop page-link viewer verification and remaining live device release checks.

## Release preparation already completed

- [x] Standalone Transcripts, canonical MD Reader and optional Paper/Sidebar boundaries documented and source-checked.
- [x] Paper packages a pinned, hash-verified canonical Reader artifact with an offline build.
- [x] MIT selected and applied to original Paper/Sidebar code; Reader MIT, font OFL and Transcripts GPL notices retained.
- [x] Native Digests integration remains deferred.

No publication, visibility change, release tag or device installation is implied by a checked source item.
