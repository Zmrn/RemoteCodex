import com.anso.remotecodex.UpdateNetwork;
import java.net.*;
import java.util.*;

public class UpdateNetworkTests {
  static int checks;
  static void check(boolean value) { if(!value)throw new AssertionError();checks++; }
  interface Task {void run() throws Exception;}
  static void rejects(Task task)throws Exception{try{task.run();throw new AssertionError("expected rejection");}catch(java.io.IOException expected){checks++;}}
  static class Connection extends HttpURLConnection {
    final int status;final String location;boolean disconnected;
    Connection(URL url,int status,String location){super(url);this.status=status;this.location=location;}
    public int getResponseCode(){return status;}
    public String getHeaderField(String key){return "Location".equals(key)?location:null;}
    public void disconnect(){disconnected=true;}
    public boolean usingProxy(){return false;}
    public void connect(){}
  }
  public static void main(String[] args)throws Exception {
    String base="https://github.com/Zmrn/RemoteCodex/releases/latest/download/";
    UpdateNetwork network=new UpdateNetwork(base);
    check(network.manifest().equals(base+"android-latest.json"));
    check(network.artifact("0.10.29").equals("https://github.com/Zmrn/RemoteCodex/releases/download/v0.10.29/RemoteCodex.apk"));
    rejects(()->network.artifact("../latest"));rejects(()->new UpdateNetwork("http://old-server/"));
    List<Connection> calls=new ArrayList<>();
    HttpURLConnection result=network.open(network.manifest(),url->{Connection c=new Connection(url,calls.isEmpty()?302:200,"https://release-assets.githubusercontent.com/asset?signature=opaque");calls.add(c);return c;});
    check(calls.size()==2&&calls.get(0).disconnected&&!calls.get(1).disconnected);
    check(result==calls.get(1)&&!result.getInstanceFollowRedirects()&&result.getRequestProperty("Authorization")==null);
    for(String location:new String[]{"http://github.com/Zmrn/RemoteCodex/releases/file","https://example.test/file",
      "https://release-assets.githubusercontent.com.evil.test/file","https://secret@github.com/Zmrn/RemoteCodex/releases/file",
      "https://github.com/Other/Repo/releases/file","https://github.com:8443/Zmrn/RemoteCodex/releases/file"}) {
      calls.clear();rejects(()->network.open(network.manifest(),url->{Connection c=new Connection(url,302,location);calls.add(c);return c;}));
      check(calls.size()==1&&calls.get(0).disconnected);
    }
    calls.clear();rejects(()->network.open(network.manifest(),url->{Connection c=new Connection(url,302,network.manifest());calls.add(c);return c;}));
    check(calls.size()==6&&calls.stream().allMatch(c->c.disconnected));
    rejects(()->network.open(network.manifest(),url->new Connection(url,404,null)));
    rejects(()->network.open(network.manifest(),url->{throw new java.net.SocketTimeoutException("fixture timeout");}));
    System.out.println("Update network JVM checks: "+checks+"; no APK built or executed");
  }
}
