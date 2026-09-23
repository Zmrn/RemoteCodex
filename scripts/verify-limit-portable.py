"""Check the packaged Limit EXE in an isolated home without touching the local official app."""
from pathlib import Path
import json, os, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[1]
home = Path(tempfile.mkdtemp(prefix='limit-portable-check-', dir=ROOT/'work'))
exe = ROOT/'dist/LimitRemoteCodex.exe'
env = os.environ.copy()
for name in ('PYTHONHOME', 'PYTHONPATH', 'NODE_PATH', 'NODE_OPTIONS',
             'REMOTE_BRIDGE_DATA_DIR', 'REMOTE_BRIDGE_PYTHON'):
    env.pop(name, None)
result = subprocess.run([str(exe), '--headless', '--home', str(home), '--self-test'],
                        capture_output=True, text=True, timeout=90, env=env,
                        creationflags=subprocess.CREATE_NO_WINDOW)
report_file = home/'data/self-test.json'
if not report_file.is_file():
    raise RuntimeError('Limit EXE did not write its isolated self-test result: '+result.stderr[-500:])
report = json.loads(report_file.read_text(encoding='utf-8'))
checks = report.get('checks', {})
if result.returncode != 0 or report.get('result') != 'passed' or not all(
        checks.get(key) for key in ('bundledNode', 'bundledPython', 'dpapiRoundTrip',
                                    'webAssets', 'localOfficialAccessDisabled')):
    raise RuntimeError('Limit EXE runtime or local-access isolation failed: '+json.dumps(report, ensure_ascii=False))
if 'officialDesktopFound' in checks or 'officialProjectsAndThreads' in checks or 'desktopConnection' in report:
    raise RuntimeError('Limit EXE self-test unexpectedly accessed local official desktop')
print('Limit EXE isolated runtime, DPAPI and local official access disabled: PASS')
