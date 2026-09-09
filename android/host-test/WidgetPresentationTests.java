import com.anso.remotecodex.WidgetSizing;
import com.anso.remotecodex.WidgetSnapshot;
import com.anso.remotecodex.WidgetReadState;
import org.json.*;

public final class WidgetPresentationTests {
  static int passed;static long now=1800000000000L;
  static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);passed++;System.out.println("PASS "+name);}
  static JSONObject task(String id,boolean running,boolean unread,String token,long at)throws Exception{return new JSONObject().put("id",id).put("kind","codex").put("title","示例任务").put("running",running).put("unread",unread).put("runtimeKnown",true).put("readStateKnown",true).put("reportToken",token).put("updatedAt",at);}
  static JSONObject device(String id,boolean online,long age,JSONObject... tasks)throws Exception{
    JSONArray rows=new JSONArray();for(JSONObject t:tasks)rows.put(t);
    return new JSONObject().put("id",id).put("name",id).put("value",new JSONObject().put("schemaVersion",2).put("statePolicy","official-only").put("threads",rows).put("available",online).put("complete",true).put("receivedAt",now-age));
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
    check(all.getInt("unread")==1&&all.getInt("running")==1,"offline old unread is never counted");
    check(all.getInt("offline")==1&&all.getInt("cachedDevices")==0&&!all.getBoolean("complete"),"offline is unknown with no counted cache");
    check(all.getJSONArray("threads").length()==2&&all.getJSONArray("threads").getJSONObject(0).getString("id").equals("b"),"only official confirmed tasks sorted by update time");
    JSONObject local=snapshot(devices,"laptop");check(local.getInt("unread")==1&&local.getInt("running")==1&&local.getBoolean("complete"),"device filter scopes counts and completeness");
    check(local.getJSONArray("deviceStates").length()==2&&local.getInt("configuredDevices")==2,"selector retains all devices");
    JSONObject office=snapshot(devices,"office");check(!office.getBoolean("known")&&office.getJSONArray("threads").length()==0,"offline-only screen shows unknown instead of old tasks");
    check(devices.toString().equals(before),"rendering and filters do not modify source data");
    JSONArray duplicate=new JSONArray().put(device("old",false,120000,task("same",false,false,"one",100))).put(device("current",true,1000,task("same",false,true,"one",100)));
    check(snapshot(duplicate,"").getInt("unread")==1,"old local read cannot suppress official unread");
    JSONObject current=duplicate.getJSONObject(1).getJSONObject("value").getJSONArray("threads").getJSONObject(0);
    current.put("unread",false);check(snapshot(duplicate,"").getInt("unread")==0,"official read disappears without a local acknowledgement");
    current.put("unread",true);check(snapshot(duplicate,"").getInt("unread")==1,"official mark can become unread again for same token");
    duplicate.getJSONObject(0).getJSONObject("value").put("available",true).put("receivedAt",now-500);
    check(snapshot(duplicate,"").getInt("unread")==0,"newest official observation chosen across duplicate paths");
    current.put("unknown",true);check(snapshot(duplicate,"current").getInt("unread")==0&&!snapshot(duplicate,"current").getBoolean("known"),"unknown task flags cannot become counted state");
    JSONObject expired=snapshot(new JSONArray().put(device("old",true,61000,task("old",true,false,"",100))),"");
    check(expired.getInt("running")==0&&!expired.getBoolean("known"),"stale running is not displayed as current running");
    JSONObject stopped=WidgetSnapshot.build(new JSONArray().put(device("old",true,61000,task("old",false,true,"",100))),"",now,false,false,"");
    check(!stopped.getBoolean("known"),"pausing service does not extend old statistics lifetime");
    JSONObject legacy=device("legacy",true,0,task("x",false,true,"",100));legacy.getJSONObject("value").put("schemaVersion",1);
    check(!snapshot(new JSONArray().put(legacy),"").getBoolean("known"),"old target protocol cannot reintroduce inferred unread");
    JSONObject missing=snapshot(new JSONArray().put(new JSONObject().put("id","new").put("name","new")),"");
    check(!missing.getBoolean("known")&&!missing.getBoolean("complete"),"restart with no observation remains unknown");
    JSONObject empty=snapshot(new JSONArray(),"");check(empty.getBoolean("known")&&empty.getBoolean("complete")&&empty.getInt("unread")==0,"no configured devices is intentionally empty");
    JSONObject zero=snapshot(new JSONArray().put(device("fresh",true,0)),"");check(zero.getBoolean("known")&&zero.getBoolean("complete"),"fresh official empty list is known zero");
    JSONObject broken=WidgetSnapshot.build(devices,"",now,true,false,"统计读取失败");check(!broken.getBoolean("known")&&broken.getInt("unread")==0,"refresh failure cannot retain old numbers");
    JSONObject flags=task("x",false,true,"",100).put("readStateKnown",false);check(!WidgetReadState.confirmed(flags),"unconfirmed read state is not guessed from completed work");
    flags.put("running",true);check(WidgetReadState.confirmed(flags),"official running can be counted independently of unread support");
    System.out.println("Widget presentation: "+passed+" checks passed (host JVM; no APK execution)");
  }
}
