"""Real Windows updater recovery from a read-only target EXE; isolated, no task writes."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import time
import uuid
from verify_portable import api, ROOT

parser = argparse.ArgumentParser()
parser.add_argument('old_exe', type=Path)
parser.add_argument('new_exe', type=Path)
args = parser.parse_args()
sandbox = ROOT / 'work' / ('update-rollback-' + uuid.uuid4().hex[:8])
home = sandbox / 'home'
data = home / 'data'
data.mkdir(parents=True)
exe = sandbox / 'RemoteCodex.exe'
shutil.copyfile(args.old_exe, exe)
data.joinpath('update-settings.json').write_text('{"automatic":false}', encoding='utf-8')
report = {'scope':'isolated real EXE, deliberately read-only target, signed cached package; no official mutations'}
def run(*opts):
    subprocess.run([str(exe),'--headless','--home',str(home),*opts],check=True,timeout=100,
                   creationflags=subprocess.CREATE_NO_WINDOW)
try:
    official = api('http://127.0.0.1:43127','/status')['officialPid']
    run()
    address = json.loads((data/'server.json').read_text())['address']
    before = api(address,'/instance')
    assert before['version'] == '0.8.0'
    api(address,'/updates/check',{})
    ready = data/'updates/ready.exe'
    ready.parent.mkdir(exist_ok=True)
    shutil.copyfile(args.new_exe,ready)
    os.chmod(exe, stat.S_IREAD)
    api(address,'/updates/install',{})
    result_file = data/'updates/result.json'
    for _ in range(120):
        if result_file.exists(): break
        time.sleep(1)
    result = json.loads(result_file.read_text())
    assert result['status'] == 'rolled-back',result
    after = api(address,'/instance')
    assert after['version'] == '0.8.0'
    assert after['instanceId'] != before['instanceId']
    assert hashlib.sha256(exe.read_bytes()).digest() == hashlib.sha256(args.old_exe.read_bytes()).digest()
    assert api(address,'/status')['officialPid'] == official
    assert api('http://127.0.0.1:43127','/status')['officialPid'] == official
    report.update(result='passed',cause='read-only target EXE',rollback=result,
                  oldBridgeRestored=True,samePort=True,originalExePreserved=True,officialPidUnchanged=True)
finally:
    os.chmod(exe,stat.S_IREAD|stat.S_IWRITE)
    run('--stop')
    (ROOT/'evidence/update-rollback.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
