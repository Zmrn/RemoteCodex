"""Production Android media continuation helper on the host JVM; no APK."""
from pathlib import Path
import os, subprocess, tempfile
root=Path(__file__).resolve().parents[1]
jdk=Path(os.environ['JAVA_HOME']);suffix='.exe' if os.name=='nt' else ''
(root/'work').mkdir(exist_ok=True)
out=Path(tempfile.mkdtemp(prefix='media-resume-jvm-',dir=root/'work'))
subprocess.run([str(jdk/('bin/javac'+suffix)),'--release','8','-encoding','UTF-8','-d',str(out),
    str(root/'android/src/com/anso/remotecodex/MediaHeaders.java'),str(root/'android/host-test/MediaHeadersTests.java')],check=True)
subprocess.run([str(jdk/('bin/java'+suffix)),'-Xmx256m','-ea','-cp',str(out),'MediaHeadersTests'],check=True,timeout=30)
