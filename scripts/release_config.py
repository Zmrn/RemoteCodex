"""Machine-local release settings. Never bundle SSH settings or signing secrets."""
from pathlib import Path
import json, os, re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

def config():
    file = ROOT / 'release.local.json'
    if not file.is_file():
        raise RuntimeError('Copy release.example.json to release.local.json and configure it first')
    value = json.loads(file.read_text(encoding='utf-8-sig'))
    url = urlsplit(value['baseUrl'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Invalid public resource baseUrl')
    value['baseUrl'] = value['baseUrl'].rstrip('/') + '/'
    if not re.fullmatch(r'[A-Za-z0-9_.@-]+', value['sshHost']) or value['sshHost'].startswith('-'):
        raise ValueError('Invalid SSH host')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value['remoteDirectory']) or '..' in Path(value['remoteDirectory']).parts:
        raise ValueError('Invalid remote directory')
    return value

def android_tools():
    value = config()
    sdk = Path(value.get('androidSdk') or Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk')
    jdk = Path(value.get('javaHome') or Path(os.environ['ProgramFiles']) / 'Android/Android Studio/jbr')
    build = sdk / 'build-tools' / value.get('buildTools', '35.0.1')
    jar = sdk / 'platforms' / value.get('androidPlatform', 'android-35') / 'android.jar'
    for p in (jar, build / 'aapt2.exe', build / 'lib/d8.jar', jdk / 'bin/javac.exe'):
        if not p.is_file(): raise RuntimeError('Missing Android build tool: ' + str(p))
    return sdk, jdk, build, jar

def version_code(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version): raise ValueError('Invalid version')
    major, minor, patch = map(int, version.split('.'))
    if minor >= 1000 or patch >= 1000: raise ValueError('Minor and patch must be below 1000')
    result = major * 1000000 + minor * 1000 + patch
    if not 0 < result < 2100000000: raise ValueError('Invalid Android version code')
    return result
