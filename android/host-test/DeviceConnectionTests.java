import com.anso.remotecodex.DevicePoller;
import com.anso.remotecodex.SummaryConnection;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class DeviceConnectionTests {
  private static int passed;
  private static void check(boolean value,String description){if(!value)throw new AssertionError(description);passed++;System.out.println("PASS "+description);}
  private static void until(java.util.function.BooleanSupplier condition)throws Exception{long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);while(!condition.getAsBoolean()){if(System.nanoTime()>deadline)throw new AssertionError("Timed out waiting for independent probe");Thread.sleep(5);}}
  private static JSONObject status(boolean connected){return new JSONObject().put("connected",connected).put("taskSummary",new JSONObject().put("supported",true));}
  public static void main(String[] args)throws Exception{
    List<String> calls=new ArrayList<>();JSONObject summary=new JSONObject().put("schemaVersion",1);
    JSONObject result=SummaryConnection.read((method,route)->{calls.add(method+" "+route);return route.equals("/api/status")?status(false):route.equals("/api/connect")?status(true):summary;});
    check(result==summary&&calls.equals(Arrays.asList("GET /api/status","POST /api/connect","GET /api/task-summary")),"unselected disconnected bridge reconnects before summary");
    calls.clear();SummaryConnection.read((method,route)->{calls.add(method+" "+route);return route.equals("/api/status")?status(true):summary;});
    check(calls.equals(Arrays.asList("GET /api/status","GET /api/task-summary")),"healthy connection is not reset");
    calls.clear();try{SummaryConnection.read((method,route)->{calls.add(method+" "+route);if(route.equals("/api/connect"))throw new Exception("lost response");return status(false);});throw new AssertionError("must fail");}catch(Exception expected){}
    check(calls.size()==2,"failed connect is not immediately replayed; no task writes available");
    try{SummaryConnection.read((method,route)->new JSONObject().put("connected",true));throw new AssertionError("must fail");}catch(Exception expected){check(expected.getMessage().equals("目标需更新"),"old target lacks summary capability without becoming an empty result");}

    Map<String,String> devices=new ConcurrentHashMap<>();devices.put("slow","key-a");devices.put("good","key-b");
    AtomicLong now=new AtomicLong();AtomicInteger good=new AtomicInteger(),slow=new AtomicInteger();CountDownLatch held=new CountDownLatch(1);
    DevicePoller independent=new DevicePoller(()->new LinkedHashMap<>(devices),(id,key)->{if(id.equals("slow")){slow.incrementAndGet();held.await();return false;}good.incrementAndGet();return true;},now::get,Executors.newSingleThreadScheduledExecutor(),Executors.newFixedThreadPool(3));
    try{
      independent.tick();until(()->good.get()==1&&slow.get()==1);
      check(good.get()==1&&held.getCount()==1,"healthy device completes while offline peer is still blocked");
      Thread.sleep(20);now.set(15001);independent.tick();until(()->good.get()==2);
      check(slow.get()==1,"healthy device keeps polling without waiting for peer or current page");
      devices.remove("slow");independent.tick();held.countDown();now.set(31000);independent.tick();until(()->good.get()==3);
      check(slow.get()==1,"removing a device cancels its retries without affecting others");
    }finally{held.countDown();independent.close();}
    int before=good.get();now.set(90000);independent.tick();check(good.get()==before,"paused service cannot restart polling");

    AtomicInteger retries=new AtomicInteger();AtomicBoolean healthy=new AtomicBoolean();now.set(0);
    DevicePoller backoff=new DevicePoller(()->Collections.singletonMap("other","key"),(id,key)->{retries.incrementAndGet();return healthy.get();},now::get,Executors.newSingleThreadScheduledExecutor(),Executors.newSingleThreadExecutor());
    try{
      backoff.tick();until(()->retries.get()==1);Thread.sleep(20);
      now.set(999);backoff.tick();Thread.sleep(20);check(retries.get()==1,"device failure waits for retry deadline");
      now.set(1001);backoff.tick();until(()->retries.get()==2);Thread.sleep(20);
      now.set(2999);backoff.tick();Thread.sleep(20);check(retries.get()==2,"each device backs off after repeated failures");
      healthy.set(true);now.set(3002);backoff.tick();until(()->retries.get()==3);Thread.sleep(20);
      now.set(18003);backoff.tick();until(()->retries.get()==4);Thread.sleep(20);
      check(retries.get()==4,"network recovery resumes normal fifteen-second summary polling");
      now.set(18004);backoff.refreshNow();until(()->retries.get()==5);check(true,"manual refresh or network availability bypasses retry delay");
    }finally{backoff.close();}
    System.out.println("RESULT PASS "+passed+" checks; JVM tests only, no APK or physical device execution");
  }
}
