# Subscription sign-in and desktop pairing

## Pairing improvements in 0.11.2

New pairing codes contain 20 unambiguous characters in five groups, with 96 bits of randomness. Existing 32-character hexadecimal codes and saved pending sessions remain accepted. The ten-minute lifetime, five-failure limit and authenticated encryption are unchanged.

The Nomad now has **Discover** beside Desktop address. Desktop publishes one expiring locator per installation under `Supernote Transcripts/Shared Data/Pairing`. It includes only a session ID, private IPv4 addresses and expiry; it never includes the pairing code or account data. Obsidian Sync carries this locator to the Nomad. On an explicit tap, the Nomad probes only listed, validated private addresses on port 19457, accepting a desktop only if its live `/info` session matches. Probes and timeouts are bounded. Repeated pairing replaces that desktop's previous locator; stale/closed sessions cannot be selected successfully.

Start **Connect a Nomad** on desktop first, wait for vault sync, then use **Discover** on Nomad and enter the separate code. Both devices need the same synced vault and a reachable private Wi-Fi network. Manual address entry remains available. This is discovery through a synced locator plus a LAN check, not mDNS or a network scan. The browser approval and Nomad's independent credential storage are unchanged. See [the complete workflow](DESKTOP-WORKFLOW.md).

## Connection recovery in 0.11.1

The account and the recognition queue have separate state. Previously a successful reconnect could leave the queue's old "Session renewal uncertain" error in place. A healthy saved session or a newly completed sign-in now clears only matching login blockers, including the older message-only records, and makes never-sent pending pages eligible again. Existing manual pause, page errors, ambiguous request holds, quotas and budgets remain in effect. Recognition follows the existing automatic/manual settings.

When the device reports that it is offline, no renewal or recognition request is sent and the saved session remains intact. Going online clears the corresponding offline blocker. A lost response after a renewal was actually sent still requires reconnecting because its replacement credential cannot be assumed; the plugin does not repeatedly reuse a possibly rotated refresh token. Storage failures and refresh backoff remain actionable errors rather than being mistaken for successful reconnection. Fresh pre-send account failures carry explicit recovery codes in the local notebook journal.

Renewal behavior was checked against OpenAI's [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) and [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery) guidance. Tokens remain in encrypted local SecretStorage.

## Desktop pairing

The first experimental SIWC device-code compatibility POST, using the Nomad’s own issued registration, returned HTTP 400 `invalid_client`. It issued no device code, so there was no poll or token exchange and no AI request. This rejects the tested request for that registration; it does not prove every possible device-code flow is unsupported.

The desktop-assisted pairing fallback is implemented in 0.10.2 source and covered by automated tests. The desktop hosts a ten-minute relay on private IPv4. A temporary 128-bit code (32 hexadecimal characters, shown in groups of four) protects purpose-bound HKDF/AES-GCM messages. The `/info` response contains only a session ID and remaining lifetime. The desktop opens the normal browser authorization flow and receives the OAuth callback only on `127.0.0.1:19456`. The relay returns the callback result encrypted under the pairing code until the Nomad acknowledges it or the relay expires; only the OAuth code exchange is one-use. The Nomad redeems it using its own PKCE verifier and stores credentials in its own encrypted SecretStorage. Desktop credentials and shared-vault configuration are not copied or transferred. Desktop keeps its normal **Connect ChatGPT account** browser flow; on Nomad the legacy Android helper sign-in remains under **Advanced**. The helper is also retained for native notebook page links.

### Pairing steps

1. On desktop, open subscription settings and choose **Connect a Nomad**. Keep desktop Obsidian open. Use **Copy** beside one displayed address (including its port), and copy the temporary pairing code. It expires after ten minutes.
2. Connect the Nomad to the same Wi-Fi network. In its **Sign in from desktop** section, choose **Discover** or enter the displayed address manually, then enter the separate code and choose **Connect**. Discovery in 0.11.2 requires the same synced vault; older versions require manual entry.
3. Complete the OpenAI sign-in and approval in the normal browser opened on desktop. The callback returns to the desktop loopback listener.
4. The Nomad receives the encrypted one-use result, exchanges the code with its own PKCE verifier, and saves its own credentials in encrypted native storage.
5. The relay closes after acknowledgment, cancellation, or expiry. The devices need the same private IPv4 network only while pairing; after completion the Nomad can use its own connection.

