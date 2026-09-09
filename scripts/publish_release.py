"""Publish BOTH signed platforms to the configured latest-only resource directory."""
from pathlib import Path
import argparse, hashlib, json, subprocess
from release_config import ROOT, config
from desktop_compatibility import compatibility, release_notes, validate_artifact_compatibility

def main():
    p = argparse.ArgumentParser()
    p.add_argument('exe', type=Path, nargs='?', default=ROOT / 'dist/RemoteCodex.exe')
    p.add_argument('--apk', type=Path, default=ROOT / 'dist/RemoteCodex.apk')
    p.add_argument('--version')
    args = p.parse_args()
    settings = config()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if args.version and args.version != version: raise ValueError('Release version must match package.json')
    artifacts = [(args.exe.resolve(), 'latest.json', '.build.json'), (args.apk.resolve(), 'android-latest.json', '.apk.build.json')]
    support = compatibility()
    notes = ROOT/'dist/RELEASE-NOTES.md'
    notes.write_bytes(release_notes(version))
    staged = []
    for file, name, suffix in artifacts:
        report = json.loads(file.with_suffix(suffix).read_text())
        validate_artifact_compatibility(report, support)
        if report['version'] != version or report['bytes'] != file.stat().st_size or report['sha256'] != hashlib.sha256(file.read_bytes()).hexdigest():
            raise RuntimeError('Both platforms must be rebuilt at the same release version: ' + file.name)
        manifest = ROOT / 'dist' / name
        subprocess.run(['node', str(ROOT / 'scripts/sign-release.mjs'), str(file), version, str(manifest)], check=True)
        staged += [(file, file.name), (manifest, name)]
    staged.append((notes, 'release-notes.md'))
    host, directory = settings['sshHost'], settings['remoteDirectory'].rstrip('/')
    for file, name in staged + [(ROOT / 'src/update-public-key.pem', 'update-public-key.pem')]:
        subprocess.run(['scp', str(file), host + ':' + directory + '/' + name + '.next'], check=True)
    script = '''
from pathlib import Path
import json,base64,hashlib,os,subprocess,tempfile
root=Path(DIRECTORY)
versions=[]
for manifest,artifact in [('latest.json','RemoteCodex.exe'),('android-latest.json','RemoteCodex.apk')]:
    envelope=json.loads((root/(manifest+'.next')).read_text())
    payload=base64.b64decode(envelope['payload'],validate=True)
    signature=base64.b64decode(envelope['signature'],validate=True)
    with tempfile.TemporaryDirectory() as folder:
        sig=Path(folder)/'sig';sig.write_bytes(signature)
        subprocess.run(['openssl','dgst','-sha256','-verify',str(root/'update-public-key.pem.next'),'-signature',str(sig)],input=payload,check=True,stdout=subprocess.DEVNULL)
    meta=json.loads(payload);file=root/(artifact+'.next')
    assert meta['desktopCompatibility']==SUPPORT
    assert hashlib.sha256((root/'release-notes.md.next').read_bytes()).hexdigest()==meta['releaseNotesSha256']
    assert meta['file']==artifact and file.stat().st_size==meta['bytes']
    assert hashlib.sha256(file.read_bytes()).hexdigest()==meta['sha256']
    versions.append(meta['version'])
assert versions==[VERSION,VERSION]
guard=root/'.publishing';guard.touch()
try:
    for name in ['RemoteCodex.exe','RemoteCodex.apk','latest.json','android-latest.json','release-notes.md']:
        os.chmod(root/(name+'.next'),0o644)
        os.replace(root/(name+'.next'),root/name)
    (root/'update-public-key.pem.next').unlink()
finally: guard.unlink(missing_ok=True)
print(json.dumps({'version':versions[0],'supportedOfficialVersions':SUPPORT['verifiedVersions'],'exeCopies':len(list(root.glob('*.exe'))),'apkCopies':len(list(root.glob('*.apk'))),'releaseNotes':'release-notes.md'}))
'''.replace('DIRECTORY', repr(directory)).replace('VERSION', repr(version)).replace('SUPPORT', repr(support))
    subprocess.run(['ssh', '-o', 'BatchMode=yes', host, 'python3 -'], input=script, text=True, encoding='utf-8', check=True)

if __name__ == '__main__': main()
