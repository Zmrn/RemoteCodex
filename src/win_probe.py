"""Read-only host/pipe identity. Never opens a database, auth file or process memory."""
import ctypes as c, ctypes.wintypes as w, json, os, platform, sys
if os.name!='nt': raise SystemExit('Windows host required')
k=c.WinDLL('kernel32',use_last_error=True)
k.CreateFileW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,c.c_void_p,w.DWORD,w.DWORD,w.HANDLE];k.CreateFileW.restype=w.HANDLE
k.GetNamedPipeServerProcessId.argtypes=[w.HANDLE,c.POINTER(w.ULONG)];k.GetNamedPipeServerProcessId.restype=w.BOOL
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
k.QueryFullProcessImageNameW.argtypes=[w.HANDLE,w.DWORD,w.LPWSTR,c.POINTER(w.DWORD)];k.CloseHandle.argtypes=[w.HANDLE]
def image(pid):
 h=k.OpenProcess(0x1000,False,pid)
 if not h:return None
 b=c.create_unicode_buffer(32768);n=w.DWORD(len(b))
 ok=k.QueryFullProcessImageNameW(h,0,b,c.byref(n));k.CloseHandle(h)
 return b.value if ok else None
def peer(path):
 h=k.CreateFileW(path,0xC0000000,0,None,3,0,None)
 if h==c.c_void_p(-1).value:return {'path':path,'error':c.get_last_error()}
 pid=w.ULONG();ok=k.GetNamedPipeServerProcessId(h,c.byref(pid));k.CloseHandle(h)
 return {'path':path,'pid':pid.value,'image':image(pid.value)} if ok else {'path':path,'error':c.get_last_error()}
paths=sys.argv[1:] or ['\\\\.\\pipe\\'+n for n in os.listdir('\\\\.\\pipe\\') if n=='codex-ipc' or n.startswith('codex-browser-use-')]
print(json.dumps({'source':'Win32 API live','host':platform.node(),'os':platform.platform(),'pid':os.getpid(),'pipes':[peer(p) for p in paths]},ensure_ascii=False))
