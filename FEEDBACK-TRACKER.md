# Current feedback and release checklist

This checklist is cumulative. Later feedback does not replace earlier requests.
Source implementation, fixture checks, installed builds and live verification are separate states.

## Shared recognition result hydration — 2610 Reflection 2

- [x] Adopt an exact current shared success for a skipped page during automatic discovery, even when the page is outside the automatic recognition depth. Respect forced retries and excluded sources; preserve the existing edit-conflict guard. Four focused runtime tests pass; TypeScript check and build pass.
- [x] Activate the final bundle on Vedas desktop and verify Nomad's page 58 shared result arrived through normal Sync. Source-only adoption produced 106/106 cached pages, cleared the issue, kept the notebook current, retained both pause states and the six-item queue byte-for-byte, and made zero provider calls or attempts. See [Validation](VALIDATION.md) and `private/investigations/recognition-sync-reflection2.md`.

## Storage paths and folder consolidation — active on desktop and Nomad

- [x] Move plugin support data into `_supernote/Shared Data`, `_supernote/History`, `_supernote/Archive`, and `_supernote/Glossaries`; keep default transcript output directly under `Supernote Transcripts/`.
- [x] Preflight known legacy-path moves, stop on different-content collisions before mutating files, and allow safe retry after interruption. Preserve page edits, caches, publication hashes, notebook identities, and the agreed shared-settings baseline.
- [x] Exclude `_supernote/` from Obsidian Search and Quick Switcher while retaining Sync eligibility. Document folder-consolidation exclusions for existing notebooks, retaining their transcripts and cached results.
- [x] Pass 632 tests, TypeScript checking, and production build on main `d66db9931ee02f016d70068120405f05639c02ed88aa5fb22d44546f8f658156`. Startup handles an absent legacy config setting as unset; migration refuses legacy output moves when affected Reader v1 highlights exist, preventing silent orphaning.
- [x] Preserve paid recognition through support-folder changes, resumable local moves and delayed Sync; protect conflicting copies, late old-root results and archived outputs. Pass 648 unit/mock tests plus TypeScript checking/build on unpublished main `97cbacab…99ce668`.
- [x] Organize settings into Connection, Recognition, Updates, and Storage tabs using the same shared underline style as Sources/Queue with one draft and shared Save/Cancel; add support-folder location/picker and device-local File Explorer/Search/Quick Switcher visibility controls. Keep Costs on the existing `$` action.
- [x] Pass **1,073 synthetic browser assertions** across desktop, narrow desktop, and Nomad-sized views. Verify tab order and keyboard focus/scroll reset, storage picker/toggles/save/cancel, and the two-column Update/Notebook tools button grids with unwrapped labels. No production Obsidian or config was used, with zero external requests and zero recognition calls.
- [x] Install matching-tab final build on desktop and Nomad; verify actual tab styling and hashes. Reflection outputs now use `Supernote Transcripts/Reflections/` on both, retaining transcript bytes, cached recognition and Nomad Reader positions. No provider calls or GitHub publication.
- [x] Install and activate the same v0.15.0 main hash on desktop and Nomad; move the four support folders under `_supernote/` and flatten transcript output. Five readable transcripts remain (four at root, one in Satsang); no `.note` file was modified.
- [x] Consolidate Reflection notebooks into one `reflections` source with a 30-ID map, 4 allowed and 26 excluded. Verify the two original shared identities against the pre-migration IDs, unchanged Nomad cache fields (122/122 current; 61/97 queued), unchanged desktop cache (54 pages / 84 desired), and unchanged queue counts (3 Nomad, 1 desktop).
- [x] Confirm `_supernote/` Sync transport with a temporary unique marker: it arrived on desktop and its deletion replicated. Sync was enabled, ready and error-free on both devices.
- [x] Preserve guard settings: Nomad AI enabled, automatic updates off, unpaused; desktop AI enabled, automatic updates off, pre-existing pause retained. No provider AI, discovery, recognition, or publication.
- [x] Complete final acceptance checks and restore Notes foreground. Desktop Quick Switcher search returned a regular Reflection transcript and no `_supernote/` suggestions. On Nomad, the hook and core command invoked `getSuggestions` without sync errors, but result-level search is unverified because modal queries returned unclassified CDP `Uncaught` errors. Six source hash checks matched their baselines except the canonical desktop mirror, intentionally updated for the consolidated folder map; the current mirror hashes match between devices. The temporary Sync marker replicated and was removed from both vaults. Guard settings were preserved, port forwarding was removed, and there were no provider or recognition calls. The canonical mirror file was copied byte-for-byte from Nomad to desktop with `app.vault.create` after it did not arrive automatically in the bounded window; this copy is not evidence of automatic Sync. Evidence: `private/device-evidence/2026-10-19/cleanup-inventory/final-acceptance-summary.json` and supporting hash checks.

