$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll ('/win32icon:' + (Join-Path $root 'public\app-icon.ico')) ('/out:' + (Join-Path $root 'RemoteBridge.exe')) (Join-Path $root 'windows\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Output 'Built RemoteBridge.exe with the project app icon.'
