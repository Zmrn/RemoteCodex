package com.anso.remotecodex;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import org.json.*;
import java.net.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Durable summary cache, independent of device configuration and WebView lifetime. */
public final class WidgetMonitor {
  public interface Source { JSONObject read(String id)throws Exception; }
  private final App app;private final SharedPreferences prefs;private final Source source;
  private final ExecutorService worker=Executors.newSingleThreadExecutor(),network=Executors.newFixedThreadPool(3);
  private final Handler main=new Handler(Looper.getMainLooper());
  private final Set<Runnable> listeners=new CopyOnWriteArraySet<>();private final List<Runnable> completions=new ArrayList<>();
  private boolean working;private JSONObject cached,readTokens;private String cacheError="";
  public WidgetMonitor(App app){this(app,"task-widget",null);}
  public WidgetMonitor(App app,String preferenceName,Source source){
    this.app=app;this.prefs=app.getSharedPreferences(preferenceName,0);this.source=source==null?this::readRemote:source;
    try{cached=new JSONObject(prefs.getString("devices","{}"));}catch(Exception e){cached=new JSONObject();cacheError="统计缓存损坏，请刷新";}
    try{readTokens=new JSONObject(prefs.getString("readTokens","{}"));}catch(Exception e){readTokens=new JSONObject();cacheError="已读缓存损坏，请刷新";}
  }
  private JSONObject readRemote(String id)throws Exception{
    DeviceConnection.Endpoint endpoint=DeviceConnection.capture(app.devices,id);
    return SummaryConnection.read((method,route)->{
      HttpURLConnection c=DeviceConnection.open(endpoint,route,method,method.equals("POST")?"{}".getBytes("UTF-8"):new byte[0],"application/json",5000,20000);
      try{int code=c.getResponseCode();if(code!=200)throw new IOException(code==404?"目标需更新":code==401||code==403?"访问密钥无效":"设备暂不可用");
        try(InputStream in=c.getInputStream()){return new JSONObject(new String(LocalServer.all(in,2*1024*1024),"UTF-8"));}
      }finally{c.disconnect();}
    });
  }
  public void listen(Runnable listener){listeners.add(listener);}
  public void unlisten(Runnable listener){listeners.remove(listener);}
  public void changed(){main.post(()->{TaskWidget.render(app);for(Runnable l:listeners)l.run();});}
  private String signature(String id)throws Exception{
    JSONObject d=app.devices.get(id);
    byte[] raw=(d.getString("host")+":"+d.getInt("port")+":"+d.optString("sealedKey")).getBytes("UTF-8");
    StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(raw))out.append(String.format("%02x",b));return out.toString();
  }
  private synchronized void persist(JSONObject state)throws Exception{
    if(!prefs.edit().putString("devices",state.toString()).putString("readTokens",readTokens.toString()).commit())throw new IOException("统计缓存保存失败");
    cached=state;cacheError="";
  }
  public synchronized void refreshAsync(Runnable completion){
    if(completion==null&&DeviceSyncService.running){DeviceSyncService.refresh(app);return;}if(completion!=null)completions.add(completion);if(working)return;working=true;changed();
    worker.execute(()->{try{refreshBlocking();}catch(Exception e){synchronized(this){cacheError="统计刷新失败，保留上次结果";}}finally{
      List<Runnable> callbacks;synchronized(this){working=false;callbacks=new ArrayList<>(completions);completions.clear();}
      changed();main.post(()->{for(Runnable c:callbacks)c.run();});
    }});
  }
  private final ConcurrentHashMap<String,Object> deviceLocks=new ConcurrentHashMap<>();
  public Map<String,String> configuredDevices()throws Exception{
    Map<String,String> out=new LinkedHashMap<>();JSONArray devices=app.devices.list().getJSONArray("agents");
    for(int i=0;i<devices.length();i++){String id=devices.getJSONObject(i).getString("id");try{out.put(id,signature(id));}catch(Exception e){/* A concurrently removed device is no longer a target. */}}
    return out;
  }
  public boolean refreshDevice(String id,String expectedSignature)throws Exception{
    synchronized(deviceLocks.computeIfAbsent(id,key->new Object())){
      if(Thread.currentThread().isInterrupted())throw new InterruptedException();
      if(!signature(id).equals(expectedSignature))return false;
      JSONObject row=new JSONObject().put("id",id).put("signature",expectedSignature);
      try{
        JSONObject value=source.read(id);
        if(value.optInt("schemaVersion")!=1||!(value.opt("threads") instanceof JSONArray)||!value.has("complete"))throw new IOException("目标需更新");
        JSONArray input=value.getJSONArray("threads"),clean=new JSONArray();if(input.length()>5000)throw new IOException("统计过大");
        for(int i=0;i<input.length();i++){
          JSONObject t=input.getJSONObject(i);String tid=t.getString("id"),kind=t.getString("kind"),title=t.optString("title","未命名任务");
          if(!tid.matches("[a-f0-9-]{36}")||!Arrays.asList("codex","chatgpt").contains(kind))throw new IOException("统计格式异常");
          clean.put(new JSONObject().put("id",tid).put("kind",kind).put("title",title.substring(0,Math.min(240,title.length())))
            .put("running",t.getBoolean("running")).put("unread",t.getBoolean("unread")&&!t.getBoolean("running"))
            .put("officialRead",t.optBoolean("officialRead"))
            .put("unknown",t.optBoolean("unknown")).put("reportToken",t.optString("reportToken","")).put("updatedAt",t.optDouble("updatedAt",0)));
        }
        row.put("threads",clean).put("complete",value.getBoolean("complete")).put("receivedAt",System.currentTimeMillis()).put("available",true);
        JSONObject official=value.optJSONObject("officialReadState");
        row.put("officialReadStatus",official==null?"unsupported":official.optString("status","unavailable"));
      }catch(Exception e){String reason=e.getMessage();row.put("available",false).put("error",Arrays.asList("目标需更新","访问密钥无效","官方桌面尚未连接").contains(reason)?reason:"设备离线，正在重连");}
      // Each device commits immediately. A slow/offline peer never holds its result.
      if(Thread.currentThread().isInterrupted())throw new InterruptedException();
      accept(row);return row.getBoolean("available");
    }
  }
  private synchronized void accept(JSONObject row)throws Exception{
    String id=row.getString("id");JSONObject next=new JSONObject(cached.toString());
    try{if(!signature(id).equals(row.getString("signature")))return;}catch(Exception e){next.remove(id);persist(next);changed();return;}
    if(row.getBoolean("available")){
      JSONObject previous=next.optJSONObject(id);
      JSONArray oldRows=previous!=null&&previous.optString("signature").equals(row.getString("signature"))?previous.optJSONArray("threads"):null;
      Map<String,JSONObject> old=new HashMap<>();if(oldRows!=null)for(int i=0;i<oldRows.length();i++){JSONObject t=oldRows.getJSONObject(i);old.put(t.getString("kind")+":"+t.getString("id"),t);}
      JSONArray incoming=row.getJSONArray("threads");
      for(int i=0;i<incoming.length();i++){
        JSONObject t=incoming.getJSONObject(i),before=old.get(t.getString("kind")+":"+t.getString("id"));
        WidgetReadState.mergeUnknown(t,before);
        if(readTokens.has(id+":"+t.getString("id")+":"+t.optString("reportToken")))t.put("unread",false).put("officialRead",false);
      }
      next.put(id,row);
    }else{
      JSONObject old=next.optJSONObject(id);if(old==null||!old.optString("signature").equals(row.getString("signature")))old=row;
      old.put("available",false).put("error",row.optString("error"));next.put(id,old);
    }
    Set<String> currentIds=configuredDevices().keySet();Iterator<String> keys=next.keys();while(keys.hasNext())if(!currentIds.contains(keys.next()))keys.remove();
    persist(next);changed();
  }
  public void refreshBlocking()throws Exception{
    Map<String,String> targets=configuredDevices();CompletionService<Boolean> queue=new ExecutorCompletionService<>(network);List<Future<Boolean>> requests=new ArrayList<>();
    for(Map.Entry<String,String> e:targets.entrySet())requests.add(queue.submit(()->refreshDevice(e.getKey(),e.getValue())));
    long end=System.currentTimeMillis()+60000;
    try{for(int i=0;i<requests.size();i++){Future<Boolean> done=queue.poll(Math.max(1,end-System.currentTimeMillis()),TimeUnit.MILLISECONDS);if(done==null)break;try{done.get();}catch(ExecutionException ignored){}}}
    finally{for(Future<Boolean> request:requests)if(!request.isDone())request.cancel(true);}
  }
  public synchronized void markRead(String agent,String thread,String token)throws Exception{
    if(!token.matches("[a-f0-9]{64}"))throw new IOException("已读标记格式无效");
    JSONObject next=new JSONObject(cached.toString()),device=next.optJSONObject(agent);
    readTokens.put(agent+":"+thread+":"+token,System.currentTimeMillis());
    // Watermarks cover in-flight requests; the bridge owns durable receipts.
    Iterator<String> keys=readTokens.keys();while(keys.hasNext()){String key=keys.next();if(System.currentTimeMillis()-readTokens.optLong(key)>30L*24*60*60*1000)keys.remove();}
    JSONArray rows=device==null?null:device.optJSONArray("threads");
    if(rows!=null)for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(row.getString("id").equals(thread)&&row.optString("reportToken").equals(token))row.put("unread",false).put("officialRead",false);}
    persist(next);changed();
  }
  public void devicesChanged(){changed();DeviceSyncService.ensure(app);DeviceSyncService.refresh(app);if(!DeviceSyncService.running)refreshAsync(null);}
  public synchronized JSONObject snapshot()throws Exception{return snapshot("");}
  public synchronized JSONObject snapshot(String selected)throws Exception{
    JSONArray configured=app.devices.list().getJSONArray("agents"),entries=new JSONArray();
    for(int i=0;i<configured.length();i++){
      JSONObject device=configured.getJSONObject(i);String id=device.getString("id");JSONObject value=cached.optJSONObject(id);
      JSONObject entry=new JSONObject().put("id",id).put("name",device.getString("name"));
      try{if(value!=null&&value.optString("signature").equals(signature(id)))entry.put("value",value);}catch(Exception ignored){/* Removed or changed while reading: no old endpoint's cache. */}
      entries.put(entry);
    }
    return WidgetSnapshot.build(entries,selected,System.currentTimeMillis(),DeviceSyncService.running,working,cacheError);
  }
}
