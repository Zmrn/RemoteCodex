package com.anso.remotecodex;
import java.net.*;
import java.io.*;
import org.json.*;

/** Shared native device transport. A widget uses the same saved endpoint/key. */
public final class DeviceConnection {
  public static final class Endpoint {final JSONObject device;final String key;Endpoint(JSONObject device,String key){this.device=device;this.key=key;}}
  public static Endpoint capture(Devices devices,String id)throws Exception{synchronized(devices){return new Endpoint(devices.get(id),devices.key(id));}}
  public static HttpURLConnection open(Devices devices,String id,String route,String method,byte[] body,String contentType)throws Exception{
    return open(capture(devices,id),route,method,body,contentType,8000,75000);
  }
  public static HttpURLConnection open(Endpoint endpoint,String route,String method,byte[] body,String contentType,int connectTimeout,int readTimeout)throws Exception{
    return openResolved(endpoint,Devices.resolve(endpoint.device.getString("host")).getHostAddress(),route,method,body,contentType,connectTimeout,readTimeout);
  }
  public static HttpURLConnection openResolved(Endpoint endpoint,String ip,String route,String method,byte[] body,String contentType,int connectTimeout,int readTimeout)throws Exception{
    if(!Devices.tail(InetAddress.getByName(ip)))throw new IOException("设备地址不属于 Tailscale 网络");
    JSONObject d=endpoint.device;String key=endpoint.key;
    URL url=new URL("http",ip,d.getInt("port"),"/bridge/v1"+route);
    HttpURLConnection c=(HttpURLConnection)url.openConnection(Proxy.NO_PROXY);
    c.setInstanceFollowRedirects(false);c.setConnectTimeout(connectTimeout);c.setReadTimeout(readTimeout);c.setRequestMethod(method);
    c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Accept-Encoding","identity");
    if(method.equals("POST")){c.setDoOutput(true);c.setRequestProperty("Content-Type",contentType==null?"application/json":contentType);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
    return c;
  }
}
