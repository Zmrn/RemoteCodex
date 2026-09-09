package com.anso.remotecodex;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.os.Bundle;
import android.os.Build;
import android.util.SizeF;
import android.util.TypedValue;
import android.widget.RemoteViews;
import java.util.*;
import org.json.*;

public final class TaskWidget extends AppWidgetProvider {
  public static final String REFRESH="com.anso.remotecodex.WIDGET_REFRESH";
  public static boolean exists(Context c){return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,TaskWidget.class)).length>0;}
  private static PendingIntent open(Context c,String filter){return PendingIntent.getActivity(c,filter.equals("running")?32:31,new Intent(c,WidgetInboxActivity.class).putExtra("filter",filter).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
  public static RemoteViews views(Context c,JSONObject state)throws Exception{
    return views(c,state,160,160);
  }
  private static RemoteViews views(Context c,JSONObject state,float width,float height)throws Exception{
    RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.task_widget);
    WidgetSizing sizing=new WidgetSizing(width,height);
    float density=c.getResources().getDisplayMetrics().density,scale=c.getResources().getConfiguration().fontScale;
    int x=Math.round(sizing.horizontalInset*density),y=Math.round(sizing.verticalInset*density);
    v.setViewPadding(R.id.widget_frame,x,y,x,y);
    boolean known=state.getBoolean("known");String unread=known?String.valueOf(state.getInt("unread")):"—",running=known?String.valueOf(state.getInt("running")):"—";
    v.setTextViewText(R.id.widget_unread,unread);v.setTextViewText(R.id.widget_running,running);
    v.setTextViewTextSize(R.id.widget_unread,TypedValue.COMPLEX_UNIT_SP,sizing.digitSize(unread.length(),scale));v.setTextViewTextSize(R.id.widget_running,TypedValue.COMPLEX_UNIT_SP,sizing.digitSize(running.length(),scale));
    v.setTextViewText(R.id.widget_status,state.getString("label"));
    v.setContentDescription(R.id.widget_root,"Remote Codex，"+unread+" 个未读回报，"+running+" 个运行中任务，"+state.getString("label"));
    v.setOnClickPendingIntent(R.id.widget_root,open(c,"unread"));v.setOnClickPendingIntent(R.id.widget_unread_action,open(c,"unread"));v.setOnClickPendingIntent(R.id.widget_running_action,open(c,"running"));
    v.setOnClickPendingIntent(R.id.widget_status,PendingIntent.getBroadcast(c,33,new Intent(c,TaskWidget.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
    return v;
  }
  private static RemoteViews sizedViews(Context c,JSONObject state,Bundle options)throws Exception{
    if(Build.VERSION.SDK_INT>=31){
      ArrayList<SizeF> sizes=options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
      Map<SizeF,RemoteViews> variants=new LinkedHashMap<>();
      if(sizes!=null)for(SizeF size:sizes){
        if(size!=null&&Float.isFinite(size.getWidth())&&Float.isFinite(size.getHeight())&&size.getWidth()>0&&size.getHeight()>0)
          variants.put(size,views(c,state,size.getWidth(),size.getHeight()));
        if(variants.size()==16)break;
      }
      if(!variants.isEmpty())return new RemoteViews(variants);
    }
    // Older launchers report portrait/landscape ranges instead of exact sizes.
    int minW=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,160),minH=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,160);
    int maxW=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,minW),maxH=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,minH);
    return new RemoteViews(views(c,state,maxW,minH),views(c,state,minW,maxH));
  }
  public static void render(Context c){try{
    App app=(App)c.getApplicationContext();AppWidgetManager manager=AppWidgetManager.getInstance(c);
    int[] ids=manager.getAppWidgetIds(new ComponentName(c,TaskWidget.class));if(ids.length==0)return;
    JSONObject state;try{state=app.widgetMonitor.snapshot();}catch(Exception e){state=new JSONObject().put("known",false).put("unread",0).put("running",0).put("label","统计不可用 · 请打开应用");}
    for(int id:ids)try{manager.updateAppWidget(id,sizedViews(c,state,manager.getAppWidgetOptions(id)));}catch(Exception ignored){manager.updateAppWidget(id,views(c,state));}
  }catch(Exception ignored){} }
  @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){render(c);WidgetJob.schedule(c);WidgetJob.refresh(c);}
  @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle b){render(c);}
  @Override public void onEnabled(Context c){WidgetJob.schedule(c);WidgetJob.refresh(c);}
  @Override public void onDisabled(Context c){WidgetJob.cancel(c);}
  @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);String action=intent.getAction();if(REFRESH.equals(action)||Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)){DeviceSyncService.ensure(c);render(c);WidgetJob.schedule(c);if(exists(c))WidgetJob.refresh(c);}}
}
