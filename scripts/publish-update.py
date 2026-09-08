"""Publish a signed latest-only release to the user-owned tx resource server."""
from pathlib import Path
import argparse
import json
import subprocess

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument("exe",type=Path)
parser.add_argument("--version",required=True)
parser.add_argument("--host",default="root@tx")
args=parser.parse_args()
manifest=root/"dist/latest.json"
subprocess.run(["node",str(root/"scripts/sign-release.mjs"),str(args.exe.resolve()),args.version,str(manifest)],check=True)
destination=args.host+":/opt/remote-codex-updates/"
subprocess.run(["scp",str(args.exe.resolve()),destination+"RemoteCodex.exe.next"],check=True)
subprocess.run(["scp",str(manifest),destination+"latest.json.next"],check=True)
script='''
from pathlib import Path
import json,base64,hashlib,os
root=Path('/opt/remote-codex-updates')
manifest=json.loads((root/'latest.json.next').read_text())
meta=json.loads(base64.b64decode(manifest['payload']))
exe=root/'RemoteCodex.exe.next'
assert exe.stat().st_size==meta['bytes']
assert hashlib.sha256(exe.read_bytes()).hexdigest()==meta['sha256']
os.chmod(exe,0o644)
os.chmod(root/'latest.json.next',0o644)
os.replace(exe,root/'RemoteCodex.exe')
os.replace(root/'latest.json.next',root/'latest.json')
print(json.dumps({'version':meta['version'],'sha256':meta['sha256'],'exeCopies':len(list(root.glob('*.exe')))}))
'''
subprocess.run(["ssh","-o","BatchMode=yes",args.host,"python3 -"],input=script,text=True,check=True)
