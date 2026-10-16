# Supernote Transcripts

## 0.11.3 release candidate — optional companions

Transcripts remains usable without Paper, Sidebar or a reader fork. The candidate publishes a versioned optional page-link adapter and safely refreshes compatible readers when it loads, unloads or page links change. Missing or failing reader hooks cannot interrupt normal Reading/Live Preview.

See [component ownership and fallback behavior](INTEGRATION.md) and [release preparation](RELEASE-PREPARATION.md). This candidate has not replaced the installed 0.11.2 build or been tagged for release.

## Version 0.11.2 — desktop workflow and easier pairing

Installed and active on desktop Vedas and Nomad. Source gates pass 398 tests, TypeScript checking and build. Live Satsang validation completed 12 changed-page Sol requests and one 39-page cleanup; the cleaned Markdown reached desktop through Obsidian Sync. Remaining physical handwriting, native Cloud upload and foreground desktop viewer checks are documented in [VALIDATION.md](VALIDATION.md).

Pairing now uses a shorter 20-character code and a **Discover** button next to the Nomad's desktop address input. Discovery uses an expiring, non-secret locator in the synced vault and verifies the desktop over private Wi-Fi. Manual entry and older codes remain supported.

A newly configured device can reuse the exact recognized pages behind a received transcript, including pages recognized with different earlier model settings and a whole-document cleanup. Reuse requires matching publication receipts, source page fingerprints and immutable result hashes. Conflicting current local results remain protected.

See [desktop Cloud Sync setup and the Nomad workflow](DESKTOP-WORKFLOW.md). The local setup uses `Supernote` for original files, excluded from Obsidian Sync, and `Supernote Transcripts` for synced Markdown and shared results. Source, deployment and live workflow evidence are recorded separately in [VALIDATION.md](VALIDATION.md).

## Previous version 0.11.1 — simpler settings and connection recovery

Active on desktop Vedas and Nomad; source tests and live settings checks passed. Both workers remain paused, with no recognition requests during validation.

Settings and source forms now use ordinary labelled sections with one **Advanced** disclosure each. Desktop controls use compact labelled rows, consistent typography and outlined secondary buttons. Pairing has **Copy** beside every complete desktop address.

A successful ChatGPT sign-in clears stale login-related queue blockers. Known offline attempts do not send a renewal request or invalidate the saved login. Page failure holds, budgets, cached text and pause settings are retained. See [SUBSCRIPTION-NOMAD.md](SUBSCRIPTION-NOMAD.md) and [VALIDATION.md](VALIDATION.md) for behavior and verification status.

## Previous release: Version 0.11

Source controls, provisional device OCR, readable page provenance, text-only whole-document cleanup, desktop page viewing and MD Reader 2.1.1 page chips are implemented. Validation passes: **377/377** plugin tests, the MD Reader suites (**123** logic and **106** UI checks), and **5/5** page-link browser/integration checks. Guarded activation and installed-byte evidence confirm Nomad Transcripts 0.11.0 active on Nomad and desktop Vedas, with MD Reader 2.1.1 active on Nomad only. Desktop and Nomad live UI checks passed, and 19/19 reader chips rendered correctly. Protected state was preserved; both workers remain idle and paused, and activation made zero recognition requests. No paid calls were made; real provider recognition and cleanup quality were not exercised. See [ENHANCEMENTS.md](ENHANCEMENTS.md) and [VALIDATION.md](VALIDATION.md). Native Digest capture remains deferred.

## Previous installed release: 0.10.2 — sign-in verified

0.10.2 is installed and guarded-verified on desktop Vedas and the Nomad. Desktop-assisted pairing completed over the private Wi-Fi network: the user approved sign-in in the desktop browser, Nomad connected with its own saved credentials, the pending callback cleared, and both relay ports closed. A single `chatgpt.models` catalog GET returned seven models; no model identifiers or names were logged. No recognition or inference request occurred. The Nomad connection screen showed the ChatGPT subscription provider and Connected status; Cancel closed settings without saving, mirrors remained closed, and there were zero forms. The device was connected for installation and inspection over USB; authentication traveled over native Wi-Fi. A full unplugged-use check has not been done. The 346-test suite, typecheck, production build and synthetic pairing UI checks pass. Evidence and remaining scope are in [VALIDATION.md](VALIDATION.md), [SUBSCRIPTION-NOMAD.md](SUBSCRIPTION-NOMAD.md), and [test-artifacts/interface-0.10.2-live-pairing-evidence.json](test-artifacts/interface-0.10.2-live-pairing-evidence.json).

