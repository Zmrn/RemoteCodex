"""Read-only latest-release resource service; no directory listing or control API."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import shutil

parser=argparse.ArgumentParser()
parser.add_argument("--bind",required=True)
parser.add_argument("--port",type=int,default=43130)
parser.add_argument("--root",type=Path,required=True)
args=parser.parse_args()
class Handler(BaseHTTPRequestHandler):
    def send_file(self,head=False):
        if (args.root/'.publishing').exists(): self.send_error(503);return
        name={"/latest.json":"latest.json","/RemoteCodex.exe":"RemoteCodex.exe","/android-latest.json":"android-latest.json","/RemoteCodex.apk":"RemoteCodex.apk","/release-notes.md":"release-notes.md"}.get(self.path)
        if not name: self.send_error(404);return
        try: stream=(args.root/name).open("rb")
        except FileNotFoundError: self.send_error(404);return
        with stream:
            self.send_response(200)
            self.send_header("Content-Type","text/markdown; charset=utf-8" if name.endswith(".md") else "application/json" if name.endswith(".json") else "application/octet-stream")
            self.send_header("Content-Length",str(__import__("os").fstat(stream.fileno()).st_size))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.end_headers()
            if not head:
                try: shutil.copyfileobj(stream,self.wfile)
                except (BrokenPipeError,ConnectionResetError): pass
    def do_GET(self): self.send_file()
    def do_HEAD(self): self.send_file(True)
    def log_message(self,*args): pass
ThreadingHTTPServer((args.bind,args.port),Handler).serve_forever()
