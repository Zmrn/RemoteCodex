package com.anso.remotecodex;
import android.app.Application;
import java.lang.ref.WeakReference;
public final class App extends Application {
  public Devices devices; public Updates updates; private LocalServer server;
  public WeakReference<MainActivity> activity=new WeakReference<>(null);
  @Override public void onCreate(){super.onCreate();devices=new Devices(this);updates=new Updates(this);UpdateJob.schedule(this);}
  public synchronized LocalServer server() throws Exception {if(server==null)server=new LocalServer(this);return server;}
}
