"""Build/sign a dependency-free Android WebView controller with the installed SDK."""
from pathlib import Path
import argparse, hashlib, json, os, secrets, subprocess, sys, zipfile, tempfile
from release_config import ROOT, config, android_tools, version_code
from desktop_compatibility import compatibility, release_notes

def run(args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)

def password(jdk):
    key = ROOT / 'data/android-signing.p12'
    secret = ROOT / 'data/android-signing-password.json'
    key.parent.mkdir(exist_ok=True)
    if key.exists() != secret.exists(): raise RuntimeError('Signing identity incomplete; restore it, never regenerate')
    def dpapi(value, op):
        result = subprocess.run([sys.executable, str(ROOT / 'src/win_secret.py')],
            input=json.dumps({'value': value, 'operation': op}), text=True, capture_output=True, check=True)
        return json.loads(result.stdout)['value']
    if key.exists():
        value = dpapi(json.loads(secret.read_text())['sealedPassword'], 'unprotect')
    else:
        value = secrets.token_urlsafe(40)
        env = dict(os.environ, REMOTE_CODEX_SIGNING_PASSWORD=value)
        run([jdk / 'bin/keytool.exe', '-genkeypair', '-keystore', key, '-storetype', 'PKCS12',
            '-storepass:env', 'REMOTE_CODEX_SIGNING_PASSWORD', '-alias', 'remote-codex', '-keyalg', 'RSA',
            '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Remote Codex, O=Anso', '-noprompt'], env=env)
        secret.write_text(json.dumps({'sealedPassword': dpapi(value, 'protect')}))
    return key, dict(os.environ, REMOTE_CODEX_SIGNING_PASSWORD=value)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', help='Override only for isolated upgrade tests')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    settings = config()
    sdk, jdk, tools, android = android_tools()
    version = args.version or json.loads((ROOT / 'package.json').read_text())['version']
    desktop_support = compatibility()
    code = version_code(version)
    (ROOT / 'work').mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='android-build-' + version + '-', dir=ROOT / 'work'))
    assets, resource, classes, dex = (work / p for p in ('assets', 'res/drawable', 'classes', 'dex'))
    for folder in (assets / 'web', resource, classes, dex): folder.mkdir(parents=True, exist_ok=True)
    for file in (ROOT / 'public').iterdir():
        if file.is_file(): (assets / 'web' / file.name).write_bytes(file.read_bytes())
    (assets / 'release.json').write_text(json.dumps({'baseUrl': settings['baseUrl']}))
    (assets / 'desktop-compatibility.json').write_text(json.dumps(desktop_support), encoding='utf-8')
    (assets / 'RELEASE-NOTES.md').write_bytes(release_notes(version))
    (assets / 'update-public-key.pem').write_bytes((ROOT / 'src/update-public-key.pem').read_bytes())
    (resource / 'app_icon.png').write_bytes((ROOT / 'public/app-icon-192.png').read_bytes())
    manifest = work / 'AndroidManifest.xml'
    manifest.write_text((ROOT / 'android/AndroidManifest.xml').read_text().replace('__VERSION_CODE__', str(code)).replace('__VERSION__', version))
    build_info = work / 'BuildInfo.java'
    build_info.write_text('package com.anso.remotecodex; public final class BuildInfo { public static final String VERSION = '+json.dumps(version)+'; }')
    compiled = work / 'resources.zip'
    run([tools / 'aapt2.exe', 'compile', '--dir', work / 'res', '-o', compiled])
    unsigned = work / 'unsigned.apk'
    run([tools / 'aapt2.exe', 'link', '-I', android, '--manifest', manifest, '-A', assets, '-o', unsigned, compiled])
    sources = list((ROOT / 'android/src').rglob('*.java')) + [build_info]
    run([jdk / 'bin/javac.exe', '-J-Duser.language=en', '-encoding', 'UTF-8', '--release', '8', '-classpath', android, '-d', classes, *sources])
    jar = work / 'classes.jar'
    with zipfile.ZipFile(jar, 'w') as z:
        for file in classes.rglob('*.class'): z.write(file, file.relative_to(classes).as_posix())
    run([jdk / 'bin/java.exe', '-cp', tools / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', android, '--min-api', '26', '--output', dex, jar])
    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as z:
        for file in dex.glob('*.dex'): z.write(file, file.name)
    aligned = work / 'aligned.apk'
    run([tools / 'zipalign.exe', '-f', '-p', '4', unsigned, aligned])
    key, env = password(jdk)
    output = (args.output or ROOT / 'dist/RemoteCodex.apk').resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    signer = [jdk / 'bin/java.exe', '-jar', tools / 'lib/apksigner.jar']
    run([*signer, 'sign', '--ks', key, '--ks-key-alias', 'remote-codex', '--ks-pass', 'env:REMOTE_CODEX_SIGNING_PASSWORD', '--out', output, aligned], env=env)
    run([*signer, 'verify', '--verbose', '--print-certs', output])
    report = {'file': output.name, 'version': version, 'versionCode': code, 'bytes': output.stat().st_size,
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'packageName': 'com.anso.remotecodex', 'desktopCompatibility': desktop_support}
    output.with_suffix('.apk.build.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
