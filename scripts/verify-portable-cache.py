"""Compile a test DLL using production cache/launcher code; never build the app EXE.

All corruption and process termination are confined to a fresh work/ directory.
No official app, installed Remote Codex or user configuration is accessed.
"""
from pathlib import Path
import hashlib, json, os, subprocess, sys, tempfile, time, zipfile

ROOT=Path(__file__).resolve().parents[1]
(ROOT/'work').mkdir(exist_ok=True)
folder=Path(tempfile.mkdtemp(prefix='portable-cache-',dir=ROOT/'work'))
fixture=folder/'fixture';fixture.mkdir()
files={'src/official_thread_index.py':b'# synthetic cache fixture\n'+b'x'*3327,
       'runtime/python/python313.zip':bytes(range(256))*16384,'public/index.html':b'<p>fixture</p>'}
with zipfile.ZipFile(fixture/'payload.zip','w',zipfile.ZIP_DEFLATED) as z:
    for name,raw in files.items():z.writestr(name,raw)
digest=hashlib.sha256((fixture/'payload.zip').read_bytes()).hexdigest()
(fixture/'hash.txt').write_text(digest,encoding='ascii')
(fixture/'files.txt').write_text(''.join(hashlib.sha256(raw).hexdigest()+'\t'+name+'\n' for name,raw in files.items()),encoding='utf-8')
(fixture/'PortableBuild.cs').write_text('internal static class PortableBuild { internal const string Version="0.10.41"; internal const string Edition="full"; internal const string PayloadHash="'+digest+'"; }',encoding='utf-8')
compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
dll=folder/'PortableCacheTests.dll'
subprocess.run([str(compiler),'/nologo','/target:library','/platform:x64','/codepage:65001',
 '/reference:System.IO.Compression.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/reference:System.Management.dll',
 '/resource:'+str(fixture/'payload.zip')+',payload.zip','/resource:'+str(fixture/'files.txt')+',payload.files',
 '/out:'+str(dll),str(ROOT/'windows/PortableCache.cs'),str(ROOT/'windows/PortableLauncher.cs'),str(ROOT/'windows/OwnedProcesses.cs'),
 str(fixture/'PortableBuild.cs'),str(ROOT/'test/PortableCacheTests.cs')],check=True)
host=folder/'host.ps1'
host.write_text('param($Dll,$Fixture,$HomePath,$Mode)\n$ErrorActionPreference="Stop"\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\ntry { [Reflection.Assembly]::LoadFrom($Dll) | Out-Null; [PortableCacheTests]::Run($Fixture,$HomePath,$Mode) } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }\n',encoding='utf-8')
ps=Path(os.environ['WINDIR'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
def command(home,mode='ensure'):
 return [str(ps),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(host),str(dll),str(fixture),str(home),mode]
def run(home,mode='ensure',ok=True):
 r=subprocess.run(command(home,mode),capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60,creationflags=subprocess.CREATE_NO_WINDOW)
 if (r.returncode==0)!=ok:raise RuntimeError(r.stdout+'\n'+r.stderr)
 return r.stdout.strip()
checks=[]
output=run(folder/'cases','suite');print(output,flush=True);checks+= [s[5:] for s in output.splitlines() if s.startswith('PASS ')]
# Terminate only our isolated PowerShell host after the production extractor has
# durably written the first file, while it is reading the next archive entry.
home=folder/'terminated';home.mkdir()
p=subprocess.Popen(command(home,'interrupt'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
try:
 deadline=time.monotonic()+25
 while not (home/'paused.txt').exists():
  if p.poll() is not None:raise RuntimeError('Interruption host exited before boundary: '+p.stderr.read().decode(errors='replace'))
  if time.monotonic()>deadline:raise RuntimeError('Interruption boundary not reached')
  time.sleep(.02)
 p.kill();p.wait(timeout=10)
finally:
 if p.poll() is None:p.kill();p.wait(timeout=10)
 p.stdout.close();p.stderr.close()
leftovers=list((home/'versions').glob('.extract-*'));assert len(leftovers)==1
restored=Path(run(home));assert restored.is_dir() and not restored.name.startswith('.extract-')
assert run(home)==str(restored) and leftovers[0].is_dir()
checks.append('forced process termination mid-extraction releases mutex; next process ignores partial bytes and fully recovers')
# Real simultaneous processes race over one damaged cache; only one new cache.
home=folder/'concurrent';root=Path(run(home));(root/'src/official_thread_index.py').write_bytes(bytes(3353))
children=[subprocess.Popen(command(home),stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW) for _ in range(4)]
try:
 paths=[]
 for p in children:
  out,err=p.communicate(timeout=60);assert p.returncode==0,err.decode(errors='replace');paths.append(out.decode().strip())
 assert len(set(paths))==1 and len(list((home/'versions').glob('*.recovered-*')))==1
 assert (root/'src/official_thread_index.py').read_bytes()==bytes(3353)
finally:
 for p in children:
  if p.poll() is None:p.kill();p.wait(timeout=10)
checks.append('four independent starts serialize and reuse one repaired cache; original remains unchanged')
# Junctions need no symlink privilege on Windows and must never be traversed.
home=folder/'junction';root=Path(run(home));external=folder/'external';external.mkdir();(external/'sentinel').write_text('unchanged')
os.rename(root/'src',root/'src-original')
junction_script=folder/'junction.ps1';junction_script.write_text('param($Link,$Target)\n$ErrorActionPreference="Stop"\nNew-Item -ItemType Junction -Path $Link -Target $Target | Out-Null',encoding='utf-8')
subprocess.run([str(ps),'-NoProfile','-File',str(junction_script),str(root/'src'),str(external)],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
run(home,ok=False);assert (external/'sentinel').read_text()=='unchanged' and not list((home/'versions').glob('*.recovered-*'))
checks.append('cache directory junction is rejected without touching its target or publishing a bypass')
if len(sys.argv)>1:
 released=Path(sys.argv[1]).resolve()
 # Load only embedded resources from an already downloaded release; never run its Main.
 r=subprocess.run([str(ps),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(host),str(dll),str(released),str(folder/'real'),'real'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90,creationflags=subprocess.CREATE_NO_WINDOW)
 if r.returncode:raise RuntimeError(r.stdout+'\n'+r.stderr)
 checks += [s[5:] for s in r.stdout.splitlines() if s.startswith('PASS ')]
result={'result':'PASS','checks':checks,'count':len(checks),'applicationBuilt':False,'installedClientChanged':False,'officialTaskWrites':0,'evidence':str(folder)}
(folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False),flush=True)
