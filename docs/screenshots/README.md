# Interface examples

These are captures of the plugin UI rendered from synthetic fixtures for the 0.12.3 working tree. The final fixture run reported 652 assertions across desktop, narrow desktop, and Nomad-sized layouts, with no production Obsidian/config use, external requests, or real recognition calls. Per viewport, controlled success stubs exercised three cleanup completions and one re-recognition completion; they did not contact a provider. The notebook labels and paths are fixture display values; no notebook contents, account data, tokens, settings profiles, or reading positions are included. These screenshots show layout and controls; they do not establish release status or live Nomad validation.

## Sources overview

The desktop Sources screen shows page progress, attention notices, source controls, and **Update**.

![Synthetic desktop Sources screen showing fixture notebook labels, progress, and source controls](sources-desktop.png)

## Source settings

The source editor shows a single-notebook source and the aligned Markdown output folder picker.

![Synthetic single-notebook source editor with output folder controls](source-editor-desktop.png)

The narrow layout stacks the output path and folder button while keeping both aligned to the form's right edge.

![Synthetic narrow desktop source editor showing the aligned output-folder control](source-editor-narrow.png)

## Notebook actions

Expanded notebook children keep their row focused on the notebook name, progress and available actions. Open **Details** to reach document workflows.

![Synthetic Sources view with compact expanded notebook children and Details actions](notebook-child-actions-desktop.png)

The notebook Details view opens the separate cleanup and page re-recognition workflows.

![Synthetic notebook Details view with separate Cleanup and Re-recognize actions](notebook-details-actions-desktop.png)

## Transcript workflows

Cleanup is a text-only operation with a per-run model and estimate. **Save cleaned text as a separate copy** reveals a new Markdown path field; the original transcript remains unchanged.

![Synthetic Cleanup workflow showing the model and estimate](cleanup-workflow-desktop.png)

![Synthetic Cleanup workflow with the separate-copy path enabled](cleanup-save-copy-desktop.png)

Re-recognition accepts selected page numbers or ranges and shows the expected work before the request.

![Synthetic Re-recognize pages workflow with range and estimate](reprocess-workflow-desktop.png)

## Queue estimate

The estimate shows four eligible remaining pages, excludes an attention source, and explains the comparable-page basis and conservative reservation.

![Synthetic desktop Queue with expanded eligible-work estimate](queue-estimate-desktop.png)

![Synthetic Nomad-sized Queue with expanded eligible-work estimate](queue-estimate-nomad.png)

## Spending pause

The Queue shows that spending limits paused recognition and provides a **Review Costs** action.

![Synthetic spending-paused Queue with the Review Costs action](queue-spending-paused-desktop.png)

## Force update recovery

The warning explains that Force update uses this device’s saved results, creates a backup, and may duplicate requests or replace newer transcript text.

![Synthetic Force update warning with backup, risk, estimate, and re-recognition option](force-update-warning-desktop.png)

## Shared settings recovery

Conflicting synced settings show the fields that differ and ask which version to keep. A separate sync failure offers **Retry Sync**.

![Synthetic source settings conflict with explicit device-versus-synced choices](settings-conflict-desktop.png)

![Synthetic shared settings sync failure with Retry Sync](settings-sync-retry-desktop.png)

The **Shared mirror** help text summarizes the difference between per-device configuration folders and the Markdown files shared through the vault.

![Synthetic Shared mirror help text explaining per-device configuration and shared vault content](shared-mirror-help-desktop.png)

For task instructions see the [user guide](../user-guide.md); for setup see [installation](../installation.md).
