"""Extract only the eight expected CI outputs; never overwrite an existing file."""
import sys, zipfile
from pathlib import Path

archive = Path(sys.argv[1]).resolve()
allowed = {'RemoteCodex.exe', 'RemoteCodex.apk', 'RemoteCodex.build.json', 'RemoteCodex.apk.build.json',
           'latest.json', 'android-latest.json', 'RELEASE-NOTES.md', 'GITHUB-BUILD.json'}
with zipfile.ZipFile(archive) as z:
    entries = z.infolist()
    if len(entries) != len(allowed) or {e.filename for e in entries} != allowed:
        raise RuntimeError('Unexpected CI artifact entries')
    if sum(e.file_size for e in entries) > 150*1024*1024 or any(e.file_size > 100*1024*1024 for e in entries):
        raise RuntimeError('CI artifact exceeds output limit')
    if any((archive.parent/e.filename).exists() for e in entries):
        raise RuntimeError('Refusing to overwrite downloaded files')
    for entry in entries:
        with (archive.parent/entry.filename).open('xb') as output:
            output.write(z.read(entry))
print('Extracted the expected dual-platform outputs; signature verification follows.')
