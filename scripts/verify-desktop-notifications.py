"""Native production card/hidden-host checks against isolated fake endpoints; no official writes."""
import json, os, subprocess, tempfile, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT=Path(__file__).resolve().parents[1]
folder=Path(tempfile.mkdtemp(prefix='notification-native-',dir=ROOT/'work'))
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        if self.headers.get('X-Bridge-CSRF')!='b'*64: self.send_error(403);return
        if self.path.endswith('/dismiss'): self.send_error(503);return
        result={'enabled':True,'health':{'writable':True},'drafts':0,'devices':[{'id':'fixture','status':'connected'}],
            'events':[{'id':'a'*64,'device':'测试远程设备','thread':'1'*36,'agent':'2'*36,'mode':'codex','kind':'completed','title':'隔离通知测试','summary':'没有官方任务写入','quickReply':True,'draft':'','outcome':'draft'}]}
        if self.path.endswith('/restore'): result={'restored':True,'ids':['a'*64]}
        raw=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
exe=folder/'DesktopNotificationsTests.exe'
subprocess.run([str(compiler),'/nologo','/target:exe','/platform:x64','/codepage:65001','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+str(exe),str(ROOT/'windows/DesktopNotifications.cs'),str(ROOT/'windows/NotificationCard.cs'),str(ROOT/'test/DesktopNotificationsTests.cs')],check=True)
try:
    result=subprocess.run([str(exe),f'http://127.0.0.1:{server.server_port}',str(folder)],capture_output=True,text=True,encoding='utf-8',timeout=55,creationflags=subprocess.CREATE_NO_WINDOW)
    print(result.stdout,end='');print(result.stderr,end='')
    (folder/'result.json').write_text(json.dumps({'passed':result.returncode==0,'output':result.stdout},ensure_ascii=False,indent=2),encoding='utf-8')
    print('Evidence:',folder)
    if result.returncode:raise RuntimeError('Native notification checks failed')
finally:server.shutdown();server.server_close()
