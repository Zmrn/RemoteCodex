package com.anso.remotecodex;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import java.util.concurrent.*;
public final class Updates {
  private final App app;private final SharedPreferences prefs;private final ExecutorService executor=Executors.newSingleThreadExecutor();
  public volatile boolean busy;private volatile boolean working=false;private volatile String phase="idle",error="";private volatile int progress;private JSONObject latest;private long lastCheck;
  public Updates(App a){app=a;prefs=a.getSharedPreferences("updates",0);try{latest=new JSONObject(prefs.getString("latest","{}"));if(latest.has("version")&&newer(latest.getString("version"),BuildInfo.VERSION)){phase=ready().exists()?"waiting":"available";}}catch(Exception ignored){} }
  public File ready(){return new File(app.getFilesDir(),"updates/RemoteCodex.apk");}
  public boolean automatic(){return prefs.getBoolean("automatic",true);}
  public void automatic(boolean on){prefs.edit().putBoolean("automatic",on).apply();if(on)checkAsync(false);}
  public synchronized JSONObject status()throws Exception{return new JSONObject().put("platform","android").put("currentVersion",BuildInfo.VERSION).put("supported",true).put("automatic",automatic()).put("phase",phase).put("progress",progress).put("available",latest!=null&&latest.has("version")&&newer(latest.getString("version"),BuildInfo.VERSION)).put("latestVersion",latest==null?JSONObject.NULL:latest.optString("version")).put("error",error).put("installRequiresConfirmation",true);}
  public void foreground(){if(automatic()&&System.currentTimeMillis()-lastCheck>3600000)checkAsync(false);}
  public synchronized void checkAsync(boolean ignored){if(working)return;working=true;executor.execute(()->{try{check(automatic());}catch(Exception e){fail(e);}finally{working=false;}});}
  public synchronized void installAsync(){if(working)return;working=true;executor.execute(()->{try{if(latest==null||!latest.has("version"))check(false);if(latest==null||!newer(latest.getString("version"),BuildInfo.VERSION))throw new Exception("没有可安装的新版");download();MainActivity activity=app.activity.get();if(activity!=null)activity.runOnUiThread(()->activity.installUpdate());}catch(Exception e){fail(e);}finally{working=false;}});}
  public void backgroundCheck()throws Exception{synchronized(this){if(!automatic()||working)return;working=true;}executor.submit(()->{try{check(true);}catch(Exception e){fail(e);}finally{working=false;}}).get();}
  private void fail(Exception e){phase="error";error=e.getMessage()==null?"更新失败，下次自动重试":e.getMessage();}
  private String base()throws Exception{try(InputStream in=app.getAssets().open("release.json")){return new JSONObject(new String(LocalServer.all(in,16000),"UTF-8")).getString("baseUrl");}}
  private HttpURLConnection open(String version)throws Exception{UpdateNetwork network=new UpdateNetwork(base());return network.open(version==null?network.manifest():network.artifact(version));}
  public JSONObject verifyEnvelope(JSONObject envelope)throws Exception{
    String encoded=envelope.getString("payload"),sig=envelope.getString("signature");if(encoded.length()>16000||sig.length()>2048)throw new Exception("更新清单过大");byte[] payload=Base64.decode(encoded,0);
    String pem;try(InputStream in=app.getAssets().open("update-public-key.pem")){pem=new String(LocalServer.all(in,8000),"UTF-8").replaceAll("-----[A-Z ]+-----|\\s","");}
    PublicKey key=KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.decode(pem,0)));java.security.Signature verifier=java.security.Signature.getInstance("SHA256withRSA");verifier.initVerify(key);verifier.update(payload);if(!verifier.verify(Base64.decode(sig,0)))throw new Exception("更新签名校验失败");
    JSONObject m=new JSONObject(new String(payload,"UTF-8"));if(m.getInt("schema")!=1||!m.getString("platform").equals("android")||!m.getString("file").equals("RemoteCodex.apk")||!m.getString("packageName").equals(app.getPackageName())||!m.getString("version").matches("\\d+\\.\\d+\\.\\d+")||m.getLong("versionCode")!=code(m.getString("version"))||!m.getString("sha256").matches("[a-f0-9]{64}")||m.getLong("bytes")<1024||m.getLong("bytes")>150*1024*1024)throw new Exception("更新清单内容无效");return m;
  }
  private void check(boolean autoDownload)throws Exception{phase="checking";error="";HttpURLConnection c=open(null);JSONObject envelope;try(InputStream in=c.getInputStream()){envelope=new JSONObject(new String(LocalServer.all(in,24000),"UTF-8"));}finally{c.disconnect();}JSONObject m=verifyEnvelope(envelope);lastCheck=System.currentTimeMillis();latest=m;prefs.edit().putString("latest",m.toString()).putString("envelope",envelope.toString()).apply();if(!newer(m.getString("version"),BuildInfo.VERSION)){phase="current";return;}phase="available";if(autoDownload)download();}
  private void download()throws Exception{
    // Reverify the signed envelope after process recreation; unsigned prefs are never authority.
    latest=verifyEnvelope(new JSONObject(prefs.getString("envelope","{}")));if(!newer(latest.getString("version"),BuildInfo.VERSION))throw new Exception("拒绝降级或重复安装");
    ready().getParentFile().mkdirs();boolean cached=false;try{validateApk(ready());cached=true;}catch(Exception ignored){}
    if(!cached){phase="downloading";progress=0;File tmp=new File(ready().getParentFile(),"download.tmp");HttpURLConnection c=open(latest.getString("version"));long total=0,limit=latest.getLong("bytes");try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(tmp)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){total+=n;if(total>limit)throw new Exception("APK 超出签名清单大小");out.write(b,0,n);progress=(int)(100*total/limit);}}finally{c.disconnect();}validateApk(tmp);if(!tmp.renameTo(ready()))throw new Exception("无法保存更新包");}
    phase="waiting";progress=100;notifyReady();
  }
  private Set<String> signatures(PackageInfo p)throws Exception{Set<String> out=new HashSet<>();android.content.pm.Signature[] a=Build.VERSION.SDK_INT>=28?p.signingInfo.getApkContentsSigners():p.signatures;for(android.content.pm.Signature s:a)out.add(hash(s.toByteArray()));return out;}
  public void validateApk(File file)throws Exception{
    if(latest==null||!file.isFile()||file.length()!=latest.getLong("bytes")||!hashFile(file).equals(latest.getString("sha256")))throw new Exception("APK 大小或 SHA-256 不匹配");
    int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;PackageManager pm=app.getPackageManager();PackageInfo candidate=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags),current=pm.getPackageInfo(app.getPackageName(),flags);
    if(candidate==null||!app.getPackageName().equals(candidate.packageName)||!latest.getString("version").equals(candidate.versionName)||(Build.VERSION.SDK_INT>=28?candidate.getLongVersionCode():candidate.versionCode)!=latest.getLong("versionCode")||!signatures(candidate).equals(signatures(current)))throw new Exception("APK 包名、版本或安装签名不匹配");
  }
  public void validateReady()throws Exception{latest=verifyEnvelope(new JSONObject(prefs.getString("envelope","{}")));if(!newer(latest.getString("version"),BuildInfo.VERSION))throw new Exception("已是当前版本");validateApk(ready());}
  private void notifyReady(){try{NotificationManager nm=app.getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("updates","软件更新",NotificationManager.IMPORTANCE_DEFAULT));Intent intent=new Intent(app,MainActivity.class).putExtra("installUpdate",true);PendingIntent p=PendingIntent.getActivity(app,10,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);nm.notify(10,new Notification.Builder(app,"updates").setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Remote Codex 更新已下载").setContentText("点击由 Android 确认安装").setContentIntent(p).setAutoCancel(true).build());}catch(SecurityException ignored){} }
  public static long code(String version){String[] p=version.split("\\.");return Long.parseLong(p[0])*1000000+Long.parseLong(p[1])*1000+Long.parseLong(p[2]);}
  public static boolean newer(String a,String b){String[] x=a.split("\\."),y=b.split("\\.");for(int i=0;i<3;i++){int c=Long.compare(Long.parseLong(x[i]),Long.parseLong(y[i]));if(c!=0)return c>0;}return false;}
  public static String hash(byte[] b)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(b));}
  public static String hashFile(File file)throws Exception{MessageDigest md=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)md.update(b,0,n);}return hex(md.digest());}
  private static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format("%02x",x));return s.toString();}
}
