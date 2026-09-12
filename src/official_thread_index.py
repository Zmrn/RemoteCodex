"""Bounded read-only projection of the running official desktop's task index.

Input home is resolved from its verified process, never this process's HOME.
No messages, credentials, runtime state, or unread flags leave this helper.
"""
import json, sqlite3, sys, time
from pathlib import Path

def project(home, spec):
    home = Path(home).resolve(strict=True)
    file = home / spec['file']
    global_file = home / spec['globalFile']
    if file.resolve(strict=True).parent != home or global_file.resolve(strict=True).parent != home:
        raise ValueError('Official index path changed')
    before = global_file.stat()
    if not 2 <= before.st_size <= spec['maxGlobalBytes']:
        raise ValueError('Official sidebar metadata size unsupported')
    state = json.loads(global_file.read_text(encoding='utf-8'))
    assignments = state.get(spec['assignmentsKey'], {})
    projectless = state.get(spec['projectlessKey'], [])
    if not isinstance(assignments, dict) or not isinstance(projectless, list):
        raise ValueError('Official sidebar metadata schema unsupported')
    if len(assignments) + len(projectless) > 100000:
        raise ValueError('Official sidebar metadata exceeds bound')
    deadline = time.monotonic() + 1.5
    db = sqlite3.connect(file.as_uri() + '?mode=ro', uri=True, timeout=0.5)
    try:
        db.execute('PRAGMA query_only=ON')
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        db.execute('BEGIN')
        columns = {r[1] for r in db.execute('PRAGMA table_info(threads)')}
        if not set(spec['columns']).issubset(columns):
            raise ValueError('Official index schema unsupported')
        # Explicit official sidebar membership excludes internal/temporary agents.
        # Archived/deleted rows never return, even if old assignments still exist.
        rows = db.execute('SELECT id, name, title, preview, cwd, updated_at, source, is_pinned '
                          'FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 5000')
        result = []
        for id, name, title, preview, cwd, updated, source, pinned in rows:
            assignment = assignments.get(id)
            project_id = assignment.get('projectId') if isinstance(assignment, dict) and assignment.get('projectKind') == 'local' else None
            if not project_id and id not in projectless:
                continue
            if source not in spec['sources']:
                continue
            display = next((s.strip() for s in [name, preview, title] if isinstance(s, str) and s.strip()), None)
            result.append({'id':id,'title':display[:2000] if display else None,'cwd':cwd,
                           'updatedAt':updated,'projectId':project_id,'pinned':pinned == 1})
            if len(result) >= spec['maxRows']:
                break
        after = global_file.stat()
        if (before.st_size,before.st_mtime_ns) != (after.st_size,after.st_mtime_ns):
            raise ValueError('Official sidebar changed during read')
        return result
    finally:
        db.close()

if __name__ == '__main__':
    try:
        value = json.load(sys.stdin)
        print(json.dumps({'status':'available','threads':project(value['home'],value['spec'])},ensure_ascii=False))
    except Exception:
        print(json.dumps({'status':'unavailable','threads':[]}))
