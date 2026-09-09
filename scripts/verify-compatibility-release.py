"""Read-only checks of built artifacts; rejects missing/stale support metadata."""
import base64, hashlib, json, zipfile
from copy import deepcopy
from release_config import ROOT
from desktop_compatibility import compatibility, release_notes, validate_artifact_compatibility

support=compatibility()
for bad in ({}, {'desktopCompatibility':None}):
    try: validate_artifact_compatibility(bad,support)
    except RuntimeError: pass
    else: raise AssertionError('Missing metadata was accepted')
stale=deepcopy(support);stale['catalogSha256']='0'*64
try: validate_artifact_compatibility({'desktopCompatibility':stale},support)
except RuntimeError: pass
else: raise AssertionError('Stale metadata was accepted')
version=json.loads((ROOT/'package.json').read_text())['version']
notes=release_notes(version)
for artifact, report_file, manifest_file in [
    ('RemoteCodex.exe','RemoteCodex.build.json','latest.json'),
    ('RemoteCodex.apk','RemoteCodex.apk.build.json','android-latest.json'),
]:
    report=json.loads((ROOT/'dist'/report_file).read_text())
    validate_artifact_compatibility(report,support)
    manifest=json.loads(base64.b64decode(json.loads((ROOT/'dist'/manifest_file).read_text())['payload']))
    assert manifest['desktopCompatibility']==support and manifest['version']==version
    assert manifest['releaseNotesSha256']==hashlib.sha256(notes).hexdigest()
    assert manifest['sha256']==hashlib.sha256((ROOT/'dist'/artifact).read_bytes()).hexdigest()
with zipfile.ZipFile(ROOT/'dist/RemoteCodex.apk') as apk:
    assert json.loads(apk.read('assets/desktop-compatibility.json'))==support
    assert apk.read('assets/RELEASE-NOTES.md')==notes
with zipfile.ZipFile(ROOT/'work/portable-build/payload.zip') as payload:
    assert hashlib.sha256(payload.read('src/official-desktop.json')).hexdigest()==support['catalogSha256']
    assert payload.read('RELEASE-NOTES.md')==notes
print(json.dumps({'result':'PASS','bridgeVersion':version,'supportedOfficialVersions':support['verifiedVersions'],'checks':['missing/stale metadata rejected','dual manifests and artifacts match','APK compatibility asset','EXE catalog asset','signed release-note hashes']},ensure_ascii=False))
