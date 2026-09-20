import com.anso.remotecodex.MediaHeaders;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.util.*;
public final class MediaHeadersTests {
  public static void main(String[] args)throws Exception{
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    String route="/api/threads/11111111-2222-4333-8444-555555555555/media?id=synthetic";
    server.createContext("/",e->{
      boolean range="bytes=3-".equals(e.getRequestHeaders().getFirst("range"))&&"\"fixture\"".equals(e.getRequestHeaders().getFirst("if-range"));
      byte[] bytes=(range?"def":"abcdef").getBytes("UTF-8");
      e.getResponseHeaders().set("ETag","\"fixture\"");e.getResponseHeaders().set("Accept-Ranges","bytes");
      if(range)e.getResponseHeaders().set("Content-Range","bytes 3-5/6");
      e.sendResponseHeaders(range?206:200,bytes.length);e.getResponseBody().write(bytes);e.close();
    });server.start();
    try{
      Map<String,String> headers=new HashMap<>();headers.put("range","bytes=3-");headers.put("if-range","\"fixture\"");
      for(String method:new String[]{"GET","POST"})for(String path:new String[]{route,"/api/usage"}){
        HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:"+server.getAddress().getPort()+path).openConnection();
        c.setRequestMethod(method);MediaHeaders.request(c,method,path,headers);
        boolean ranged=method.equals("GET")&&path.equals(route);
        if(c.getResponseCode()!=(ranged?206:200))throw new AssertionError("Range forwarding route boundary");
        String response=MediaHeaders.response(c);
        if(!response.contains("ETag: \"fixture\"\r\n")||!response.contains("Accept-Ranges: bytes\r\n")||response.contains("Content-Range:")!=ranged)throw new AssertionError("Missing continuation headers");
        ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){int x;while((x=in.read())!=-1)out.write(x);}
        if(!out.toString("UTF-8").equals(ranged?"def":"abcdef"))throw new AssertionError("Response bytes changed");
        c.disconnect();
      }
    }finally{server.stop(0);}
    System.out.println("PASS: Android native GET resumes through whitelisted headers; other routes/methods remain whole; status and bytes preserved; no APK");
  }
}
