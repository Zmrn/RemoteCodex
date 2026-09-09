package com.anso.remotecodex;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import org.json.*;

public final class WidgetInboxActivity extends Activity {
  private App app;private LinearLayout root,rows;private TextView status;private Button unread,running;private String filter;
  private final Runnable listener=()->render();
  private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
  private TextView text(String s,int size,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);return t;}
  @Override public void onCreate(Bundle state){super.onCreate(state);app=(App)getApplication();filter="running".equals(getIntent().getStringExtra("filter"))?"running":"unread";
    root=new LinearLayout(this);root.setOrientation(1);root.setPadding(dp(20),dp(20),dp(20),dp(12));root.setBackgroundColor(Color.rgb(21,25,31));setContentView(root);
    if(android.os.Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
    root.setOnApplyWindowInsetsListener((v,insets)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());v.setPadding(dp(20)+safe.left,dp(20)+safe.top,dp(20)+safe.right,dp(12)+safe.bottom);return android.view.WindowInsets.CONSUMED;}v.setPadding(dp(20)+insets.getSystemWindowInsetLeft(),dp(20)+insets.getSystemWindowInsetTop(),dp(20)+insets.getSystemWindowInsetRight(),dp(12)+insets.getSystemWindowInsetBottom());return insets;});root.requestApplyInsets();
    root.addView(text("Remote Codex",22,Color.WHITE));status=text("正在汇总全部设备…",13,0xffaeb7c5);root.addView(status);
    LinearLayout tabs=new LinearLayout(this);unread=new Button(this);running=new Button(this);tabs.addView(unread,new LinearLayout.LayoutParams(0,-2,1));tabs.addView(running,new LinearLayout.LayoutParams(0,-2,1));root.addView(tabs);
    unread.setOnClickListener(v->{filter="unread";render();});running.setOnClickListener(v->{filter="running";render();});
    ScrollView scroll=new ScrollView(this);rows=new LinearLayout(this);rows.setOrientation(1);scroll.addView(rows);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    LinearLayout actions=new LinearLayout(this);Button refresh=new Button(this);refresh.setText("刷新");refresh.setOnClickListener(v->app.widgetMonitor.refreshAsync(null));actions.addView(refresh,new LinearLayout.LayoutParams(0,-2,1));
    Button open=new Button(this);open.setText("打开应用");open.setOnClickListener(v->startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP)));actions.addView(open,new LinearLayout.LayoutParams(0,-2,1));root.addView(actions);
  }
  @Override protected void onStart(){super.onStart();app.widgetMonitor.listen(listener);render();app.widgetMonitor.refreshAsync(null);}
  @Override protected void onStop(){app.widgetMonitor.unlisten(listener);super.onStop();}
  private void render(){try{
    JSONObject s=app.widgetMonitor.snapshot();status.setText(s.getString("label")+" · "+s.getInt("devices")+" 台设备"+(s.optString("lastUpdated").isEmpty()?"":" · 更新于 "+s.getString("lastUpdated"))+(s.optBoolean("working")?" · 刷新中":""));
    unread.setText("未读回报 "+s.getInt("unread"));unread.setTextColor(0xffffc45e);running.setText("运行中 "+s.getInt("running"));running.setTextColor(0xff69b2ff);unread.setSelected(filter.equals("unread"));running.setSelected(filter.equals("running"));rows.removeAllViews();
    JSONArray tasks=s.getJSONArray("threads");int count=0;
    for(int i=0;i<tasks.length();i++){JSONObject t=tasks.getJSONObject(i);if(!t.optBoolean(filter))continue;count++;
      LinearLayout card=new LinearLayout(this);card.setOrientation(1);card.setPadding(0,dp(14),0,dp(14));card.addView(text(t.optString("title","未命名任务"),17,Color.WHITE));card.addView(text(t.getString("deviceName")+" · "+(t.getString("kind").equals("chatgpt")?"Chat / Work":"Codex")+(t.optBoolean("stale")?" · 离线缓存":""),12,0xffaeb7c5));
      card.setOnClickListener(v->{try{app.devices.get(t.getString("agentId"));Intent intent=new Intent(this,MainActivity.class).putExtra("widgetAgent",t.getString("agentId")).putExtra("widgetThread",t.getString("id")).putExtra("widgetMode",t.getString("kind").equals("chatgpt")?"chat":"codex").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);startActivity(intent);}catch(Exception e){Toast.makeText(this,"设备已移除，请刷新",Toast.LENGTH_SHORT).show();}});rows.addView(card);
    }
    if(count==0)rows.addView(text(s.getBoolean("complete")?(filter.equals("unread")?"没有未读回报":"没有运行中的任务"):"当前已知结果为空，部分设备或任务暂不可读。",16,0xffaeb7c5));
    if(!s.getBoolean("complete"))rows.addView(text("统计不完整：可能存在离线设备、较大历史或官方列表数量限制。缓存不会被当作新的实时结果。",13,0xffaeb7c5));
  }catch(Exception e){status.setText("统计暂不可用，请刷新");}}
}
