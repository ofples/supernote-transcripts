# Desktop and cross-device use

## Version 0.11 desktop readiness

The 0.11 source passes **377/377 tests**, TypeScript checking and production build. Guarded activation and installed-byte checks confirm Nomad Transcripts 0.11.0 active on Nomad and desktop Vedas, with MD Reader 2.1.1 active on Nomad only. Synthetic desktop and Nomad UI checks passed; bounded live UI checks are in progress. Desktop page links resolve the current local `.note` by stable identity; an in-vault source opens through an enabled notebook viewer, while external sources or a missing viewer use the read-only original-page preview. MD Reader 2.1.1 can render transcript page chips through its optional adapter. Activation preserved protected state and made zero recognition requests. See [VALIDATION.md](VALIDATION.md) and the private activation/byte evidence under `private/device-evidence/2026-10-16/`.

No paid calls were made. Real provider recognition and cleanup quality were not exercised. See [VALIDATION.md](VALIDATION.md) for the current verification boundary.

## Historical: 0.10.0 desktop status

The 0.10.0 release passes TypeScript checking, production build, and **323/323 tests** ([test log](test-artifacts/tests-0.10.0-final.txt)). It is installed and active on desktop Vedas; installed hashes match the final build. Guarded activation preserved configuration, cache and page IDs, session and usage ledgers, and managed Markdown. The worker is connected, idle and paused; activation made zero AI requests. Headless desktop and Nomad UI mocks passed with synthetic data. Live desktop DOM checks passed for Sources, source editor, Queue, and Settings; physical visual verification is pending. Nomad was unavailable over ADB and remains on 0.9.2. See [VALIDATION.md](VALIDATION.md) for the verification boundary.

The updated interface has persistent **Sources** and **Queue** views. Source settings group folder/notebook selection, transcript destination, and recognition. Queue leads with one overall status, then working and waiting notebooks, with collapsed paused and attention groups. General Settings defaults apply to sources without custom recognition settings, including existing sources that still use the General profile.

Source browsing retains immediate **Mirror** actions. They add the selected folder or notebook with defaults; configure the source afterward from Sources. To review or customize settings before saving, select a notebook row to open the source editor. The 0.10.0 UI build makes no automatic configuration migration.

### Previously verified interface: 0.9.2

Version 0.9.2 rendered existing page comments as inline **p.N ↗** links in standard Reading view and Live Preview without changing transcript Markdown. Native notebook navigation ran on the Nomad; desktop clicks explained that device requirement. It was verified on desktop Vedas and Nomad. Both activations preserved plugin state and managed Markdown, kept the worker idle and paused, and made zero recognition requests. Production UI checks verified inline placement on desktop and Nomad, plus a physical Nomad Live Preview tap that opened Notes at page 1 / 122. Full evidence: [page-links-0.9.2-desktop-evidence.json](test-artifacts/page-links-0.9.2-desktop-evidence.json) and [page-links-0.9.2-nomad-evidence.json](test-artifacts/page-links-0.9.2-nomad-evidence.json). See [PAGE_LINKS.md](PAGE_LINKS.md).

Historical 0.8.0 quality-release evidence: Version 0.8 added contextual page groups and the quality slider, using the same plugin code on desktop and Nomad. See [QUALITY.md](QUALITY.md). At that release, Vedas and Nomad were connected, idle and paused; 299 tests, typecheck and build passed. Production slider checks passed on both devices, alongside isolated desktop Save/Cancel/Reset/activity UI checks. Configuration, cached results, accounting, credentials and managed Markdown were preserved with zero recognition calls. Existing sources remained Fast until explicitly changed. The Nomad's previously idle, unpaused worker was paused for installation and left paused. A real recognition-quality comparison remained pending.

Historical 0.7.1 release record: typecheck, production build and 277 tests passed. The saved test output is [tests-0.7.1-final.txt](test-artifacts/tests-0.7.1-final.txt). At that time it was active on both Nomad and Vedas. See [VALIDATION.md](VALIDATION.md) for deployment evidence boundaries and [RECOVERY.md](RECOVERY.md) for edited-mirror recovery.

Historical deployment record: Nomad and Vedas 0.7.1 were connected, idle and paused, with no saved-state block. The Satsang instructions were applied to the desktop `rule-satsang` clone while retaining its GPT-6 Luna model and Sanskrit glossary; Reflection settings were left intact. Both deployments made zero recognition requests, and cached page data plus the two managed Markdown hashes were preserved. The desktop catalog save updated a Shared Data record; afterward Reflection appeared queued with its previous error cleared and one transient in-memory queue entry. A reload read the validated durable generation 6 with an empty queue, so the record does not claim exact equality for the transient in-memory store. See [VALIDATION.md](VALIDATION.md) for versioned historical evidence.

Historical UI checks: desktop per-page Retry/Skip and local-counter mocks passed. The full desktop browser fixture was not verified in that release; the successful focused inline folder-browser check was on Nomad only.

