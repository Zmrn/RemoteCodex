"""Canonical release entrypoint: test, build both platforms, optionally publish both."""
import argparse, subprocess, sys
from release_config import ROOT

p = argparse.ArgumentParser()
p.add_argument('--publish', action='store_true')
args = p.parse_args()
subprocess.run(['node', '--test', *[str(p) for p in sorted((ROOT / 'test').glob('*.test.mjs'))]], check=True, cwd=ROOT)
for script in ('build_android.py', 'build_portable.py'):
    subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts' / script)], check=True, cwd=ROOT)
if args.publish:
    subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/publish-update.py')], check=True, cwd=ROOT)
