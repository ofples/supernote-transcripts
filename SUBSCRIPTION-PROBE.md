# ChatGPT subscription experiment

This is an isolated experiment, separate from installed Supernote Transcripts 0.5.0. It uses documented Sign in with ChatGPT, not an API key, browser cookies or private endpoints. Production configuration and cache are not modified.

## Design

- The Windows loopback helper in `scripts/subscription-probe/server.mjs` validates OAuth state, PKCE, nonce, JWKS signature, issuer, audience, expiration and granted plan permission before inference. The user authorizes it in their browser.
- OAuth credentials stay in memory. The ignored private directory contains only host/registration identifiers and a temporary local bridge secret. The helper revokes its renewable session on shutdown or timeout.
- `device.ts` builds as a separate temporary Obsidian plugin, `nomad-subscription-probe`, staged without changing the saved enabled-plugin list. A USB reverse port connects it to the helper.
- During an explicit device-access window, it receives one in-memory access-token lease, discovers account-specific models and sends one locally rendered notebook page directly from the Nomad to the public Responses API. With explicit user authorization it attempts GPT-6.1 Sol even when absent from the displayed catalog, then allows one GPT-5.6 Sol fallback only for a model-access rejection. Quota, transport and incomplete response errors stop without retry. There is no API-key fallback.
- Requests set `store: false` and `stream: true`, omitting unsupported parameters. Results require `response.completed`; late usage-limit failures or incomplete streams fail explicitly.
- Output is temporary. No Markdown, cache, glossary or original notebook is written. Source revisions are checked around rendering. Tokens never enter localStorage, plugin data or diagnostic output.

This first experiment uses desktop-assisted login. It does not establish independent Android login, secure durable Android token storage, renewal after restart, or operation without the helper. Official remote-host guidance describes local login and protected session transfer, with attribution limitations.

## Run

1. Build: `node scripts/subscription-probe/build.mjs`.
2. Start: `node scripts/subscription-probe/server.mjs`. Open `http://127.0.0.1:19455/` on Windows and choose Continue with ChatGPT. Prefer a small app allowance and disable purchased-credit use in ChatGPT's app controls.
3. Stage the three generated files; add USB reverse port 19455 and Obsidian debug forward port 19222.
4. Obtain a device-access window. The normal worker must be idle; preserve any user-owned form and their AI/automatic preferences. Run `control.mjs connect`, then `control.mjs open` only when available.
5. Choose one notebook page and Test one page. This consumes ChatGPT plan allowance. There is no API-key billing route; app credit settings remain controlled by the user.
6. `control.mjs result` returns sanitized results. `control.mjs close` unloads the temporary plugin and `control.mjs shutdown` ends the helper. Remove only its three plugin files and the temporary USB reverse afterward.

## Evidence: 7 October 2026

- Nine security/catalog/stream/request/fallback mock tests pass; the complete suite had 105 passing tests before the catalog and fallback tests were added. Device prototype typecheck and build pass.
- OpenAI discovery returned its published issuer, JWKS and revocation endpoint.
- Browser launch was blocked by system policy; the user opened the local login link. Two local-page defects were fixed: null Origin on protected forms and CSP blocking cross-origin form redirects. The live form contract verifies its CSRF protection and explicit OpenAI redirect allowance. Browser automation inspection timed out.
- User sign-in succeeded twice. ID-token signature and claims and ChatGPT direct-plan permission were verified. The first renewable session was ended before the second login.
- During the authorized Nomad window, the production queue was paused after its active page completed. The temporary plugin rendered Reflection page 1 and called the subscription model catalog. It stopped before inference because GPT-6.1 Sol was absent. Production settings/cache/key/spending record/output files and the source notebook were unchanged during the test; production AI and automatic remained enabled, with the queue paused. The temporary plugin was unloaded and device access released.
- The read-only Windows and device displayed catalogs contain `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. The response uses `models` with slugs; the first stop was not a format mismatch.
- The user then explicitly requested a direct GPT-6.1 Sol attempt with GPT-5.6 Sol fallback. The Nomad sent exactly one Responses request with `model: gpt-6.1-sol`; HTTP 200 and `response.completed` returned the handwritten page transcription. Usage was 3,003 input and 95 output tokens (3,098 total). The fallback was not used. The successful request proves absence from the displayed catalog did not mean inference was unavailable. The exact server-side reason for the catalog discrepancy remains unknown. The probe records the requested model, not a separately retained returned model field.
- The notebook SHA-256 remained `c05ae322bb5cbf51a330551a6f19d104e576517f2f3daade5510a4f86d7fa336`. Production configuration, cache, API key, spending record and output contents passed preservation checks. AI and automatic preferences remain enabled; the normal queue remains paused. The probe was unloaded, its three device files and USB reverse were removed, and the helper was shut down through session revocation. Device access is released. Safe output/usage evidence is in ignored `test-artifacts/subscription-probe/live-result.json`.
- Independent Android login, secure durable Android storage, restart renewal and operation without the helper remain unvalidated. The subscription route has not been integrated into production 0.5.0.

## Official sources

- [Registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Session security](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Supported requests and inputs](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Account-specific models](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Model rollout and client availability](https://learn.chatgpt.com/docs/models)
- [Remote-host transfer](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
