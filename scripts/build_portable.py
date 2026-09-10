"""Build one Windows x64 EXE with verified runtimes and no user data."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import subprocess
import urllib.request
import zipfile
from release_config import config
from desktop_compatibility import compatibility, release_notes

ROOT = Path(__file__).resolve().parents[1]
RUNTIMES = {
    "node": {
        "file": "node-v22.19.0-win-x64.zip",
        "url": "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip",
        "sha256": "ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86",
    },
    "python": {
        "file": "python-3.13.2-embed-amd64.zip",
        "url": "https://www.python.org/ftp/python/3.13.2/python-3.13.2-embed-amd64.zip",
        "sha256": "1e803610b140cbf69dfa2ceaaeb39651bef75a239c381289e827c30862a27b93",
    },
    "webview2Sdk": {
        "file": "microsoft.web.webview2.1.0.4191.47.nupkg",
        "url": "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4191.47/microsoft.web.webview2.1.0.4191.47.nupkg",
        "sha256": "f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0",
    },
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def download(cache, entry):
    dest = cache / entry["file"]
    if not dest.exists():
        partial = dest.with_suffix(".partial")
        print("Downloading", entry["file"], flush=True)
        with urllib.request.urlopen(entry["url"], timeout=60) as response, partial.open("wb") as target:
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
        if sha(partial.read_bytes()) != entry["sha256"]:
            raise RuntimeError("Downloaded runtime checksum mismatch: " + entry["file"])
        partial.replace(dest)
    raw = dest.read_bytes()
    if sha(raw) != entry["sha256"]:
        raise RuntimeError("Cached runtime checksum mismatch: " + entry["file"])
    return raw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=ROOT / "work/runtime-cache")
    parser.add_argument("--version", help="Version override for an isolated update test build")
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Build on Windows with the .NET Framework C# compiler.")
    args.cache.mkdir(parents=True, exist_ok=True)
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = args.version or package["version"]
    desktop_support = compatibility()
    if not __import__("re").fullmatch(r"\d+\.\d+\.\d+", version): raise ValueError("Invalid version")
    files = {}
    for folder in ("src", "public"):
        for file in (ROOT / folder).rglob("*"):
            if file.is_file() and "__pycache__" not in file.parts:
                files[file.relative_to(ROOT).as_posix()] = file.read_bytes()
    for name in ("package.json", "README.md", "PORTABLE.md", "THIRD_PARTY_NOTICES.md", "FARFIELD-LICENSE.txt", "LICENSE"):
        files[name] = (ROOT / name).read_bytes()
    package["version"] = version
    files["RELEASE-NOTES.md"] = release_notes(version)
    files["package.json"] = json.dumps(package, indent=2).encode()
    files["src/update-source.json"] = (ROOT / 'src/update-source.json').read_bytes()
    with zipfile.ZipFile(io.BytesIO(download(args.cache, RUNTIMES["node"]))) as archive:
        for name in ("node.exe", "LICENSE"):
            files["runtime/node/" + name] = archive.read("node-v22.19.0-win-x64/" + name)
    with zipfile.ZipFile(io.BytesIO(download(args.cache, RUNTIMES["python"]))) as archive:
        for entry in archive.infolist():
            if not entry.is_dir():
                if entry.filename.startswith("/") or ".." in Path(entry.filename).parts:
                    raise RuntimeError("Unsafe runtime archive entry")
                files["runtime/python/" + entry.filename] = archive.read(entry)
    files["runtime/SOURCES.json"] = json.dumps(RUNTIMES, indent=2).encode()
    build = ROOT / "work/portable-build"
    build.mkdir(parents=True, exist_ok=True)
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    sdk = build / "webview2"
    sdk.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(download(args.cache, RUNTIMES["webview2Sdk"]))) as archive:
        for entry in ("lib/net462/Microsoft.Web.WebView2.Core.dll", "lib/net462/Microsoft.Web.WebView2.WinForms.dll", "runtimes/win-x64/native/WebView2Loader.dll", "LICENSE.txt"):
            name = Path(entry).name
            raw = archive.read(entry)
            (sdk / name).write_bytes(raw)
            files["runtime/webview2/" + name] = raw
    subprocess.run([str(compiler), "/nologo", "/codepage:65001", "/target:library", "/platform:x64", "/optimize+",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.Web.Extensions.dll",
        "/reference:" + str(sdk / "Microsoft.Web.WebView2.Core.dll"),
        "/reference:" + str(sdk / "Microsoft.Web.WebView2.WinForms.dll"),
        "/out:" + str(sdk / "DesktopUi.dll"), str(ROOT / "windows/DesktopWindow.cs"), str(ROOT / "windows/WindowPlacement.cs"), str(ROOT / "windows/DesktopNotifications.cs"), str(ROOT / "windows/NotificationCard.cs")], check=True)
    files["runtime/webview2/DesktopUi.dll"] = (sdk / "DesktopUi.dll").read_bytes()
    payload = build / "payload.zip"
    print("Compressing", len(files), "files ...", flush=True)
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    payload_hash = sha(payload.read_bytes())
    manifest = build / "payload-files.sha256"
    manifest.write_text("".join(sha(raw) + "\t" + name + "\n" for name, raw in sorted(files.items())), encoding="utf-8")
    generated = build / "PortableBuild.cs"
    generated.write_text(
        'using System.Reflection;\n[assembly: AssemblyVersion("' + version + '.0")]\n'
        'internal static class PortableBuild {\n'
        'internal const string Version = ' + json.dumps(version) + ';\n'
        'internal const string PayloadHash = ' + json.dumps(payload_hash) + ';\n}\n', encoding="utf-8")
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    if not compiler.exists():
        compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework/v4.0.30319/csc.exe"
    dest = ROOT / "dist" / "RemoteCodex.exe"
    dest.parent.mkdir(exist_ok=True)
    subprocess.run([
        str(compiler), "/nologo", "/codepage:65001", "/target:winexe", "/platform:x64", "/optimize+",
        "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll",
        "/reference:System.IO.Compression.dll", "/reference:System.Management.dll",
        "/win32icon:" + str(ROOT / "public/app-icon.ico"),
        "/resource:" + str(payload) + ",payload.zip",
        "/resource:" + str(manifest) + ",payload.files",
        "/out:" + str(dest), str(ROOT / "windows/PortableLauncher.cs"), str(ROOT / "windows/OwnedProcesses.cs"), str(generated),
    ], check=True)
    result = {
        "file": dest.name, "version": version, "bytes": dest.stat().st_size,
        "sha256": sha(dest.read_bytes()), "payloadSha256": payload_hash,
        "payloadFiles": len(files), "runtimeSources": RUNTIMES,
        "desktopCompatibility": desktop_support,
    }
    (dest.with_suffix(".build.json")).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
