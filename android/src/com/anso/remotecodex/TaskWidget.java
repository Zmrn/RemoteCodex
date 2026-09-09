package com.anso.remotecodex;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.RemoteViews;
import org.json.*;

public final class TaskWidget extends AppWidgetProvider {
  public static final String REFRESH="com.anso.remotecodex.WIDGET_REFRESH";
  public static boolean exists(Context c){return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,TaskWidget.class)).length>0;}
  private static PendingIntent open(Context c,String filter){return PendingIntent.getActivity(c,filter.equals("running")?32:31,new Intent(c,WidgetInboxActivity.class).putExtra("filter",filter).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
  public static RemoteViews views(Context c,JSONObject state)throws Exception{
    RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.task_widget);
    boolean known=state.getBoolean("known");String unread=known?String.valueOf(state.getInt("unread")):"—",running=known?String.valueOf(state.getInt("running")):"—";
    v.setTextViewText(R.id.widget_unread,unread);v.setTextViewText(R.id.widget_running,running);
    v.setTextViewTextSize(R.id.widget_unread,TypedValue.COMPLEX_UNIT_SP,size(unread));v.setTextViewTextSize(R.id.widget_running,TypedValue.COMPLEX_UNIT_SP,size(running));
    v.setTextViewText(R.id.widget_status,state.getString("label"));
    v.setContentDescription(R.id.widget_root,"Remote Codex，"+unread+" 个未读回报，"+running+" 个运行中任务，"+state.getString("label"));
    v.setOnClickPendingIntent(R.id.widget_root,open(c,"unread"));v.setOnClickPendingIntent(R.id.widget_unread_action,open(c,"unread"));v.setOnClickPendingIntent(R.id.widget_running_action,open(c,"running"));
    v.setOnClickPendingIntent(R.id.widget_status,PendingIntent.getBroadcast(c,33,new Intent(c,TaskWidget.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
    return v;
  }
  private static float size(String text){return text.length()<2?46:text.length()==2?36:text.length()==3?28:22;}
  public static void render(Context c){try{App app=(App)c.getApplicationContext();int[] ids=AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,TaskWidget.class));if(ids.length==0)return;JSONObject state;try{state=app.widgetMonitor.snapshot();}catch(Exception e){state=new JSONObject().put("known",false).put("unread",0).put("running",0).put("label","统计不可用 · 请打开应用");}AppWidgetManager.getInstance(c).updateAppWidget(ids,views(c,state));}catch(Exception ignored){} }
  @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){render(c);WidgetJob.schedule(c);WidgetJob.refresh(c);}
  @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle b){render(c);}
  @Override public void onEnabled(Context c){WidgetJob.schedule(c);WidgetJob.refresh(c);}
  @Override public void onDisabled(Context c){WidgetJob.cancel(c);}
  @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);String action=intent.getAction();if(REFRESH.equals(action)||Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)){render(c);WidgetJob.schedule(c);if(exists(c))WidgetJob.refresh(c);}}
}
