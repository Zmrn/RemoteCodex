package com.anso.remotecodex;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
public final class LocalServer {
  private final App app;private final ServerSocket socket;private final ExecutorService pool=Executors.newFixedThreadPool(24);
  public final String session=random(),csrf=random(),origin;
  private static String random(){byte[] b=new byte[24];new SecureRandom().nextBytes(b);StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format("%02x",x));return s.toString();}
  public LocalServer(App app)throws Exception{
    this.app=app;int saved=app.getSharedPreferences("runtime",0).getInt("port",0);
    socket=new ServerSocket();socket.setReuseAddress(true);socket.bind(new InetSocketAddress("127.0.0.1",saved));origin="http://127.0.0.1:"+socket.getLocalPort();app.getSharedPreferences("runtime",0).edit().putInt("port",socket.getLocalPort()).commit();
    new Thread(()->{while(!socket.isClosed())try{Socket client=socket.accept();pool.execute(()->handle(client));}catch(Exception ignored){}},"android-view-server").start();
  }
  private static String line(InputStream in)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();int v;while((v=in.read())!=-1){if(v==10)break;if(v!=13)b.write(v);if(b.size()>16384)throw new Exception("HTTP header too large");}return b.toString("ISO-8859-1");}
  private static byte[] read(InputStream in,int size,int max)throws Exception{if(size<0||size>max)throw new Exception("请求过大");byte[] b=new byte[size];int n=0,k;while(n<size&&(k=in.read(b,n,size-n))>0)n+=k;if(n!=size)throw new EOFException();return b;}
  private void handle(Socket client){boolean started=false;try{Socket c=client;c.setSoTimeout(15000);InputStream in=c.getInputStream();OutputStream out=c.getOutputStream();String[] first=line(in).split(" ");if(first.length!=3)return;String method=first[0],target=first[1];Map<String,String> h=new HashMap<>();int total=0;for(String s;(s=line(in)).length()>0;){if((total+=s.length())>32768)throw new Exception("HTTP headers too large");int at=s.indexOf(':');if(at>0)h.put(s.substring(0,at).toLowerCase(Locale.ROOT),s.substring(at+1).trim());}
    if(!h.getOrDefault("host","").equals("127.0.0.1:"+socket.getLocalPort())||!Arrays.asList(h.getOrDefault("cookie","").split(";\\s*")).contains("bridgeSession="+session)){reply(out,403,"application/json","{\"error\":\"App session required\"}".getBytes("UTF-8"));return;}
    String source=h.get("origin");if(source!=null&&!origin.equals(source)){reply(out,403,"application/json","{}".getBytes());return;}
    URI uri=new URI(target);String route=uri.getPath();if(route==null||!target.startsWith("/")||target.startsWith("//"))throw new Exception("Invalid path");
    boolean api=route.startsWith("/api/");if(api&&!csrf.equals(h.get("x-bridge-csrf"))){reply(out,403,"application/json","{}".getBytes());return;}
    if(h.containsKey("transfer-encoding"))throw new Exception("Chunked requests are not supported");byte[] body=read(in,Integer.parseInt(h.getOrDefault("content-length","0")),(route.equals("/api/downloads/image")?25:24)*1024*1024);
    if(route.equals("/api/downloads/image")&&method.equals("POST")){
      MainActivity a=app.activity.get();if(a==null)throw new Exception("请打开应用后保存文件");
      String name=android.net.Uri.parse(target).getQueryParameter("name");a.downloadImage(body,name==null?"image.png":name);
      reply(out,200,"application/json","{\"accepted\":true}".getBytes("UTF-8"));return;
    }
    if(api&&route.matches("/api/agents/[a-f0-9-]{36}/bridge/.*")){
      String[] parts=route.split("/",6);String id=parts[3],remote="/api/"+parts[5]+(uri.getRawQuery()==null?"":"?"+uri.getRawQuery());
      if(!allowed(method,remote))throw new Exception("此设备操作不支持转发");
      HttpURLConnection connection=remote(id,remote,method,body,h.get("content-type"));int code=connection.getResponseCode();
      try{headers(out,code,connection.getContentType()==null?"application/octet-stream":connection.getContentType(),-1);started=true;InputStream stream=code>=400?connection.getErrorStream():connection.getInputStream();if(stream!=null)try(InputStream s=stream){byte[] buffer=new byte[32768];int count;while((count=s.read(buffer))!=-1){out.write(buffer,0,count);out.flush();}}}finally{connection.disconnect();}return;
    }
    if(api){JSONObject input=body.length==0?new JSONObject():new JSONObject(new String(body,StandardCharsets.UTF_8)),answer;
      if(route.equals("/api/agents")&&method.equals("GET"))answer=app.devices.list();
      else if(route.equals("/api/agents")&&method.equals("POST"))answer=app.devices.save(input);
      else if(route.equals("/api/agents/select")&&method.equals("POST"))answer=app.devices.select(input.getString("id"));
      else if(route.equals("/api/agents/remove")&&method.equals("POST"))answer=app.devices.remove(input.getString("id"));
      else if(route.equals("/api/updates")&&method.equals("GET"))answer=app.updates.status();
      else if(route.equals("/api/updates/check")&&method.equals("POST")){app.updates.checkAsync(false);answer=app.updates.status();}
      else if(route.equals("/api/updates/install")&&method.equals("POST")){app.updates.installAsync();answer=app.updates.status();}
      else if(route.equals("/api/updates/settings")&&method.equals("POST")){app.updates.automatic(input.getBoolean("automatic"));answer=app.updates.status();}
      else if(route.equals("/api/updates/activity")&&method.equals("POST")){app.updates.busy=input.optBoolean("busy");answer=new JSONObject();}
      else if(route.equals("/api/remote-info")&&method.equals("GET"))answer=new JSONObject().put("android",true).put("port",0).put("addresses",new JSONArray());
      else if(route.equals("/api/downloads/start")&&method.equals("POST")){MainActivity a=app.activity.get();if(a==null)throw new Exception("请打开应用后保存文件");a.download(input);answer=new JSONObject().put("accepted",true);}
      else{reply(out,404,"application/json","{\"error\":\"Unknown route\"}".getBytes());return;}
      reply(out,200,"application/json; charset=utf-8",answer.toString().getBytes("UTF-8"));return;
    }
    if(!method.equals("GET")){reply(out,405,"text/plain",new byte[0]);return;}
    String name=route.equals("/")?"index.html":route.substring(1);if(!name.matches("[a-zA-Z0-9._-]+")||name.equals("release.json")||name.equals("update-public-key.pem"))throw new Exception("Unknown asset");
    byte[] bytes;try(InputStream asset=app.getAssets().open("web/"+name)){bytes=all(asset,4*1024*1024);}
    if(name.equals("index.html"))bytes=new String(bytes,"UTF-8").replace("__BRIDGE_CSRF__",csrf).replace("__BRIDGE_VERSION__",BuildInfo.VERSION).replace("<head>","<head><meta name=\"bridge-platform\" content=\"android\">").getBytes("UTF-8");
    reply(out,200,type(name),bytes);
  }catch(Exception error){if(!started)try{reply(client.getOutputStream(),502,"application/json",new JSONObject().put("error",error instanceof SocketTimeoutException?"连接超时，正在自动重连":safe(error)).toString().getBytes("UTF-8"));}catch(Exception ignored){}}finally{try{client.close();}catch(Exception ignored){}}}
  private static String safe(Exception e){String message=e.getMessage();return message==null?"连接或读取失败":message.replaceAll("(?i)Bearer [^ ]+","Bearer [redacted]");}
  public HttpURLConnection remote(String id,String route,String method,byte[] body,String contentType)throws Exception{
    JSONObject d=app.devices.get(id);String ip=Devices.resolve(d.getString("host")).getHostAddress();URL url=new URL("http",ip,d.getInt("port"),"/bridge/v1"+route);HttpURLConnection c=(HttpURLConnection)url.openConnection(Proxy.NO_PROXY);c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(75000);c.setRequestMethod(method);c.setRequestProperty("Authorization","Bearer "+app.devices.key(id));c.setRequestProperty("Accept-Encoding","identity");
    if(method.equals("POST")){c.setDoOutput(true);c.setRequestProperty("Content-Type",contentType==null?"application/json":contentType);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}return c;
  }
  public static boolean allowed(String method,String route){String p=route.split("\\?",2)[0];if(method.equals("GET")&&p.matches("/api/(status|events|projects|threads|models|usage|updates)"))return true;if(method.equals("POST")&&p.matches("/api/(connect|threads|updates/(check|install|settings))"))return true;return method.equals("GET")?p.matches("/api/threads/[a-f0-9-]{36}(/(files|file|queue|media))?"):method.equals("POST")&&p.matches("/api/threads/[a-f0-9-]{36}/(follow|open|messages|interrupt|settings|queue|questions)");}
  static byte[] all(InputStream in,int max)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){if(out.size()+n>max)throw new Exception("文件过大");out.write(b,0,n);}return out.toByteArray();}
  static String type(String name){return name.endsWith("html")?"text/html; charset=utf-8":name.endsWith("css")?"text/css":name.endsWith("js")?"text/javascript":name.endsWith("svg")?"image/svg+xml":name.endsWith("png")?"image/png":name.endsWith("ico")?"image/x-icon":"application/json";}
  private static void headers(OutputStream out,int code,String type,int length)throws Exception{String h="HTTP/1.1 "+code+" Response\r\nContent-Type: "+type.replaceAll("[\\r\\n]","")+"\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'\r\n"+(length>=0?"Content-Length: "+length+"\r\n":"")+"\r\n";out.write(h.getBytes("ISO-8859-1"));out.flush();}
  private static void reply(OutputStream out,int code,String type,byte[] bytes)throws Exception{headers(out,code,type,bytes.length);out.write(bytes);out.flush();}
}
