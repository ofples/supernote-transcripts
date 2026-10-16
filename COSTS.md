# Spending limits and estimates

Open **Mirrors → Costs → Limits and model pricing**. Defaults are **US$1 per calendar day**, **US$10 per calendar month**, and **US$0.25 per update**. All are adjustable. The extra default guards are 50 recognition requests per day and 4,096 maximum output tokens per page. Zero stops recognition; it does not remove the limit. Save applies changes; Cancel preserves existing values.

Version 0.8 groups up to four consecutive target pages in Balanced/Careful. The output allowance is per target; the actual request cap includes a quality-dependent reasoning floor. Admission reserves that full cap plus the input for all target/context images, the prompt, glossary and cached text. One group counts as one request; only valid target results count as completed pages. See [QUALITY.md](QUALITY.md) for exact presets and allowances. Costs from context and reasoning are included in rolling estimates for the selected recipe; estimates are provisional until that recipe has history.

API spending periods use the device's local calendar. Subscription attempt limits use UTC and count this plugin's local attempts, not ChatGPT plan usage or remaining quota. Subscription counters distinguish **Today (UTC)** from **All tracked activity since tracking began**; lifetime attempts include failed and uncertain requests.

One Update continuously processes eligible queued pages until finished, paused, inactive, or stopped by a limit or execution-level error. Individual page failures remain actionable while other eligible groups continue. Each update has a new update allowance; daily and monthly totals survive subsequent updates and restarts. Calendar periods use the device's local time. Automatic catch-up remains optional and only runs while Obsidian is active.

## Before sending recognition

1. Require known prices for the exact model and endpoint, a readable spending ledger, and available limits.
2. Send the exact text/image inputs to the provider's Responses `input_tokens` endpoint. An unavailable or malformed count blocks generation for that page; the plugin never guesses an image's token count. Other eligible pages can continue if their own admission checks pass.
3. Reserve the exact input count at the greatest input/cache/write rate, plus every permitted output token and 10% extra headroom. Apply the configured long-context multipliers. Count existing spent and held amounts against every limit.
4. Persist that reservation locally **before** sending the generation request. Recheck pause, app activity and AI switches after counting. Use Standard service tier and disable response storage.
5. Replace the hold with the token-derived cost when trustworthy usage returns. If usage is uncertain, keep the reservation as a hold and save a successful page result. Eligible pages may continue while the hold still leaves room under every configured ceiling.

Preflight token counting is a separate provider request containing the same page and prompt. The request count shown here counts generation reservations, not local source scans or token-count preflights. It is not a promise that every provider offers unbilled preflight requests.

Cache reads and cache writes use separate rates. Reasoning tokens are already included in output usage and are not charged twice by the estimate. Price snapshots are retained with each receipt, so changing rates never rewrites past estimates.

## Interrupted or uncertain requests

A timeout, missing/malformed usage, unexpected model/service tier, or cost above its reservation leaves an unconfirmed hold. A reservation interrupted by restart is also unconfirmed. The hold counts against configured ceilings, so other eligible pages can continue only while there is room. **Count held amount** is an optional acknowledgement that records the greater of the reservation and any known cost as spent for the selected provider. A failed request with trustworthy usage is recorded as spent but not as a recognized page. There is no exactly-once provider billing guarantee.

Corrupt or unavailable accounting storage blocks recognition because limits cannot be enforced. There is deliberately no spending-reset button. Preserve the device's WebView storage when recovering or reinstalling.

## Analytics and scope

API Costs shows today's and this month's bars, spent/held amounts, tracked lifetime estimate, recognized pages and requests, and expandable notebook/model breakdowns. Recognized pages count successful recognition events; explicitly reprocessing a page adds another event. Previous versions' paid pages have no usage receipts and are excluded. Mock development receipts remain in the isolated fixture and never enter the real ledger. Subscription mode instead reports the plugin's tracked page and attempt counts, reported tokens and estimated time; it does not estimate dollar charges or infer ChatGPT plan allowance.

The ledger is device-local, per vault, under `nomad-transcripts:<vault-name>:spending-v1` in WebView localStorage. It contains paths, page numbers, model/rates and token counts, not images, note text or API credentials. It is not synced to another device. Copying the vault to another device does not transfer its budget or history; renaming the vault changes the key.

**These are local safeguards and estimates, not an account-wide provider billing cap or invoice.** Taxes, credits, regional processing premiums, other devices/apps, provider rate changes and unknown interrupted costs can differ from these totals. Configure custom rates for your actual endpoint/model if needed. The 10% reservation headroom does not make the final settled estimate include account-specific premiums. Daily/monthly ceilings also depend on the device clock and intact local data.

## Built-in rates

Standard USD per million tokens, checked 6 October 2026:

| Model | Input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| gpt-6.1-sol | 2.00 | 0.10 | 2.50 | 10.00 |
| gpt-6-luna | 0.10 | 0.01 | 0.125 | 0.50 |
| gpt-6-astra | 10.00 | 1.00 | 12.50 | 50.00 |

These apply only to `https://api.openai.com/v1/responses`. Input above 272,000 tokens uses 2× input/cache/write rates and 1.5× output rates. Other model IDs/endpoints require explicit rates; no guess is made. Review rates when the provider changes pricing.

Sources: [Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra), [token counting](https://developers.openai.com/api/docs/guides/token-counting), [Responses usage](https://developers.openai.com/api/reference/python/resources/responses/methods/create).

## Pricing controls (0.5.0)

Open Costs with the `$` header icon. Model pricing displays the effective rates and whether they are Standard or Custom. Built-in rates retain their verification date; they are not automatically discovered from response headers or the model-list API. Customize pricing is an explicit override. Restore standard pricing removes overrides only for configured known provider/model combinations, in the unsaved draft. Save applies changes; Cancel preserves both rates and limit settings. Unknown model or endpoint prices require custom rates before API recognition can start. Changing rates never rewrites historical receipts.
