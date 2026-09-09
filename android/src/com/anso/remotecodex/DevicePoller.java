package com.anso.remotecodex;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Per-device read-only recovery, independent of the selected page and WebView. */
public final class DevicePoller implements AutoCloseable {
  public interface Registry { Map<String,String> devices() throws Exception; }
  public interface Probe { boolean read(String id,String signature) throws Exception; }
  private static final long[] RETRY={1000,2000,4000,8000,15000,30000};
  private static final class State {
    final String signature;long next;int failures;boolean running,again;Future<?> work;
    State(String signature){this.signature=signature;}
  }
  private final Registry registry;private final Probe probe;private final LongSupplier clock;
  private final ScheduledExecutorService timer;private final ExecutorService network;
  private final Map<String,State> states=new LinkedHashMap<>();private boolean closed,started;
  public DevicePoller(Registry registry,Probe probe){this(registry,probe,()->System.nanoTime()/1000000L,Executors.newSingleThreadScheduledExecutor(),Executors.newFixedThreadPool(6));}
  public DevicePoller(Registry registry,Probe probe,LongSupplier clock,ScheduledExecutorService timer,ExecutorService network){this.registry=registry;this.probe=probe;this.clock=clock;this.timer=timer;this.network=network;}
  public synchronized void start(){if(started||closed)return;started=true;timer.scheduleWithFixedDelay(this::tick,0,1000,TimeUnit.MILLISECONDS);}
  public void tick(){
    Map<String,String> current;try{current=registry.devices();}catch(Exception e){return;}
    synchronized(this){
      if(closed)return;
      Iterator<Map.Entry<String,State>> items=states.entrySet().iterator();
      while(items.hasNext()){Map.Entry<String,State> e=items.next();if(!e.getValue().signature.equals(current.get(e.getKey()))){if(e.getValue().work!=null)e.getValue().work.cancel(true);items.remove();}}
      for(Map.Entry<String,String> e:current.entrySet()){
        String id=e.getKey();State s=states.get(id);if(s==null){s=new State(e.getValue());states.put(id,s);}
        if(s.running||s.next>clock.getAsLong())continue;
        s.running=true;final State state=s;
        state.work=network.submit(()->{
          boolean healthy=false;try{healthy=probe.read(id,state.signature);}catch(Exception ignored){}
          synchronized(DevicePoller.this){
            if(closed||states.get(id)!=state)return;
            state.running=false;long delay=healthy?15000:RETRY[Math.min(state.failures,RETRY.length-1)];
            state.failures=healthy?0:Math.min(state.failures+1,RETRY.length-1);
            state.next=state.again?0:clock.getAsLong()+delay;state.again=false;
          }
        });
      }
    }
  }
  public synchronized void refreshNow(){if(closed)return;for(State s:states.values()){s.next=0;s.again=s.running;}timer.execute(this::tick);}
  @Override public synchronized void close(){if(closed)return;closed=true;for(State s:states.values())if(s.work!=null)s.work.cancel(true);states.clear();timer.shutdownNow();network.shutdownNow();}
}
