$ErrorActionPreference = 'Stop'
$desktopExe = Join-Path $PSScriptRoot 'dist\RemoteCodex.exe'
if (-not (Test-Path -LiteralPath $desktopExe)) {
    throw 'Build the portable desktop first: python scripts/build_portable.py. Then open this launcher again.'
}
# The requested app window owns its service; no separate background start.
Start-Process -FilePath $desktopExe -WindowStyle Normal | Out-Null
