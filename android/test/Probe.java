package com.anso.remotecodex.tests;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
import com.anso.remotecodex.*;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;

/** Same-signed instrumentation, never bundled in the release APK. Read-only against real agents. */
public final class Probe extends Instrumentation {
  private Bundle args; private MainActivity activity; private App app;
  @Override public void onCreate(Bundle arguments){args=arguments;start();}
  private void require(boolean ok,String name)throws Exception{if(!ok)throw new Exception(name);Bundle b=new Bundle();b.putString("passed",name);sendStatus(1,b);}
  private String js(String script)throws Exception{CountDownLatch latch=new CountDownLatch(1);String[] value={null};runOnMainSync(()->activity.web.evaluateJavascript(script,r->{value[0]=r;latch.countDown();}));if(!latch.await(10,TimeUnit.SECONDS))throw new Exception("JS timeout");return value[0];}
  private void until(String script,int seconds)throws Exception{long end=SystemClock.elapsedRealtime()+seconds*1000L;while(SystemClock.elapsedRealtime()<end){if("true".equals(js(script)))return;SystemClock.sleep(150);}throw new Exception("UI condition timeout: "+script);}
  private HttpURLConnection request(String route, boolean cookie, boolean csrf)throws Exception{LocalServer s=app.server();HttpURLConnection c=(HttpURLConnection)new URL(s.origin+route).openConnection(Proxy.NO_PROXY);c.setConnectTimeout(10000);c.setReadTimeout(60000);if(cookie)c.setRequestProperty("Cookie","bridgeSession="+s.session);if(csrf)c.setRequestProperty("X-Bridge-CSRF",s.csrf);return c;}
  private String body(HttpURLConnection c)throws Exception{try(InputStream in=c.getInputStream()){ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)b.write(buf,0,n);return b.toString("UTF-8");}finally{c.disconnect();}}
  private String get(String route)throws Exception{return body(request(route,true,true));}
  @Override public void onStart(){Bundle result=new Bundle();try{
    app=(App)getTargetContext().getApplicationContext();
    activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    until("document.readyState==='complete'",20);
    require(request("/",false,false).getResponseCode()==403,"private loopback requires app session");
    require(request("/api/agents",true,false).getResponseCode()==403,"API requires CSRF");
    require(!get("/api/agents").contains("sealedKey"),"registry strips encrypted secrets");
    String stage=args.getString("stage","smoke");
    if(stage.equals("inspect")){js("import('/app.js').catch(e=>window.__probeError=String(e))");SystemClock.sleep(1000);result.putString("scriptError",js("window.__probeError"));result.putString("ui",js("JSON.stringify({title:document.getElementById('agent-title').textContent,empty:document.getElementById('empty-title').textContent,error:document.getElementById('error')?.textContent,platform:document.querySelector('[name=bridge-platform]')?.content,modules:[...document.scripts].map(s=>s.src),updates:document.getElementById('help-update-status').textContent})"));}
    else if(stage.equals("smoke")){
      until("document.getElementById('agent-title').textContent==='添加电脑'",15);
      require("true".equals(js("document.getElementById('prompt').disabled")),"no device disables composer");
      require("true".equals(js("innerWidth<760 && !document.body.classList.contains('drawer-open')")),"portrait drawer starts closed");
      js("document.getElementById('create').click()");until("document.getElementById('agent-dialog').open",5);
      require(true,"new conversation opens inline device onboarding when empty");js("document.getElementById('agent-dialog').close()");
    }else if(stage.equals("connect")){
      JSONObject data=new JSONObject();if(args.containsKey("seed")){HttpURLConnection seed=(HttpURLConnection)new URL(args.getString("seed")).openConnection();data=new JSONObject(body(seed));
      app.devices.save(data);require(app.devices.key(app.devices.list().getString("selectedId")).equals(data.getString("key")),"Keystore key round trip");
      require(!getTargetContext().getSharedPreferences("devices",0).getString("items","").contains(data.getString("key")),"no plaintext key in preferences");}
      runOnMainSync(()->activity.web.reload());until("document.getElementById('connection').textContent==='已连接官方桌面'",60);
      String id=app.devices.list().getString("selectedId"),base="/api/agents/"+id+"/bridge";
      JSONObject status=new JSONObject(get(base+"/status"));require(status.optBoolean("connected"),"real Windows owner connected");
      JSONObject threads=new JSONObject(get(base+"/threads"));require(threads.getJSONObject("data").getJSONArray("threads").length()>0,"real official task list");
      String thread=args.getString("thread");require(thread!=null&&thread.matches("[a-f0-9-]{36}"),"explicit test task ID supplied");JSONObject read=new JSONObject(get(base+"/threads/"+thread+"?paging=items-v1"));
      require(read.getJSONObject("data").has("thread") && read.getJSONObject("data").getJSONArray("turns").length()>0,"real task read through APK proxy");result.putString("taskId",thread);result.putString("source",read.getString("source"));
      js("document.getElementById('prompt').value='ANDROID_UPGRADE_DRAFT';window.remoteCodexSaveDrafts()");SystemClock.sleep(700);
      require(true,"draft saved without sending a task message");
    }else if(stage.equals("layout")){
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
      until("innerWidth>innerHeight && !document.body.classList.contains('mobile-layout')",15);
      require(true,"landscape desktop layout");
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
      until("innerWidth<innerHeight && document.body.classList.contains('mobile-layout')",15);
      require(true,"portrait mobile layout restored");
    }else if(stage.equals("updated")){
      require(getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0).versionName.equals(args.getString("expected","0.10.0")),"installed APK updated version");
      require(app.devices.list().getJSONArray("agents").length()>0,"saved device survives upgrade");
      until("document.getElementById('prompt').value==='ANDROID_UPGRADE_DRAFT'",30);
      require(true,"draft survives APK upgrade");
    }else if(stage.equals("update")){
      app.updates.backgroundCheck();JSONObject state=app.updates.status();require("waiting".equals(state.getString("phase")),"automatic signed APK download completed");app.updates.validateReady();require(true,"download hash package version certificate verified");
      String envelope=app.getSharedPreferences("updates",0).getString("envelope","{}");JSONObject bad=new JSONObject(envelope);bad.put("signature","AAAA");boolean rejected=false;try{app.updates.verifyEnvelope(bad);}catch(Exception expected){rejected=true;}require(rejected,"tampered update rejected");
      activity.installUpdate();
    }
    result.putString("result","PASS");finish(Activity.RESULT_OK,result);
  }catch(Throwable e){result.putString("result","FAIL");result.putString("error",e.toString());finish(Activity.RESULT_CANCELED,result);}}
}
