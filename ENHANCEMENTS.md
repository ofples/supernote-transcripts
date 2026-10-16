# Source controls, provisional OCR, cleanup and reader links

## Version 0.11

This pass keeps the existing plugin ID, credentials, spending ledgers, source mappings and raw AI page cache. Native Digest capture is deferred in [MD Reader enhancement #1](https://github.com/ofples/obsidian-md-reader/issues/1).

### Source settings

Destination, recognition quality, default/custom model choice and automatic recognition are visible in the source editor. The destination picker browses vault folders with breadcrumbs and search, and can create a named child folder. Optional source instructions and reference files remain source-specific.

Automatic recognition is a source opt-out within the device's global automatic setting. A source set to Manual is skipped by automatic runs but still participates in an explicit Update. Source/notebook Pause and global Pause continue to stop new dispatch. Changing model, quality, instructions or glossary contents does not automatically charge for old pages. Re-recognize pages accepts lists and ranges, for example `1, 3-5, 12`, or only pages whose saved recipe differs from the current settings. The action binds the selection to stable page IDs, not a potentially stale page ordinal.

Desktop uses a bounded, theme-aware dialog with compact controls. Nomad retains its larger e-ink controls. Settings stays visible in the header, including while settings is open. Successful Open transcript/Open mirror/Open backup actions close the dialog.

## Device OCR

The bounded notebook reader can read embedded `RECOGNTEXT` records using the pinned parser's base64 JSON format. It does not request device recognition or modify the `.note` file. Missing, unsupported, malformed or oversized optional records supply no text; source revision changes still stop the affected read.

OCR is stored separately from successful AI results. Current AI text takes precedence; otherwise available current-page OCR is published provisionally while the AI page remains pending. The document identifies provisional text. OCR never counts as completed AI work, never proves a page blank, and cannot overwrite a current AI transcription. It is excluded from visual fingerprints, so a device OCR refresh alone does not invalidate successful AI text.

Balanced/Careful receive bounded labelled OCR and previous-target text as secondary hints. Fast remains image-only. The current handwriting image is authoritative; old text must not conceal edits. These hints share the existing nearby-text allowance rather than adding an unbounded second context window.

## Page provenance

New successful page results retain provider, actual returned model when available (otherwise the requested model), quality, recognition time, and hashes of the prompt and reference text. Shared result records whitelist and retain these fields; old records remain readable and unknown historical dates are not invented. The opaque recipe hash still determines exact settings compatibility. Notebook details expose readable provenance under Technical details; Markdown page markers remain compact and stable.

## Whole-document cleanup

Cleanup is an explicit operation on one notebook. It requires a current AI result for every page and reads the current full Markdown, including manual text corrections, along with the source instructions and `.md`/`.txt` reference files. It sends **one text-only request**, with high reasoning where supported and no notebook images. It asks for faithful corrections and continuous formatting, not a summary or expanded essay. All original page identities must remain represented in the structured response.

The default updates the current transcript; Save a separate copy is optional. Before applying a valid result, both the old document and the paid cleanup result are saved in History. Raw AI results remain unchanged. The cleaned text is a presentation layer per original page, tied to the exact underlying text and page fingerprint. Later pages can append without undoing existing cleanup. An edited or explicitly re-recognized page loses only its affected cleanup layer; other cleaned pages remain. Cleanup is never retried automatically.

If source content, destination, model/profile/reference text or the Markdown changes during the request, publication is refused and the paid cleanup result remains in History. Shared publication receipts carry cleanup presentation metadata so another device can preserve it. An incompatible same-page base result blocks replacement until shared data is available; a received cleaned document must not be silently rebuilt as raw text.

Estimates are provisional. API requests use the existing input-token preflight and monetary reservations before generation; subscription mode counts one attempt and reported tokens against the plugin's configured request limit. Processed-page totals include cleanup pages, not only first-time image recognition. Cleanup attempts have a distinct recipe namespace so interrupted cleanup does not create failed-image-page holds. Provider quota is not inferred from subscription counters.

Application limits: the complete assembled cleanup prompt must fit 400,000 characters; official API preflight also refuses more than 100,000 input tokens. Output allowance includes reasoning and is bounded at 128,000 tokens. Provider/model limits may be smaller. Oversized or incomplete operations fail explicitly; the plugin never silently chunks or truncates a whole-document cleanup. See [OpenAI token-counting documentation](https://developers.openai.com/api/docs/guides/token-counting) for preflight and visible/reasoning output accounting.

## Notebook page links

The matching MD Reader fork exposes exact source-line maps through chapter packing and footnote handling. The transcript adapter verifies the canonical managed file and its page identities before rendering inline chips, including in prefetched chapters. Repeated chapter text is never matched by a naive text search. Chips are inserted before pagination and marker-only paragraphs are attached to adjacent text.

On Nomad, a chip still opens native Notes through the installed page-link helper. On desktop it resolves the stable ID in the latest local `.note`, then opens `#page=N` using an enabled notebook viewer when that source is inside the current vault. External files or a missing viewer use a read-only original-page image preview. Navigation does not request recognition.

Cloud Sync can own a dedicated raw notebook folder in the desktop vault, excluded separately from Obsidian Sync. Generated Markdown, glossaries and Shared Data stay outside that exclusion. No Cloud Sync fork or second competing `.note` viewer is needed. The transcript plugin does not change Sync exclusions, Cloud credentials or Cloud ownership.

## Verification

Automated provider tests use mocks; UI fixtures block outbound requests. Build/type checks, source tests, synthetic browser checks, installed artifact checks and real device interaction are separate evidence. A real cleanup/recognition quality comparison is intentionally not part of cost-free installation verification.
