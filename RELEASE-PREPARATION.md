# Release preparation

## Candidate stack

| Component | Candidate | Distribution |
| --- | --- | --- |
| Supernote Transcripts | 0.16.0 | Manual-install ZIP from `ofples/supernote-transcripts` |
| MD Reader fork | 2.2.1 | Separate plugin release from `ofples/obsidian-md-reader` |
| Paper theme | 0.5.14 | Separate theme release |
| Sidebar companion | 0.4.1 | Separate plugin release |
| Supernote Bridge | 0.6.1 | Separate signed Android APK from `ofples/supernote-transcripts` |

Each component remains independently installable and keeps its own manifest, settings, license and release. Transcripts works without the optional Reader, Paper, Sidebar or Bridge. The integration and fallback contract is in [INTEGRATION.md](INTEGRATION.md).

## Transcripts release checks

- Run `npm test`, `npm run check`, and `npm run build` against the final source revision.
- Confirm `manifest.json`, `package.json`, and `package-lock.json` use the same version and the generated `main.js` is built from that tree.
- Build the manual-install ZIP with only the plugin runtime files, license and notices. Verify its contents and SHA-256 checksum; do not include `private/`, `test-artifacts/`, local configuration, credentials, or notebook captures.
- Record the exact source commit and artifact hashes in the release notes. Keep automated checks, installed builds, and device acceptance as separate evidence.

## Bridge release checks

- Run the Android JVM tests and build with the repository's pinned Android Gradle Plugin, Java 17+, SDK 35, and Gradle 8.13.
- Confirm application ID, version name and incremented version code. Sign with the established production key so an in-place update preserves app data; a debug-signed APK is not a release artifact.
- Inspect the APK contents and signature, then calculate its SHA-256 checksum. Do not include local signing material or build intermediates.
- Keep physical-device acceptance separate from the source build and signature checks. See the [Bridge build guide](scripts/subscription-nomad/android/README.md) and [validation record](VALIDATION.md).

## Publication state

These versions are prepared as release candidates. Publishing requires passing the final checks on the exact candidate trees and attaching only the verified artifacts to the matching component releases. Do not imply a community-plugin listing or device acceptance unless those have been confirmed separately.