### Previous release: 0.10.1

The 0.10.1 release passes **326/326 tests**, TypeScript checking, and production build. It is installed and active on desktop Vedas; the installed artifact hashes match the release build. Activation preserved configuration, cache and page IDs, managed Markdown, encrypted session and usage ledgers. The worker is connected, idle and paused; validation made zero recognition requests. Subscription recovery controls passed desktop and Nomad UI mocks. Guarded installation and activation of 0.10.1 and Android helper 0.2.1 on Nomad passed preservation checks. Live Nomad checks verified Sources and Queue navigation and source editor open/Cancel without saving. Sign-in remains intentionally held at the saved-account chooser while a helper-free flow is considered; the account is disconnected and no session was restored. Physical Windows visual verification remains pending. See [VALIDATION.md](VALIDATION.md) for evidence boundaries.

The interface has persistent **Sources** and **Queue** views on desktop and Nomad. Source settings group **What to mirror**, **Save Markdown**, and **Recognition**. Folder inclusion and notebook selection are visible; model and quality are in Recognition. Optional instructions and glossary files share a disclosure. Technical settings, such as shared mirror links, endpoint, and exclusions, remain under Advanced source settings. General Settings separates connection, run behavior, defaults, and transcript appearance. Default recognition settings apply to sources without custom recognition settings, including existing sources that still use the General profile.

The source browser retains its one-step **Mirror** actions. They add a source using the defaults; users can open its settings from Sources afterward. Adding a source does not automatically migrate saved configuration. Save and Cancel continue to apply or discard the open settings draft.

### Previously verified release: 0.9.2

Version 0.9.2 rendered existing page metadata comments as inline **p.N ↗** buttons in Reading view and Live Preview without changing Markdown. On Nomad, a button opened the original notebook at the current position of its saved page ID. Navigation made no AI request. The device-local **Show or hide notebook page links** command controlled their visibility. Version 0.9.2 was installed on desktop Vedas and Nomad before later releases superseded it. See [PAGE_LINKS.md](PAGE_LINKS.md) for setup, identity handling and verification limits.

### Previous quality release: 0.8.0

Version 0.8 adds a source-specific **Recognition quality** slider: Fast, Balanced and Careful. Balanced and Careful recognize up to four consecutive pending pages together, with separately labelled neighboring images and bounded cached text. Every target still has its own cached result, Retry/Skip action, and recovery identity. Continuous Markdown joins supported paragraph/list continuations using hidden inline page references. Subscription activity now includes notebook/model and model breakdowns. See [QUALITY.md](QUALITY.md) for presets, output allowances, incremental behavior and validation limits. Recognition remains paused during installation and testing; historical pages are not forced to run again.

At the 0.8.0 release, desktop Vedas and Nomad were connected, idle and paused. Typecheck, build and **299/299 tests** pass. Isolated desktop UI checks verified slider keyboard positions, Save/Cancel/Reset, output-allowance details and note/model activity breakdowns. On both production devices the slider was opened, changed in a draft and cancelled; saved configuration and managed Markdown hashes were preserved. Existing source modes remain Fast until explicitly selected. Both deployments made zero recognition calls and preserved credentials, both accounting ledgers, cached page data and output ownership. The Nomad's idle worker was paused before installation and remains paused; its AI/automatic settings were retained. A real handwriting comparison is pending.

### Previous robustness release: 0.7.1

