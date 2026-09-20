package com.anso.remotecodex;
import java.net.HttpURLConnection;
import java.util.Map;
/** Whitelisted media continuation headers, shared by native transport tests. */
public final class MediaHeaders {
  private MediaHeaders(){}
  public static void request(HttpURLConnection connection,String method,String route,Map<String,String> headers){
    if(!method.equals("GET")||!route.split("\\?",2)[0].matches("/api/threads/[a-f0-9-]{36}/media"))return;
    for(String key:new String[]{"range","if-range"}){
      String value=headers.get(key);
      if(value!=null&&!value.contains("\r")&&!value.contains("\n"))connection.setRequestProperty(key,value);
    }
  }
  public static String response(HttpURLConnection connection){
    StringBuilder h=new StringBuilder();
    for(String key:new String[]{"ETag","Accept-Ranges","Content-Range"}){
      String value=connection.getHeaderField(key);
      if(value!=null&&!value.contains("\r")&&!value.contains("\n"))h.append(key).append(": ").append(value).append("\r\n");
    }
    return h.toString();
  }
}
