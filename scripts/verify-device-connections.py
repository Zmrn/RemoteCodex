"""Host-JVM checks of the production recovery scheduler/HTTP flow; no APK execution."""
from pathlib import Path
import hashlib, subprocess, urllib.request, tempfile
from release_config import ROOT, android_tools

_, jdk, _, _ = android_tools()
cache = ROOT / 'work/host-test-deps'
cache.mkdir(parents=True, exist_ok=True)
jar = cache / 'json-20250517.jar'
url = 'https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar'
expected = '3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796'
if not jar.exists():
    data = urllib.request.urlopen(url, timeout=20).read()
    if hashlib.sha256(data).hexdigest() != expected: raise RuntimeError('Host-test dependency checksum mismatch')
    jar.write_bytes(data)
if hashlib.sha256(jar.read_bytes()).hexdigest() != expected: raise RuntimeError('Host-test cache checksum mismatch')
work = Path(tempfile.mkdtemp(prefix='device-connections-jvm-', dir=ROOT/'work'))
source = ROOT / 'android/src/com/anso/remotecodex'
subprocess.run([str(jdk/'bin/javac.exe'), '--release', '8', '-encoding', 'UTF-8', '-cp', str(jar), '-d', str(work),
                str(source/'DevicePoller.java'), str(source/'SummaryConnection.java'), str(source/'WidgetSizing.java'), str(source/'WidgetSnapshot.java'), str(source/'WidgetReadState.java'),
                str(source/'DeviceStore.java'),str(source/'WidgetText.java'),str(ROOT/'android/host-test/DeviceStoreTests.java'),
                str(ROOT/'android/host-test/DeviceConnectionTests.java'), str(ROOT/'android/host-test/WidgetPresentationTests.java')], check=True)
subprocess.run([str(jdk/'bin/java.exe'), '-ea', '-cp', str(work)+';'+str(jar), 'DeviceConnectionTests'], check=True, timeout=30)
subprocess.run([str(jdk/'bin/java.exe'), '-ea', '-cp', str(work)+';'+str(jar), 'WidgetPresentationTests'], check=True, timeout=30)
subprocess.run([str(jdk/'bin/java.exe'), '-ea', '-cp', str(work)+';'+str(jar), 'DeviceStoreTests',str(work)], check=True, timeout=30)
