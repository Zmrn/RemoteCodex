"""Build the separate, same-signed instrumentation APK; never publish it."""
import json, tempfile, zipfile
from pathlib import Path
from build_android import run, password
from release_config import ROOT, android_tools

sdk,jdk,tools,android=android_tools()
builds=sorted((ROOT/'work').glob('android-build-*/classes.jar'),key=lambda p:p.stat().st_mtime,reverse=True)
production=builds[0]
work=Path(tempfile.mkdtemp(prefix='android-test-',dir=ROOT/'work'));classes=work/'classes';dex=work/'dex';classes.mkdir();dex.mkdir()
manifest=work/'AndroidManifest.xml'
manifest.write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.anso.remotecodex.tests"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><application android:label="Remote Codex Tests"/><instrumentation android:name="com.anso.remotecodex.tests.Probe" android:targetPackage="com.anso.remotecodex"/></manifest>''')
unsigned=work/'unsigned.apk'
run([tools/'aapt2.exe','link','-I',android,'--manifest',manifest,'-o',unsigned])
run([jdk/'bin/javac.exe','-J-Duser.language=en','--release','8','-encoding','UTF-8','-classpath',str(android)+';'+str(production),'-d',classes,*list((ROOT/'android/test').glob('*.java'))])
jar=work/'test.jar'
with zipfile.ZipFile(jar,'w') as z:
    for f in classes.rglob('*.class'):z.write(f,f.relative_to(classes).as_posix())
run([jdk/'bin/java.exe','-cp',tools/'lib/d8.jar','com.android.tools.r8.D8','--lib',android,'--classpath',production,'--min-api','26','--output',dex,jar])
with zipfile.ZipFile(unsigned,'a') as z:
    z.write(dex/'classes.dex','classes.dex')
    z.write(ROOT/'scripts/fixtures/queue-preview.js','assets/queue-preview.js')
aligned=work/'aligned.apk';run([tools/'zipalign.exe','-f','4',unsigned,aligned]);key,env=password(jdk)
run([jdk/'bin/java.exe','-jar',tools/'lib/apksigner.jar','sign','--ks',key,'--ks-key-alias','remote-codex','--ks-pass','env:REMOTE_CODEX_SIGNING_PASSWORD','--out',ROOT/'work/RemoteCodex-tests.apk',aligned],env=env)
