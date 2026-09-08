"""Build source-only portable archive. Excludes all local data, credentials and evidence."""
from pathlib import Path
import zipfile
import json
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
dest = root / 'dist' / f'RemoteBridge-Windows-{version}-source.zip'
dest.parent.mkdir(exist_ok=True)
files = [p for d in ('src','public','fixtures','scripts','windows') for p in (root/d).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
files += [root/n for n in ('README.md','PORTABLE.md','.gitignore','package.json','RemoteBridge.exe','Start.ps1','Stop.ps1','Open-UI.ps1','Open-UI.cmd','THIRD_PARTY_NOTICES.md','FARFIELD-LICENSE.txt')]
files += list((root/'test').glob('*.test.mjs'))
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(files): z.write(p, p.relative_to(root).as_posix())
    z.writestr('START-HERE.txt', f'''Remote Bridge Windows UI {version}
Requires Node.js 22+, Python 3.10+, Microsoft Edge, and a running logged-in official ChatGPT desktop (verified package 26.901.6511.0).
Double-click RemoteBridge.exe (or Open-UI.cmd). The launcher, web favicon and manifest use the ChatGPT knot with a blue network badge. The launcher source is windows/Launcher.cs; rebuild using scripts/Build-Launcher.ps1. Use the Remote Access help inside the UI for connecting another PC.
New conversation: type in the main composer; Enter sends, Shift+Enter inserts a newline. First message is text only.
Click the device at the bottom-left to open the picker. Weekly remaining quota is read from the selected device account in the official desktop. Narrow portrait uses a drawer; landscape uses two columns. Resize preserves the in-page draft.
Default: loopback only. Optional target agent: Start.ps1 -Background -AgentAddress <actual Tailscale IP> -AgentPort 43128.
Stop.ps1 stops only this bridge. No app-server is launched. Existing Codex conversations can be continued, including the development conversation. Automated write tests still exclude development tasks. Interrupt and result-file controls remain Probe-only. Use model and permission buttons for next-turn settings. While running, Enter queues a follow-up in the official desktop; use Steer or Edit on queued messages.
Running tasks show a spinning ring; confirmed completion shows a blue dot. Waiting, error and unknown states have separate indicators. Live owner events update watched tasks; visible sidebar status polling runs every 15 seconds. Reduced-motion preference uses a stationary ring.
Click the model name for an anchored model dropdown; the adjacent effort label opens the supported-effort slider. Permissions have a separate nonmodal menu. Select directly to apply; outside click and Escape dismiss. On unloaded tasks, model selection applies with the next message; permissions require a loaded idle task. Settings UI tests: node scripts/verify-settings-ui.mjs.
Queue UI tests: node scripts/verify-queue-ui.mjs. Status UI tests: node scripts/verify-status-ui.mjs. Read-only live status verification: node scripts/verify-status-live.mjs RUNNING_ID COMPLETED_PROBE_ID.
Quota: node src/cli.mjs usage. Read-only picker UI tests: node scripts/verify-picker.mjs (requires playwright-core). Protocol tests: npm test. Read-only live verification: node scripts/retest.mjs.
UI test dependency: npm install --no-save --package-lock=false playwright-core@1.56.1. Optional write test: node scripts/verify-ui.mjs --write (creates one official Probe and consumes model quota).
This archive deliberately contains no user data, saved devices, pairing keys or session evidence. APK and second physical PC testing are deferred.
''')
print(dest)
