"""Compile and exercise only the production Java HTTP helper; no APK build/run."""
from pathlib import Path
import os, json, subprocess, tempfile

root = Path(__file__).resolve().parents[1]
settings = root/'release.local.json'
jdk = Path(os.environ.get('JAVA_HOME') or json.loads(settings.read_text(encoding='utf-8-sig'))['javaHome'])
suffix = '.exe' if os.name == 'nt' else ''
(root/'work').mkdir(exist_ok=True)
out = Path(tempfile.mkdtemp(prefix='update-network-jvm-', dir=root/'work'))
subprocess.run([str(jdk/('bin/javac'+suffix)), '--release', '8', '-encoding', 'UTF-8', '-d', str(out),
    str(root/'android/src/com/anso/remotecodex/UpdateNetwork.java'), str(root/'android/host-test/UpdateNetworkTests.java')], check=True)
subprocess.run([str(jdk/('bin/java'+suffix)), '-ea', '-cp', str(out), 'UpdateNetworkTests'], check=True, timeout=30)
