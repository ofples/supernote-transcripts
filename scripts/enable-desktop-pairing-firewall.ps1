[CmdletBinding(DefaultParameterSetName = 'Preview')]
param(
    [Parameter(ParameterSetName = 'Preview')]
    [switch] $Preview,
    [Parameter(Mandatory, ParameterSetName = 'Apply')]
    [switch] $Apply,
    [Parameter(Mandatory, ParameterSetName = 'Undo')]
    [switch] $Undo
)

$ErrorActionPreference = 'Stop'
$port = 19457
$peer = '192.168.31.167'
$program = Join-Path $env:LOCALAPPDATA 'Programs\Obsidian\Obsidian.exe'
$tcpRuleName = 'TCP Query User{02A8BFCC-F130-4A16-8938-D137AA984307}C:\users\pless\appdata\local\programs\obsidian\obsidian.exe'
$ownedPrefix = 'Supernote-Nomad-Pairing-19457-'
$backupDirectory = Join-Path $env:LOCALAPPDATA 'SupernoteTranscripts\Firewall'
$backupPath = Join-Path $backupDirectory 'pairing-firewall-backup.json'
$otherV4 = @('0.0.0.0-192.168.31.166', '192.168.31.168-255.255.255.255')
$allV6 = @('::/0')
$narrowedPorts = @('1-19456', '19458-65535')
$narrowedPortText = $narrowedPorts -join ','
$ownedNames = @(
    "$ownedPrefix-other-private",
    "$ownedPrefix-other-private-v6",
    "$ownedPrefix-public",
    "$ownedPrefix-allow-nomad"
)

if (-not $Apply -and -not $Undo) { $Preview = $true }

function Get-PortListText($values) {
    $parts = @($values | ForEach-Object { "$($_)" })
    if ($parts.Count -eq 1 -and $parts[0] -eq 'Any') { return 'Any' }
    return (@($parts | Sort-Object { [int](($_ -split '-')[0]) }) -join ',')
}

function Get-ExactPersistentTcpRule {
    $policyRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -ErrorAction SilentlyContinue |
        Where-Object {
            $_.PolicyStoreSourceType -match 'GroupPolicy' -and
            (Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $_).Program -ieq $program
        })
    if ($policyRules.Count -gt 0) { throw 'An Obsidian inbound rule comes from Group Policy; refusing to change local firewall rules.' }
    $matches = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $tcpRuleName -ErrorAction SilentlyContinue |
        Where-Object {
            $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $_
            $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and
            $_.Profile -eq 'Private, Public' -and $application.Program -ieq $program
        })
    if ($matches.Count -ne 1) { throw 'Expected exactly one enabled persistent Obsidian TCP block rule with the audited identity.' }
    $rule = $matches[0]
    $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
    $addressFilter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule
    $interfaceFilter = Get-NetFirewallInterfaceTypeFilter -AssociatedNetFirewallRule $rule
    $localPorts = Get-PortListText $portFilter.LocalPort
    if ($portFilter.Protocol -ne 'TCP' -or $localPorts -notin @('Any', $narrowedPortText) -or
        $portFilter.RemotePort -ne 'Any' -or $addressFilter.LocalAddress -ne 'Any' -or
        $addressFilter.RemoteAddress -ne 'Any' -or $interfaceFilter.InterfaceType -ne 'Any') {
        throw 'The persistent TCP block rule has unexpected filters; refusing to change it.'
    }
    return [pscustomobject]@{ Rule = $rule; PortFilter = $portFilter }
}

function Get-OwnedRules {
    $rules = @()
    foreach ($name in $ownedNames) {
        $rules += @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue)
    }
    return $rules
}

