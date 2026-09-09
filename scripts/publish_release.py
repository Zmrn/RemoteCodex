"""Publish BOTH signed platforms to the configured latest-only resource directory."""
from pathlib import Path
import argparse, hashlib, json, shlex, subprocess, time, uuid
from release_config import ROOT, config
from desktop_compatibility import compatibility, release_notes, validate_artifact_compatibility

def upload_staged(file, name, host, directory, ssh_options):
    """Only replace staging after a bounded, complete, hash-checked transfer."""
    raw = file.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    for attempt in range(3):
        code = '''
from pathlib import Path
import hashlib,os,sys
root=Path(DIRECTORY)
temp=root/TEMP
try:
    remaining=SIZE;digest=hashlib.sha256()
    with temp.open('xb') as output:
        while remaining:
            chunk=sys.stdin.buffer.read(min(1048576,remaining))
            if not chunk: raise RuntimeError('Incomplete staged upload')
            output.write(chunk);digest.update(chunk);remaining-=len(chunk)
        output.flush();os.fsync(output.fileno())
    assert digest.hexdigest()==DIGEST
    os.replace(temp,root/TARGET)
finally: temp.unlink(missing_ok=True)
print('STAGED_VERIFIED')
'''.replace('DIRECTORY', repr(directory)).replace('TEMP', repr('.upload-' + uuid.uuid4().hex)).replace('SIZE', str(len(raw))).replace('DIGEST', repr(digest)).replace('TARGET', repr(name + '.next'))
        try:
            result = subprocess.run(['ssh', '-T', *ssh_options, host, 'python3 -c ' + shlex.quote(code)],
                                    input=raw, capture_output=True, timeout=max(60, min(600, len(raw) / 65536 + 30)))
            if result.returncode == 0 and result.stdout.strip() == b'STAGED_VERIFIED':
                print('Uploaded and verified staging file:', name, flush=True)
                return
        except subprocess.TimeoutExpired: pass
        if attempt < 2:
            print('Retrying staged transfer:', name, flush=True)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError('Staged upload failed; formal resources have not been replaced: ' + name)

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
    ssh_options = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                   '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
    # A retry may reuse a completely uploaded staging file, but only after
    # comparing its server-side digest. Old or partial files are sent again.
    inspect = '''
from pathlib import Path
import json,hashlib
root=Path(DIRECTORY)
print(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.next') if p.is_file()}))
'''.replace('DIRECTORY', repr(directory))
    existing = {}
    try:
        result = subprocess.run(['ssh', *ssh_options, host, 'python3 -'], input=inspect,
                                text=True, encoding='utf-8', capture_output=True, check=True, timeout=60)
        existing = json.loads(result.stdout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError): pass
    for file, name in staged + [(ROOT / 'src/update-public-key.pem', 'update-public-key.pem')]:
        if existing.get(name + '.next') == hashlib.sha256(file.read_bytes()).hexdigest():
            print('Verified existing staging file:', name, flush=True)
            continue
        upload_staged(file, name, host, directory, ssh_options)
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
    subprocess.run(['ssh', *ssh_options, host, 'python3 -'], input=script, text=True, encoding='utf-8', check=True)

if __name__ == '__main__': main()
