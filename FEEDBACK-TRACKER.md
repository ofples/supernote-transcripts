# Current feedback and release checklist

This checklist is cumulative. Later feedback does not replace earlier requests.
Source implementation, fixture checks, installed builds and live verification are separate states.

## Reader selection actions and native Digest lists — Reader 2.2 / Bridge 0.6.0

- [x] Provide four clear selection actions: Digest, Digest with note, Highlight, and Copy; keep Save quote to Obsidian secondary.
- [x] Require explicit first-use Quick Digest approval, then use a device-local default list; support reviewed notes and list choice.
- [x] Store Reader highlights as ordinary Markdown annotations without editing source transcripts; preserve conservative context matching and duplicate guards.
- [x] Keep the selection dock independent of hidden status bars and make its buttons and gutters safe from page/fullscreen gestures.
- [x] Open a context menu when saved highlighted text is tapped, with Copy, Remove highlight, applicable Digest actions, and a receipt-checked route to the native Digest Edit screen; preserve long-press selection and overlapping excerpts.
- [x] Verify source tests, real Chromium selection/layout regressions, and the helper protocol/build/signature checks.
- [x] Verify all four actions together on the active Nomad build, including first-use and subsequent quick saves, a detailed note/list save, duplicate prevention, and synthetic cleanup.
- [x] Publish Reader 2.2.0 and Bridge 0.6.0 with verified public download hashes; update the optional Paper 0.5.13 bundle with Sidebar 0.4.3 and the exact released Reader runtime.

Native Digest-to-notebook backlinks remain unsupported: the workflow does not alter `.note` files. The separate existing page-link and Bridge Open original notebook routes are documented independently.

## Handwriting formatting and toolbar follow-up — 0.14.0

- [x] Describe the sample's four heading styles, strikethrough, highlights, underlines and hand-drawn tables in the recognition prompt, preserving line reflow and source wording. No extra reference image is attached by default.
- [x] Default formatting On; support source Default/On/Off and editable/inherited visual cues. Preserve saved user instructions and sync effective source settings.
- [x] Exclude generated Page N headings whenever a source's formatting is enabled; retain original-page metadata and navigation chips. Preserve existing formatting during text-only cleanup.
- [x] Hash formatting settings into recognition recipes/provenance, leave existing pages cached until explicitly re-recognized, and include guidance in provisional API estimates.
- [x] Pass 528 source tests and 855 current synthetic UI assertions, plus focused formatting UI inheritance/save checks.
- [x] Run the single user-approved isolated Sol sample test: all four heading levels, strike/highlight/underline and three-column table were correctly returned. Keep output private and outside the vault; preserve the queue and record the single usage entry.
- [x] Stage the frozen desktop 0.14.0 assets while Obsidian is closed; preserve configuration/state/auth.
- [x] Activate the frozen 0.14.0 build on the Nomad without further recognition requests; this records asset activation and preservation checks only.
- [ ] Inspect 0.14.0 formatting settings with a Cancel-only check; this was not completed during the Sidebar verification.
- [x] Install the frozen Paper Sidebar 0.4.2 direct Read/Edit change on the Nomad and verify both physical taps on the Satsang transcript. The initial CSS transfer read back empty and was repaired atomically before final hash and protected-state verification; see [Validation](VALIDATION.md). Reader scrolling settings were not changed, and the Scroll submenu was not inspected.

## Document page-link visibility — 0.13.2

- [x] Add the contextual per-document visibility control beside the mode control, with local persistence and optional Reader/Sidebar support.
- [x] Verify physical MD Reader hide/show on Nomad, 48×48 alignment and ordinary-note hiding; preserve notes and leave recognition paused.
- [ ] Verify core Reading/Live Preview on the physical Nomad; source fixtures cover these paths.

## Preview speed and simplified notebook controls — 0.13.1

- [x] Render original-page previews without fingerprinting unrelated pages; retain revision and selected-content checks, deduplicate pending renders and bound the revision-aware memory cache.
- [x] Reuse current cached device OCR for the selection grid without reopening the notebook; refresh when the original revision changes.
- [x] Move image preview alongside the re-recognition page cards, with immediate loading feedback, inline errors and stale-completion guards.
- [x] Consolidate notebook actions, put restore under History and keep technical details expandable; confirm notebook exclusion before changing the source.
- [x] Simplify output folder browsing to Find; move creation to a separate name prompt reached beside Choose, with validation and Cancel.
- [x] Remove Manage subscription usage from Settings and subscription activity.
- [x] Verify 504 source tests, TypeScript/build and 855 synthetic UI assertions; refresh guides and screenshots. Install final 0.13.1 artifacts on desktop and Nomad, preserving saved results, settings, session and accounting; leave recognition paused. See [Validation](VALIDATION.md) for live checks and the Nomad's pre-existing in-memory queue discrepancy.


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
- [ ] Native Digest-to-notebook source jumps remain an open enhancement. Manual Entry capture is implemented in the current pass below; native jumps require an embedded notebook reference and are not advertised. See the [reader enhancement](https://github.com/ofples/obsidian-md-reader/issues/1).

No publication, visibility change, release tag or device installation is implied by a checked source item.

## Native Digest integration — current implementation pass

- [x] Rename the optional Android helper to **Supernote Bridge**, retaining its package, signing identity and existing sign-in/page routes.
- [x] Verify the native Knowledge provider's permissions and fixed insert/known-ID read routes on Nomad; record the acknowledged labelled synthetic test separately from any unidentified UI records.
- [x] Verify the same test record appears in the native Digest UI; preserve notes and pause recognition throughout.
- [x] Establish the native backlink requirement: the native Digest app requires an embedded notebook Digest reference. Keep that enhancement deferred and retain source provenance without notebook modification.
- [x] Add a Reader selection action with explicit Bridge confirmation, bounded provenance and durable duplicate prevention.
- [x] Keep ordinary Markdown capture independent from Transcripts, Paper and Sidebar; use optional Transcripts provenance for notebook excerpts.
- [x] Keep page provenance usable with hidden chips, chapter packing, repeated text and changed source pages.
- [x] Verify actual Reader-to-Bridge confirmation/Cancel for ordinary and managed Markdown; test acknowledgement and uncertain outcomes with fixtures and document live-test boundaries.
- [x] Exercise one authorized production Save, Reader acknowledgement, same-request reopen and duplicate-prevention check; remove the acknowledged synthetic entry through native Digest UI. The exact search for a previously observed same-phrase Manual Entry returned no results later, so that older row was not deleted and its current status is unresolved. See [Validation](VALIDATION.md).
- [ ] Verify the native Digest quick list and its trusted default behavior with a bounded read-only list inspection; do not log or publish entry labels or IDs.
- [ ] Verify detailed Save with a synthetic note and list, including the highlight-only case.
- [ ] Verify Reader highlight persistence and copy behavior with synthetic text, without creating extra Digest entries.
- [x] Install verified Bridge 0.4.0, Reader 2.1.3 and Transcripts 0.15.0 artifacts on Nomad; preserve configuration, auth, recognition state and accounting, and leave recognition paused.
- [x] Remove the known native test record, temporary Markdown fixture and disposable probe app; leave an unidentified same-text Manual Entry untouched. Restore the original Reader view and document the cleanup boundary.
- [x] Update illustrated installation and Digest guides with the native-backlink limitation and separate live verification evidence.
- [x] Publish the source and preview releases: Transcripts 0.15.0 with Bridge 0.4.0, and Reader 2.1.3. Anonymous ZIP downloads and GitHub asset digests match the frozen builds; Paper's optional bundle update is coordinated separately.
