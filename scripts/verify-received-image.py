"""Host JVM regression for received originals. Does not build or run an APK."""
from pathlib import Path
import json, os, subprocess, tempfile
root = Path(__file__).resolve().parents[1]
jdk = Path(os.environ.get('JAVA_HOME') or json.loads((root/'release.local.json').read_text(encoding='utf-8-sig'))['javaHome'])
suffix = '.exe' if os.name == 'nt' else ''
(root/'work').mkdir(exist_ok=True)
out = Path(tempfile.mkdtemp(prefix='received-image-jvm-', dir=root/'work'))
subprocess.run([str(jdk/('bin/javac'+suffix)), '--release', '8', '-encoding', 'UTF-8', '-d', str(out),
    str(root/'android/src/com/anso/remotecodex/ReceivedImage.java'), str(root/'android/host-test/ReceivedImageTests.java')], check=True)
subprocess.run([str(jdk/('bin/java'+suffix)), '-Xmx256m', '-ea', '-cp', str(out), 'ReceivedImageTests'], check=True, timeout=30)