The 346-test suite, typecheck, and final 0.10.2 build pass; synthetic desktop and Nomad pairing UI checks passed without external requests. Guarded activation is complete on desktop and Nomad, with installed hashes matching the release artifact and protected data preserved. Desktop and Nomad are connected. The user approved sign-in in the desktop browser; the Nomad holds its own encrypted credentials, the callback is cleared, and relay listeners on TCP 19457 and 19456 are closed. One `chatgpt.models` catalog GET returned seven models. No model identifiers or names were logged, and no recognition or inference request occurred. USB was used for installation and inspection; authentication used native private Wi-Fi. Unplugged operation has not been verified. The relay uses HTTP on the local network with authenticated encrypted payloads, not a TLS LAN endpoint. No auto-discovery, public relay, shared-vault secret, or desktop-token transfer is used.

### Windows firewall prerequisite

The 0.10.2 pairing relay listens on TCP 19457. During this verified pairing, the user manually changed the Obsidian TCP and UDP firewall rules from Block to Allow for all ports and peers on Private and Public profiles. The pairing succeeded with that user-applied configuration. The scoped helper script was not applied; its preview now refuses the changed rule state. The release evidence records this firewall scope. No scripted or narrow firewall exception is claimed.


## Version 0.10.1 — production subscription authentication recovery

When production subscription renewal is blocked, use **Reconnect** to start a fresh sign-in. When disconnected, use **Connect ChatGPT**. Reconnect does not require **Disconnect ChatGPT** first; disconnecting would clear local tokens and attempt remote revocation. Reconnect explicitly starts a fresh PKCE authorization instead of automatically retrying the old refresh token. A fresh attempt replaces the pending authorization, and callbacks from older attempts are rejected. Recovery controls passed desktop and Nomad mock UI checks. On Nomad, validation was intentionally held at the saved-account chooser while helper-free code-based sign-in is pending implementation. No password, OTP, consent, catalog request or account session was used; the account remains disconnected.

The Android helper's 0.2.1 build supports sign-in retry while its callback service is already running: a new start replaces the state, clears any prior result, and resets the ten-minute expiry while retaining the single loopback listener. Version 0.2.0 remains the minimum helper version for notebook page navigation. The 0.2.1 build keeps that route and signing certificate. The shared helper remains in production and 0.2.1 is installed on the Nomad. Live Sources/Queue navigation and source editor open/Cancel were verified; OAuth retry and page-link retesting after upgrade remain pending.

Production 0.10.1 passed 326 tests, typechecking and build. It is active on desktop Vedas; activation preserved the encrypted session and accounting data, left the worker idle and paused, and made zero recognition requests. The desktop readback showed the access token expired or near expiry; refresh-token expiry is unknown, and server time allows renewal without a renewal block. No real refresh or new sign-in was attempted during desktop validation. The cause of the earlier renewal failure cannot be confirmed because the prior session was disconnected before it could be inspected; the stale-attempt handling bug was identified in helper source and fixed. Guarded Nomad installation of 0.10.1 and helper 0.2.1 passed preservation checks, with five sources retained and the worker idle, paused and disconnected. Live Sources/Queue navigation and source editor open/Cancel passed without saving; sign-in remains intentionally held with no session restored. No catalog GET, OCR or recognition occurred. See [VALIDATION.md](VALIDATION.md) for evidence and hashes.

### Earlier device-code research

