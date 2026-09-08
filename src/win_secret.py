"""Protect bridge-only pairing keys with the current Windows user's DPAPI."""
import base64, ctypes as c, ctypes.wintypes as w, json, sys
class Blob(c.Structure):
    _fields_ = [('size', w.DWORD), ('data', c.POINTER(c.c_ubyte))]
def crypt(value, decrypt=False):
    raw = base64.b64decode(value) if decrypt else value.encode('utf8')
    buf = (c.c_ubyte * len(raw)).from_buffer_copy(raw)
    source, target = Blob(len(raw), buf), Blob()
    lib = c.WinDLL('crypt32', use_last_error=True)
    fn = lib.CryptUnprotectData if decrypt else lib.CryptProtectData
    fn.argtypes = [c.POINTER(Blob), c.c_void_p, c.c_void_p, c.c_void_p, c.c_void_p, w.DWORD, c.POINTER(Blob)]
    if not fn(c.byref(source), None, None, None, None, 1, c.byref(target)):
        raise RuntimeError('Windows DPAPI failed')
    try:
        result = c.string_at(target.data, target.size)
        return result.decode('utf8') if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        kernel = c.WinDLL('kernel32'); kernel.LocalFree.argtypes = [c.c_void_p]
        kernel.LocalFree(target.data)
request = json.load(sys.stdin)
print(json.dumps({'value': crypt(request['value'], request['operation'] == 'unprotect')}))