function Test-CompleteOwnedConfiguration {
    $rules = Get-OwnedRules
    if ($rules.Count -ne 4) { return $false }
    $expected = @{
        $ownedNames[0] = @{ Action = 'Block'; Profile = 'Private'; RemoteAddress = ($otherV4 -join ',') }
        $ownedNames[1] = @{ Action = 'Block'; Profile = 'Private'; RemoteAddress = ($allV6 -join ',') }
        $ownedNames[2] = @{ Action = 'Block'; Profile = 'Public'; RemoteAddress = 'Any' }
        $ownedNames[3] = @{ Action = 'Allow'; Profile = 'Private'; RemoteAddress = $peer }
    }
    foreach ($rule in $rules) {
        $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
        if (-not $expected.ContainsKey($rule.Name) -or $rule.Enabled -ne 'True' -or
            $rule.Direction -ne 'Inbound' -or $application.Program -ine $program) { return $false }
        $filter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
        $address = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule
        $spec = $expected[$rule.Name]
        if ($rule.Action -ne $spec.Action -or $rule.Profile -ne $spec.Profile -or
            $filter.Protocol -ne 'TCP' -or (Get-PortListText $filter.LocalPort) -ne "$port" -or
            $filter.RemotePort -ne 'Any' -or $address.LocalAddress -ne 'Any' -or
            (($address.RemoteAddress | ForEach-Object { "$($_)" }) -join ',') -ne $spec.RemoteAddress) { return $false }
    }
    return $true
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Remove-OwnedRules([string[]] $Names) {
    foreach ($name in $Names) {
        Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue |
            Remove-NetFirewallRule
    }
}

function Add-ScopedRules([System.Collections.Generic.List[string]] $CreatedNames) {
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ownedNames[0] -DisplayName 'Nomad pairing: block other Private IPv4 peers' -Direction Inbound -Action Block -Enabled True -Profile Private -Program $program -Protocol TCP -LocalPort $port -RemoteAddress $otherV4 | Out-Null
    $CreatedNames.Add($ownedNames[0])
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ownedNames[1] -DisplayName 'Nomad pairing: block Private IPv6 peers' -Direction Inbound -Action Block -Enabled True -Profile Private -Program $program -Protocol TCP -LocalPort $port -RemoteAddress $allV6 | Out-Null
    $CreatedNames.Add($ownedNames[1])
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ownedNames[2] -DisplayName 'Nomad pairing: block Public profile' -Direction Inbound -Action Block -Enabled True -Profile Public -Program $program -Protocol TCP -LocalPort $port -RemoteAddress Any | Out-Null
    $CreatedNames.Add($ownedNames[2])
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ownedNames[3] -DisplayName 'Nomad pairing: allow the Nomad on Private IPv4' -Direction Inbound -Action Allow -Enabled True -Profile Private -Program $program -Protocol TCP -LocalPort $port -RemoteAddress $peer | Out-Null
    $CreatedNames.Add($ownedNames[3])
}

if ($Preview) {
    $current = Get-ExactPersistentTcpRule
    $owned = Get-OwnedRules
    if ((Get-PortListText $current.PortFilter.LocalPort) -eq $narrowedPortText -and (Test-CompleteOwnedConfiguration)) {
        'Already configured: private IPv4 peer 192.168.31.167 is allowed on TCP 19457; other peers and Public profile remain blocked.'
        exit 0
    }
    if ((Get-PortListText $current.PortFilter.LocalPort) -ne 'Any' -or $owned.Count -ne 0) {
        throw 'Firewall state is partial or unexpected; refusing preview of a guessed repair.'
    }
    'PREVIEW ONLY: no firewall changes will be made.'
    "Program: $program"
    "Peer: $peer / TCP $port / Private profile only"
    'Create four persistent scoped rules: block other Private IPv4 peers, block Private IPv6 peers, block all Public profile peers, allow only the Nomad peer on Private IPv4.'
    "Then narrow the audited Obsidian TCP block LocalPort from Any to $narrowedPortText. UDP and other ports remain unchanged."
    "Undo backup location: $backupPath"
    exit 0
}

if (-not (Test-Administrator)) { throw 'Run -Apply or -Undo from an elevated PowerShell session. No elevation is started automatically.' }

if ($Apply) {
    $current = Get-ExactPersistentTcpRule
    $owned = Get-OwnedRules
    if ((Get-PortListText $current.PortFilter.LocalPort) -eq $narrowedPortText -and (Test-CompleteOwnedConfiguration)) {
        'Already configured; no changes made.'
        exit 0
    }
    if ((Get-PortListText $current.PortFilter.LocalPort) -ne 'Any' -or $owned.Count -ne 0) {
        throw 'Firewall state is partial or unexpected; refusing to add duplicate or broaden rules.'
    }
    New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
    $backup = [ordered]@{
        version = 1
        createdUtc = [DateTime]::UtcNow.ToString('o')
        tcpRuleName = $tcpRuleName
        program = $program
        originalLocalPort = 'Any'
        peer = $peer
        port = $port
        ownedNames = $ownedNames
    }
    if (Test-Path -LiteralPath $backupPath) {
        $existingBackup = Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json
        $backupNamesMatch = (@($existingBackup.ownedNames) -join ',') -ceq ($ownedNames -join ',')
        if ($existingBackup.version -ne 1 -or $existingBackup.tcpRuleName -cne $tcpRuleName -or
            $existingBackup.program -ine $program -or $existingBackup.peer -ne $peer -or
            $existingBackup.port -ne $port -or $existingBackup.originalLocalPort -ne 'Any' -or
            -not $backupNamesMatch) { throw "Existing backup is not this script's validated rollback record: $backupPath" }
    } else {
        $backup | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $backupPath -Encoding UTF8
    }
    $createdNames = [System.Collections.Generic.List[string]]::new()
    try {
        Add-ScopedRules $createdNames
        Set-NetFirewallPortFilter -InputObject $current.PortFilter -LocalPort $narrowedPorts | Out-Null
        $after = Get-ExactPersistentTcpRule
        if ((Get-PortListText $after.PortFilter.LocalPort) -ne $narrowedPortText -or -not (Test-CompleteOwnedConfiguration)) { throw 'Post-change verification failed.' }
        'Configured and verified scoped TCP 19457 access for the Nomad peer.'
    } catch {
        try {
            Set-NetFirewallPortFilter -InputObject $current.PortFilter -LocalPort Any | Out-Null
        } catch {
            throw 'Rollback could not restore the original TCP block. Scoped guard rules were retained; manual firewall review is required.'
        }
        try { Remove-OwnedRules $createdNames.ToArray() } catch { Write-Error 'Rollback could not remove all rules created by this attempt; manual firewall review is required.' }
        throw
    }
    exit 0
}

if ($Undo) {
    if (-not (Test-Path -LiteralPath $backupPath)) { throw "No owned backup found at $backupPath." }
    $backup = Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json
    $backupNamesMatch = (@($backup.ownedNames) -join ',') -ceq ($ownedNames -join ',')
    if ($backup.version -ne 1 -or $backup.tcpRuleName -cne $tcpRuleName -or $backup.program -ine $program -or
        $backup.peer -ne $peer -or $backup.port -ne $port -or $backup.originalLocalPort -ne 'Any' -or -not $backupNamesMatch) {
        throw 'Backup identity does not match this script; refusing undo.'
    }
    $current = Get-ExactPersistentTcpRule
    $owned = Get-OwnedRules
    if ((Get-PortListText $current.PortFilter.LocalPort) -eq 'Any' -and $owned.Count -eq 0) {
        'Already undone; no changes made.'
        exit 0
    }
    if ((Get-PortListText $current.PortFilter.LocalPort) -ne $narrowedPortText -or -not (Test-CompleteOwnedConfiguration)) {
        throw 'Firewall state differs from the complete owned configuration; refusing partial undo.'
    }
    # Restore the original broad block before removing scoped guard rules.
    Set-NetFirewallPortFilter -InputObject $current.PortFilter -LocalPort $backup.originalLocalPort | Out-Null
    Remove-OwnedRules $ownedNames
    if ((Get-PortListText (Get-ExactPersistentTcpRule).PortFilter.LocalPort) -ne 'Any' -or (Get-OwnedRules).Count -ne 0) {
        throw 'Undo verification failed; inspect firewall state and the backup before retrying.'
    }
    Remove-Item -LiteralPath $backupPath
    "Restored the original TCP Any block and removed only this script's four rules. UDP and unrelated rules were untouched."
}
