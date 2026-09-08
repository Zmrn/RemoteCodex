param([switch]$Background, [string]$AgentAddress, [ValidateRange(1,65535)][int]$AgentPort = 43128)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$existingPage = $null
try { $existingPage = Invoke-WebRequest -Uri 'http://127.0.0.1:43127/' -UseBasicParsing -TimeoutSec 2 } catch {}
if ($existingPage) {
    if (-not $existingPage.Content.Contains('name="bridge-csrf"')) { throw 'Port 43127 is occupied by another service.' }
    if ($AgentAddress) { throw 'The bridge is already running. Run Stop.ps1, then start with AgentAddress. Official tasks keep running.' }
    Write-Output 'Bridge is already running at http://127.0.0.1:43127/'
    return
}
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$nodeArgs = @((Join-Path $PSScriptRoot 'src\server.mjs'))
if ($AgentAddress) {
    if ($AgentAddress -notmatch '^[0-9a-fA-F:.]+$') { throw 'AgentAddress must be an existing Tailscale IP, without a URL or port.' }
    $nodeArgs += @('--agent-address', $AgentAddress, '--agent-port', [string]$AgentPort)
}
if ($Background) {
    New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'data') | Out-Null
    $arguments = ($nodeArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
    Start-Process -FilePath $nodeCommand -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data\stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data\stderr.log') | Out-Null
    Write-Output 'Bridge starting at http://127.0.0.1:43127 . Use Stop.ps1 to stop only the bridge.'
} else {
    & $nodeCommand @nodeArgs
}
