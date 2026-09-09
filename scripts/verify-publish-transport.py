"""Isolated real staging I/O and HTTP checks; never connects to a release host."""
from pathlib import Path
import http.client, http.server, runpy, shlex, subprocess, sys, tempfile, threading, unittest
from unittest.mock import patch
import publish_release as publisher

RUN = subprocess.run

class Staging(unittest.TestCase):
    def exercise(self, alter=lambda raw: raw, timeout=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root/'source'; source.write_bytes(b'new package\x00\xff')
            formal = root/'RemoteCodex.exe'; formal.write_bytes(b'formal package')
            staged = root/'RemoteCodex.exe.next'; staged.write_bytes(b'previous staging')
            def remote(command, **kwargs):
                self.assertIn('StrictHostKeyChecking=yes', command)
                self.assertGreater(kwargs['timeout'], 0)
                if timeout: raise subprocess.TimeoutExpired(command, kwargs['timeout'])
                code = shlex.split(command[-1])[2]
                return RUN([sys.executable, '-c', code], input=alter(kwargs['input']), capture_output=True)
            with patch.object(publisher.subprocess, 'run', side_effect=remote) as calls, patch.object(publisher.time, 'sleep'):
                if timeout or alter(source.read_bytes()) != source.read_bytes():
                    with self.assertRaises(RuntimeError):
                        publisher.upload_staged(source, formal.name, 'fixture', folder, ['-o', 'StrictHostKeyChecking=yes'])
                    self.assertEqual(calls.call_count, 3)
                    self.assertEqual(staged.read_bytes(), b'previous staging')
                else:
                    publisher.upload_staged(source, formal.name, 'fixture', folder, ['-o', 'StrictHostKeyChecking=yes'])
                    self.assertEqual(staged.read_bytes(), source.read_bytes())
            self.assertEqual(formal.read_bytes(), b'formal package')
            self.assertEqual(list(root.glob('.upload-*')), [])

    def test_complete_transfer(self): self.exercise()
    def test_truncated_transfer_preserves_staging(self): self.exercise(lambda raw: raw[:-1])
    def test_bad_digest_preserves_staging(self): self.exercise(lambda raw: b'x'*len(raw))
    def test_timeouts_are_bounded(self): self.exercise(timeout=True)

class ResourceService(unittest.TestCase):
    def test_notes_allowlist_and_publication_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); notes='支持范围与发布说明'.encode()
            (root/'release-notes.md').write_bytes(notes)
            (root/'latest.json.next').write_bytes(b'private staging')
            real_server=http.server.ThreadingHTTPServer
            captured=[]
            class DeferredServer:
                def __init__(self, address, handler): captured.append(handler)
                def serve_forever(self): pass
            with patch.object(sys, 'argv', ['serve-updates.py','--bind','127.0.0.1','--port','0','--root',folder]), patch.object(http.server,'ThreadingHTTPServer',DeferredServer):
                runpy.run_path(str(Path(__file__).with_name('serve-updates.py')))
            server=real_server(('127.0.0.1',0),captured[0])
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            def request(method,path):
                conn=http.client.HTTPConnection(*server.server_address,timeout=5)
                try:
                    conn.request(method,path);r=conn.getresponse()
                    return r.status,dict(r.getheaders()),r.read()
                finally:conn.close()
            try:
                status,headers,body=request('GET','/release-notes.md')
                self.assertEqual((status,body),(200,notes))
                self.assertEqual(headers['Content-Type'],'text/markdown; charset=utf-8')
                self.assertEqual(request('HEAD','/release-notes.md')[2],b'')
                for path in ['/latest.json.next','/','/../release-notes.md']:
                    self.assertEqual(request('GET',path)[0],404)
                (root/'.publishing').touch()
                self.assertEqual(request('GET','/release-notes.md')[0],503)
            finally:server.shutdown();server.server_close();worker.join()

unittest.main()