Historical 0.7.1 record: typecheck, production build, and **277 tests** passed. The saved test output is [tests-0.7.1-final.txt](test-artifacts/tests-0.7.1-final.txt). At that time the release was active on Nomad and Vedas; both were connected, idle and paused, with no saved-state block. Deployments made zero recognition requests. Nomad retained one legacy request hold for explicit user review, with no page-level holds. Vedas received the Satsang prompt on its `rule-satsang` clone while retaining GPT-6 Luna and the Sanskrit glossary; the final desktop UI read-back was still in progress. See [VALIDATION.md](VALIDATION.md) and [ROBUSTNESS.md](ROBUSTNESS.md) for details and limits. Version 0.7 added independent page failures with explicit Retry/Skip, exact empty-page protocol handling, and clarified request accounting. No historical pages were forced to run again.

Open **Supernote Transcripts: Open mirrors** from the command palette. The overview shows selected sources, page progress, and worker actions. Add source opens the source picker; the sliders icon opens that source's instructions and glossary settings. Desktop uses a responsive, theme-aware Obsidian layout; the Nomad keeps its e-ink presentation. See [INTERFACE.md](INTERFACE.md).

Version 0.4.0 adds adjustable spending limits and cost breakdowns, continuous queue processing, source/notebook pause controls, expandable folder contents, and an existing-vault-folder picker. New sources default to **Supernote Transcripts/Transcripts**; existing destinations are preserved. See [COSTS.md](COSTS.md) for accounting, limits and provider compatibility.

Version 0.5.0 adds a separate **Queue** screen: tap the activity summary on Mirrors. Working and waiting notebooks use the same progress bars as Sources. Icon controls pause/resume or **Do next** (arrow to top); priorities switch after saving the current page. Unique titles stand alone; duplicate names show their parent path beside the title. **Costs** is the `$` icon in the header. Effective model rates are shown read-only; **Customize pricing** and **Restore standard pricing** edit a draft until Save.

Version 0.6.0 adds desktop `.note` sources and shared page-result records for devices linked through Obsidian Sync. See the current deployment evidence and remaining release checks below.

## Desktop and cross-device setup

Install the same `nomad-transcripts` plugin in the Vedas vault. The desktop source picker can read a `.note` file or folder from the vault or an external local folder, including a folder synchronized by another tool. Files must be available on disk. The original `.note` stays in its source folder and is not copied into the Nomad vault. See [DESKTOP.md](DESKTOP.md) for install, shared-cache, and operating instructions.

Use the **Shared mirror** picker to create or select the same logical mirror on each device while keeping each device's source path local. Obsidian Sync must include `Supernote Transcripts/Shared Data/` and must not exclude or pause synchronization for that folder. Sync delay means leases cannot guarantee exactly-once requests; occasional duplicate recognition or publication conflicts remain possible.

Recommended execution is automatic catch-up on Nomad and explicit **Update** on desktop. Existing automatic settings are not changed during setup. Concurrency defaults to four requests on desktop and one on Nomad; both allow up to 32. API queue costs are rolling estimates from up to 20 comparable pages; sparse history uses provisional token assumptions. Estimates are not bills, reservations are separate, and budget limits are per device. Subscription mode reports this plugin's tracked activity and the local UTC-day attempt limit. It does not know or display ChatGPT's remaining plan quota.

### 0.7 behavior

Failed pages remain visible with concise reasons while other eligible pages continue. The plugin does not automatically retry a failed page. Use **Retry** to queue it again or **Skip** to omit it; skipped pages remain visible and can be retried later. An exact `<!-- supernote-empty-page -->` response marks a page as intentionally blank; the marker itself is hidden in the Markdown output. Empty, refused, or incomplete responses without that exact marker are failures.

For subscription mode, the local UTC-day request count includes attempts, including failures and uncertain attempts; lifetime pages and attempts are labeled separately. The local limit is not ChatGPT's plan quota. For API mode, an unconfirmed usage result is held against configured ceilings; other eligible pages may continue while those ceilings still have room. **Count held amount** is optional and records the hold as spent for the selected provider. Corrupt or unavailable accounting storage blocks recognition because the limits cannot be enforced.

### 0.7.1 state and request safeguards