Supernote Transcripts can read `.note` files on desktop as well as on the Nomad. A desktop source can be in the Vedas vault, in a folder synchronized by another service, or in another local folder. The source must be present on disk and readable by Obsidian; online-only placeholders are not sufficient. Reading is read-only.

## Install in Vedas

Install the same plugin ID, `nomad-transcripts`, in the Vedas vault. From the plugin checkout, run `npm ci` and `npm run build`, then copy the generated `main.js` together with `manifest.json` and `styles.css` into:

```text
Vedas/.obsidian/plugins/nomad-transcripts/
```

Then enable **Supernote Transcripts** under **Settings → Community plugins**. Restart Obsidian if it does not appear. Configure a local source path and output folder for Vedas. The desktop plugin reads a `.note` file or folder from an absolute local path; the source picker accepts a typed Windows or Unix path. Browse within the locations exposed by Obsidian, or type the absolute path to an external folder.

## Add the desktop source

1. Open **Supernote Transcripts → Open mirrors**, then choose **Add source**.
2. Browse to an in-vault `.note` file or its parent folder. For an external folder, enter its absolute path in **Source path**. For a folder synchronized by OneDrive, Dropbox, or another tool, use that tool's local folder and make sure the notebook files are available offline. A **Mirror** action adds with defaults immediately; selecting a notebook row opens its settings first.
3. In the source editor, choose the **Save Markdown** destination. New sources default to `Supernote Transcripts/Transcripts`.
4. In **Advanced source settings → Link across devices**, create a shared mirror or select an existing one. On the Nomad, choose that same shared mirror for its corresponding local source. The machine-specific `.note` paths remain local; the shared mirror connects their page identities, recipes, cached results, and leases.
5. For folders, review **What to mirror** and select notebooks if needed. Review **Recognition** model and quality; instructions and glossary files are optional. Advanced source settings contains exclusions and endpoint options. Selecting a different existing shared mirror adopts its shared recognition profile, folder selection and exclusions when saved; a warning appears for that change.
6. Use **Update** to start a desktop run. Desktop automatic catch-up is off by default for a new desktop profile. The recommended setup is automatic catch-up on the Nomad and explicit **Update** on desktop. These settings are independent and are not silently changed on an existing installation.

The original `.note` source stays in its existing local folder. This workflow does not copy `.note` files into the Nomad vault. Generated Markdown is written to the selected vault output folder; a local save does not confirm that Obsidian Sync has delivered it to another device.

## Shared page cache and synchronization

Shared definitions and page results are ordinary Markdown records under `Supernote Transcripts/Shared Data/` in each vault. The mirror picker reads definitions from `Supernote Transcripts/Shared Data/Mirrors/`. Page-result and lease records are stored in subfolders under the shared data root.

For cache reuse and cross-device lease checks, let Obsidian Sync include `Supernote Transcripts/Shared Data/` on both devices. Do not exclude or pause Sync for that folder. The transcript output folder should also sync if you want the generated Markdown on both devices. Obsidian Sync has no atomic file-lock or immediate delivery guarantee: delayed Sync can let both devices send a request, and simultaneous publication can require conflict recovery. Leases reduce duplicate work but cannot guarantee exactly-once recognition.

### What Sync shares

Vault files and Obsidian settings use different Sync controls. Ordinary generated transcript Markdown and glossary files follow the vault's normal file-type and folder selection. Shared page-result, lease, and mirror-catalog records are also ordinary files under `Supernote Transcripts/Shared Data/`; they sync only if that folder and its Markdown files are included and not excluded.

The mirror catalog can store a portable profile snapshot: model, endpoint, prompt, glossary references, default output, recursive selection, and exclusions. That snapshot is imported into a local rule only when the rule first binds to that `sharedId`. Later catalog changes do not automatically update an already-bound rule. The local rule's actual output destination is not imported, so each device keeps its own destination. Treat the catalog as an initial binding source, not a live settings feed.

The plugin also keeps local settings outside the shared Markdown records. Browser `localStorage` contains the provider choice, API key, AI and automatic-execution switches, worker limit, global pause, cost settings and API ledger, and subscription-usage ledger. The encrypted account session is local to Obsidian's Secret Storage. The plugin's `data.json` contains local rule source/output paths and enabled/folder-pause state, profile IDs, glossary references, model, prompt, interval, batch/continuous settings, and the page-heading option. Obsidian's `data.json` lives in its active configuration folder, not in `Shared Data`.

The Nomad and Vedas currently use separate configuration folders (`.obsidian-supernote` and `.obsidian`). Their plugin `data.json` files are therefore separate; enabling Sync for the community-plugin list or settings does not merge one active profile's plugin configuration into the other. Do not assume one device's rule/profile edits appear in the other's plugin settings. The exact vault-configuration Sync categories enabled on desktop have not been confirmed. Obsidian Sync can sync multiple configuration folders to one remote vault and lets each device choose which categories to receive; community-plugin changes may require a restart. This plugin has no `onExternalSettingsChange` handler, so it does not promise to adopt external settings changes live. See [Obsidian Sync settings and selective syncing](https://obsidian.md/help/sync/settings) for the official profile, configuration-sync, and reload guidance.

