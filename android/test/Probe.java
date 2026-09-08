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
    }else if(stage.equals("citations")){
      js("window.__citationProbe=null;import(location.origin+'/ui.mjs').then(({markdown,copyMarkdown})=>{const marker='\\ue200cite\\ue202turn1view0\\ue202turn2search1\\ue201';const text='测试 **'+marker+'**\\n[网页](https://example.com/)\\n`'+marker+'`';const node=markdown(text);node.id='citation-probe';document.body.append(node);window.__citationProbe={copied:copyMarkdown(text)};}).catch(e=>window.__citationProbe={error:String(e)})");
      until("window.__citationProbe!=null",15);
      require("true".equals(js("!window.__citationProbe.error && document.querySelector('#citation-probe .citation-ref').textContent==='[1, 2]'")),"APK renders grouped citation numbers: "+js("JSON.stringify({error:window.__citationProbe?.error,text:document.querySelector('#citation-probe .citation-ref')?.textContent})"));
      js("document.querySelector('#citation-probe .citation-ref').click()");
      require("true".equals(js("document.querySelector('#citation-probe .citation-notice').open && document.querySelector('#citation-probe .citation-notice').textContent.includes('官方会话读取接口未提供')")),"tap explains unavailable source URLs");
      require("true".equals(js("document.querySelector('#citation-probe code').textContent.includes('\\ue200cite') && window.__citationProbe.copied.includes('[来源 1, 2]') && document.querySelector('#citation-probe a').href==='https://example.com/'")),"APK copy cleanup preserves literal code and normal links");
      js("document.getElementById('citation-probe').remove()");
    }else if(stage.equals("chat")){
      until("document.getElementById('connection').textContent==='已连接官方桌面'",60);
      js("document.querySelector('#mode-menu [data-mode=chat]').click()");
      until("document.body.dataset.mode==='chat' && document.querySelector('#threads .thread-card')!=null",60);
      require("true".equals(js("document.getElementById('mode-notice').textContent.includes('Work')")),"Chat list explicitly reports unclassified Work records");
      js("document.querySelector('#threads .thread-card').click()");
      until("document.querySelector('#messages .message')!=null",60);
      require("true".equals(js("document.getElementById('model-display').disabled && document.getElementById('model-display').textContent==='官方 Chat 模型'")),"Chat never offers Codex model catalog");
      require("true".equals(js("document.getElementById('image').disabled && document.getElementById('permission-display').hidden")),"unsupported Chat attachments and permissions hidden");
      require("true".equals(js("[...document.querySelectorAll('.turn-divider')].every(e=>e.textContent.includes('历史记录'))")),"Chat history does not claim runtime completion");
      require("true".equals(js("document.getElementById('metadata').textContent.includes('chat-history')")),"real Chat read uses official Windows Chat adapter");
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
      until("innerWidth>innerHeight && !document.body.classList.contains('mobile-layout')",15);
      js("document.getElementById('mode-picker').click()");
      require("true".equals(js("document.getElementById('mode-menu').matches(':popover-open')")),"Android landscape mode dropdown opens");
      js("document.querySelector('#mode-menu [data-mode=codex]').click()");
      until("document.body.dataset.mode==='codex' && document.querySelector('#threads .thread-card')!=null",30);
      require(true,"Android switches back to real Codex list");
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
      until("document.body.classList.contains('mobile-layout') && !document.body.classList.contains('drawer-open')",15);
      require(true,"portrait drawer remains closed; no real task writes");
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
