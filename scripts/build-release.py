"""Canonical release entrypoint: test, build both platforms, optionally publish both."""
import argparse, json, subprocess, sys
from release_config import ROOT
from desktop_compatibility import compatibility, release_notes

p = argparse.ArgumentParser()
p.add_argument('--publish', action='store_true')
args = p.parse_args()
compatibility()
subprocess.run(['node', '--test', *[str(p) for p in sorted((ROOT / 'test').glob('*.test.mjs'))]], check=True, cwd=ROOT)
subprocess.run([sys.executable, str(ROOT / 'scripts/verify-window-placement.py')], check=True, cwd=ROOT)
for script in ('build_android.py', 'build_portable.py'):
    subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts' / script)], check=True, cwd=ROOT)
version = json.loads((ROOT/'package.json').read_text())['version']
(ROOT/'dist/RELEASE-NOTES.md').write_bytes(release_notes(version))
if args.publish:
    subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/publish-update.py')], check=True, cwd=ROOT)
