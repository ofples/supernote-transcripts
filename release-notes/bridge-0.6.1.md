# Supernote Bridge 0.6.1

Supernote Bridge 0.6.1 is an optional Android companion for MD Reader 2.2.1 and Supernote Transcripts 0.16.0. It is distributed separately from the Transcripts plugin and remains optional for ordinary reading and transcription.

## Digest handoff and provenance

- Keep authenticated Quick Digest requests backward compatible while binding optional delivery choices to the request signature.
- Bound and validate delivery options before handling a request.
- Show a concise native Digest comment with the user's note and readable source provenance. Preserve exact legacy comment formatting when verifying older saved receipts.
- Keep Reader Highlight and Digest receipt behavior separate from edits to source Markdown and `.note` files.

Bridge writes native Digest entries through the permissioned Knowledge provider and verifies the returned row before recording success. It does not make AI requests or modify original notebooks. Native Digest-to-notebook backlinks remain unsupported.

Automated verification passed: 41/41 JVM tests and the APK build. The APK declares `tools.supernote.logincallback`, versionCode 9, and versionName 0.6.1. Its signing certificate SHA-256 is `9b2dd09ca2ea875af4872f3be4da6ee980f1cdb37d3dd001af62a3c6373e6f34`, matching the previous published Bridge APK. The APK checksum is attached as `SHA256SUMS`. The live workflow evidence in [Native Digests](../docs/native-digests.md) applies to earlier local candidates; it does not establish device acceptance for this release build.
