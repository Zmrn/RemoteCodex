"""Portable desktop process-lifetime tests. UI close itself is exercised with Computer Use."""
from pathlib import Path
import argparse, ctypes, ctypes.wintypes as w, json, shutil, subprocess, time, uuid
from verify_portable import api, ROOT

k=ctypes.WinDLL('kernel32',use_last_error=True)
class Entry(ctypes.Structure):
    _fields_=[('size',w.DWORD),('usage',w.DWORD),('pid',w.DWORD),('heap',ctypes.c_size_t),('module',w.DWORD),('threads',w.DWORD),('parent',w.DWORD),('priority',w.LONG),('flags',w.DWORD),('name',w.WCHAR*260)]
k.CreateToolhelp32Snapshot.argtypes=[w.DWORD,w.DWORD];k.CreateToolhelp32Snapshot.restype=w.HANDLE
k.Process32FirstW.argtypes=[w.HANDLE,ctypes.POINTER(Entry)];k.Process32NextW.argtypes=[w.HANDLE,ctypes.POINTER(Entry)]
k.CloseHandle.argtypes=[w.HANDLE]
def processes():
    handle=k.CreateToolhelp32Snapshot(2,0);entry=Entry();entry.size=ctypes.sizeof(entry);result={}
    try:
        ok=k.Process32FirstW(handle,ctypes.byref(entry))
        while ok:
            result[entry.pid]={'pid':entry.pid,'parent':entry.parent,'name':entry.name}
            ok=k.Process32NextW(handle,ctypes.byref(entry))
    finally:k.CloseHandle(handle)
    return result
def tree(pid):
    allp=processes();ids={pid}
    while True:
        more={p['pid'] for p in allp.values() if p['parent'] in ids}
        if more<=ids:break
        ids|=more
    return [allp[p] for p in ids if p in allp]
def wait(fn,seconds=90):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        try:
            result=fn()
            if result:return result
        except (OSError,ValueError):pass
        time.sleep(.3)
    raise AssertionError('Timed out waiting for lifecycle transition')
def record(home):return json.loads((home/'data/server.json').read_text())
def launch(exe,home):
    p=subprocess.Popen([str(exe),'--home',str(home)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    r=wait(lambda:record(home) if (home/'data/desktop.json').exists() and api(record(home)['address'],'/instance')['version']=='0.9.0' else None)
    assert p.poll() is None
    wait(lambda:any(x['name']=='msedgewebview2.exe' for x in tree(p.pid)))
    time.sleep(2)
    return p,r,tree(p.pid)
def assert_gone(before):
    ids={p['pid'] for p in before}
    wait(lambda:not(ids & processes().keys()),25)
def stop(exe,home):
    subprocess.run([str(exe),'--headless','--home',str(home),'--stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=40,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
parser=argparse.ArgumentParser()
parser.add_argument('mode',choices=['prepare','closed','crash','migrate'])
parser.add_argument('exe',type=Path)
parser.add_argument('--old-exe',type=Path)
args=parser.parse_args()
state_file=ROOT/'evidence/lifecycle-fixture.json'
report_file=ROOT/'evidence/lifecycle-verification.json'
report=json.loads(report_file.read_text()) if report_file.exists() else {'scope':'isolated owned desktop process; real WebView2; no official task writes','checks':{}}
official=api('http://127.0.0.1:43127','/status')['officialPid']
if args.mode=='closed':
    state=json.loads(state_file.read_text());assert_gone(state['processes'])
    try:api(state['address'],'/status')
    except OSError:pass
    else:raise AssertionError('Closed UI left an accessible listener')
    report['checks']['realWindowClose']={'passed':True,'ownedProcessesExited':len(state['processes']),'portClosed':True}
else:
    folder=ROOT/'work'/('lifecycle-'+uuid.uuid4().hex[:8]);home=folder/'home'
    (home/'data').mkdir(parents=True)
    (home/'data/update-settings.json').write_text('{"automatic":false}')
    exe=folder/'Remote Codex.exe';shutil.copyfile(args.exe,exe)
    oldpid=None
    if args.mode=='migrate':
        old=folder/'Legacy.exe';shutil.copyfile(args.old_exe,old)
        subprocess.run([str(old),'--headless','--home',str(home)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=90,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        oldpid=record(home)['pid'];assert oldpid in processes()
    p,r,before=launch(exe,home)
    assert r['remoteAddress'] is None
    assert r['pid'] in {x['pid'] for x in before}
    assert api(r['address'],'/status')['officialPid']==official
    if args.mode=='prepare':
        state_file.write_text(json.dumps({'exe':str(exe),'home':str(home),'address':r['address'],'pid':p.pid,'processes':before},indent=2))
        print(json.dumps({'ready':True,'exe':str(exe),'pid':p.pid,'ownedProcessCount':len(before)}))
    elif args.mode=='crash':
        p.kill();p.wait(10);assert_gone(before)
        report['checks']['ownerCrash']={'passed':True,'ownedProcessesExited':len(before)}
    elif args.mode=='migrate':
        assert oldpid not in processes()
        subprocess.run([str(exe),'--headless','--home',str(home)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=40,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        assert record(home)['pid']==r['pid']
        stop(exe,home);p.wait(25);assert_gone(before)
        report['checks']['legacyOrphanAdopted']={'passed':True,'duplicateLaunchReusedOwner':True,'ownedProcessesExited':len(before)}
assert api('http://127.0.0.1:43127','/status')['officialPid']==official
report['officialProcessUnchanged']=True
report_file.write_text(json.dumps(report,indent=2))
print(json.dumps(report))
