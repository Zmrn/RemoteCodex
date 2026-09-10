package com.anso.remotecodex;
import org.json.JSONObject;

/** All status surfaces distinguish unknown observations from confirmed zero. */
public final class WidgetText {
  public static String count(JSONObject state,String key){return state.optBoolean("known")?String.valueOf(state.optInt(key)):"—";}
  public static String notification(JSONObject state){
    String result=state.optInt("connectedDevices")+" / "+state.optInt("devices")+" 台设备已连接 · ";
    result+=state.optBoolean("known")?count(state,"unread")+" 未读 / "+count(state,"running")+" 运行中":"官方状态未知";
    if(!state.optBoolean("complete"))result+=" · 部分统计";
    return result;
  }
}
