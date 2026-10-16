# Desktop script invoker

Run a reviewed, saved JavaScript helper inside the selected Obsidian vault:

```powershell
.\scripts\invoke-desktop-script.ps1 -ScriptPath .\scripts\my-helper.js -VaultName Vedas
```

The wrapper resolves and JSON-quotes the local file path, then sends Obsidian CLI a short `readFileSync`/`eval` expression. It never puts the helper source into the CLI argument. The payload must remain under 1,200 UTF-8 bytes. The wrapper suppresses CLI output so a helper cannot accidentally print prompts, credentials, or note text.

Async helpers should store a sanitized result in a named `globalThis` property before they finish. The wrapper records only an error name in `globalThis.__desktopScriptFailure` when evaluation throws. Read a sanitized result with a separate short CLI call, for example:

```powershell
& 'C:\Users\pless\AppData\Local\Programs\Obsidian\Obsidian.com' vault=Vedas eval 'code=JSON.stringify(globalThis.__mySafeResult)'
```

Return only booleans, counts, lengths, and other reviewed metadata from helpers. Never serialize raw credentials, usage records, prompt content, or note contents into the result.
