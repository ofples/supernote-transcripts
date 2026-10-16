# Prepared Satsang prompt upgrade

`apply-satsang-prompt.js` is prepared but must only be invoked after the coordinating agent grants the update. It requires the production plugin to be idle and paused and stops if any dialog or form is open.

The prompt JSON can use this shape (nested `prompt`, `text`, or `content` fields are also accepted):

```json
{
  "SATSANG": "Satsang-specific prompt text",
  "General": "General prompt text"
}
```

On Vedas, the helper reads `private/prompt-improvements.json` from the local project checkout. On Nomad, place the same JSON at the production plugin folder as `prompt-upgrade.json`; the helper reads it through Obsidian's vault adapter.

The helper applies only the Satsang text. It keeps that rule's model, endpoint, glossary paths, output path, exclusions, shared identity, and other settings. If another rule uses the current profile, it creates a dedicated Satsang profile rather than changing the shared one. It saves configuration only: it does not start an update, retry, transcribe, resolve a conflict, or edit Markdown.

The result stored in `globalThis.__satsangPromptUpgradeResult` contains only the selected rule/profile metadata, prompt lengths, preservation booleans, and request count. It never returns prompt text, credentials, or note contents.
