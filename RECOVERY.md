# Edited transcripts

Editing generated Markdown does not discard cached recognition. An update stops before overwriting the edited file and before sending new page requests. The notebook shows **Resolve edits** in its status, in the mirror list, and in the attention section of Queue.

## Recover a mirror

1. Open **Resolve edits**. If an update is running, pause it and wait for active requests to finish.
2. Expand **Compare versions** to see the current Markdown and the proposed mirror, rebuilt from saved page recognition. Preview reads the notebook's latest page metadata into a private working copy, so pages added while syncing was blocked are included without running AI. This is a complete text comparison, not an automatic merge or a line diff.
3. Choose one action:
   - **Back up edits and restore mirror** saves the complete edited file under `Supernote Transcripts/History/<notebook name>/`, then restores generated Markdown to the original destination. **Open backup** opens the preserved version.
   - **Keep edits · create new mirror** keeps the edited file at its current path and creates a sibling such as `Notebook (mirror).md`. That notebook continues syncing into the new mirror, including after restart. **Open mirror** opens the new destination.
4. Resume or update when ready to recognize pending pages. Recovery itself makes no AI requests and does not enable or resume recognition.

Unchanged recognized pages are reused. Pages still awaiting recognition are labelled honestly; restoring cached Markdown does not pretend they have been recognized. Neither recovery action modifies a `.note` source or adds manual corrections to the AI result cache.

If the Markdown or source notebook changes after preview, recovery refuses to overwrite it: reload the comparison first. The restore action stops if the backup cannot be saved. A different notebook's output or an unrelated personal note cannot be overwritten through this action.

A sibling mirror's destination is a device-local binding, like the source/output settings. Obsidian Sync delivers its Markdown to your other devices; a second recognition device keeps its own output binding. Restoring the original destination is the simplest recovery when both devices already recognize into the same synced path.

## Other conflicts

Newer or conflicting shared inventories and missing synced result records require the source or Obsidian Sync to catch up. **Resolve edits** does not override those checks. Legacy releases sometimes lost the saved inventory after an append: migration accepts an older publication only when its owned hash, unchanged page prefix and all cached result text prove it belongs to the current notebook. Reorders, deletions and changed earlier pages cannot use that migration shortcut.

## Later merging

A future three-way merge should compare the exact last published baseline, your edited Markdown and newly generated Markdown. It should preserve edits on unchanged pages, append new pages, and ask for a decision where both versions changed the same content. This release offers explicit recovery; it does not silently merge corrections.