## Sync-record warning — diagnosis still open

- [ ] Identify why the live notebook reports "Shared publication receipt is damaged." The validator currently uses this wording for an invalid/unreadable sync record; it does not establish damage to the original notebook. Read-only device diagnostic attempts did not return the underlying validation failure.
- [x] Preserve the existing records, notebooks and transcripts while investigating; no recovery/deletion was performed and no AI request was made.
- [x] Keep the friendly attention explanation and recovery controls visible directly on the notebook details page, with technical diagnostics optional. Keep source rows compact.
- [x] Let an explicit **Check & update** retry this hold after Sync has caught up, while still rejecting an invalid record and preserving all evidence; mocked regression verifies zero repeated AI calls.
- [ ] Verify the friendly warning and recovery controls on a live attention state. The checked Nomad Details screen had no attention item; the underlying sync-record cause is still unknown.

## Automatic update check modes — source and synthetic UI verified

- [x] Add the global **Automatic checks** slider under Settings → Updates with New pages, Recent edits, and All changes, including the Recent pages count.
- [x] Add source inheritance and per-source overrides; keep them in the normal source draft so Cancel discards them and Save syncs them.
- [x] Document limits in contextual help and show automatic/full check timestamps in notebook Details when available.
- [x] Integrate runtime scan behavior and finish synthetic UI checks for slider positions, inheritance, recent count, save/cancel, timestamps, and help.
- [x] Check notebook-detail action groups, one-shot Check & update targeting, pause controls, and the friendly sync-record attention message in the mocked UI.
- [x] Pass 607 unit/mock tests, TypeScript checking and production build; pass 1,034 synthetic UI assertions across desktop, narrow desktop and Nomad-sized layouts with no external requests or recognition calls.
- [x] Install hash-verified final assets locally on desktop Vedas and Nomad; protected data and queue-state hashes are unchanged. Evidence: `private/device-evidence/2026-10-19/automatic-check-update/installation-evidence.json`.
- [x] Activate the approved v0.15.0 bundle on Nomad and physically verify global slider positions/count, source inheritance/override visibility, Cancel, and the notebook Details action groups and button sizes. No detail action was invoked. Evidence: `private/device-evidence/2026-10-19/automatic-check-live-test/summary.json` and adjacent check JSON files.
- [x] Restore runtime settings after the guarded UI check: AI enabled, automatic updates disabled, unpaused and idle; queue count 3, zero recognition calls, unchanged config and closed forms. Protected data hashes remained unchanged; CDP block was cleared and original Notes activity restored.
- [ ] Activate v0.15.0 by reopening/reloading desktop Obsidian. The sync-record warning was not live-verified because the inspected Details screen had no attention item. No provider AI request or GitHub publication was made.

## Bitmap reading and page order — source verified and installed locally

- [x] Trace repeated Android bitmap progress: each local stream scan starts at byte zero, and inventory previously discarded its index before processing opened the notebook again.
- [x] Identify the misleading repeated bitmap label: per-page device OCR reads reused the previous stage text and rescanned the file for each page after a notebook revision changed.
- [x] Reuse up to four compact page indexes on Nomad and eight on desktop within an update; retain no whole-notebook bitmap buffer or persistent bitmap cache. Reuse validates revision, signature, current footer pointer and metadata hashes; rendering still validates bitmap bytes.
- [x] Read nearby target/context images together where the batch fits eight pages and 16 MiB; preserve individual bitmap and metadata validation and page-local fallback.
- [x] Read device OCR for the selected pages in a combined scan and show the correct OCR-reading status.
- [x] Verify insertion, deletion and reordering reuse records by native page ID and bitmap fingerprint rather than page number.
- [x] Stop higher-priority notebooks waiting on shared claims from starving another notebook through repeated opens. Retire a one-shot request that cannot make progress while preserving its ordinary queue entry.
- [x] Pass 582 unit/mock tests, TypeScript checking and production build on the final source revision.
- [x] Run final source checks and install hash-verified assets on desktop and Nomad, preserving `data.json`, `state-a.json` and `state-b.json` byte-for-byte.
- [ ] Activate by reopening/reloading Obsidian and measure the reported Experiments notebook on device. Anki was left in the foreground; neither desktop nor Nomad Obsidian was reloaded during installation. No real recognition request was made.

