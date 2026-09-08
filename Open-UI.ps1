$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:43127/?ui=0.6.5'
function Test-Bridge {
    try { return (Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing).Content.Contains('name="bridge-csrf"') } catch { return $false }
}
if (-not (Test-Bridge)) { & (Join-Path $PSScriptRoot 'Start.ps1') -Background }
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-Bridge) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Bridge startup failed. See data\stderr.log.' }
$edgeCandidates = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found. Open http://127.0.0.1:43127/ in a browser.' }
$profile = Join-Path $PSScriptRoot 'data\windows-ui-profile'
$uiArguments = '--app="' + $url + '" --user-data-dir="' + $profile + '" --no-first-run --no-default-browser-check --window-size=1440,960'
# A visible window is intentional: this is the user-requested UI preview.
Start-Process -FilePath $edge -ArgumentList $uiArguments -WindowStyle Normal | Out-Null
