package com.anso.remotecodex;

import org.json.*;
import java.util.*;

/** Counts only fresh official observations. No old read flags or offline totals. */
public final class WidgetSnapshot {
  public static JSONObject build(JSONArray devices, String selected, long now, boolean syncing, boolean working, String error) throws Exception {
    JSONArray items=new JSONArray(),states=new JSONArray();Map<String,JSONObject> tasks=new LinkedHashMap<>();
    int offline=0,unknown=0,incomplete=0,known=0,total=0,unknownTasks=0;boolean anyKnown=false;long oldest=Long.MAX_VALUE;
    for(int i=0;i<devices.length();i++){
      JSONObject device=devices.getJSONObject(i),value=device.optJSONObject("value");String id=device.getString("id");
      boolean hasData=value!=null&&value.optInt("schemaVersion")==2&&"official-only".equals(value.optString("statePolicy"))&&value.optJSONArray("threads")!=null;
      long at=hasData?value.optLong("receivedAt",0):0;
      boolean stale=!hasData||!value.optBoolean("available")||at<=0||now<at||now-at>60000||!error.isEmpty();
      String status=!hasData?(value==null?"尚未取得官方状态":value.optString("error","尚未取得官方状态")):stale?(value.optBoolean("available")?"官方状态已过期，暂不计数":value.optString("error","设备未连接")):value.optBoolean("complete")?"已连接":"已连接 · 部分统计";
      states.put(new JSONObject().put("id",id).put("name",device.getString("name")).put("known",hasData)
        .put("stale",stale).put("status",status+(hasData?" · 以官方状态为准":"")).put("lastUpdated",formatTime(at,now)));
      if(!selected.isEmpty()&&!selected.equals(id))continue;
      total++;
      if(!hasData){unknown++;continue;}
      if(stale){offline++;continue;}known++;oldest=Math.min(oldest,at);if(!value.optBoolean("complete"))incomplete++;
      JSONArray rows=value.getJSONArray("threads");if(rows.length()==0&&value.optBoolean("complete"))anyKnown=true;
      for(int j=0;j<rows.length();j++){
        JSONObject t=new JSONObject(rows.getJSONObject(j).toString());if(!WidgetReadState.confirmed(t)){unknownTasks++;incomplete++;continue;}anyKnown=true;String key=t.getString("kind")+":"+t.getString("id");
        t.put("agentId",id).put("deviceName",device.getString("name")).put("stale",stale||t.optBoolean("cached")||t.optBoolean("unknown")).put("receivedAt",at);
        JSONObject previous=tasks.get(key);
        // Pick a newest usable official observation; never merge read flags.
        if(previous==null||at>previous.optLong("receivedAt"))tasks.put(key,t);
      }
    }
    List<JSONObject> sorted=new ArrayList<>(tasks.values());sorted.sort((a,b)->Double.compare(b.optDouble("updatedAt"),a.optDouble("updatedAt")));
    int unread=0,running=0;for(JSONObject task:sorted){if(task.optBoolean("running"))running++;else if(task.optBoolean("unread"))unread++;items.put(task);}
    String time=oldest==Long.MAX_VALUE?"":formatTime(oldest,now);
    String label=total==0?"添加设备":!anyKnown?"官方状态未知 · 点击刷新":unknown>0?unknown+" 台未连接 · 部分统计":offline>0?"部分设备状态未知 · "+time:incomplete>0?"部分统计 · 点击查看":"官方状态合计 · "+time;
    if(!error.isEmpty())label=error;
    return new JSONObject().put("known",anyKnown||total==0).put("unread",unread).put("running",running).put("label",label)
      .put("complete",known==total&&offline==0&&incomplete==0&&error.isEmpty()).put("working",working).put("cacheError",error)
      .put("devices",total).put("configuredDevices",devices.length()).put("deviceStates",states).put("cachedDevices",0).put("unknownTasks",unknownTasks)
      .put("connectedDevices",known).put("offline",offline+unknown).put("lastUpdated",time).put("threads",items);
  }
  private static String formatTime(long at,long now){return at<=0?"":new java.text.SimpleDateFormat(now-at>24*60*60*1000?"MM-dd HH:mm":"HH:mm",Locale.getDefault()).format(new Date(at));}
}
