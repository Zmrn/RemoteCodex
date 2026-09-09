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
    HttpURLConnection c=DeviceConnection.open(app.devices,id,"/api/task-summary","GET",new byte[0],null);
    c.setConnectTimeout(6000);c.setReadTimeout(20000);
    try{int code=c.getResponseCode();if(code!=200)throw new IOException(code==404?"目标需更新":"设备暂不可用");
      try(InputStream in=c.getInputStream()){return new JSONObject(new String(LocalServer.all(in,2*1024*1024),"UTF-8"));}
    }finally{c.disconnect();}
  }
  public void listen(Runnable listener){listeners.add(listener);}
  public void unlisten(Runnable listener){listeners.remove(listener);}
  private void changed(){main.post(()->{TaskWidget.render(app);for(Runnable l:listeners)l.run();});}
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
    if(completion!=null)completions.add(completion);if(working)return;working=true;changed();
    worker.execute(()->{try{refreshBlocking();}catch(Exception e){synchronized(this){cacheError="统计刷新失败，保留上次结果";}}finally{
      List<Runnable> callbacks;synchronized(this){working=false;callbacks=new ArrayList<>(completions);completions.clear();}
      changed();main.post(()->{for(Runnable c:callbacks)c.run();});
    }});
  }
  public void refreshBlocking()throws Exception{
    JSONArray devices=app.devices.list().getJSONArray("agents");
    Map<String,String> signatures=new LinkedHashMap<>();for(int i=0;i<devices.length();i++){String id=devices.getJSONObject(i).getString("id");signatures.put(id,signature(id));}
    CompletionService<JSONObject> queue=new ExecutorCompletionService<>(network);List<Future<JSONObject>> requests=new ArrayList<>();
    for(String id:signatures.keySet())requests.add(queue.submit(()->{
      JSONObject row=new JSONObject().put("id",id).put("signature",signatures.get(id));
      try{JSONObject value=source.read(id);if(value.optInt("schemaVersion")!=1||!(value.opt("threads") instanceof JSONArray)||!value.has("complete"))throw new IOException("目标需更新");
        JSONArray input=value.getJSONArray("threads"),clean=new JSONArray();if(input.length()>5000)throw new IOException("统计过大");
        for(int i=0;i<input.length();i++){JSONObject t=input.getJSONObject(i);String tid=t.getString("id"),kind=t.getString("kind");
          if(!tid.matches("[a-f0-9-]{36}")||!Arrays.asList("codex","chatgpt").contains(kind))throw new IOException("统计格式异常");
          clean.put(new JSONObject().put("id",tid).put("kind",kind).put("title",t.optString("title","未命名任务").substring(0,Math.min(240,t.optString("title","未命名任务").length())))
            .put("running",t.getBoolean("running")).put("unread",t.getBoolean("unread")&&!t.getBoolean("running"))
            .put("unknown",t.optBoolean("unknown")).put("reportToken",t.optString("reportToken","")).put("updatedAt",t.optDouble("updatedAt",0)));
        }
        row.put("threads",clean).put("complete",value.getBoolean("complete")).put("receivedAt",System.currentTimeMillis()).put("available",true);
      }catch(Exception e){row.put("available",false).put("error","目标需更新".equals(e.getMessage())?"目标需更新":"设备离线");}return row;
    }));
    List<JSONObject> results=new ArrayList<>();long end=System.currentTimeMillis()+60000;
    try{for(int i=0;i<requests.size();i++){Future<JSONObject> future=queue.poll(Math.max(1,end-System.currentTimeMillis()),TimeUnit.MILLISECONDS);if(future==null)break;results.add(future.get());}}
    finally{for(Future<JSONObject> f:requests)if(!f.isDone())f.cancel(true);}
    synchronized(this){
      JSONObject next=new JSONObject(cached.toString());Set<String> received=new HashSet<>();
      for(JSONObject row:results){String id=row.getString("id");received.add(id);try{if(!signature(id).equals(row.getString("signature")))continue;}catch(Exception e){next.remove(id);continue;}
        if(row.getBoolean("available")){
          JSONObject previous=next.optJSONObject(id);JSONArray oldRows=previous!=null&&previous.optString("signature").equals(row.getString("signature"))?previous.optJSONArray("threads"):null;
          Map<String,JSONObject> old=new HashMap<>();if(oldRows!=null)for(int i=0;i<oldRows.length();i++){JSONObject t=oldRows.getJSONObject(i);old.put(t.getString("kind")+":"+t.getString("id"),t);}
          JSONArray incoming=row.getJSONArray("threads");
          for(int i=0;i<incoming.length();i++){
            JSONObject t=incoming.getJSONObject(i),before=old.get(t.getString("kind")+":"+t.getString("id"));
            if(t.optBoolean("unknown")&&before!=null){
              t.put("running",before.optBoolean("running")).put("unread",before.optBoolean("unread")).put("reportToken",before.optString("reportToken")).put("cached",true);
            }
            // An acknowledgement arriving while this request was in flight
            // must survive its older response, including after process restart.
            if(readTokens.has(id+":"+t.getString("id")+":"+t.optString("reportToken")))t.put("unread",false);
          }
          next.put(id,row);
        }
        else{JSONObject old=next.optJSONObject(id);if(old==null||!old.optString("signature").equals(row.getString("signature")))old=row;old.put("available",false).put("error",row.optString("error"));next.put(id,old);}
      }
      for(String id:signatures.keySet())if(!received.contains(id)){JSONObject old=next.optJSONObject(id);if(old!=null)old.put("available",false).put("error","连接超时");}
      Set<String> currentIds=new HashSet<>();JSONArray current=app.devices.list().getJSONArray("agents");for(int i=0;i<current.length();i++)currentIds.add(current.getJSONObject(i).getString("id"));
      Iterator<String> keys=next.keys();while(keys.hasNext())if(!currentIds.contains(keys.next()))keys.remove();
      persist(next);
    }
    changed();
  }
  public synchronized void markRead(String agent,String thread,String token)throws Exception{
    if(!token.matches("[a-f0-9]{64}"))throw new IOException("已读标记格式无效");
    JSONObject next=new JSONObject(cached.toString()),device=next.optJSONObject(agent);
    readTokens.put(agent+":"+thread+":"+token,System.currentTimeMillis());
    // Watermarks cover in-flight requests; the bridge owns durable receipts.
    Iterator<String> keys=readTokens.keys();while(keys.hasNext()){String key=keys.next();if(System.currentTimeMillis()-readTokens.optLong(key)>30L*24*60*60*1000)keys.remove();}
    JSONArray rows=device==null?null:device.optJSONArray("threads");
    if(rows!=null)for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(row.getString("id").equals(thread)&&row.optString("reportToken").equals(token))row.put("unread",false);}
    persist(next);changed();
  }
  public void devicesChanged(){changed();if(TaskWidget.exists(app))refreshAsync(null);}
  public synchronized JSONObject snapshot()throws Exception{
    JSONArray devices=app.devices.list().getJSONArray("agents"),items=new JSONArray();Map<String,JSONObject> tasks=new LinkedHashMap<>();
    int offline=0,unknown=0,incomplete=0,known=0;long oldest=Long.MAX_VALUE,now=System.currentTimeMillis();
    for(int i=0;i<devices.length();i++){
      JSONObject device=devices.getJSONObject(i);String id=device.getString("id");JSONObject value=cached.optJSONObject(id);
      if(value==null||!value.optString("signature").equals(signature(id))||value.optJSONArray("threads")==null){unknown++;continue;}
      known++;long at=value.optLong("receivedAt",0);oldest=Math.min(oldest,at);
      boolean stale=!value.optBoolean("available")||now-at>20*60*1000;
      if(stale)offline++;if(!value.optBoolean("complete"))incomplete++;
      JSONArray rows=value.getJSONArray("threads");
      for(int j=0;j<rows.length();j++){
        JSONObject t=new JSONObject(rows.getJSONObject(j).toString());String key=t.getString("kind")+":"+t.getString("id");
        t.put("agentId",id).put("deviceName",device.getString("name")).put("stale",stale||t.optBoolean("cached")||t.optBoolean("unknown")).put("receivedAt",at);
        JSONObject previous=tasks.get(key);
        boolean read=previous!=null&&!t.optString("reportToken").isEmpty()&&previous.optString("reportToken").equals(t.optString("reportToken"))&&(!previous.optBoolean("unread")||!t.optBoolean("unread"));
        if(previous==null||previous.optBoolean("stale")&&!t.optBoolean("stale")||previous.optBoolean("stale")==t.optBoolean("stale")&&(t.optDouble("updatedAt")>previous.optDouble("updatedAt")||t.optDouble("updatedAt")==previous.optDouble("updatedAt")&&at>previous.optLong("receivedAt")))tasks.put(key,t);
        if(read)tasks.get(key).put("unread",false);
      }
    }
    int unread=0,running=0;for(JSONObject task:tasks.values()){if(task.optBoolean("running"))running++;else if(task.optBoolean("unread"))unread++;items.put(task);}
    String time=oldest==Long.MAX_VALUE?"":new java.text.SimpleDateFormat(now-oldest>24*60*60*1000?"MM-dd HH:mm":"HH:mm",java.util.Locale.getDefault()).format(new java.util.Date(oldest));
    String label=devices.length()==0?"添加设备":known==0?"暂无数据 · 点击刷新":unknown>0?unknown+" 台未连接 · 部分统计":offline>0?"含离线缓存 · "+time:incomplete>0?"部分统计 · 点击查看":"全部设备合计 · "+time;
    if(!cacheError.isEmpty())label=cacheError;
    return new JSONObject().put("known",known>0||devices.length()==0).put("unread",unread).put("running",running).put("label",label)
      .put("complete",known==devices.length()&&offline==0&&incomplete==0&&cacheError.isEmpty()).put("working",working)
      .put("devices",devices.length()).put("offline",offline+unknown).put("lastUpdated",time).put("threads",items);
  }
}
