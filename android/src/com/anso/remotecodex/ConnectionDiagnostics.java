package com.anso.remotecodex;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import org.json.*;

/** Bounded, read-only probe of one saved endpoint. Returned fields contain no keys or tasks. */
public final class ConnectionDiagnostics {
  private static final ExecutorService dns=new ThreadPoolExecutor(0,2,15,TimeUnit.SECONDS,new SynchronousQueue<Runnable>(),new ThreadPoolExecutor.AbortPolicy());
  private static String version(String value){return value.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:\\.[0-9]+)?")?value:"";}
  private static byte[] body(InputStream stream)throws Exception{
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[8192];long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
    for(;;){if(System.nanoTime()>=deadline)throw new SocketTimeoutException();int count=stream.read(chunk);if(count<0)return bytes.toByteArray();if(bytes.size()+count>1024*1024)throw new JSONException("status too large");bytes.write(chunk,0,count);}
  }
  private static JSONObject project(JSONObject s)throws Exception{
    JSONObject c=s.optJSONObject("desktopCompatibility"),chat=s.optJSONObject("chat"),summary=s.optJSONObject("taskSummary");
    JSONObject out=new JSONObject().put("bridgeVersion",version(s.optString("bridgeVersion"))).put("connected",s.optBoolean("connected")).put("officialVersion",version(c==null?"":c.optString("detectedVersion")))
      .put("codexWritable",s.optBoolean("existingCodexWritable")).put("chatRead",chat!=null&&chat.optBoolean("read")).put("chatSend",chat!=null&&chat.optBoolean("sendText"))
      .put("chatCreate",chat!=null&&chat.optBoolean("create")).put("chatImages",chat!=null&&chat.optBoolean("images"))
      .put("officialOnly",summary!=null&&summary.optInt("schemaVersion")==2&&"official-only".equals(summary.optString("statePolicy")));
    JSONArray versions=new JSONArray(),health=new JSONArray(),input=c==null?null:c.optJSONArray("verifiedVersions");
    if(input!=null)for(int i=0;i<Math.min(input.length(),20);i++){String v=version(input.optString(i));if(!v.isEmpty())versions.put(v);}out.put("verifiedVersions",versions);
    input=s.optJSONArray("storageHealth");if(input!=null)for(int i=0;i<Math.min(input.length(),10);i++){JSONObject h=input.optJSONObject(i);if(h!=null&&java.util.Arrays.asList("healthy","recovered","blocked").contains(h.optString("status")))health.put(new JSONObject().put("status",h.getString("status")).put("writable",h.optBoolean("writable")));}
    return out.put("storage",health);
  }
  public static JSONObject read(Devices devices,String id)throws Exception{
    JSONObject out=new JSONObject().put("schemaVersion",1).put("checkedAt",new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX",java.util.Locale.ROOT).format(new java.util.Date())).put("local",false).put("resolved",false).put("tcp",false);
    DeviceConnection.Endpoint endpoint;JSONObject original;
    try{original=devices.get(id);}catch(Exception e){return out.put("failure","config-unreadable");}
    try{Devices.validateHost(original.getString("host"));}catch(Exception e){return out.put("failure","endpoint-invalid");}
    try{endpoint=DeviceConnection.capture(devices,id);}catch(Exception e){return out.put("failure","key-unavailable");}
    Future<InetAddress> lookup;
    try{lookup=dns.submit(()->Devices.resolve(endpoint.device.getString("host")));}catch(RejectedExecutionException e){return out.put("failure","diagnostic-busy");}
    String ip;
    try{ip=lookup.get(3,TimeUnit.SECONDS).getHostAddress();out.put("resolved",true);}catch(TimeoutException e){lookup.cancel(true);return out.put("failure","dns-timeout");}catch(Exception e){return out.put("failure","dns-failed");}
    HttpURLConnection connection=null;
    try{
      // An explicit TCP probe distinguishes a listening endpoint from slow HTTP.
      try(Socket socket=new Socket()){socket.connect(new InetSocketAddress(ip,endpoint.device.getInt("port")),3000);out.put("tcp",true);}
      connection=DeviceConnection.openResolved(endpoint,ip,"/api/status","GET",new byte[0],"application/json",3000,5000);
      int code=connection.getResponseCode();out.put("httpStatus",code);
      if(code==401||code==403)out.put("failure","authentication-failed");
      else if(code!=200)out.put("failure","http-error");
      else{JSONObject value;try(InputStream stream=connection.getInputStream()){value=new JSONObject(new String(body(stream),"UTF-8"));}
        if(!(value.opt("connected") instanceof Boolean)||!"official-desktop-IPC-live".equals(value.optString("source")))out.put("failure","invalid-response");else out.put("bridge",project(value));}
    }catch(SocketTimeoutException e){out.put("failure",out.optBoolean("tcp")?"response-timeout":"connection-timeout");}
    catch(ConnectException e){out.put("failure","connection-refused");}
    catch(JSONException e){out.put("failure","invalid-response");}
    catch(Exception e){out.put("failure","connection-interrupted");}
    finally{if(connection!=null)connection.disconnect();}
    try{JSONObject current=devices.get(id);if(!current.getString("host").equals(endpoint.device.getString("host"))||current.getInt("port")!=endpoint.device.getInt("port")||!current.optString("sealedKey").equals(endpoint.device.optString("sealedKey")))return new JSONObject().put("schemaVersion",1).put("failure","target-changed");}
    catch(Exception e){return new JSONObject().put("schemaVersion",1).put("failure","target-changed");}
    return out;
  }
}
