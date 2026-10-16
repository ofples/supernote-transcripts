# Mirrors interface

## Version 0.10.0 — desktop active

The release passes TypeScript checking, production build, and **323/323 tests**. It is active on desktop Vedas with installed hashes matching the final build; guarded activation preserved configuration, cache and page IDs, session and usage ledgers, and managed Markdown. The worker is connected, idle and paused, with zero AI requests during activation. Headless UI mocks passed for desktop and Nomad using synthetic data. Live desktop DOM checks passed for Sources, the source editor, Queue, and Settings. Physical visual verification is pending. Nomad was unavailable over ADB and remains on 0.9.2. See [VALIDATION.md](VALIDATION.md).

Sources and Queue are persistent views on both desktop and Nomad. Sources shows concise status and progress; Queue leads with one global status and counts, followed by working and waiting notebooks. Paused and Needs attention remain available with direct resume or review actions. Estimate methodology is shared in one disclosure. Detailed diagnostics remain in notebook details.

The source editor uses three sections: **What to mirror** (folder inclusion and notebook selection), **Save Markdown** (output folder), and **Recognition** (model, quality, optional instructions and glossary). A single notebook source omits the folder-selection section. Technical and management controls remain under **Advanced source settings**. General Settings separates connection, run behavior, default recognition, and transcript appearance. Default recognition values are used by sources without custom recognition settings, including existing sources that still use the General profile.

The source browser keeps its immediate **Mirror** actions. These add the selected source with defaults; its settings can be adjusted afterward from Sources. Existing destinations and profiles are retained unless the user edits and saves them. Cancel discards the current draft.

> The versioned release and device notes below describe earlier builds and are historical unless explicitly noted otherwise.

## Historical design and release record through 0.7.0

The 0.7.0 implementation passed typecheck, production build and 238 tests. At that time, version 0.7.0 was active on Nomad and desktop remained on 0.6.4 pending activation. Per-page Retry/Skip and local-counter UI mocks passed on both platforms. The focused Nomad inline browser check passed; the full desktop browser fixture was unverified. See [VALIDATION.md](VALIDATION.md).

Desktop uses compact Obsidian-themed folder and notebook rows, Mirrors/Queue tabs, status badges, and a source browser with breadcrumbs and explicit mirror selection. Its interaction pattern follows Supernote Cloud Sync's browser, while the Nomad retains its e-ink layout. Folder browsing uses the platform's actual filesystem information, including Windows drive roots and network shares.

Edited notebooks expose **Resolve edits** directly. The recovery screen compares the current and cached generated versions, then offers a backup-and-restore action or a new sibling mirror that keeps the original edited file. It displays **Open backup** and **Open mirror** after recovery. See [RECOVERY.md](RECOVERY.md).

Simultaneous requests are configurable from 1 to 32 on both platforms. Existing values are retained; fresh defaults remain one on Nomad and four on desktop. Higher values use more memory and reach provider limits faster. Rendering remains serialized and each generation request still passes the budget/request admission checks.

## Page outcomes and source controls

Only the exact `<!-- supernote-empty-page -->` response marks a page as intentionally blank, and the marker is hidden in the Markdown mirror. Empty, refused, or incomplete responses without that marker are page failures, never proof that handwriting is blank. Other eligible pages continue; failed pages are not retried automatically. Notebook details show concise reasons and per-page **Retry** and **Skip** actions. Skipped pages remain visible, are labeled separately from errors, and offer **Retry** to add them back. Source-level or unresolved legacy errors can still block safe work. Summaries include only issues matching the current page fingerprint.

The source editor includes the **Mirror this source** control next to the selected source. Turning mirroring off stops future work for that rule while retaining its existing Markdown and cached results. Saving applies the setting; Cancel discards the form draft. This control is available on Nomad and desktop.

## What the main screen answers

1. What am I mirroring?
2. How much is ready?
3. Is something waiting for me?

The interface fills the screen. A fixed header holds navigation, Settings and one close button. A fixed bottom bar holds the primary action and Add source. The overview has one status sentence; aggregate progress appears only when several sources are enabled. Each selected source has a short name, a page count, a quiet progress bar, and a sliders icon for its settings. Folder contents open into a notebook list. Technical details are disclosed only in notebook details.

Version 0.3.1 follows the device's typography: one body scale, a modest centered title, restrained section headings, and generous space between fields. Controls use square outlines or simple stroke icons on a plain background. Instructions and advanced options are expandable; glossary files display their names and can be searched in the picker. Save/Cancel stays visible at the bottom. Reopening the command keeps an existing unsaved form intact instead of stacking dialogs.

## Source setup

Version 0.4.0 adds source pause/resume icons and folder chevrons. Expanded notebook rows use the same progress format, with independent pause controls. A paused folder also pauses its child controls; resume the folder before a child. Global Pause/Resume remains in the bottom bar. Update continuously drains eligible work within spending limits.

New output defaults to **Supernote Transcripts/Transcripts**. **Choose existing folder** browses visible vault folders, excluding hidden configuration folders. Picking a destination changes only the open form; Save applies it and Cancel preserves the original. Typed paths remain available for creating a new folder. Existing source destinations are retained.

**Costs** opens daily/monthly bars, spent and held amounts, and expandable notebook/model breakdowns. Limits and pricing stay collapsed until needed. Save/Cancel applies or discards edits. API usage with uncertain cost remains held against local ceilings; other eligible work can continue if those limits have room. **Count held amount** is optional and counts the hold as spent for the selected provider. Subscription mode shows a local UTC-day attempt count and separately labeled lifetime activity, not ChatGPT remaining plan quota. See [COSTS.md](COSTS.md).

