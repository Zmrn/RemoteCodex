import ctypes, ctypes.wintypes as w, time, json, subprocess
from verify_portable import api
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

wait_gone=assert_gone