New state snapshots are checksummed and structurally validated. Older snapshots without a checksum remain usable if they pass full validation. If no valid copy can be read, recognition is blocked and the UI directs the user to restore `state-a.json` or `state-b.json` from a plugin backup and reload Obsidian. Update cannot repair damaged state. See [ROBUSTNESS.md](ROBUSTNESS.md) for limits and recovery behavior.

Before an uncertain paid attempt is treated as unresolved, the plugin checks matching shared results at startup and again after it reads a fresh source descriptor. A successful paid response is written into the page cache before publication; if local state persistence fails, the result is also offered to shared storage for rescue. Forced reprocessing remains an explicit per-page intent after failure, so Retry does not silently turn into an ordinary cache hit. The source reader checks indexed metadata and bitmap hashes during its bounded read pass to catch same-size/same-time source changes without rendering every page again. UI configuration saves are serialized, and a failed save rolls back only the entry it attempted to write.

New general-profile instructions include the shared recognition protocol on every request. Existing user-saved source instructions, model choices, glossary selections and page results are preserved. The 2022-character Satsang prompt is applied on Nomad and to the desktop `rule-satsang` clone; the desktop clone retains GPT-6 Luna and its Sanskrit glossary. Prompt changes do not force historical pages to run again.

### 0.6 deployment evidence (historical)

Version 0.6.0 is fully initialized and active on the Nomad. Four commands are registered, and the panel opens with one close control and no duplicate panel. The reading note remains visible without a form; the worker is idle and globally paused. Existing AI and automatic-catch-up settings remain on, the API provider is unchanged, and subscription sign-in is disconnected. The API key, cache/store, spending ledger, transcript Markdown, and Reflection and Satsang source hashes were preserved.

The Satsang folder rule excludes 21 older notes by explicit relative paths and retains the annotated 2610 notebook. Thirty-six cached page results were exported to Shared Data without AI calls. Sync delivered shared metadata to Vedas, where a read-only desktop check reused 32 matching results. A stale 61-page Cloud source was rejected against the 79-page Nomad publication without AI requests or writes; the Cloud Satsang 2610 source is still absent. The Windows reader separately indexed 61 real Reflection pages and rendered one PNG without changing the source hash or modification time.

Desktop 0.6 is installed and registered in Vedas for its next reload, with external Cloud paths mapped; live activation is unverified and CLI activation remains disabled. `community-plugins.json` was backed up at `private/backups/desktop-followup-20261007/vedas-community-plugins.json`; the existing Copilot entry was preserved and no other plugin settings changed. Reload Vedas (or enable CLI activation), refresh the Cloud mirror, then choose a provider and sign in. Subscription authentication requires encrypted Obsidian Secret Storage. The distinct `nomad-transcripts-subscription-return` protocol ID fixes the callback collision; mock verification covers the Finish sign-in UI, but the native callback helper does not yet route the new action and production authentication remains unverified. Keyboard testing found and fixed the form overlay using Obsidian's `--keyboard-height`; live Save and Cancel remain above the keyboard (see ignored `test-artifacts/nomad-0.6-keyboard-fixed.png`). The previous full suite, typecheck, and build passed with 187/187 tests. No paid requests were made. Desktop-assisted pairing remains separate pending work; diagram extraction/cropping and handwritten heading/highlight extraction remain deferred or under research.

For any source folder with existing transcripts, open that source's sliders, then **Select notebooks**. Uncheck notebooks you do not want recognized. **Find existing transcripts** offers basename matches as unchecked suggestions; choose suggestions and apply them to the draft, then **Done → Save**. Nothing is imported or excluded automatically. Existing Markdown and cached results are kept. Advanced exclusions accept literal relative paths and globs (`25*.note`, `**/Archive/**`), one per line; no regex is evaluated. The 0.6 Satsang rule uses its explicit 21 older-note exclusions and retains the annotated 2610 notebook.

The 0.4 preflight recorded **27 of 79 pages ready** in the Reflections notebook, with **52 initial-import pages remaining**; this is a historical snapshot, not current 0.6 progress. On 0.6, the existing AI and automatic-catch-up settings remained on while the worker was globally paused. The 0.6 Satsang export made no AI calls. Existing paid results and original `.note` files remain preserved. Earlier paid pages are excluded from the cost ledger because their token usage was not recorded.

