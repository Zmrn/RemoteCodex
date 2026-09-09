package com.anso.remotecodex;
import android.os.Handler;
import android.os.Looper;
import org.json.*;
import java.net.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Short-lived official observations only; no task/read state is stored on disk. */
public final class WidgetMonitor {
  public interface Source { JSONObject read(String id)throws Exception; }
  private final App app;private final Source source;
  private final ExecutorService worker=Executors.newSingleThreadExecutor(),network=Executors.newFixedThreadPool(3);
  private final Handler main=new Handler(Looper.getMainLooper());
  private final Set<Runnable> listeners=new CopyOnWriteArraySet<>();private final List<Runnable> completions=new ArrayList<>();
  private boolean working;private JSONObject cached=new JSONObject();private String cacheError="";
  private final Map<String,Long> generations=new HashMap<>();
  private final Runnable expire=()->changed();
  public WidgetMonitor(App app){this(app,"task-widget",null);}
  public WidgetMonitor(App app,String preferenceName,Source source){
    this.app=app;this.source=source==null?this::readRemote:source;
    // Old task-widget preferences are deliberately not read or rewritten.
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
  private synchronized void replaceObservation(JSONObject state)throws Exception{
    cached=state;cacheError="";
    main.removeCallbacks(expire);main.postDelayed(expire,60001);
  }
  public synchronized void refreshAsync(Runnable completion){
    if(completion==null&&DeviceSyncService.running){DeviceSyncService.refresh(app);return;}if(completion!=null)completions.add(completion);if(working)return;working=true;changed();
    worker.execute(()->{try{refreshBlocking();}catch(Exception e){synchronized(this){cached=new JSONObject();cacheError="统计刷新失败，当前状态未知";}}finally{
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
      long generation; synchronized(this){generation=generations.getOrDefault(id,0L);}
      JSONObject row=new JSONObject().put("id",id).put("signature",expectedSignature);
      try{
        JSONObject value=source.read(id);
        if(value.optInt("schemaVersion")!=2||!"official-only".equals(value.optString("statePolicy"))||!(value.opt("threads") instanceof JSONArray)||!value.has("complete"))throw new IOException("目标需更新");
        JSONArray input=value.getJSONArray("threads"),clean=new JSONArray();if(input.length()>5000)throw new IOException("统计过大");
        for(int i=0;i<input.length();i++){
          JSONObject t=input.getJSONObject(i);String tid=t.getString("id"),kind=t.getString("kind"),title=t.optString("title","未命名任务");
          if(!tid.matches("[a-f0-9-]{36}")||!Arrays.asList("codex","chatgpt").contains(kind))throw new IOException("统计格式异常");
          clean.put(new JSONObject().put("id",tid).put("kind",kind).put("title",title.substring(0,Math.min(240,title.length())))
            .put("running",t.getBoolean("running")).put("unread",t.getBoolean("unread")&&!t.getBoolean("running"))
            .put("runtimeKnown",t.optBoolean("runtimeKnown")).put("readStateKnown",t.optBoolean("readStateKnown"))
            .put("unknown",t.optBoolean("unknown")).put("reportToken",t.optString("reportToken","")).put("updatedAt",t.optDouble("updatedAt",0)));
        }
        row.put("schemaVersion",2).put("statePolicy","official-only").put("threads",clean).put("complete",value.getBoolean("complete")).put("receivedAt",System.currentTimeMillis()).put("available",true);
        JSONObject official=value.optJSONObject("officialReadState");
        row.put("officialReadStatus",official==null?"unsupported":official.optString("status","unavailable"));
      }catch(Exception e){String reason=e.getMessage();row.put("available",false).put("error",Arrays.asList("目标需更新","访问密钥无效","官方桌面尚未连接").contains(reason)?reason:"设备离线，正在重连");}
      // Each device commits immediately. A slow/offline peer never holds its result.
      if(Thread.currentThread().isInterrupted())throw new InterruptedException();
      accept(row,generation);return row.getBoolean("available");
    }
  }
  private synchronized void accept(JSONObject row,long generation)throws Exception{
    String id=row.getString("id");if(generation!=generations.getOrDefault(id,0L))return;JSONObject next=new JSONObject(cached.toString());
    try{if(!signature(id).equals(row.getString("signature")))return;}catch(Exception e){next.remove(id);replaceObservation(next);changed();return;}
    next.put(id,row); // Failure replaces old task flags too.
    Set<String> currentIds=configuredDevices().keySet();Iterator<String> keys=next.keys();while(keys.hasNext())if(!currentIds.contains(keys.next()))keys.remove();
    replaceObservation(next);changed();
  }
  public void refreshBlocking()throws Exception{
    Map<String,String> targets=configuredDevices();CompletionService<Boolean> queue=new ExecutorCompletionService<>(network);List<Future<Boolean>> requests=new ArrayList<>();
    for(Map.Entry<String,String> e:targets.entrySet())requests.add(queue.submit(()->refreshDevice(e.getKey(),e.getValue())));
    long end=System.currentTimeMillis()+60000;
    try{for(int i=0;i<requests.size();i++){Future<Boolean> done=queue.poll(Math.max(1,end-System.currentTimeMillis()),TimeUnit.MILLISECONDS);if(done==null)break;try{done.get();}catch(ExecutionException ignored){}}}
    finally{for(Future<Boolean> request:requests)if(!request.isDone())request.cancel(true);}
  }
  public synchronized void markRead(String agent,String thread,String token)throws Exception{
    // Invalidate only. The next official observation determines the number.
    generations.put(agent,generations.getOrDefault(agent,0L)+1);
    cached.remove(agent);changed();refreshAsync(null);
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
