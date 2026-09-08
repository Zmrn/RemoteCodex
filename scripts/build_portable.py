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
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Build on Windows with the .NET Framework C# compiler.")
    args.cache.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    files = {}
    for folder in ("src", "public"):
        for file in (ROOT / folder).rglob("*"):
            if file.is_file() and "__pycache__" not in file.parts:
                files[file.relative_to(ROOT).as_posix()] = file.read_bytes()
    for name in ("package.json", "README.md", "PORTABLE.md", "THIRD_PARTY_NOTICES.md", "FARFIELD-LICENSE.txt"):
        files[name] = (ROOT / name).read_bytes()
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
    dest = ROOT / "dist" / f"RemoteCodex-{version}-windows-x64.exe"
    dest.parent.mkdir(exist_ok=True)
    subprocess.run([
        str(compiler), "/nologo", "/codepage:65001", "/target:winexe", "/platform:x64", "/optimize+",
        "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll",
        "/reference:System.IO.Compression.dll",
        "/win32icon:" + str(ROOT / "public/app-icon.ico"),
        "/resource:" + str(payload) + ",payload.zip",
        "/resource:" + str(manifest) + ",payload.files",
        "/out:" + str(dest), str(ROOT / "windows/PortableLauncher.cs"), str(generated),
    ], check=True)
    result = {
        "file": dest.name, "version": version, "bytes": dest.stat().st_size,
        "sha256": sha(dest.read_bytes()), "payloadSha256": payload_hash,
        "payloadFiles": len(files), "runtimeSources": RUNTIMES,
    }
    (dest.with_suffix(".build.json")).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