An Obsidian plugin for maintaining Markdown mirrors of selected local Supernote notebooks. It reads `.note` files from the Nomad or desktop and writes generated Markdown into the current vault. Source notebooks are opened read-only. Recognition can use a configured HTTPS API or the supported subscription mode; Obsidian Sync can deliver saved Markdown and shared page records between vaults.

The plugin keeps ID `nomad-transcripts` and migrates settings and cached results from the earlier 0.1 prototype on first load. Review settings and make a vault backup before updating an installed copy.

## Device and vault paths

The existing Nomad vault is named `Obsidian`, located at `/storage/emulated/0/Documents/Obsidian`, and uses the separate `.obsidian-supernote` profile. Its plugin directory is:

`/storage/emulated/0/Documents/Obsidian/.obsidian-supernote/plugins/nomad-transcripts/`

Notebook sources are restricted to `/storage/emulated/0/Note`. The disabled Reflections folder rule retains output `Experiments/Nomad transcripts`. The enabled single-notebook rule and its saved Markdown were already under `Supernote Transcripts/Transcripts` at the 0.4 preflight; that location was preserved. The 0.6 Satsang folder rule excludes 21 existing older notes by explicit relative path and retains the annotated 2610 notebook. Output paths are relative to the current vault. Desktop Vedas receives those notes through the vault's normal Obsidian Sync when desktop setup is complete.

## First setup and updates

Open **Settings → Supernote Transcripts** and add an enabled rule for a source folder or one `.note` file. Select an output folder in the vault and a profile. Folder rules can recurse and have one exclusion path or glob pattern per line. When several rules match, the most specific enabled source path wins.

Fresh setups start with **General — no glossary** and no selected sources. Create an ordinary `.txt` or `.md` file anywhere in the vault containing names, specialist terms or spelling preferences; use **Choose glossary files** in a source's settings to select it. Several files can be selected. The contents are sent only for that source's future recognition requests. No vocabulary is bundled and no language is assumed. Existing user-configured instructions and glossary selections are preserved. The API key is stored in device-local WebView storage; it is not stored in synced `data.json` or this repository. AI, automatic execution, and global pause are device-local. The 0.6 Nomad verification preserved AI and automatic execution as on and found the worker idle and globally paused.

The status panel opens from the ribbon icon or **Open transcription status**. It reports stages and aggregate work counts, plus each tracked notebook's state, ready pages versus desired pages, queued tasks, errors, and output action. Use **Update**, **Pause/Resume**, or per-page **Retry**/**Skip** to manage work. A first update scans enabled rules and discovers notebooks; until then the panel explains that discovery is needed.

For a manual selection, choose an indexed notebook and enter a required page number (`3`) or range (`3-6`), up to 10 pages per selection. Use **Update** to drain eligible queued pages, subject to spending limits. Expand a folder with its chevron to see notebook rows; pause/resume controls work for the entire folder or an individual notebook. Global Pause finishes and saves the current request, then stops new requests. Other unpaused sources can continue when one source is paused. **Preview** renders locally and makes no AI request. **Force reprocess** asks for new recognition of selected pages even when a saved page is current and may incur additional API charges.

Automatic catch-up is opt-in. It runs on startup/resume or the configured interval while Obsidian is active; it does not provide continuous Android background execution. Native app-state and pause events prevent new page requests after leaving Obsidian or sleeping; an already-running request is saved when it returns. Work no longer stops after a small page batch: dollar/request limits bound recognition instead. Failed pages remain visible and are not retried automatically; other eligible pages continue. Successful page results and queue state are persisted in alternating state slots before publication, so a later run reuses completed work. An in-flight interruption may still be billed without saving its result; its hold counts against configured ceilings, and the user can optionally count it as spent. There is no exactly-once billing guarantee.

## Page identity, reading, and output

