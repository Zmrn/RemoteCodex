"""Isolated Windows environment-scope checks. Does not launch or change Codex."""
import importlib.util
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('official_home', root / 'src/official_home.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
passed = 0
with tempfile.TemporaryDirectory(prefix='official-home-', dir=root / 'work') as temporary:
    for custom in (str(Path(temporary) / 'custom'), None, 'relative-invalid'):
        env = dict(os.environ)
        env.pop('CODEX_HOME', None)
        if custom is not None:
            env['CODEX_HOME'] = custom
        child = subprocess.Popen([sys.executable, '-c', 'import sys;print("ready",flush=True);sys.stdin.read()'], env=env,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            assert child.stdout.readline().strip() == b'ready'
            if custom == 'relative-invalid':
                try:
                    module.process_home(child.pid, sys.executable)
                except ValueError:
                    passed += 1
                else:
                    raise AssertionError('Relative path accepted')
            else:
                value = module.process_home(child.pid, sys.executable)
                expected = custom or str(Path(env['USERPROFILE']) / '.codex')
                assert os.path.normcase(value) == os.path.normcase(expected)
                passed += 1
            try:
                module.process_home(child.pid, str(root / 'wrong.exe'))
            except ValueError:
                passed += 1
            else:
                raise AssertionError('Wrong process image accepted')
        finally:
            child.stdin.close()
            child.wait(timeout=5)
        try:
            module.process_home(child.pid, sys.executable)
        except ValueError:
            passed += 1
        else:
            raise AssertionError('Exited process accepted')
print(f'Official home: {passed} isolated Windows scope checks passed')

with tempfile.TemporaryDirectory(prefix='official-identity-', dir=root / 'work') as temporary:
    claim = 'https://api.openai.com/auth'
    payload = base64.urlsafe_b64encode(json.dumps({claim: {'chatgpt_account_id': 'fixture-account', 'user_id': 'fixture-user'}}).encode()).decode().rstrip('=')
    value = {'auth_mode': 'chatgpt', 'tokens': {'access_token': 'fixture.' + payload + '.fixture-secret', 'refresh_token': 'fixture-refresh-secret'}}
    auth = Path(temporary) / 'auth.json'
    auth.write_text(json.dumps(value), encoding='utf8')
    before = auth.read_bytes()
    projected = module.read_identity(temporary)
    assert projected == {'kind': 'chatgpt', 'accountId': 'fixture-account', 'userId': 'fixture-user'}
    assert 'secret' not in json.dumps(projected) and 'token' not in json.dumps(projected)
    assert auth.read_bytes() == before
    value['auth_mode'] = 'apikey'; auth.write_text(json.dumps(value), encoding='utf8')
    assert module.read_identity(temporary) is None
print('Official identity: metadata projection, token exclusion, read-only file and auth-mode checks passed')
