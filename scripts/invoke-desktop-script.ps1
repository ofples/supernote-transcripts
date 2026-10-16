[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [string]$VaultName = 'Vedas',

    [string]$ObsidianCli = 'C:\Users\pless\AppData\Local\Programs\Obsidian\Obsidian.com'
)

$ErrorActionPreference = 'Stop'

if ($VaultName -match '[\r\n]' -or [string]::IsNullOrWhiteSpace($VaultName)) {
    throw 'VaultName must be a non-empty single-line vault name.'
}

$resolvedScript = (Resolve-Path -LiteralPath $ScriptPath).Path
if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) {
    throw 'ScriptPath must resolve to a local file.'
}
if ([System.IO.Path]::GetExtension($resolvedScript) -ne '.js') {
    throw 'Only saved JavaScript files can be invoked.'
}
if (-not (Test-Path -LiteralPath $ObsidianCli -PathType Leaf)) {
    throw 'Obsidian CLI executable was not found at the configured path.'
}

# JSON string quoting produces a JavaScript string literal for readFileSync.
# The script source remains on disk and is never interpolated into the CLI payload.
$quotedPath = ConvertTo-Json -InputObject $resolvedScript -Compress
$code = 'code=(()=>{globalThis.__desktopScriptFailure=null;try{void Promise.resolve(eval(require("fs").readFileSync(' + $quotedPath + ',"utf8"))).catch(e=>{globalThis.__desktopScriptFailure={name:String(e?.name||"Error")}})}catch(e){globalThis.__desktopScriptFailure={name:String(e?.name||"Error")}}})()'
$payloadBytes = [System.Text.Encoding]::UTF8.GetByteCount($code)
if ($payloadBytes -ge 1200) {
    throw "CLI payload is $payloadBytes bytes; refusing to invoke it because the safe limit is under 1200 bytes."
}

$arguments = @("vault=$VaultName", 'eval', $code)
$null = & $ObsidianCli @arguments 2>&1
$exitCode = $LASTEXITCODE

[pscustomobject]@{
    accepted = ($exitCode -eq 0)
    exitCode = $exitCode
    payloadBytes = $payloadBytes
    scriptName = [System.IO.Path]::GetFileName($resolvedScript)
    vault = $VaultName
}

if ($exitCode -ne 0) {
    Write-Error 'Obsidian CLI returned a non-zero exit code. Check the app for its error dialog.'
}
