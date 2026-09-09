"""Read only the verified x64 desktop process's home-directory environment values.

The optional identity projection reads login metadata but never returns tokens.
Never writes files or process memory or emits the environment block.
Failure disables this optional metadata integration.
"""
import ctypes as c
import ctypes.wintypes as w
import json
import base64
import os
import sys
from pathlib import Path


def read_identity(home):
    """Project local login metadata to identity only; never return any token."""
    spec = json.loads(Path(__file__).with_name('official-desktop.json').read_text(encoding='utf8'))['storage']['readState']
    with (Path(home) / spec['authFile']).open('rb') as file:
        raw = file.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        return None
    value = json.loads(raw)
    if value.get('auth_mode') != 'chatgpt':
        return None
    token = value.get('tokens', {}).get('access_token')
    if not isinstance(token, str):
        return None
    payload = token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get(spec['identityClaim'], {})
    account = claims.get('chatgpt_account_id', claims.get('account_id'))
    user = claims.get('user_id', claims.get('chatgpt_user_id'))
    if not all(isinstance(v, str) and 0 < len(v) <= 256 for v in (account, user)):
        return None
    # Candidate identity only; the official receiver matches its current login.
    return {'kind': 'chatgpt', 'accountId': account, 'userId': user}


def process_home(pid, expected_image):
    if os.name != 'nt' or c.sizeof(c.c_void_p) != 8:
        raise ValueError('Unsupported process platform')
    k = c.WinDLL('kernel32', use_last_error=True)
    nt = c.WinDLL('ntdll')
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    k.OpenProcess.restype = w.HANDLE
    k.CloseHandle.argtypes = [w.HANDLE]
    k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
    k.IsWow64Process.argtypes = [w.HANDLE, c.POINTER(w.BOOL)]
    k.ReadProcessMemory.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
    nt.NtQueryInformationProcess.argtypes = [w.HANDLE, w.ULONG, c.c_void_p, w.ULONG, c.POINTER(w.ULONG)]
    nt.NtQueryInformationProcess.restype = c.c_long
    handle = k.OpenProcess(0x1010, False, pid)  # QUERY_LIMITED_INFORMATION | VM_READ
    if not handle:
        raise ValueError('Process metadata unavailable')
    try:
        image = c.create_unicode_buffer(32768)
        length = w.DWORD(len(image))
        wow = w.BOOL()
        if (not k.QueryFullProcessImageNameW(handle, 0, image, c.byref(length)) or
                os.path.normcase(image.value) != os.path.normcase(expected_image) or
                not k.IsWow64Process(handle, c.byref(wow)) or wow.value):
            raise ValueError('Process identity changed')
        def read(address, size):
            result = c.create_string_buffer(size)
            count = c.c_size_t()
            if not k.ReadProcessMemory(handle, address, result, size, c.byref(count)) or count.value != size:
                raise ValueError('Process metadata unavailable')
            return result.raw
        basic = c.create_string_buffer(48)
        returned = w.ULONG()
        if nt.NtQueryInformationProcess(handle, 0, basic, 48, c.byref(returned)) != 0 or returned.value != 48:
            raise ValueError('Process metadata unavailable')
        peb = int.from_bytes(basic.raw[8:16], 'little')
        params = int.from_bytes(read(peb + 0x20, 8), 'little')
        environment = int.from_bytes(read(params + 0x80, 8), 'little')
        # x64 RTL_USER_PROCESS_PARAMETERS; bounded reads stop at the double NUL.
        raw = bytearray()
        offset = 0
        while offset < 1024 * 1024:
            # Do not cross a Windows x64 memory-page boundary merely to find
            # the final NUL in a smaller committed environment allocation.
            size = min(256, 4096 - ((environment + offset) % 4096))
            raw.extend(read(environment + offset, size))
            offset += size
            end = next((i for i in range(max(0, len(raw) - 258), len(raw) - 3, 2)
                        if raw[i:i + 4] == b'\0\0\0\0'), None)
            if end is not None:
                values = {}
                for entry in raw[:end].decode('utf-16-le').split('\0'):
                    name, _, value = entry.partition('=')
                    if name.upper() in ('CODEX_HOME', 'USERPROFILE'):
                        values[name.upper()] = value
                result = values.get('CODEX_HOME', str(Path(values.get('USERPROFILE', '')) / '.codex'))
                if not result or not Path(result).is_absolute():
                    raise ValueError('Official home is not absolute')
                return result
        raise ValueError('Process metadata too large')
    finally:
        k.CloseHandle(handle)


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.read())
        home = process_home(int(request['pid']), request['image'])
        result = {'home': home}
        if request.get('identity') is True:
            result['identity'] = read_identity(home)
        print(json.dumps(result))
    except Exception:
        # No paths, environment values or native buffers in error output.
        print(json.dumps({'unavailable': True}))