OCR is a provisional text aid, not a change fingerprint: it can be absent, stale, or unchanged after a visual edit. No trustworthy per-page modification timestamp was found in the pinned parser's page metadata. File metadata is a freshness hint; actual bitmap hashes remain the content check. Android's streaming fallback can still read a large file prefix, so these changes reduce repeated work without promising true random-access reads.

## One-shot recognition and queue controls — source and synthetic UI verified

- [x] Add a **Recognize now** action for notebook rows and source folders, with exact notebook/folder targeting and duplicate suppression while queued or active.
- [x] Keep one-shot work independent of automatic catch-up and saved pause preferences; show Pause during manual work and preserve pause scope.
- [x] Expand the **Working now** card from its text or caret; keep progress visible while details are collapsed and isolate pause/caret actions.
- [x] Use the standard **?** help control for estimates, keep **Needs attention** always visible, and place Review/Force update together under source progress.
- [x] Remove the duplicate divider when a progress line already separates rows and sections.
- [x] Pass type checking, 582 unit/mock tests, and 966 synthetic Playwright assertions across desktop, narrow desktop, and Nomad-sized mocks, including a fresh synthetic pass against the final combined build.
- [ ] Complete the separate operator’s desktop and Nomad UI verification after the final runtime/build is frozen.

Synthetic screenshot evidence is in `private/ux-streamline/evidence/current-ui/`, including the desktop/Nomad Queue views and expanded Working now card. No live device interaction or recognition request was performed in this UI task.

Final assets were subsequently installed locally on both devices with protected data hashes unchanged; runtime activation and live interaction remain pending. Installation evidence: `private/device-evidence/2026-10-19/manual-queue-update/installation-evidence.json`. No GitHub publication was made.

## Transcript page edit reconciliation — source and local activation complete

- [x] Show an affected-page count in notebook details and provide a dedicated review view.
- [x] Compare the current edited text with new handwriting recognition and an optional proposed edit.
- [x] Require an explicit per-page choice; refresh stale comparisons before another choice.
- [x] Verify the focused runtime tests and synthetic browser layouts.
- [x] Activate the local plugin in desktop Vedas and Nomad while preserving existing state.
- [ ] Exercise an actual in-app page conflict and user choice on device.

Appending pages are kept automatically and only those pages are sent for recognition. Existing Markdown corrections and `==highlight==` markup stay separate from the raw recognition cache. When an existing page image changes, its recognition request includes the old recognition and edited text in that same request; this adds input tokens but starts no extra automatic request and remains within existing budgets and output caps. Unsafe or missing page metadata, or removal of a page with edits, uses the backed-up **Resolve edits** or **Force update** recovery flow. The page review itself makes no AI calls and saves a restore point before each explicit choice.

Source verification: 558 unit/mock tests pass; type checking and build pass; the synthetic browser checker passes 882 assertions, and Reader's browser suite passes 63 checks. Transcripts 0.15.0 is active locally in desktop Vedas and on Nomad: `main.js` SHA-256 `6d43b4c162e6101bb1211b3ba279fb82d5ca3bf06d0add80e176a7e802efa1bb`, `styles.css` SHA-256 `15a09c2a685521e0f1bb81e4188c8849f10e8b6e3802c96a98e18d421b31c82b`; the manifest was unchanged. Reader main SHA `f8df3cb69a815e73d5e9243d3096d703c46b232b0fe68907267ac8246f41c452` is active on Nomad; Reader is not installed on desktop. Protected settings and `data.json`, `state-a`, and `state-b` were preserved byte-for-byte during activation; both Transcripts copies remained paused and idle with zero AI calls and no open forms. On Nomad, the Satsang page 15 Markdown, anchors and screen position were preserved. No in-app conflict choice was performed, and no real-provider semantic reconciliation was tested; the 882 assertions are synthetic browser checks. Private activation evidence: `private/device-evidence/2026-10-18/reconciliation-update-activation/desktop-activation-evidence.json` and `private/device-evidence/2026-10-18/reconciliation-update-activation/nomad-activation-evidence.json`. No GitHub push, release, tag, or commit was made.

