import com.anso.remotecodex.DeviceStore;
import com.anso.remotecodex.WidgetText;
import org.json.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;
public final class DeviceStoreTests {
  private static int passed;
  private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);passed++;System.out.println("PASS "+message);}
  private static JSONObject state()throws Exception{return new JSONObject().put("selected","11111111-1111-4111-8111-111111111111").put("items",new JSONArray().put(new JSONObject().put("id","11111111-1111-4111-8111-111111111111").put("kind","remote").put("name","Fixture").put("host","100.70.0.1").put("port",43128).put("sealedKey","ciphertext-fixture")));}
  public static void main(String[]args)throws Exception{
    File dir=Files.createTempDirectory(Paths.get(args[0]),"device-store-").toFile();JSONObject legacy=state();String original=legacy.toString();
    DeviceStore first=new DeviceStore(dir,()->new JSONObject(original));check(first.read().getJSONArray("items").getJSONObject(0).getString("sealedKey").equals("ciphertext-fixture"),"legacy encrypted key and IDs retained");
    DeviceStore second=new DeviceStore(dir,()->{throw new AssertionError("legacy reread");});second.change(s->{s.getJSONArray("items").getJSONObject(0).put("name","Renamed");return s;});
    check(first.read().getJSONArray("items").getJSONObject(0).getString("name").equals("Renamed"),"existing instances reread committed state");
    check(legacy.toString().equals(original),"legacy preferences remain unchanged");
    DeviceStore failing=new DeviceStore(dir,()->state(),file->{if(file.getParentFile().getName().endsWith(".history"))throw new IOException("checkpoint failure");});
    boolean rejected=false;try{failing.change(s->s.put("items",new JSONArray()).put("selected",""));}catch(Exception e){rejected=true;}
    check(rejected&&first.read().getJSONArray("items").length()==1,"checkpoint failure reports failure and preserves device");
    DeviceStore mirrorFailure=new DeviceStore(dir,()->state(),file->{if(file.getName().equals("devices-v2.json"))throw new IOException("mirror failure");});rejected=false;
    try{mirrorFailure.change(s->s.put("items",new JSONArray()).put("selected",""));}catch(Exception e){rejected=true;}
    check(rejected,"mirror failure explicitly reports uncertain completion");
    DeviceStore restarted=new DeviceStore(dir,()->new JSONObject(original));check(restarted.read().getJSONArray("items").length()==0,"committed deletion does not resurrect after restart or stale mirror");
    Files.write(new File(dir,"devices-v2.json").toPath(),"broken mirror".getBytes("UTF-8"));check(restarted.read().getJSONArray("items").length()==0,"damaged mirror reads independent committed history");
    File[] histories=new File(dir,"devices-v2.history").listFiles((d,n)->n.endsWith(".json"));Arrays.sort(histories,Comparator.comparing(File::getName).reversed());Files.write(histories[0].toPath(),"broken checkpoint".getBytes("UTF-8"));rejected=false;
    try{restarted.read();}catch(Exception e){rejected=true;}check(rejected,"damaged latest checkpoint blocks rather than reverting deletion");
    JSONObject unknown=new JSONObject().put("known",false).put("unread",0).put("running",0).put("devices",2).put("connectedDevices",0);
    check(WidgetText.notification(unknown).contains("官方状态未知")&&!WidgetText.notification(unknown).contains("0 未读"),"notification never calls unknown a healthy zero");
    unknown.put("known",true).put("complete",true);check(WidgetText.count(unknown,"unread").equals("0"),"confirmed empty result still displays zero");
    System.out.println("Storage and status: "+passed+" checks passed (host JVM; no APK execution)");
  }
}
