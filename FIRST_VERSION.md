# Supernote Transcripts — first-version guide

The 0.3 interface replaces the long settings/status forms with **Open mirrors**, a full-screen source overview. Use **Add source** to browse notebooks/folders, **Configure** for per-source instructions and glossary files, and panel **Settings** for the model, API key and execution controls. Source and settings editors have explicit Save/Cancel. Inactive sources and technical details are collapsed. See [INTERFACE.md](INTERFACE.md).

**AI recognition off** is a persistent device-local cost gate. While it is off, Check now can inspect sources and saved results but cannot send recognition requests or queue new forced reprocessing. Mock responses are confined to isolated tests. AI and automatic updates currently remain off on the device.

Version 0.4.0 keeps page reuse, read-only source access and ownership checks. Continuous queue processing replaces small page batches. Adjustable budget gates are documented in [COSTS.md](COSTS.md).

The 0.2 first version reads selected local `.note` notebooks and maintains Markdown in the active Obsidian vault. The source interface is read-only. See [README.md](README.md) for device paths, migration and rollback.

## Configure

In **Settings → Supernote Transcripts**, add an enabled rule for a folder under `/storage/emulated/0/Note` or for one `.note` file. Set a vault-relative output folder and choose a transcription profile. Folder rules can recurse and exclude relative path prefixes; the most specific enabled matching rule applies.

The **General — no glossary** profile sends no glossary. Use **Choose glossary files** to select your own ordinary vault `.txt` or `.md` reference files for each source. No vocabulary is bundled as of 0.3.2. Existing personal glossary selections are preserved. The API key and automatic catch-up setting are device-local. Automatic catch-up is opt-in and runs only while Obsidian is active.

## Update and inspect

Choose **Update** to scan enabled sources and process eligible queued pages until finished or stopped by a budget, pause, app inactivity or error. Expand folder rows for individual notebook progress. Use the folder/notebook pause icons or global Pause/Resume. **Costs** shows spending and editable limits; defaults are $1/day, $10/month and $0.25/update.

For a manual request, select an indexed notebook and enter a page (`3`) or range (`3-6`), up to 10 pages. The range is required. Use **Update** for the notebook or collection queue. **Preview** renders locally without an AI request. **Force reprocess** can submit already-current pages again and may incur charges. New output defaults to **Supernote Transcripts/Transcripts**; use the existing-folder picker or enter a new vault-relative path.

Local saves and Obsidian Sync delivery are separate. A successfully saved note appears on other devices after normal Sync completes.

## Limits and validation

The reader streams notebook bytes in bounded blocks, rejects a block above 64 MB, and does not support mixed portrait and landscape pages within one notebook. The Android filesystem interface used to access source files is undocumented and may change with Obsidian updates. An interrupted in-flight AI request may be billed even if its result was not saved; retry can make another paid request.

Local checks, 0.2 device flows, and fixture-only API-stub scenarios are recorded in [VALIDATION.md](VALIDATION.md). Returning to Obsidian in the foreground triggered a successful bounded catch-up batch without a manual update; the test cannot isolate startup from focus as the trigger. The configured five-minute interval has not been separately time-validated. No continuous Android background execution is claimed.