## Reader selection responsiveness — current follow-up

- [x] Wait for pen/pointer-up before showing Reader selection controls.
- [x] Keep one selection surface visible at a time; hide the selection dock while its context menu is open.
- [x] Avoid text/range work during an active drag, and do not use a chapter index when no highlight records exist.

Status: source fix complete. Node syntax and Digest fixtures pass. Browser verification: 62 Chromium reading checks pass, including held-pen controls remaining hidden with zero snapshots until pointer-up, one snapshot after pointer-up, cancellation clearing the range, context-menu/dock exclusivity, and no text-index walk when there are no highlight records. Local Nomad activation and simulated DOM PointerEvent checks passed on active Reader main SHA `7e4545f8e5e9f29829c919e1e7b0a62b124348d3a9f2660d8f472fbfd691de41`; manifest and styles remained unchanged. On-device simulation showed the dock hidden while the pen gesture was held, four actions after pointer-up, and the dock hidden with the context menu open. Source/settings/reading position were preserved, Transcripts stayed paused and idle with zero AI calls, Native Notes was restored to foreground, and the ADB forward was removed. This was a simulated DOM-pointer check, not a physical stylus test; native Android popup behavior remains unverified. See [Validation](VALIDATION.md) and its private evidence reference.

## Publication boundary

Nomad local installation and testing are authorized. Do not push to GitHub, create tags or releases, or deploy until the user explicitly asks for publication in a later request.

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

## Digest highlights and category defaults — 2026-10-20 local pass

- [x] Give saved Reader highlights their own darker background, independent of theme highlight variables; confirm real screenshot pixels and persistence after reopening.
- [x] Restore **Quick Digest** without opening the native Digest app; keep **Create Digest** for saving and opening native Details.
- [x] Keep the capture identity stable across delivery/category choices; verify repeated Quick saves do not insert another entry.
- [x] Add the default category in MD Reader settings and optional source overrides in Transcripts. Share names through the source catalog, with explicit Uncategorized and inherited defaults kept distinct.
- [x] Reject missing/ambiguous categories before inserting. Verify missing-category feedback and successful correction using the same request and Highlight.
- [x] Install and verify the matching local Reader, Transcripts and Bridge candidates on Nomad; also finish the pending Paper/Sidebar update. Preserve reading positions, auth/trust and existing ledger records; leave recognition paused without AI calls.
- [x] Stage the matching Transcripts files in the existing desktop vault with its configuration preserved. Desktop reload and active-runtime verification remain pending; no running desktop window was interrupted.
- [x] Remove the three owned native test Digests, Highlight files, temporary source/folder and Reader test state. Keep Bridge's audit receipts; restore the original Reader location and position map.
- [ ] Native Digest-to-notebook navigation remains open. Knowledge 1.00.153 requires a reachable type-100 `.note` Digest reference keyed by the provider UID; notebook/page provenance alone does not enable its source action. The offline parser and in-memory append prototype pass 11 tests over three public fixtures, including malformed input and append-safety cases. A native-created N6 before/after pair now exists from a disposable note; its baseline Source action works, and Digest creation changed several TOTALPATH objects and raster data. A guarded exact-donor-only candidate was built and installed on a disposable closed note with original bitmap pointers preserved. Its native Source action and save/reopen survival are still under test; candidate success is not established. No production writer has been built, and original notes remain unchanged. See the [offline reference experiment](experiments/native-digest-reference/README.md).
- [ ] Live nondefault category selection and category-setting propagation between devices remain unverified. Source/catalog fixtures cover override, inheritance and conflicts.

These are unpublished local candidates. No GitHub push, tag or release was made in this pass. See [Native Digests](docs/native-digests.md) for verification boundaries.
