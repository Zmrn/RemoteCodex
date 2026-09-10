package com.anso.remotecodex;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.net.*;
import android.os.*;
import org.json.*;

/** Ongoing connections to the user's configured computers, with a visible stop control. */
public final class DeviceSyncService extends Service {
  private static final int NOTIFICATION=42;
  private static final String CHANNEL="device-connections",PAUSE="com.anso.remotecodex.PAUSE_CONNECTIONS";
  public static volatile boolean running;
  private static volatile String lastError="";
  private static volatile DeviceSyncService instance;
  private App app;private volatile DevicePoller poller;private ConnectivityManager connectivity;
  private final Handler handler=new Handler(Looper.getMainLooper());
  private final Runnable changed=()->updateNotification();
  private final Runnable maintain=new Runnable(){public void run(){if(!running)return;try{if(!enabled(app)||app.devices.list().getJSONArray("agents").length()==0){stopSelf();return;}}catch(Exception e){lastError="设备配置暂不可读，已保留原数据";}updateNotification();handler.postDelayed(this,15000);}};
  private final ConnectivityManager.NetworkCallback network=new ConnectivityManager.NetworkCallback(){
    @Override public void onAvailable(Network network){if(poller!=null)poller.refreshNow();}
    @Override public void onLost(Network network){if(poller!=null)poller.refreshNow();}
  };
  public static boolean enabled(Context c){return c.getSharedPreferences("device-connections",0).getBoolean("enabled",true);}
  public static void setEnabled(Context c,boolean value)throws Exception{
    if(!c.getSharedPreferences("device-connections",0).edit().putBoolean("enabled",value).commit())throw new Exception("无法保存同步设置");
    if(value)ensure(c);else c.stopService(new Intent(c,DeviceSyncService.class));
  }
  public static void ensure(Context c){
    if(!enabled(c)||running)return;
    try{App app=(App)c.getApplicationContext();if(app.devices.list().getJSONArray("agents").length()==0)return;c.startForegroundService(new Intent(c,DeviceSyncService.class));lastError="";}
    catch(Exception e){lastError="后台连接未启动，请打开应用重试";}
  }
  public static void refresh(Context c){DeviceSyncService service=instance;if(service!=null&&service.poller!=null)service.poller.refreshNow();}
  public static JSONObject state(Context c)throws Exception{
    JSONObject stats=((App)c.getApplicationContext()).widgetMonitor.snapshot();
    return new JSONObject().put("enabled",enabled(c)).put("running",running).put("error",lastError).put("devices",stats.getInt("devices"))
      .put("connected",stats.optInt("connectedDevices")).put("detail",!enabled(c)?"持续同步已暂停":running?"全部设备独立同步，断线自动重连":lastError.isEmpty()?"添加设备后自动开始同步":lastError);
  }
  @Override public void onCreate(){super.onCreate();app=(App)getApplication();instance=this;
    NotificationManager manager=getSystemService(NotificationManager.class);
    manager.createNotificationChannel(new NotificationChannel(CHANNEL,"设备持续连接",NotificationManager.IMPORTANCE_LOW));
    try{
      if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);else startForeground(NOTIFICATION,notification());
      if(!enabled(this)){stopSelf();return;}
      running=true;lastError="";
      poller=new DevicePoller(app.widgetMonitor::configuredDevices,app.widgetMonitor::refreshDevice);poller.start();
      app.widgetMonitor.listen(changed);connectivity=getSystemService(ConnectivityManager.class);
      try{connectivity.registerDefaultNetworkCallback(network);}catch(Exception ignored){}
      handler.post(maintain);
    }catch(Exception e){lastError="后台连接启动失败，请重新打开应用";stopSelf();}
  }
  @Override public int onStartCommand(Intent intent,int flags,int startId){
    if(intent!=null&&PAUSE.equals(intent.getAction()))try{setEnabled(this,false);}catch(Exception e){lastError=e.getMessage();}
    if(!enabled(this)||!running||poller==null){stopSelf();return START_NOT_STICKY;}
    return START_STICKY;
  }
  private Notification notification(){
    String detail="正在连接全部设备";
    try{detail=WidgetText.notification(app.widgetMonitor.snapshot());}catch(Exception ignored){detail="设备统计暂不可用，正在重试";}
    PendingIntent open=PendingIntent.getActivity(this,42,new Intent(this,WidgetInboxActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    PendingIntent pause=PendingIntent.getService(this,43,new Intent(this,DeviceSyncService.class).setAction(PAUSE),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Remote Codex · 全部设备同步")
      .setContentText(detail).setStyle(new Notification.BigTextStyle().bigText(detail)).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
      .addAction(new Notification.Action.Builder((android.graphics.drawable.Icon)null,"暂停同步",pause).build()).build();
  }
  private void updateNotification(){if(!running)return;try{getSystemService(NotificationManager.class).notify(NOTIFICATION,notification());}catch(SecurityException ignored){}}
  @Override public void onDestroy(){running=false;if(instance==this)instance=null;handler.removeCallbacksAndMessages(null);if(poller!=null)poller.close();if(app!=null)app.widgetMonitor.unlisten(changed);if(connectivity!=null)try{connectivity.unregisterNetworkCallback(network);}catch(Exception ignored){}stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
  @Override public IBinder onBind(Intent intent){return null;}
}
