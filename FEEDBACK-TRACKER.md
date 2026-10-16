# Current feedback and release checklist

This checklist is cumulative. Later feedback does not replace earlier requests.
Source implementation, fixture checks, installed builds and live verification are separate states.

## Active pass

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
- [ ] Activate Nomad 0.12.0 after its Reflection source-settings form is saved or cancelled. Active version remains 0.11.2, idle and paused.
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
