"""Read-only host/pipe identity. Never opens a database, auth file or process memory."""
import ctypes as c, ctypes.wintypes as w, json, os, platform, sys, subprocess
from pathlib import Path
discovery=json.loads(Path(__file__).with_name('official-desktop.json').read_text(encoding='utf-8'))['discovery']
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

def broker_identity(pipe):
 # The broker can be hosted by VS Code. Verify the signed product, never just
 # a user-writable file called Code.exe. Paths travel as stdin data, not code.
 if (pipe['path'].rsplit('\\',1)[-1] != discovery['ownerPipe'] or
     Path(pipe.get('image') or '').name.lower() != discovery['sharedBroker']['executable'].lower()):
  return pipe
 script = r'''
$ErrorActionPreference = 'Stop'
# Use this Windows PowerShell's own modules even when launched from pwsh 7.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$probeImage = [Console]::In.ReadToEnd() | ConvertFrom-Json
$probeSignature = Get-AuthenticodeSignature -LiteralPath $probeImage
$probeVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($probeImage)
$probePublisher = if ($probeSignature.SignerCertificate) { $probeSignature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { $null }
@{status=[string]$probeSignature.Status;publisherSimpleName=$probePublisher;productName=$probeVersion.ProductName;companyName=$probeVersion.CompanyName;version=$probeVersion.ProductVersion} | ConvertTo-Json -Compress
'''
 try:
  powershell = Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
  result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', script],
   input=json.dumps(pipe['image']), capture_output=True, text=True, timeout=15,
   creationflags=subprocess.CREATE_NO_WINDOW, check=True)
  pipe['signature'] = json.loads(result.stdout)
 except (OSError, ValueError, subprocess.SubprocessError):
  pipe['signature'] = {'status':'Unknown'}
 return pipe

paths=sys.argv[1:] or ['\\\\.\\pipe\\'+n for n in os.listdir('\\\\.\\pipe\\') if n==discovery['ownerPipe'] or n.startswith(discovery['toolsPipePrefix'])]
print(json.dumps({'source':'Win32 API live','host':platform.node(),'os':platform.platform(),'pid':os.getpid(),'pipes':[broker_identity(peer(p)) for p in paths]},ensure_ascii=False))