The reader indexes page identities using native `PAGEID` where it is unique and content fingerprints as a fallback. Reconciliation reuses matching page results through insertions and reorderings. Edits and newly added pages take priority over older backfill, and recently changed notebooks run first. Hidden/deleted layers are omitted; ambiguous visibility metadata fails safely. Profile changes mark results for refresh without forcing every page to be recognized immediately. A manual force option is available for selected pages.

Notebook data is read through the Android Obsidian filesystem interface, which is undocumented and may change in future Obsidian releases. Data is fetched in bounded blocks; there is no fixed whole-notebook size limit, but a single block above 64 MB is rejected. Mixed portrait and landscape pages in one notebook are not supported by the current renderer. The reader checks source revision around inspection and rendering and refuses to publish if the source changes during processing. The native source interface is read-only.

Generated Markdown is stored inside the selected vault output folder. Existing unrelated notes and transcripts with unrecorded manual edits are protected from overwrite. If a completed source scan confirms an owned notebook is missing, its verified output is moved to `Supernote Transcripts/Archive/<notebook-id>/`; a possible rename or restore can then match the saved page identities and reuse successful text at the notebook's new output path. Modified or unowned output is not moved or overwritten: the notebook is marked as a conflict, and the user can preserve that note and choose another output folder in the rule to continue. Replaced output revisions are retained in the vault's `Supernote Transcripts/History` folder. A local save does not mean Sync delivery has finished; check Obsidian Sync separately on the desktop.

## 0.1 prototype migration and rollback

The plugin ID and API-key storage key are retained. The existing key is the localStorage entry `nomad-transcripts-key:Obsidian` in the Nomad vault's Obsidian WebView; it is device-local and not encrypted. The 0.1 `data.json` settings and page cache are migrated into the profile/rule configuration and persistent notebook state. Existing source/output paths and cached page results are carried forward; legacy page results are checked against the rendered page before reuse. Migration writes only glossary text previously supplied by the user to a generic Imported glossary file, choosing another filename if an unrelated file already exists. It adds no glossary when none was supplied. Existing version-1 configurations remain intact.

The new notebook state uses two rotating files, `state-a.json` and `state-b.json`, beneath `.obsidian-supernote/plugins/nomad-transcripts/`. Configuration remains in the plugin's `data.json`; the API key and automatic execution preference remain in localStorage. Keep the plugin directory and vault output when rolling back so the migration source and generated Markdown remain available.

To roll back, disable **Supernote Transcripts** in the Nomad's Community Plugins settings. Generated Markdown and history are ordinary vault files and remain available. Reinstalling the previous package restores the old prototype behavior; it may not understand the new state slots, but it can use its original `data.json` if retained. To remove only the key, clear the API key from plugin settings before disabling.

## Development and validation

Run `npm ci`, `npm run check`, `npm test`, and `npm run build` for local validation. Dependencies and `package-lock.json` are pinned and retained. `supernote-typescript@0.7.1` supplies notebook parsing and rendering; `image-js@1.7.0` encodes page images. The project is GPL-3.0-or-later; see `NOTICE.md`.

The scripts under `scripts/` include development diagnostics using a local ADB-forwarded WebView endpoint on port 19222. Read [scripts/README.md](scripts/README.md) before running operator or device scripts. `set-key.mjs` transfers an existing environment key without printing it or writing it into project files. See [VALIDATION.md](VALIDATION.md) for current local, fixture, and device evidence. Referenced files under `test-artifacts/` and private inputs under `private/` are local evidence and are intentionally excluded from this source repository.

During the initial 0.6 Nomad rollout, state comparisons confirmed the API key, cache/store, spending ledger, and existing transcript contents were unchanged. The Satsang source and 21 explicit exclusions were saved, with the annotated 2610 notebook retained; 36 cached page records were exported to Shared Data without AI calls. That historical check did not establish desktop activation, production ChatGPT sign-in, cross-device Sync delivery, live provider behavior, or continuous Android background execution. Later 0.6.4 desktop reload verification and current 0.7 deployment evidence are recorded in [VALIDATION.md](VALIDATION.md).

The existing Obsidian Android host exposes the native [Capacitor App lifecycle API](https://capacitorjs.com/docs/apis/app); the plugin uses its state and pause events without installing an Android component.