The published OpenID configuration and SIWC sign-in guide document authorization-code + PKCE, not a generic device-code grant. The single compatibility POST recorded above returned `invalid_client`; Codex CLI device-code support remains a separate flow and does not establish support for this app. See the [published OpenID configuration](https://auth.openai.com/.well-known/openid-configuration), [SIWC sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), and [Codex device-auth implementation](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs).

Desktop-assisted pairing is implemented in 0.10.2 and was verified on the Nomad. The remaining device check is unplugged operation; inference was not part of this sign-in validation.

## Historical device-only ChatGPT subscription prototype

Separate from production Supernote Transcripts 0.5.0 and the earlier USB-assisted probe. This discontinued test plugin connected one ChatGPT account and recognized one notebook page per connection; the plugin was removed from the Nomad. The shared `tools.supernote.logincallback` helper remains in production for OAuth callbacks and notebook navigation. Production recovery above is the supported path. The test did not write any original notebook, generated transcript, production cache, configuration, API key or spending ledger.

## Flow

1. Open **Nomad subscription test** from its ribbon icon or command. Choose **Continue with ChatGPT**.
2. The plugin generates a stable Nomad host ID and fresh state, nonce and PKCE verifier using WebCrypto. Pending authorization lives in Obsidian's encrypted native SecretStorage, not plugin `data.json`, the vault, browser storage or a clipboard.
3. A small separate Android app, **Supernote login helper**, binds only `127.0.0.1:19456`. It opens the external device browser after its listener is ready. It stores no files or OAuth access/refresh tokens. Its foreground callback service expires after ten minutes.
4. OpenAI redirects to the device loopback callback. The helper validates state and holds the code in memory. **Return to Obsidian** carries no code or tokens; the plugin retrieves the result once through a protected loopback request. It exchanges the code directly with OpenAI and validates the ID-token signature, issuer, audience, expiry, nonce, selected identity and granted plan scope.
5. The full rotating token set is saved as one encrypted native secret. Requests and serialized token renewal run directly on the Nomad over Wi-Fi. No Windows helper, USB reverse, public relay or hosted service participates.
6. One explicit **Recognize one page** action attempts GPT-6.1 Sol, then GPT-5.6 Sol only for a model-access rejection. There is no API-key fallback or automatic recognition retry. The test limit persists across plugin reloads, alongside its temporary result in encrypted device storage.
7. **Disconnect ChatGPT** attempts renewable-session revocation and clears local tokens, retaining the issued registration and host identity for returning login. Failure to confirm remote revocation is shown explicitly.

The callback APK is a prototype targeting Android 10, matching the current Nomad; newer Android versions and store distribution are untested. The plugin uses the supported Obsidian SecretStorage API, checked to report encryption available on the device. Other enabled Obsidian plugins share the same trusted app process; this is not isolation from malicious plugins.

## Build and install

- Plugin: `node scripts/subscription-nomad/build.mjs` (generated files under ignored `test-artifacts/subscription-nomad`).
- Android: run Gradle 8.13 `assembleDebug` in `scripts/subscription-nomad/android`, with the Android SDK configured. AGP 8.7.2, compile SDK 35, min SDK 26, target SDK 29; no external runtime dependencies.
- APK: `scripts/subscription-nomad/android/build/outputs/apk/debug/NomadLoginCallback-debug.apk`.
- Install the APK and the three generated plugin files in the Nomad-only Obsidian configuration. Enable the separate `nomad-subscription-test` plugin. Production `nomad-transcripts` remains separate.
- Keep the ordinary worker paused for this test. No queue automation is enabled by the test plugin.
- To remove the historical test plugin, disable it and remove only its directory. Keep the shared `tools.supernote.logincallback` helper installed while production page navigation uses it. Do not clear the entire Obsidian secret store.

## Evidence and limitations

- APK and plugin build/typecheck passed. Thirteen targeted tests cover both prototypes: WebCrypto signature/claim validation, stale/replayed callbacks, scope, refresh rotation fields, model rejection fallback, and terminal stream handling.
- APK manifest/package/permissions inspected; callback service is unexported and binds loopback only. Installed on the Nomad. Obsidian 1.13.8 reports encrypted SecretStorage available.
- During the historical test, the separate plugin was enabled and its initial login successfully launched the local callback service in foreground. The user completed sign-in through the Nomad browser, with verified ID-token identity and plan permission. The callback was retrieved directly by Obsidian, and the helper service stopped. The test plugin was later discontinued and removed; the shared helper remains in production. No USB reverse or Windows helper was installed for this flow.
- Read the encrypted entry back through native SecretStorage loading, compared it in-process without emitting credentials, unloaded/reloaded the test plugin, and confirmed the renewable session survived. This validates native write/read and plugin reload, not a complete Android reboot.
- Production configuration/cache/API key/spending record/output content preservation checks passed after login and reload; AI and automatic remain enabled, with the ordinary queue paused. The source Reflection notebook hash was unchanged at that checkpoint.
- The user unplugged USB, kept Wi-Fi on, explicitly recognized Reflection page 1, and reported **Completed with 6.1 Sol**. This confirms the device-only recognition workflow by live user observation. Its token counts, stored result and post-recognition file hashes have not been independently retrieved after unplugging. No desktop helper or USB reverse participated. The test's source API remains read-only and transcript writes are absent by construction.
- Real access-token expiry/renewal is not yet observed; token refresh fields and rejection conditions are covered locally. There is no automatic background notebook processing or production subscription integration in this prototype.
- The installed device build predates the small source-only changes preventing overlapping login starts and sanitizing validation error messages. Those changes have been built/typechecked locally; staging them on the device remains pending. They do not change the successful recognition path.

## Superseded login planning (16 October 2026)

Earlier helper-free device-code and protected desktop token-transfer ideas were exploratory and unimplemented. The device-code attempt and implemented 0.10.2 LAN relay are documented above; production device verification remains pending.

## Sources

- [OpenAI registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Session security, renewal and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Subscription request requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)
- [Android foreground services](https://developer.android.com/develop/background-work/services/fgs/declare)
