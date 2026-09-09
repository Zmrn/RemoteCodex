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
  private void safeBounds(String label)throws Exception{
    final int[] bounds=new int[10];
    runOnMainSync(()->{android.view.WindowInsets wi=activity.getWindow().getDecorView().getRootWindowInsets();android.graphics.Insets safe=wi.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout()|android.view.WindowInsets.Type.ime());android.graphics.Rect screen=activity.getWindowManager().getCurrentWindowMetrics().getBounds();int[] xy=new int[2];activity.web.getLocationOnScreen(xy);bounds[0]=xy[0];bounds[1]=xy[1];bounds[2]=xy[0]+activity.web.getWidth();bounds[3]=xy[1]+activity.web.getHeight();bounds[4]=safe.left;bounds[5]=safe.top;bounds[6]=screen.width()-safe.right;bounds[7]=screen.height()-safe.bottom;bounds[8]=activity.web.getPaddingTop();bounds[9]=activity.web.getPaddingBottom();});
    require(bounds[0]>=bounds[4]&&bounds[1]>=bounds[5]&&bounds[2]<=bounds[6]&&bounds[3]<=bounds[7],label+" native WebView excludes system bars/cutout/IME "+java.util.Arrays.toString(bounds));
    require(bounds[2]-bounds[0]>100&&bounds[3]-bounds[1]>100&&bounds[8]==0&&bounds[9]==0,label+" measured viewport, no WebView padding workaround");
    require("true".equals(js("(()=>{const r=document.querySelector('.composer').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth})()")),label+" composer and horizontal content inside CSS viewport");
  }
  private boolean imeVisible()throws Exception{final boolean[] shown={false};runOnMainSync(()->shown[0]=activity.getWindow().getDecorView().getRootWindowInsets().isVisible(android.view.WindowInsets.Type.ime()));return shown[0];}
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
    }else if(stage.equals("web-images")){
      String source="https://interfaceingame.com/wp-content/uploads/detroit-become-human/detroit-become-human-audio.jpg";
      String markdown="![Image one]("+source+")\n\n![Image two](https://interfaceingame.com/wp-content/uploads/nierautomata/nierautomata-settings.jpg)";
      js("window.__webImageProbe=null;import(location.origin+'/ui.mjs').then(({markdown})=>{const node=markdown("+JSONObject.quote(markdown)+");node.id='web-image-probe';node.style.cssText='position:fixed;inset:0;background:#101722;z-index:999;overflow:auto;padding:20px';document.body.append(node);window.__webImageProbe=true}).catch(e=>window.__webImageProbe=String(e))");
      until("window.__webImageProbe===true",15);
      until("document.querySelectorAll('#web-image-probe img').length===2 && [...document.querySelectorAll('#web-image-probe img')].every(i=>i.complete && i.naturalWidth>0)",60);
      require(true,"Android loads two actual public HTTPS images inline through CSP");
      js("document.querySelector('#web-image-probe img').click()");
      until("document.querySelector('#image-viewer')?.open && document.querySelector('#image-viewer img').naturalWidth>0",15);
      require("true".equals(js("document.querySelector('.image-viewer-download').textContent==='打开原图' && !document.querySelector('.image-viewer-download').hasAttribute('download')")),"Android remote preview offers original URL instead of unsupported local download");
      js("document.getElementById('image-viewer').close();document.getElementById('web-image-probe').remove()");
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
    }else if(stage.equals("safe-area")){
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
      until("innerWidth<innerHeight && document.body.classList.contains('mobile-layout')",15);SystemClock.sleep(700);safeBounds("portrait");
      js("document.getElementById('prompt').disabled=false;document.getElementById('prompt').focus()");
      runOnMainSync(()->{activity.web.requestFocus();((android.view.inputmethod.InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(activity.web,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);});
      long end=SystemClock.elapsedRealtime()+10000;while(!imeVisible()&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(200);
      require(imeVisible(),"real Android keyboard is visible");SystemClock.sleep(700);safeBounds("portrait keyboard");
      runOnMainSync(()->((android.view.inputmethod.InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(activity.web.getWindowToken(),0));
      SystemClock.sleep(700);
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
      until("innerWidth>innerHeight && !document.body.classList.contains('mobile-layout')",15);SystemClock.sleep(700);safeBounds("landscape");
      runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
      until("innerWidth<innerHeight",15);SystemClock.sleep(700);safeBounds("portrait restored");
      android.net.Uri first=android.net.Uri.parse("content://fixture/one"),second=android.net.Uri.parse("content://fixture/two");
      Intent picked=new Intent().setData(first);ClipData clip=ClipData.newRawUri("images",first);clip.addItem(new ClipData.Item(second));picked.setClipData(clip);
      require(java.util.Arrays.equals(MainActivity.selectedImages(Activity.RESULT_OK,picked),new android.net.Uri[]{first,second}),"native chooser keeps all ClipData URIs in order without duplication");
      require(MainActivity.selectedImages(Activity.RESULT_CANCELED,picked)==null,"cancelled chooser adds nothing");
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
