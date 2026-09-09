package com.anso.remotecodex;
import java.io.IOException;
import org.json.JSONObject;

/** Viewing recovery only; this class cannot send task messages or replay writes. */
public final class SummaryConnection {
  public interface Wire { JSONObject request(String method,String route) throws Exception; }
  public static JSONObject read(Wire wire)throws Exception{
    JSONObject status=wire.request("GET","/api/status");
    if(!status.optBoolean("connected"))status=wire.request("POST","/api/connect");
    if(!status.optBoolean("connected"))throw new IOException("官方桌面尚未连接");
    if(status.optJSONObject("taskSummary")==null||!status.optJSONObject("taskSummary").optBoolean("supported"))throw new IOException("目标需更新");
    return wire.request("GET","/api/task-summary");
  }
}
