# Goal: Supernote Transcripts first version

Build a reusable Obsidian plugin that maintains a Markdown mirror of selected local Supernote folders/notebooks, without writing any `.note` original. Run transcription on the Nomad through a configurable online vision API; write generated Markdown into the Nomad's Obsidian vault so existing Obsidian Sync distributes it to desktop Vedas.

## Required outcomes

1. Folder rules preserve source hierarchy, permit recursive selection/exclusions, and resolve the most specific enabled rule. Each rule specifies an output folder and a transcription profile.
2. Profiles configure endpoint/model/instructions and a list of user-supplied ordinary vault `.txt`/`.md` glossary files. The default general profile has no glossary. Do not bundle subject-specific vocabulary or assume a language. Preserve existing users' optional glossary selections; credentials and execution switches stay device-local.
3. Track native page identities where available, with safe content-based fallbacks. Reuse successful results for unchanged pages; recognize new or edited pages only. Reordering/insertion/deletion must not attach stale text to the wrong page. Do not automatically re-recognize a whole collection when a profile changes.
4. Persist successful page results and queue state before publishing each updated notebook. Interruption/retry must reuse paid successful work. Keep old text until replacements succeed. Never publish a snapshot from an actively changing source.
5. Provide visible checking/rendering/recognizing/saving progress, per-notebook status, update, pause/resume, retry and open-transcript actions. Mark local save separately from Obsidian Sync delivery.
6. Automatic catch-up is device-local and runs on startup/resume/interval only while Obsidian is active. No claim of continuous Android background execution. Each Update drains eligible work continuously, bounded by configurable persistent spending/request limits rather than a small page batch. Provide global, source and notebook pause controls; use mocks and make no live AI requests during validation, preserving existing device-local AI settings.
7. Validate full folder scanning and large real notebooks with memory-conscious parsing/rendering. Keep source access read-only, preserve manual Markdown edits, keep history for replaced/deleted results, and handle incomplete source inventories conservatively.
8. Reuse the existing plugin ID and device-local credential; preserve prototype output and installed plugins. Back up before deployment. Use isolated copies for edit/reorder/delete tests.
9. Record local token-derived cost estimates by notebook/model. Reserve before generation, retain interrupted costs through restart, stop when prices/counts/accounting are unavailable, and make limits configurable ($1/day, $10/month, $0.25/update defaults). Preserve previous destinations; new sources default to Supernote Transcripts/Transcripts with an existing-vault-folder selector.

## Delegation

Follow the workspace AGENTS.md: use Luna by default for routine implementation, settings/UI/documentation, quick device checks and UI verification. Reserve Sol for intricate source access, page identity, queue/publication correctness, review and coordination. Escalate specific difficult checks when needed. Do not modify third-party clones or resume the parked recognition enhancer.

## Completion evidence

The 0.6 typecheck and build pass, with 186/186 tests passing. Version 0.6 is initialized and active on the previously authorized Nomad; state preservation, local rendering, cached result reuse, and shared metadata delivery have been checked. No paid request was made. Desktop activation, selecting a provider, production sign-in, and a bounded live AI request remain separate release gates. Document unsupported platform behavior and remaining limitations explicitly.

## 0.5 follow-up

Add notebook selection/exclusions without importing prior transcripts; opt-in filename-match suggestions; a queue that reflects actual worker priority and can preempt after saving a page; current-source pause/exclude; shared queue/source progress bars and compact accessible icons; Costs in the top header with read-only effective rates, explicit custom overrides and draft-only Restore. Validate with isolated mocks and no live AI calls, preserving installed configuration, cache, outputs, key and spending ledger. The recognition enhancer remains parked.

## Desktop and cross-device follow-up: agreed scope

The plugin must support recognition initiated on either desktop or Nomad, without a hosted coordinator or mandatory manual device ownership. Earlier proposals requiring exclusive per-source ownership or a hosted coordinator are superseded. Use shared page results and best-effort expiring notebook leases carried through Obsidian Sync. Synced files are not atomic locks: delayed synchronization can permit duplicate requests and conflicting output writes. Do not claim exactly-once recognition or invent a reliable Sync-completion signal.

