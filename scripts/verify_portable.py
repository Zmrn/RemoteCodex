"""Run the real portable EXE with no Node/Python on PATH; no task writes."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def page(address):
    with HTTP.open(address + "/", timeout=3) as response:
        return response.read().decode()


def api(address, route, body=None):
    csrf = re.search(r'name="bridge-csrf" content="([a-f0-9]+)"', page(address))[1]
    request = urllib.request.Request(address + "/api" + route,
        data=None if body is None else json.dumps(body).encode(),
        headers={"X-Bridge-CSRF": csrf, "Content-Type": "application/json"})
    with HTTP.open(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("exe", type=Path)
    parser.add_argument("--keep-running", action="store_true")
    args = parser.parse_args()
    sandbox = ROOT / "work" / ("portable-test-" + uuid.uuid4().hex[:8])
    single = sandbox / "只有一个 EXE"
    single.mkdir(parents=True)
    executable = single / "Remote Codex.exe"
    shutil.copyfile(args.exe, executable)
    home = sandbox / "独立 数据目录"
    (home / "data").mkdir(parents=True)
    (home / "data/update-settings.json").write_text('{"automatic":false}',encoding="utf-8")
    env = os.environ.copy()
    env["PATH"] = str(Path(os.environ["WINDIR"]) / "System32")
    for key in ("PYTHONHOME", "PYTHONPATH", "NODE_PATH", "NODE_OPTIONS"):
        env.pop(key, None)
    checks = {}
    report = {"scope": "real single EXE; isolated local data; PATH contains only Windows System32; no official task mutations", "checks": checks}
    old_pid = None
    try:
        old_pid = api("http://127.0.0.1:43127", "/status").get("officialPid")
    except (OSError, ValueError):
        pass

    def run(*arguments, expected=0, target=None):
        completed = subprocess.run([str(target or executable), "--headless", "--home", str(home), *arguments],
            cwd=single, env=env, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
        if completed.returncode != expected:
            error = home / "data/launcher-error.txt"
            raise AssertionError("Launcher exit " + str(completed.returncode) + ": " + (error.read_text(encoding="utf-8-sig") if error.exists() else "inspect self-test.json"))

    record_file = home / "data/server.json"
    address = None
    try:
        assert [p.name for p in single.iterdir()] == [executable.name]
        run("--self-test")
        diagnosis = json.loads((home / "data/self-test.json").read_text(encoding="utf-8"))
        assert diagnosis["result"] == "passed", diagnosis
        checks["singleFileWithSystemOnlyPath"] = True
        checks["bundledDependencyAndDesktopSelfTest"] = diagnosis
        run()
        record = json.loads(record_file.read_text(encoding="utf-8"))
        address = record["address"]
        assert address.startswith("http://127.0.0.1:")
        assert record["remoteAddress"] is None
        assert record["portable"] is True
        assert Path(record["executable"]).is_relative_to(home / "versions")
        instance = api(address, "/instance")
        assert instance["instanceId"] == record["instanceId"]
        status = api(address, "/status")
        assert status["connected"] is True
        threads = api(address, "/threads")["data"]["threads"]
        assert threads
        selected = next(t for t in threads if t["kind"] == "codex")
        read = api(address, "/threads/" + selected["id"])
        assert read["data"]["thread"]["id"] == selected["id"]
        checks["officialTaskRead"] = {"passed": True, "recentTaskCount": len(threads)}
        checks["loopbackOnly"] = True
        checks["runtimeProcessFromExtractedBundle"] = True
        assert "Remote Bridge" in page(address)
        checks["webPageServed"] = True
        run()
        assert json.loads(record_file.read_text(encoding="utf-8"))["pid"] == record["pid"]
        checks["duplicateLaunchReusesService"] = True
        api(address, "/agents", {"id": "local", "name": "Portable Test Device"})
        original_record = record_file.read_bytes()
        wrong_record = dict(record, instanceId="wrong-instance")
        try:
            record_file.write_text(json.dumps(wrong_record), encoding="utf-8")
            run("--stop", expected=1)
            assert api(address, "/instance")["instanceId"] == record["instanceId"]
        finally:
            record_file.write_bytes(original_record)
        checks["stopRejectsMismatchedInstance"] = True
        run("--stop")
        try:
            api(address, "/instance")
        except OSError:
            checks["stopOwnService"] = True
        else:
            raise AssertionError("Service remains reachable after stop")
        cached_page = Path(record["executable"]).parents[2] / "public/index.html"
        original_page = cached_page.read_bytes()
        try:
            cached_page.write_bytes(original_page + b"<!-- corrupt test cache -->")
            run(expected=1)
        finally:
            cached_page.write_bytes(original_page)
        checks["corruptCacheRejected"] = True
        relocated_dir = sandbox / "换个 文件夹"
        relocated_dir.mkdir()
        relocated = relocated_dir / "Bridge.exe"
        shutil.copyfile(executable, relocated)
        run(target=relocated)
        restarted = json.loads(record_file.read_text(encoding="utf-8"))
        address = restarted["address"]
        agents = api(address, "/agents")["agents"]
        assert next(a for a in agents if a["id"] == "local")["name"] == "Portable Test Device"
        checks["relocateAndPreserveDeviceConfig"] = True
        if old_pid:
            assert api("http://127.0.0.1:43127", "/status")["officialPid"] == old_pid
            checks["existingBridgeAndOfficialProcessUnaffected"] = True
        report["result"] = "passed"
        report["testHome"] = str(home)
        report["address"] = address
        report["sha256"] = hashlib.sha256(args.exe.read_bytes()).hexdigest()
    finally:
        if not args.keep_running or report.get("result") != "passed":
            run("--stop")
        dest = ROOT / "evidence/portable-verification.json"
        dest.parent.mkdir(exist_ok=True)
        dest.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"result": report.get("result", "failed"), "checks": list(checks), "report": str(dest)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
