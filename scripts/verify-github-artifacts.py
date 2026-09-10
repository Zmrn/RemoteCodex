"""Refuse accidental configuration/signing inclusion before public CI upload."""
from pathlib import Path
import json, re, zipfile

ROOT = Path(__file__).resolve().parents[1]
channel = json.loads((ROOT/'src/update-source.json').read_text())
for package in (ROOT/'work/portable-build/payload.zip', ROOT/'dist/RemoteCodex.apk'):
    with zipfile.ZipFile(package) as archive:
        bundled = json.loads(archive.read('src/update-source.json' if package.suffix == '.zip' else 'assets/release.json'))
        if bundled.get('baseUrl') != channel['baseUrl'] or (package.suffix == '.zip' and bundled != channel):
            raise RuntimeError('Packaged updater does not use the committed GitHub release channel')
        for name in archive.namelist():
            parts = Path(name).parts
            if '..' in parts or name.startswith('/') or re.search(
                r'(^|/)(?:data|work|\.git|\.github)/|release\.local|(?:^|/)\.env(?:\.|$)|\.(?:p12|jks|pfx)$', name, re.I):
                raise RuntimeError('Unexpected private path in package: '+name)
            if package.suffix == '.zip' and not (
                name.startswith(('src/', 'public/', 'runtime/')) or
                name in ('package.json', 'README.md', 'PORTABLE.md', 'THIRD_PARTY_NOTICES.md',
                         'FARFIELD-LICENSE.txt', 'LICENSE', 'RELEASE-NOTES.md')):
                raise RuntimeError('Unexpected EXE payload path: '+name)
            if name.endswith('.json') and re.search(rb'"sealed(?:PrivateKey|Password|Key)"\s*:\s*"[A-Za-z0-9+/=]{100,}"', archive.read(name)):
                raise RuntimeError('Encrypted user secret was included in package')
print(json.dumps({'result':'PASS','checks':['no local data or signing containers in packages','EXE payload allowlist','no encrypted user secrets in JSON']}))
