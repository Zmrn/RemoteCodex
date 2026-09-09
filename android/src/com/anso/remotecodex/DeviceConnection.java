package com.anso.remotecodex;
import java.net.*;
import java.io.*;
import org.json.*;

/** Shared native device transport. A widget uses the same saved endpoint/key. */
public final class DeviceConnection {
  public static HttpURLConnection open(Devices devices,String id,String route,String method,byte[] body,String contentType)throws Exception{
    JSONObject d;String key;
    synchronized(devices){d=devices.get(id);key=devices.key(id);}
    String ip=Devices.resolve(d.getString("host")).getHostAddress();
    URL url=new URL("http",ip,d.getInt("port"),"/bridge/v1"+route);
    HttpURLConnection c=(HttpURLConnection)url.openConnection(Proxy.NO_PROXY);
    c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(75000);c.setRequestMethod(method);
    c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Accept-Encoding","identity");
    if(method.equals("POST")){c.setDoOutput(true);c.setRequestProperty("Content-Type",contentType==null?"application/json":contentType);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
    return c;
  }
}
