param([string]$Cache)
$ErrorActionPreference = 'Stop'
$buildScript = Join-Path $PSScriptRoot 'build_portable.py'
if ($Cache) { & python $buildScript --cache $Cache } else { & python $buildScript }
if ($LASTEXITCODE -ne 0) { throw 'Portable EXE build failed.' }
