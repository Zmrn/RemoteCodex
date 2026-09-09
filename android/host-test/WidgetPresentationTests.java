import com.anso.remotecodex.WidgetSizing;
import com.anso.remotecodex.WidgetSnapshot;
import org.json.*;

public final class WidgetPresentationTests {
  static int passed;static long now=1800000000000L;
  static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);passed++;System.out.println("PASS "+name);}
  static JSONObject task(String id,boolean running,boolean unread,String token,long at)throws Exception{return new JSONObject().put("id",id).put("kind","codex").put("title","示例任务").put("running",running).put("unread",unread).put("reportToken",token).put("updatedAt",at);}
  static JSONObject device(String id,boolean online,long age,JSONObject... tasks)throws Exception{
    JSONArray rows=new JSONArray();for(JSONObject t:tasks)rows.put(t);
    return new JSONObject().put("id",id).put("name",id).put("value",new JSONObject().put("threads",rows).put("available",online).put("complete",true).put("receivedAt",now-age));
  }
  static JSONObject snapshot(JSONArray devices,String selected)throws Exception{return WidgetSnapshot.build(devices,selected,now,true,false,"");}
  public static void main(String[] args)throws Exception{
    WidgetSizing tall=new WidgetSizing(467,519);check(tall.side==467&&tall.horizontalInset==0&&tall.verticalInset==26,"tall launcher slot becomes centered square matching width");
    WidgetSizing wide=new WidgetSizing(230,160);check(wide.side==160&&wide.horizontalInset==35&&wide.verticalInset==0,"landscape and resized slots retain square");
    WidgetSizing normal=new WidgetSizing(160,160);check(normal.side==160&&normal.horizontalInset==0&&normal.verticalInset==0,"already square has no extra inset");
    WidgetSizing invalid=new WidgetSizing(Float.NaN,-1);check(invalid.side==160&&invalid.verticalInset==0,"invalid launcher dimensions have finite fallback");
    boolean fits=true;for(int digits=1;digits<=5;digits++){WidgetSizing small=new WidgetSizing(110,160);float sp=small.digitSize(digits,1);fits&=sp*digits*.64f<=(110-16)*.45f+.01f;}check(fits,"multi-digit numbers fit minimum supported width");
    check(normal.digitSize(3,1.3f)<=normal.digitSize(3,1),"larger system fonts do not enlarge digits beyond cell");
    JSONArray devices=new JSONArray().put(device("laptop",true,1000,task("a",false,true,"one",100),task("b",true,false,"",200))).put(device("office",false,120000,task("c",false,true,"three",300)));
    String before=devices.toString();JSONObject all=snapshot(devices,"");
    check(all.getInt("unread")==2&&all.getInt("running")==1&&all.getInt("devices")==2,"all devices contribute counts including cached results");
    check(all.getInt("offline")==1&&all.getInt("cachedDevices")==1&&!all.getBoolean("complete"),"offline cache is explicitly partial");
    check(all.getJSONArray("threads").getJSONObject(0).getString("id").equals("c"),"cross-device tasks sorted by update time");
    JSONObject local=snapshot(devices,"laptop");check(local.getInt("unread")==1&&local.getInt("running")==1&&local.getInt("devices")==1&&local.getBoolean("complete"),"device filter scopes counts and completeness");
    check(local.getJSONArray("deviceStates").length()==2&&local.getInt("configuredDevices")==2,"selector retains all saved devices");
    JSONObject office=snapshot(devices,"office");check(office.getJSONArray("threads").length()==1&&office.getJSONArray("threads").getJSONObject(0).getString("agentId").equals("office"),"task deep links retain filtered source device");
    check(devices.toString().equals(before),"rendering and filtering do not modify cache or receipts");
    JSONArray duplicate=new JSONArray().put(device("one",false,120000,task("same",false,true,"exact",100))).put(device("two",true,1000,task("same",false,false,"exact",100)));
    JSONObject dedup=snapshot(duplicate,"");check(dedup.getInt("unread")==0&&dedup.getJSONArray("threads").length()==1&&dedup.getJSONArray("threads").getJSONObject(0).getString("agentId").equals("two"),"same report deduplicates and prefers live route with exact read receipt");
    check(snapshot(duplicate,"one").getInt("unread")==1,"single-device view uses that device's own receipt");
    duplicate.getJSONObject(1).getJSONObject("value").getJSONArray("threads").getJSONObject(0).put("reportToken","new").put("unread",true).put("updatedAt",200);
    check(snapshot(duplicate,"").getInt("unread")==1,"a different newer report remains unread");
    JSONObject missing=snapshot(new JSONArray().put(new JSONObject().put("id","new").put("name","new")),"");
    check(!missing.getBoolean("known")&&missing.getInt("offline")==1&&missing.getInt("cachedDevices")==0&&!missing.getBoolean("complete"),"unconnected device is unknown rather than healthy zero");
    JSONObject empty=snapshot(new JSONArray(),"");check(empty.getBoolean("known")&&empty.getBoolean("complete")&&empty.getInt("unread")==0,"no configured devices produces intentional empty state");
    JSONObject stale=snapshot(new JSONArray().put(device("old",true,61000,task("x",false,true,"x",100))),"");check(stale.getInt("offline")==1&&stale.getJSONArray("threads").getJSONObject(0).getBoolean("stale"),"aged foreground result marked stale");
    JSONObject broken=WidgetSnapshot.build(devices,"",now,true,false,"缓存读取失败");check(!broken.getBoolean("complete")&&broken.getString("cacheError").equals("缓存读取失败"),"cache error remains visible in details");
    System.out.println("Widget presentation: "+passed+" checks passed (host JVM; no APK execution)");
  }
}
