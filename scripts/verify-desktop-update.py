"""Upgrade a real desktop using the signed release and a verified cached EXE."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, time, uuid
from verify_portable import api, ROOT
from verify_lifecycle_support import processes, tree, wait_gone

parser=argparse.ArgumentParser()
parser.add_argument('old_exe',type=Path)
parser.add_argument('new_exe',type=Path)
parser.add_argument('--legacy',action='store_true')
args=parser.parse_args()
folder=ROOT/'work'/('desktop-update-'+uuid.uuid4().hex[:8]);home=folder/'home';data=home/'data'
data.mkdir(parents=True);(data/'update-settings.json').write_text('{"automatic":false}')
exe=folder/'RemoteCodex.exe';shutil.copyfile(args.old_exe,exe)
report={'scope':'real desktop update with tx signed manifest and cached matching package; no task writes','legacy':args.legacy}
official=api('http://127.0.0.1:43127','/status')['officialPid']
launcher=None
try:
    command=[str(exe),'--home',str(home)]
    if args.legacy:command.append('--headless')
    launcher=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(300):
        if (data/'server.json').exists():break
        time.sleep(.3)
    before=json.loads((data/'server.json').read_text());address=before['address']
    prior=tree(before['pid']) if args.legacy else tree(launcher.pid)
    state=api(address,'/updates/check',{});assert state['available'] and state['latestVersion']=='0.9.0',state
    ready=data/'updates/ready.exe';ready.parent.mkdir(exist_ok=True);shutil.copyfile(args.new_exe,ready)
    if args.legacy:api(address,'/updates/install',{})
    else:api(address,'/updates/settings',{'automatic':True})
    result_file=data/'updates/result.json'
    for _ in range(180):
        if result_file.exists():break
        time.sleep(1)
    result=json.loads(result_file.read_text());assert result['status']=='updated',result
    after=api(address,'/instance');owner=json.loads((data/'desktop.json').read_text())
    assert after['version']=='0.9.0' and after['instanceId']!=before['instanceId']
    assert owner['pid'] in processes()
    assert hashlib.sha256(exe.read_bytes()).digest()==hashlib.sha256(args.new_exe.read_bytes()).digest()
    wait_gone(prior)
    assert api(address,'/status')['officialPid']==official
    latest=tree(owner['pid'])
    assert any(p['name']=='msedgewebview2.exe' for p in latest)
    subprocess.run([str(exe),'--headless','--home',str(home),'--stop'],check=True,timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
    wait_gone(latest)
    report.update(result='passed',upgrade=result,samePort=True,newWindowOwnsService=True,oldProcessesExited=len(prior),newProcessesExitOnStop=len(latest),officialUnchanged=True)
finally:
    subprocess.run([str(exe),'--headless','--home',str(home),'--stop'],timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
    (ROOT/('evidence/desktop-update-'+('legacy' if args.legacy else 'native')+'.json')).write_text(json.dumps(report,indent=2))
print(json.dumps(report))
