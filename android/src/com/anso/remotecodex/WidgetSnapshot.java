package com.anso.remotecodex;

import org.json.*;
import java.util.*;

/** Read-only presentation of validated cache entries. Never writes devices or receipts. */
public final class WidgetSnapshot {
  public static JSONObject build(JSONArray devices, String selected, long now, boolean syncing, boolean working, String error) throws Exception {
    JSONArray items=new JSONArray(),states=new JSONArray();Map<String,JSONObject> tasks=new LinkedHashMap<>();
    int offline=0,unknown=0,incomplete=0,known=0,total=0;long oldest=Long.MAX_VALUE;
    for(int i=0;i<devices.length();i++){
      JSONObject device=devices.getJSONObject(i),value=device.optJSONObject("value");String id=device.getString("id");
      boolean hasData=value!=null&&value.optJSONArray("threads")!=null;
      long at=hasData?value.optLong("receivedAt",0):0;
      boolean stale=!hasData||!value.optBoolean("available")||now-at>(syncing?60000:20*60*1000);
      String status=!hasData?(value==null?"尚未取得统计":value.optString("error","尚未取得统计")):stale?(value.optBoolean("available")?"统计已过期":value.optString("error","设备未连接")):value.optBoolean("complete")?"已连接":"已连接 · 部分统计";
      states.put(new JSONObject().put("id",id).put("name",device.getString("name")).put("known",hasData)
        .put("stale",stale).put("status",status+(hasData?("available".equals(value.optString("officialReadStatus"))?" · 已同步本机 Codex 已读":" · 仅 Remote Codex 已读"):"")).put("lastUpdated",formatTime(at,now)));
      if(!selected.isEmpty()&&!selected.equals(id))continue;
      total++;
      if(!hasData){unknown++;continue;}
      known++;oldest=Math.min(oldest,at);if(stale)offline++;if(!value.optBoolean("complete"))incomplete++;
      JSONArray rows=value.getJSONArray("threads");
      for(int j=0;j<rows.length();j++){
        JSONObject t=new JSONObject(rows.getJSONObject(j).toString());String key=t.getString("kind")+":"+t.getString("id");
        t.put("agentId",id).put("deviceName",device.getString("name")).put("stale",stale||t.optBoolean("cached")||t.optBoolean("unknown")).put("receivedAt",at);
        t.put("officialReadFresh",!stale&&!t.optBoolean("officialReadCached")&&t.optBoolean("officialRead"));
        JSONObject previous=tasks.get(key);
        boolean read=previous!=null&&!t.optString("reportToken").isEmpty()&&previous.optString("reportToken").equals(t.optString("reportToken"))&&(WidgetReadState.canClear(previous)||WidgetReadState.canClear(t));
        if(previous==null||previous.optBoolean("stale")&&!t.optBoolean("stale")||previous.optBoolean("stale")==t.optBoolean("stale")&&(t.optDouble("updatedAt")>previous.optDouble("updatedAt")||t.optDouble("updatedAt")==previous.optDouble("updatedAt")&&at>previous.optLong("receivedAt")))tasks.put(key,t);
        if(read)tasks.get(key).put("unread",false);
      }
    }
    List<JSONObject> sorted=new ArrayList<>(tasks.values());sorted.sort((a,b)->Double.compare(b.optDouble("updatedAt"),a.optDouble("updatedAt")));
    int unread=0,running=0;for(JSONObject task:sorted){if(task.optBoolean("running"))running++;else if(task.optBoolean("unread"))unread++;items.put(task);}
    String time=oldest==Long.MAX_VALUE?"":formatTime(oldest,now);
    String label=total==0?"添加设备":known==0?"暂无数据 · 点击刷新":unknown>0?unknown+" 台未连接 · 部分统计":offline>0?"含离线缓存 · "+time:incomplete>0?"部分统计 · 点击查看":"全部设备合计 · "+time;
    if(!error.isEmpty())label=error;
    return new JSONObject().put("known",known>0||total==0).put("unread",unread).put("running",running).put("label",label)
      .put("complete",known==total&&offline==0&&incomplete==0&&error.isEmpty()).put("working",working).put("cacheError",error)
      .put("devices",total).put("configuredDevices",devices.length()).put("deviceStates",states).put("cachedDevices",offline)
      .put("connectedDevices",known-offline).put("offline",offline+unknown).put("lastUpdated",time).put("threads",items);
  }
  private static String formatTime(long at,long now){return at<=0?"":new java.text.SimpleDateFormat(now-at>24*60*60*1000?"MM-dd HH:mm":"HH:mm",Locale.getDefault()).format(new Date(at));}
}