Credentials, provider selection, AI switches, automatic execution, concurrency, global pause, and accounting remain device-local. Shared Markdown records carry page results and recognition metadata, not provider credentials or a live copy of the whole plugin configuration.

## Requests, estimates, and presentation

The default simultaneous request limit is four on desktop and one on Nomad. Both allow a configurable maximum of 32. Quality controls how many consecutive pending pages each request handles: one in Fast, up to four in Balanced/Careful. Worker count is a request count, not a page count. Context images are additional input and never target extra unchanged pages. Rendering limits are separate. Successful page results can be saved as requests finish, while publication follows page order. Higher settings use more memory and reach provider limits faster; admission reserves the full grouped request.

API queue estimates normalize up to the most recent 20 comparable completed requests by their completed page count, for the same model, endpoint, and recognition recipe. Without matching history, an estimate is marked provisional and assumes 3,000 input tokens per target/context image, 1,000 output tokens per target, and an extra reasoning allowance for Balanced/Careful. These assumptions are estimates, not measured image token counts or a bill. Exact provider input-token preflight and conservative output reservations govern admission. Held reservations are displayed separately. Daily, monthly, and per-update spending limits are enforced independently on each device.

Subscription mode reports this plugin's pages, attempt counts, reported tokens, and estimated time. It labels the UTC-day attempt count against the configured local limit separately from lifetime activity. Attempts include failures and uncertain requests; the counter is not ChatGPT's plan quota, and the plugin cannot show remaining plan usage. API mode keeps unconfirmed cost as a hold against local ceilings; **Count held amount** is optional. It does not change subscription records. Corrupt or unavailable accounting storage blocks recognition. Desktop ChatGPT sign-in requires Obsidian encrypted Secret Storage. Desktop-assisted pairing was implemented and live-verified for installed version 0.10.2. Version 0.11.0 is now active on desktop Vedas and Nomad; no live sign-in or provider request was part of activation.

Failed pages do not stop unrelated eligible pages, and they are not retried automatically. Notebook details show concise reasons with per-page **Retry** and **Skip**. A skipped page remains listed as intentionally omitted and can be returned to work with **Retry**. Only the exact `<!-- supernote-empty-page -->` response marks a page blank; the marker is hidden in the generated Markdown. Empty, refused, or incomplete responses without it are failures.

Visible physical-page headings are optional. New configurations default to hidden page headings; upgraded configurations preserve the previous visible-heading behavior. Changing this presentation option does not request recognition again. Page provenance remains in hidden boundaries and shared result records. Extracting headings or highlights from handwriting is research work and is not implemented. Diagram extraction and cropping are deferred. Recognition instructions and existing page results remain available if the presentation setting changes.

## 0.6 validation and release status

The statements in this section document the 0.6.0 rollout and are historical. For current 0.7 implementation and deployment status, see the release note at the top and [VALIDATION.md](VALIDATION.md).

Version 0.6.0 is fully initialized and active on the Nomad. Four commands are registered; its panel has one close control and no duplicate instance. The reading note remained visible without a form, and the worker was idle and globally paused. Existing AI and automatic-catch-up settings remained on, the API provider was unchanged, and subscription sign-in was disconnected. The API key, cache/store, spending ledger, transcript Markdown, and Reflection and Satsang source hashes were preserved.

The Satsang rule excludes 21 older notes by explicit relative path and retains the annotated 2610 notebook. Thirty-six cached page results were exported to Shared Data without AI calls. Sync delivered shared metadata to Vedas, and a read-only desktop check reused 32 matching results. A stale 61-page Cloud source was rejected against the 79-page Nomad publication without AI requests or writes; Cloud Satsang 2610 is still absent. The Windows reader indexed 61 real Reflection pages and rendered one PNG without changing the source hash or modification time.

Desktop plugin 0.6 is installed and registered in Vedas for the next reload, with external Cloud paths mapped. Live activation is unverified and CLI activation remains disabled. The community plugin configuration was backed up to `private/backups/desktop-followup-20261007/vedas-community-plugins.json`; its Copilot entry was preserved and no other plugin settings changed. The next steps are to reload Vedas (or enable CLI activation), refresh the Cloud mirror, and choose a provider and sign in. ChatGPT subscription authentication and the production Finish sign-in flow remain unverified live. Previous typecheck/build and **187/187 tests** passed; no paid requests were made. A physical keyboard check caught the form overlay; it was fixed using Obsidian's `--keyboard-height`, and Save/Cancel remain above the keyboard. Screenshot: ignored `test-artifacts/nomad-0.6-keyboard-fixed.png`. Do not treat the Nomad validation as live desktop activation or as a completed cross-device release.
