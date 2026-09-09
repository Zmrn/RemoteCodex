"""Build/publish metadata from the same catalog used by the runtime."""
import json, subprocess
from release_config import ROOT

def compatibility():
    result = subprocess.run(['node', str(ROOT/'scripts/compatibility-report.mjs'), '--json'], cwd=ROOT, capture_output=True, check=True)
    return json.loads(result.stdout.decode('utf-8'))

def release_notes(version):
    result = subprocess.run(['node', str(ROOT/'scripts/compatibility-report.mjs'), '--release-notes', version], cwd=ROOT, capture_output=True, check=True)
    return result.stdout

def validate_artifact_compatibility(report, expected):
    if report.get('desktopCompatibility') != expected:
        raise RuntimeError('Desktop compatibility catalog changed or metadata missing; rebuild BOTH APK and EXE')
