"""Read only: compare the running Remote Codex window with its saved preferences."""
import ctypes, ctypes.wintypes as w, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = Path(os.environ['LOCALAPPDATA']) / 'RemoteCodex/data'
owner = json.loads((data / 'desktop.json').read_text(encoding='utf-8-sig'))
saved = json.loads((data / 'window-placement.json').read_text(encoding='utf-8-sig'))
api = ctypes.WinDLL('user32', use_last_error=True)
api.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
api.GetWindowRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
api.IsIconic.argtypes = api.IsZoomed.argtypes = [w.HWND]
pid, rectangle = w.DWORD(), w.RECT()
handle = owner['window']
api.GetWindowThreadProcessId(handle, ctypes.byref(pid))
assert pid.value == owner['pid'], 'Desktop handle is stale or belongs to a different process'
assert api.GetWindowRect(handle, ctypes.byref(rectangle)), 'Window bounds unavailable'
normal = not api.IsIconic(handle) and not api.IsZoomed(handle)
actual = {'Left': rectangle.left, 'Top': rectangle.top, 'Width': rectangle.right - rectangle.left, 'Height': rectangle.bottom - rectangle.top}
if normal:
    assert all(saved[k] == value for k, value in actual.items()), 'Saved size/position differs from running window'
result = {'version': owner['version'], 'normalWindow': normal, 'actual': actual,
          'saved': {k: saved[k] for k in ['Left', 'Top', 'Width', 'Height', 'Maximized']},
          'savedMatchesRunningWindow': normal, 'scope': 'read-only window geometry; no UI input or official task access'}
(ROOT / 'work/window-placement-live.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
