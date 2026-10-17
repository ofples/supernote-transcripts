# Current feedback and release checklist

This checklist is cumulative. Later feedback does not replace earlier requests.
Source implementation, fixture checks, installed builds and live verification are separate states.

## Restore, storage, cleanup and page-selection follow-up — 0.13.0 candidate

- [x] Keep a single previous-version restore point per notebook containing exact Markdown and its matching recognition snapshot; expose **Restore last version**, pause the notebook after restoring, and use the current original on a later Update.
- [x] Explain that Obsidian Sync file history complements the Transcripts restore point and recognition provenance.
- [x] Add a conservative Saved data review and cleanup for older tracked transcript/recognition history and old unreferenced page results/publication receipts; preserve current and latest data, the restore point, unresolved/unknown/malformed/conflicting records, claims, mirrors, new files, local cost records, and plugin state recovery snapshots.
- [x] Keep removed-source transcripts and cache as recoverable archive/unknown data.
- [x] Add a read-only page-selection preview grid that prefers device OCR and falls back to matching cached recognition, supports page/range selection, shows the available range, and loads only the visible window without image renders or AI requests.
- [x] Use the same notebook-details icon for standalone notebook sources and notebooks inside folders.
- [x] Keep the overall progress summary compact and put additional status under **Details**; retain the notebook details/action entry point.
- [x] Make the default cleanup prompt configurable, append per-run extra instructions, and allow page-comment removal only in a separate copy while preserving comments in-place.
- [x] Record automated verification separately: 494 tests, TypeScript checking, production build and 767 synthetic visual assertions pass. See [Validation](VALIDATION.md) for live installation/UI evidence.
- [x] Activate 0.13.0 on desktop and Nomad with exact artifact hashes and guarded preservation of configuration, transcripts, recognition state, account session and accounting. Leave recognition paused. Nomad preflight resumed seven requests from its existing automatic queue before Pause; preserve those completed results rather than restoring the earlier backup.

## Notebook actions workflow — 0.12.3

- [x] Keep expanded folder notebook rows compact; move cleanup and page-recognition forms into dedicated workflows reached through details/configuration.
- [x] Open cleanup setup after **Clean up document**, with a per-run model selector, Save as copy and conditional copy path.
- [x] Hide previous cleanup metadata behind Details rather than presenting it inline.
- [x] Apply model overrides to the cleanup request/estimate without changing saved source settings.
- [x] Validate explicit copy destinations before recognition; preserve a colliding file and the paid result if a destination appears during a request.
- [x] Preserve the canonical transcript and publication receipt when saving a separate copy.
- [x] Verify, install and document the workflow update; preserve notes/settings and keep test recognition mocked. Actual Nomad inspection passed; an unexpected desktop draft was left untouched.

## Follow-up fixes — 0.12.2

- [x] Diagnose Careful re-recognition appearing stuck on page 29 using saved screenshot and local attempt records.
- [x] Fix queued groups overwriting the actual rendering page; honor Pause before starting another image and reuse bounded context-image cache.
- [x] Refresh changed notebook inventories in bounded parallel batches before recognition, so all queue counts are current.
- [x] Distinguish missing shared results from existing divergent recognition versions; do not tell users to wait for Sync when it cannot resolve the conflict.
- [x] Add explicit Force update with a clear warning and backup; allow overriding device claims and shared-result waits without bypassing budgets or local storage safety.
- [x] Align fields, selectors, toggles, help buttons and actions consistently across source/global settings; verify actual geometry and update guide screenshots.
- [x] Activate the final combined build on desktop and Nomad with protected data preserved and recognition paused.
- [x] Update validation, illustrated guides and remote repository for the combined follow-up.

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
- [x] Superseded by guarded activation and Source settings verification of Nomad 0.12.2 after the draft was closed.
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
- [x] Superseded by guarded active Nomad 0.12.2 after the user closed the draft; saved settings were preserved.
- [x] Verify the actual Nomad 0.12.2 Source settings and Queue; retain separate desktop and synthetic evidence.
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
