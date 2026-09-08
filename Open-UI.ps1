$ErrorActionPreference = 'Stop'
$package = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'package.json') | ConvertFrom-Json
$desktopExe = Join-Path $PSScriptRoot ('dist\RemoteCodex-' + $package.version + '-windows-x64.exe')
if (-not (Test-Path -LiteralPath $desktopExe)) {
    throw 'Build the portable desktop first: python scripts/build_portable.py. Then open this launcher again.'
}
# The requested app window owns its service; no separate background start.
Start-Process -FilePath $desktopExe -WindowStyle Normal | Out-Null
