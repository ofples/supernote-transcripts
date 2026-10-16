# Recognition quality

## Current verification boundary

Version 0.11 is active on Nomad and desktop Vedas. Quality choices remain source-specific or inherited from the General profile. Device OCR is a secondary hint in Balanced/Careful; Fast remains image-only. Whole-document cleanup is a separate explicit text-only operation. Automated provider tests use mocks. No real provider recognition or cleanup quality comparison was run, and no paid calls were made. Bounded live UI checks are still in progress; see [VALIDATION.md](VALIDATION.md).

Version 0.8 adds a three-position **Recognition quality** slider in each source's settings. Settings also has the default quality for the General profile. Quality changes apply to future requests; saving a setting does not force previously saved pages to run again.

| Mode | Target pages per request | Context images | Nearby cached text | Reasoning where supported |
| --- | --- | --- | --- | --- |
| Fast | 1 | None | None | Low |
| Balanced | Up to 4 consecutive pending pages | Up to 1 page before and after | Up to 12,000 characters | Medium |
| Careful | Up to 4 consecutive pending pages | Up to 2 pages before and after | Up to 24,000 characters | High |

Fresh installations default to Balanced. Older profiles without a quality setting are treated as Fast until explicitly changed, to avoid increasing context usage silently. Quality remains independent of model choice. The reasoning parameter is sent for recognized GPT-5/6 model names on the official OpenAI Responses endpoint or subscription transport; other providers retain their own reasoning defaults. Unsupported provider/model settings fail with an actionable source error rather than being retried automatically.

## Context and faithfulness

Requests contain separately labelled target and context page images at original detail. The source prompt and glossary still apply. Context images and matching cached neighbor text help resolve handwriting; their content is not transcribed into a target page. Source images, glossary contents, and cached text are treated as untrusted reference material. The prompt preserves wording, fragments, negation, uncertainty, headings and lists; it forbids invented arguments and prose expansion.

Only consecutive pending target pages are grouped, preserving queue priorities. An isolated edited page is one target with the selected neighbors as context. Unchanged pages are not requested as targets. Page fingerprints and individual cached results remain the unit of incremental updates and cross-device reuse. An ordinary unreadable context image can be omitted; a source revision change stops the affected notebook before dispatch. Requests already underway are awaited and saved on Pause.

This version uses local neighboring context, not the entire notebook or a generated document summary. It does not add a second AI coherence pass, translate notes, or extract diagram crops. A context page changing later does not automatically invalidate every previously recognized neighboring page. Explicit Force reprocess remains available when earlier text needs improvement.

## Responses and failures

Each response contains a JSON pages list with exact target page numbers, Markdown text, and a continuation flag. Supported official API requests also use a strict JSON schema. Subscription and custom providers use the prompt protocol and strict local parsing; their native schema support has not been verified. Malformed or duplicate target entries become individual actionable failures; valid siblings are saved and later request groups continue. No failed page or charged request is automatically retried. Only the exact empty-page marker in a page's text field declares a blank page.

## Continuous documents

With page headings hidden, a confidently identified continuation joins the preceding current page's final paragraph or list item. Hidden page comments remain inline at joined boundaries. The assembler preserves real paragraph breaks and refuses joins through missing, blank, stale or failed pages, or unsafe Markdown structures such as headings, tables and fenced code. With page headings visible, pages retain their separate sections.

Existing cached pages without continuation metadata retain their current boundaries. Changing the heading option assembles cached text locally and makes no AI request. New recognition or explicit reprocessing can supply continuation metadata; the plugin does not guess it for historical results.

## Usage and budgets

One group is one request, with several target pages. Context images increase input usage; grouping shares the source prompt and glossary across targets. Four equally sized target images plus two context images have roughly 50% more visual input than four isolated pages, but this is not a 50% total-cost prediction. Reasoning and output usage vary. Queue estimates use matching model/provider/quality recipe history; estimates without history are labelled provisional and include context assumptions.

The output allowance configured in Costs is per target page. Actual grouped request caps multiply that allowance by target count, with a minimum of 4,096 tokens for Balanced and 8,192 for Careful, including reasoning tokens. Known official GPT families are conservatively capped at 128,000 output tokens. API admission reserves against the exact cap and the provider's input-token preflight, including the existing 10% reserve margin. If limits cannot cover it, no recognition request is sent; choose Fast, select fewer target pages, or increase the configured limit.

Subscription activity distinguishes attempts from completed pages and shows notebook/model and model totals. Tokens are those reported by the provider; plugin activity is not ChatGPT's remaining quota or an API invoice. Group ledgers retain every target's page identity and fingerprint, so restart recovery can hold only pages whose paid result is missing.

## Validation limits

Automated checks use mock providers, including multi-image request shapes, partial results, budgets, edited pages, interruptions, continuation assembly, and pause behavior. Desktop UI checks use an isolated fake controller. No real recognition is needed to install this feature. A representative handwriting comparison is still needed to quantify quality, latency and cost differences; increased context or reasoning is not a guarantee of better transcription.
