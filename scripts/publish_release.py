"""Retired server publisher; transfer helper retained only for historical tests."""
from pathlib import Path
import argparse, hashlib, json, shlex, subprocess, time, uuid

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
    raise RuntimeError('Server publication is retired. Use node scripts/github-actions.mjs publish RUN_ID for verified GitHub build artifacts; do not rebuild locally.')

if __name__ == '__main__': main()