Add source opens a browser inside the device's Note directory. Choose a folder or an individual `.note`. The source editor has explicit Save/Cancel and groups folder selection, output destination, and recognition choices. Changing a source's instructions or glossary creates an independent profile; it does not change another source's settings. Subfolders and notebook selection are in **What to mirror**. Model and quality are in **Recognition**. Exclusions, shared mirror links, provider endpoint, reset, and source removal are under **Advanced source settings**.

General sources start without a glossary. New general-profile instructions include the shared recognition and blank-page protocol, sent with every recognition request. Glossaries are ordinary vault `.txt` or `.md` files. Selecting one sends its contents only with that source's transcription requests. Saved user instructions are preserved. The 2022-character Satsang prompt is applied on Nomad while preserving its GPT-6.1-Sol model, glossary, Reflections settings and saved data; applying it on desktop remains pending. Prompt changes apply to future requests and do not force historical pages to run again. Reprocessing old pages is an explicit action in notebook details.

Version 0.3.2 bundles no domain vocabulary or language-specific setup. Users supply their own reference files, optionally selecting different files for different folders or notebooks. Existing personal selections remain intact.

## Controls

- **Outlined buttons:** the primary action on the current screen (Save, Done, Check now/Update, Choose this folder, Open transcript).
- **Plain text buttons:** secondary actions such as Cancel, Add source, Change, choosing glossary files, Reset transcription settings and Preview. These share the same typography and touch-target height; they do not receive arbitrary borders.
- **Icon buttons:** Back, Settings, Close, per-source settings and removing an individual glossary selection. Each has an accessible label.
- **Checkboxes:** square outline when off; the same outline with a smaller filled square inside when on. No ticks, rounded shapes, colour dependence or animation. The complete labelled row is tappable, and native checkbox keyboard semantics are retained.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| Initial import | Existing notebook pages are being recognized for the first time. Show pages ready and remaining. |
| Updating pages | New or visibly edited pages need recognition. Reuse all unchanged results. |
| Up to date | Selected indexed pages have saved results matching their visible content. |
| Waiting for AI | A current request is slow. Do not silently duplicate it. |
| Paused | Work is stopped; saved results remain available. |
| Spending paused | API limits are full, or the accounting ledger cannot safely enforce them. An unconfirmed hold counts against the configured ceilings. |
| Usage limit reached | The configured local UTC-day subscription attempt limit has been reached. This is not ChatGPT's plan quota. |
| Needs attention | A failed request or protected output needs intervention. |
| AI recognition off | Source checks are allowed; the API boundary rejects recognition requests. |

The queue counts notebooks, not pages. A single queued notebook can represent 56 remaining pages; this is not evidence of repeated whole-notebook recognition. Queue counts, fingerprints, raw paths and reader byte progress do not belong in the overview.

## Quiet behavior

- Fixed-size controls and square, thin borders; no decorative animation or animated spinners.
- Only update visible status when its displayed content changes. Preserve input focus and scroll position.
- Keep page-range, preview, forced recognition and troubleshooting in notebook details.
- Show genuine page counts. Never show a fabricated percentage before indexing reveals the total.
- Source status describes the local Markdown mirror. Obsidian Sync delivers that Markdown separately; this interface does not claim remote delivery is complete.
- Preserve generated output ownership checks, original notebooks and cached page results.
- A metadata-only change can trigger a read, but not a paid recognition call. The last-saved time changes only when Markdown changes.

## Cost protection during development

AI recognition and automatic catch-up are off on the device while validating this interface. The UI fixture plugin copies settings and notebook state into memory, performs no AI requests, and does not write transcripts. Runtime tests use fake API responses in isolated fixtures. No mock text is injected into the real vault.

One pre-existing slow request was already in flight when development paused the worker. It completed and its result was saved before the upgrade. The installed 0.3 version has 21 of 76 pages ready, remains paused with AI and automatic catch-up off, and reused all 21 cached results in a live source check with zero AI calls and unchanged Markdown.

## Historical queue and selection design (0.5.0)

In earlier versions, Queue opened from the activity summary. In 0.10.0 it is a persistent view. **Working now** shows the active notebook, page/stage and saved-page progress. **Up next** follows the actual worker order; its arrow-to-top icon means Do next, switching after the current page has been saved. Pause/play icons have accessible labels and 48px targets. Global Pause/Resume remains in the footer. Paused and Needs attention are collapsed; attention entries open notebook details. Do next never bypasses AI-off, pauses or spending limits. Progress bars share one component with source/notebook rows. Parent paths appear beside duplicate titles only; complete paths remain in details/settings.

Folder settings offer **Select notebooks** with square Include checkboxes. Cancel restores the selection draft; Done returns to the source form, whose Save applies it. Find existing transcripts scans filenames only and requires explicit candidate selection. Applying suggestions edits the draft only. Advanced exclusions use exact relative paths or escaped glob patterns, one per line. Excluding removes future work and current overview counts, while retaining saved Markdown/cache. Notebook details also offer Exclude from mirror; an active page finishes and is saved first.

The `$` header icon opens Costs. Limits and Customize pricing stay collapsed. Model pricing shows effective rates, Standard/Custom labels and the built-in verification date. Restore standard pricing removes matching known-model overrides from the draft only; Cancel preserves saved pricing. Unknown providers/models require explicit custom rates before generation.
