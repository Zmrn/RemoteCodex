package com.anso.remotecodex;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import org.json.*;

/** Native task overview. Selection is local to this page, never the saved active device. */
public final class WidgetInboxActivity extends Activity {
  private static final int BG=0xff101722,SURFACE=0xff161e2a,BORDER=0xff354559,SELECTED=0xff273d5b;
  private static final int INK=0xffe6edf5,MUTED=0xffa5b3c5,BLUE=0xff89b6ff,AMBER=0xffedbb78;
  private App app;private LinearLayout root,rows,tabs;private ScrollView scroll;
  private TextView deviceName,deviceCount,updated;private View refresh;private String filter="unread",selectedDevice="";
  private boolean refreshing;private AlertDialog dialog;
  private final Runnable listener=()->render();
  private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
  private LinearLayout column(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.VERTICAL);return v;}
  private LinearLayout row(){LinearLayout v=new LinearLayout(this);v.setGravity(Gravity.CENTER_VERTICAL);return v;}
  private TextView text(String s,int size,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);t.setFontFeatureSettings("tnum");return t;}
  private void medium(TextView v){v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));}
  private GradientDrawable shape(int fill,int stroke,int radius){GradientDrawable d=new GradientDrawable();d.setColor(fill);d.setCornerRadius(dp(radius));if(stroke!=0)d.setStroke(dp(1),stroke);return d;}
  private void surface(View v,int fill,int stroke,int radius){v.setBackground(shape(fill,stroke,radius));}
  private void action(View v,int fill,int stroke,int radius,Runnable run){
    v.setBackground(new RippleDrawable(ColorStateList.valueOf(0x2289b6ff),shape(fill,stroke,radius),shape(Color.WHITE,0,radius)));
    v.setFocusable(true);v.setOnClickListener(unused->run.run());
    v.setAccessibilityDelegate(new View.AccessibilityDelegate(){@Override public void onInitializeAccessibilityNodeInfo(View view,AccessibilityNodeInfo info){super.onInitializeAccessibilityNodeInfo(view,info);info.setClassName("android.widget.Button");}});
  }
  private View icon(String kind,int color,int size){ImageView v=new ImageView(this);v.setImageDrawable(new InboxIcon(kind,color));v.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);v.setLayoutParams(new LinearLayout.LayoutParams(dp(size),dp(size)));return v;}
  private View iconButton(String kind,String label,Runnable run,boolean outlined){
    FrameLayout box=new FrameLayout(this);ImageView image=new ImageView(this);image.setImageDrawable(new InboxIcon(kind,MUTED));
    box.addView(image,new FrameLayout.LayoutParams(dp(22),dp(22),Gravity.CENTER));box.setContentDescription(label);
    action(box,outlined?SURFACE:Color.TRANSPARENT,outlined?BORDER:0,12,run);return box;
  }
  private void gap(LinearLayout parent,int height){View v=new View(this);parent.addView(v,new LinearLayout.LayoutParams(1,dp(height)));}
  private void space(LinearLayout parent,int width){View v=new View(this);parent.addView(v,new LinearLayout.LayoutParams(dp(width),1));}
  private void openApp(){startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP));}
  @Override public void onCreate(Bundle state){
    super.onCreate(state);app=(App)getApplication();
    filter=state==null?getIntent().getStringExtra("filter"):state.getString("filter");filter="running".equals(filter)?"running":"unread";
    if(state!=null)selectedDevice=state.getString("device","");
    getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);getWindow().getDecorView().setSystemUiVisibility(0);
    if(Build.VERSION.SDK_INT>=29){getWindow().setNavigationBarContrastEnforced(false);getWindow().setStatusBarContrastEnforced(false);}
    root=column();root.setBackgroundColor(BG);root.setPadding(dp(16),dp(8),dp(16),dp(12));setContentView(root);
    if(Build.VERSION.SDK_INT>=30){
      getWindow().setDecorFitsSystemWindows(false);
      getWindow().getInsetsController().setSystemBarsAppearance(0,android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
    }
    root.setOnApplyWindowInsetsListener((v,insets)->{
      if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());v.setPadding(dp(16)+safe.left,dp(8)+safe.top,dp(16)+safe.right,dp(12)+safe.bottom);return android.view.WindowInsets.CONSUMED;}
      v.setPadding(dp(16)+insets.getSystemWindowInsetLeft(),dp(8)+insets.getSystemWindowInsetTop(),dp(16)+insets.getSystemWindowInsetRight(),dp(12)+insets.getSystemWindowInsetBottom());return insets;
    });root.requestApplyInsets();
    LinearLayout header=row();header.addView(iconButton("back","返回",this::finish,false),new LinearLayout.LayoutParams(dp(40),dp(48)));
    LinearLayout heading=column();TextView title=text("任务概览",20,INK);medium(title);heading.addView(title);heading.addView(text("Remote Codex",12,MUTED));
    header.addView(heading,new LinearLayout.LayoutParams(0,-2,1));refresh=iconButton("refresh","刷新全部设备统计",this::refreshNow,true);header.addView(refresh,new LinearLayout.LayoutParams(dp(48),dp(48)));root.addView(header);gap(root,12);
    scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setClipToPadding(false);scroll.setVerticalScrollBarEnabled(false);
    LinearLayout content=column();scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    LinearLayout devices=row(),choose=row();choose.setPadding(dp(10),dp(4),dp(10),dp(4));choose.setMinimumHeight(dp(44));
    choose.addView(icon("device",MUTED,18));space(choose,8);deviceName=text("全部设备",14,INK);deviceName.setSingleLine();deviceName.setEllipsize(TextUtils.TruncateAt.END);
    choose.addView(deviceName,new LinearLayout.LayoutParams(0,-2,1));space(choose,6);choose.addView(icon("down",MUTED,16));action(choose,SURFACE,BORDER,10,this::chooseDevice);
    devices.addView(choose,new LinearLayout.LayoutParams(0,-2,1));space(devices,8);deviceCount=text("",11,MUTED);devices.addView(deviceCount);space(devices,8);
    updated=text("尚未更新",11,MUTED);updated.setGravity(Gravity.RIGHT);devices.addView(updated);content.addView(devices);gap(content,12);
    tabs=row();tabs.setPadding(dp(3),dp(3),dp(3),dp(3));surface(tabs,SURFACE,BORDER,12);content.addView(tabs);gap(content,14);
    rows=column();content.addView(rows);
    gap(root,10);LinearLayout open=row();open.setGravity(Gravity.CENTER);open.setPadding(dp(12),dp(12),dp(12),dp(12));open.setMinimumHeight(dp(48));open.addView(icon("open",BLUE,20));space(open,10);open.addView(text("打开 Remote Codex",15,BLUE));action(open,SURFACE,0xff6389be,12,this::openApp);root.addView(open,new LinearLayout.LayoutParams(-1,-2));
  }
  @Override protected void onSaveInstanceState(Bundle state){state.putString("filter",filter);state.putString("device",selectedDevice);super.onSaveInstanceState(state);}
  @Override protected void onStart(){super.onStart();DeviceSyncService.ensure(app);app.widgetMonitor.listen(listener);render();app.widgetMonitor.refreshAsync(null);}
  @Override protected void onStop(){app.widgetMonitor.unlisten(listener);super.onStop();}
  @Override protected void onDestroy(){if(dialog!=null)dialog.dismiss();super.onDestroy();}
  private void refreshNow(){
    if(refreshing)return;refreshing=true;refresh.setEnabled(false);refresh.setAlpha(.45f);updated.setText("刷新中…");
    app.widgetMonitor.refreshAsync(()->{refreshing=false;if(!isDestroyed()){refresh.setEnabled(true);refresh.setAlpha(1);render();}});
  }
  private TextView pill(String label,int color,boolean filled){TextView t=text(label,12,filled?BG:color);medium(t);t.setGravity(Gravity.CENTER);t.setPadding(dp(7),dp(2),dp(7),dp(2));surface(t,filled?color:Color.TRANSPARENT,filled?0:color,20);return t;}
  private void tab(String key,String label,int color,String number){
    boolean active=filter.equals(key);LinearLayout v=row();v.setGravity(Gravity.CENTER);v.setMinimumHeight(dp(44));v.setPadding(dp(4),dp(8),dp(4),dp(8));
    TextView title=text(label,14,active?INK:MUTED);medium(title);v.addView(title);space(v,8);v.addView(pill(number,color,active));
    v.setSelected(active);v.setContentDescription(label+"，"+number+(active?"，已选择":""));action(v,active?SELECTED:Color.TRANSPARENT,active?0xff3b5779:0,9,()->{filter=key;scroll.smoothScrollTo(0,0);render();});
    tabs.addView(v,new LinearLayout.LayoutParams(0,-2,1));
  }
  private void render(){if(isDestroyed()||rows==null)return;try{
    if(!selectedDevice.isEmpty())try{app.devices.get(selectedDevice);}catch(Exception removed){selectedDevice="";}
    JSONObject s=app.widgetMonitor.snapshot(selectedDevice);
    deviceName.setText(selectedDevice.isEmpty()?"全部设备":app.devices.get(selectedDevice).getString("name"));deviceCount.setText(s.getInt("devices")+" 台设备");
    String time=s.optString("lastUpdated");updated.setText(refreshing||s.optBoolean("working")?"刷新中…":time.isEmpty()?"尚未更新":"更新于 "+time);
    tabs.removeAllViews();tab("unread","未读回报",AMBER,s.optBoolean("known")?String.valueOf(s.getInt("unread")):"—");tab("running","运行中",BLUE,s.optBoolean("known")?String.valueOf(s.getInt("running")):"—");
    rows.removeAllViews();
    if(s.optInt("offline")>0){
      LinearLayout warning=row();warning.setPadding(dp(14),dp(12),dp(12),dp(12));warning.addView(icon("offline",AMBER,26));space(warning,12);
      LinearLayout words=column();TextView title=text(s.getInt("offline")+" 台设备未连接",14,AMBER);medium(title);words.addView(title);words.addView(text(s.optInt("cachedDevices")>0?"已保留最近统计":"连接后自动更新统计",12,MUTED));
      warning.addView(words,new LinearLayout.LayoutParams(0,-2,1));space(warning,6);warning.addView(text("查看",13,AMBER));space(warning,4);warning.addView(icon("right",AMBER,16));action(warning,0xff242526,0xffaa8553,12,()->showDetails(true));rows.addView(warning);gap(rows,18);
    }
    rows.addView(text(filter.equals("unread")?"待查看":"进行中",13,MUTED));gap(rows,8);
    JSONArray tasks=s.getJSONArray("threads");int count=0;
    for(int i=0;i<tasks.length();i++){JSONObject t=tasks.getJSONObject(i);if(!t.optBoolean(filter))continue;count++;taskCard(t);gap(rows,10);}
    if(count==0){
      LinearLayout empty=column();empty.setGravity(Gravity.CENTER);empty.setPadding(dp(16),dp(28),dp(16),dp(28));empty.addView(icon("task",MUTED,28));gap(empty,12);
      String label=s.optInt("devices")==0?"添加电脑，开始汇总任务":s.optBoolean("complete")?(filter.equals("unread")?"没有未读回报":"没有运行中的任务"):"暂未取得这类任务";
      TextView title=text(label,15,INK);title.setGravity(Gravity.CENTER);empty.addView(title);gap(empty,6);
      TextView hint=text(s.optInt("devices")==0?"在应用的设备菜单中添加":s.optBoolean("complete")?"后续状态会自动更新":"当前结果不完整，连接恢复后自动更新",12,MUTED);hint.setGravity(Gravity.CENTER);empty.addView(hint);surface(empty,SURFACE,BORDER,12);rows.addView(empty);gap(rows,12);
    }
    if(!s.optBoolean("complete")){
      LinearLayout info=row();info.setMinimumHeight(dp(48));info.addView(icon("info",MUTED,18));space(info,8);info.addView(text("当前为部分统计",12,MUTED));space(info,12);info.addView(text("详情",13,BLUE));space(info,4);info.addView(icon("right",BLUE,16));action(info,Color.TRANSPARENT,0,8,()->showDetails(false));rows.addView(info);
    }
  }catch(Exception e){updated.setText("统计暂不可用");rows.removeAllViews();TextView error=text("暂时无法读取官方状态，请点击右上角刷新。",14,MUTED);error.setPadding(0,dp(20),0,dp(20));rows.addView(error);}}
  private void taskCard(JSONObject task){
    LinearLayout card=column();card.setPadding(dp(16),dp(14),dp(14),dp(14));
    LinearLayout top=row();TextView title=text(task.optString("title","未命名任务"),16,INK);medium(title);title.setMaxLines(3);title.setEllipsize(TextUtils.TruncateAt.END);
    top.addView(title,new LinearLayout.LayoutParams(0,-2,1));space(top,10);top.addView(pill(filter.equals("running")?"运行中":"未读",filter.equals("running")?BLUE:AMBER,false));card.addView(top);gap(card,9);
    LinearLayout meta=row();meta.addView(icon("device",MUTED,18));space(meta,8);TextView detail=text(task.optString("deviceName")+" · "+(task.optString("kind").equals("chatgpt")?"Chat / Work":"Codex"),12,MUTED);detail.setMaxLines(2);detail.setEllipsize(TextUtils.TruncateAt.END);meta.addView(detail,new LinearLayout.LayoutParams(0,-2,1));space(meta,8);meta.addView(icon("right",MUTED,18));card.addView(meta);
    action(card,SURFACE,BORDER,14,()->openTask(task));rows.addView(card,new LinearLayout.LayoutParams(-1,-2));
  }
  private void openTask(JSONObject task){try{
    app.devices.get(task.getString("agentId"));startActivity(new Intent(this,MainActivity.class).putExtra("widgetAgent",task.getString("agentId")).putExtra("widgetThread",task.getString("id")).putExtra("widgetMode",task.getString("kind").equals("chatgpt")?"chat":"codex").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP));
  }catch(Exception e){Toast.makeText(this,"设备已移除，请刷新",Toast.LENGTH_SHORT).show();render();}}
  private void chooseDevice(){try{
    JSONArray devices=app.widgetMonitor.snapshot().getJSONArray("deviceStates");String[] ids=new String[devices.length()+1],labels=new String[ids.length];ids[0]="";labels[0]="全部设备";int checked=0;
    for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i);ids[i+1]=d.getString("id");labels[i+1]=d.getString("name")+"\n"+d.getString("status");if(selectedDevice.equals(ids[i+1]))checked=i+1;}
    dialog=new AlertDialog.Builder(this).setTitle("选择设备").setSingleChoiceItems(labels,checked,(d,which)->{selectedDevice=ids[which];d.dismiss();scroll.smoothScrollTo(0,0);render();}).setNegativeButton("取消",null).create();dialog.show();
  }catch(Exception e){Toast.makeText(this,"暂时无法读取设备列表",Toast.LENGTH_SHORT).show();}}
  private void showDetails(boolean offlineOnly){try{
    JSONObject current=app.widgetMonitor.snapshot(selectedDevice);JSONArray states=current.getJSONArray("deviceStates");StringBuilder message=new StringBuilder();
    for(int i=0;i<states.length();i++){JSONObject d=states.getJSONObject(i);if(!selectedDevice.isEmpty()&&!selectedDevice.equals(d.getString("id")))continue;if(offlineOnly&&!d.getBoolean("stale"))continue;
      message.append(d.getString("name")).append("\n").append(d.getString("status"));if(!d.optString("lastUpdated").isEmpty())message.append(" · 更新于 ").append(d.getString("lastUpdated"));message.append("\n\n");}
    if(!current.optString("cacheError").isEmpty())message.append(current.getString("cacheError")).append("\n\n");
    message.append(DeviceSyncService.running?"全部设备正在独立同步，断线后自动重试。":"持续同步当前未运行，可在应用的帮助与更新页检查“保持所有设备连接”。");
    message.append("\n\n未读与运行中数量只采用官方确认的状态。离线、过期或无法读取时显示未知，不沿用旧结果，不维护单独的已读记录。目标电脑需同步更新。\n\n官方列表最多包含最近 50 个未固定任务及全部固定任务；无法取得状态的任务不计入，结果会注明部分统计。在 Remote 中实际读到回报后会请求官方清除标记，是否已读仍以官方确认为准。");
    dialog=new AlertDialog.Builder(this).setTitle(offlineOnly?"设备连接状态":"统计详情").setMessage(message.toString()).setPositiveButton("知道了",null).setNeutralButton("刷新",(d,which)->refreshNow()).create();dialog.show();
  }catch(Exception e){Toast.makeText(this,"统计详情暂不可用",Toast.LENGTH_SHORT).show();}}
}