- Before each new request, recheck locally received page results and other devices' leases. Refresh leases while active, release on completion/pause after in-flight work settles, and recover stale leases conservatively. Use distinct device claim records so concurrent writes do not silently overwrite each other's claims. Bound concurrency and retries; retain completed results before publishing.
- Keep result records immutable and independently recoverable. Detect conflicting snapshots/publication rather than silently replacing newer text or manually edited Markdown. Sync-delay and simultaneous-start tests must cover duplicate-request behavior, stale leases, crashes, and output recovery. Use mock inference throughout these tests.
- Offer independent manual/automatic execution settings on each device. Recommended initial configuration: automatic catch-up on Nomad and explicit Update on desktop; either device may trigger recognition at any time. Do not silently change existing execution settings during deployment.
- Desktop reads local .note files from the current vault or an external folder supplied by any sync tool; write into the current vault by default, with an optional explicit other-vault destination. Use portable notebook/page identities and recognition recipes for shared cache matching. Credentials remain device-local.
- Preserve one-page-per-request semantics with configurable simultaneous requests and separate rendering limits. Save out-of-order successes immediately, publish in page order, and enforce reservations before dispatch.
- Keep the interface generic. Share behavior and components, but give desktop a responsive, theme-aware desktop layout and Nomad its own e-ink presentation. Include a model dropdown with Custom entry and keyboard-safe forms.
- Queue rows show remaining-page cost estimates for API mode from recent comparable results, with sample confidence and conservative budget reservations kept distinct. Subscription mode shows pages, requests, reported tokens and ETA; do not invent dollar charges or a remaining-plan percentage.
- Visible physical-page headings are optional; preserve page provenance in hidden boundaries and synced result records. Changing output presentation alone must not trigger recognition. Research heading/highlight extraction without re-recognizing cached collections automatically.
- Diagram extraction/cropping is explicitly deferred.
- Satsang scope: retain the annotated 2610 notebook and exclude the 21 existing older notes by explicit relative paths. Do not use a blanket filter that would exclude future notebooks. The 0.6 Nomad rule now uses those exclusions; 36 existing cached page records were exported to Shared Data without AI calls. No prior transcripts were imported or existing outputs deleted.

## 0.6 validation record

- The 0.6 typecheck and build pass; the complete test suite passes 186/186. No paid requests were made.
- Version 0.6.0 is fully initialized and active on Nomad. Four commands are registered; the panel opens with one close control and no duplicate. The reading note remained visible with no form open. The worker was idle and globally paused; existing AI/automatic settings remained on, API provider was unchanged, and subscription sign-in was disconnected.
- The API key, cache/store, spending ledger, transcript Markdown, Reflection source hash, and Satsang source hash were preserved. The Satsang rule excludes 21 existing older notes by explicit relative path and retains the annotated 2610 notebook. Thirty-six cached page results were exported to Shared Data without AI calls.
- Obsidian Sync delivered shared metadata to Vedas; a read-only desktop check reused 32 matching results. A stale 61-page Cloud source was rejected against the 79-page Nomad publication without AI requests or writes. The Cloud Satsang 2610 source is still absent.
- The Windows reader indexed 61 real Reflection pages and rendered one PNG without changing the source hash or modification time. A physical keyboard test exposed an overlay issue; it was fixed using Obsidian's `--keyboard-height`, and live Save/Cancel stay above the keyboard.
- Desktop 0.6 is installed and registered in Vedas for its next reload, with external Cloud paths mapped; live activation is unverified and CLI activation remains disabled. Reload Vedas or enable CLI activation, refresh the Cloud mirror, and select a provider/sign-in. The backed-up `community-plugins.json` preserved Copilot and other plugin settings. Mock verification covers Finish sign-in UI only; live production auth remains unverified. The callback collision uses the distinct `nomad-transcripts-subscription-return` ID, but the native helper does not yet route the new subscription action. Wireless desktop-assisted pairing remains a separate pending task.

The desktop/cross-device scope above records agreed requirements; this record captures the current implementation evidence and remaining release gates. Diagram extraction/cropping and the .note recognition enhancer remain deferred/parked. Native handwritten heading/highlight extraction is research, not implemented behavior.
