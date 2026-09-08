"""Exercise public launcher commands and process cleanup; no Windows input injection."""
from pathlib import Path
import json,os,subprocess,time
from verify_lifecycle_support import tree,wait_gone
from verify_portable import api,ROOT
data=Path(os.environ['LOCALAPPDATA'])/'RemoteCodex/data'
owner=json.loads((data/'desktop.json').read_text())
server=json.loads((data/'server.json').read_text())
exe=Path(owner['executable'])
assert exe.name=='RemoteCodex.exe' and owner['version']=='0.9.10'
official=api(server['address'],'/status')['officialPid']
subprocess.run([str(exe)],check=True,timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
assert json.loads((data/'desktop.json').read_text())['pid']==owner['pid']
owned=tree(owner['pid'])
subprocess.run([str(exe),'--stop'],check=True,timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
wait_gone(owned)
subprocess.Popen([str(exe)],creationflags=subprocess.CREATE_NO_WINDOW)
for _ in range(120):
 try:
  current=json.loads((data/'server.json').read_text())
  if current['instanceId']!=server['instanceId'] and api(current['address'],'/status')['officialPid']==official:break
 except (OSError,ValueError):pass
 time.sleep(.5)
else:raise AssertionError('Restart failed')
report={'result':'passed','version':current['version'],'source':'public --stop and launch commands; no simulated tray clicks','duplicateLaunchKeptOwner':True,'explicitStopExitedOwnedProcesses':len(owned),'officialPid':official,'officialUnchanged':True,'trayMouseInteraction':'not tested by this script'}
(ROOT/'evidence/tray-lifecycle.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
