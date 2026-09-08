"""Cross-process window preference regression; no visible windows or official task calls."""
import json, os, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
(ROOT / 'work').mkdir(exist_ok=True)
folder = Path(tempfile.mkdtemp(prefix='window-placement-', dir=ROOT / 'work'))
compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
exe = folder / 'WindowPlacementTests.exe'
subprocess.run([str(compiler), '/nologo', '/target:exe', '/platform:x64', '/codepage:65001',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
    '/out:' + str(exe), str(ROOT / 'windows/WindowPlacement.cs'), str(ROOT / 'test/WindowPlacementTests.cs')], check=True)
output = []
for stage in ('write', 'verify'):
    result = subprocess.run([str(exe), stage, str(folder / 'data')], text=True, encoding='utf-8',
        capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    print(result.stdout, end='')
    if result.returncode:
        raise RuntimeError(result.stderr)
    output += result.stdout.splitlines()
(folder / 'result.json').write_text(json.dumps({'passed': True, 'checks': output}, indent=2))
