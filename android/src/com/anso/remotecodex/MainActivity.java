package com.anso.remotecodex;
import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import android.view.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
public final class MainActivity extends Activity {
  public WebView web;private App app;private LocalServer server;private ValueCallback<Uri[]> chooser;private File pendingFile;private boolean pendingInstall;private final ExecutorService io=Executors.newSingleThreadExecutor();
  private final Handler widgetHandler=new Handler(Looper.getMainLooper());private boolean foreground,pageReady;private JSONObject widgetDestination;
  private final Runnable widgetPoll=new Runnable(){public void run(){if(!foreground)return;if(app!=null&&TaskWidget.exists(app))app.widgetMonitor.refreshAsync(null);widgetHandler.postDelayed(this,30000);}};
  private JSONObject widgetTarget(Intent intent){try{String agent=intent.getStringExtra("widgetAgent"),thread=intent.getStringExtra("widgetThread");if(agent==null||thread==null||!agent.matches("[a-f0-9-]{36}")||!thread.matches("[a-f0-9-]{36}"))return null;app.devices.get(agent);return new JSONObject().put("agent",agent).put("thread",thread).put("mode","chat".equals(intent.getStringExtra("widgetMode"))?"chat":"codex");}catch(Exception e){message("小组件中的设备已移除，请刷新");return null;}}
  private void openWidgetTarget(){if(!pageReady||web==null||widgetDestination==null)return;JSONObject target=widgetDestination;widgetDestination=null;web.evaluateJavascript("window.remoteCodexOpenTask?.("+target.toString()+").catch(e=>alert(e.message))",null);}
  @Override public void onCreate(Bundle state){super.onCreate(state);app=(App)getApplication();app.activity=new java.lang.ref.WeakReference<>(this);
    try{server=app.server();web=new WebView(this);web.setBackgroundColor(Color.rgb(16,23,34));
      // Insets belong to the native container: WebView padding does not shrink
      // CSS fixed-position elements or its viewport on Android 15 edge-to-edge.
      FrameLayout safeArea=new FrameLayout(this);safeArea.setBackgroundColor(Color.rgb(16,23,34));
      safeArea.addView(web,new FrameLayout.LayoutParams(-1,-1));
      if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
      else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
      safeArea.setOnApplyWindowInsetsListener((v,insets)->{
        if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsets.CONSUMED;}
        int left=insets.getSystemWindowInsetLeft(),top=insets.getSystemWindowInsetTop(),right=insets.getSystemWindowInsetRight(),bottom=insets.getSystemWindowInsetBottom();
        if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){DisplayCutout cutout=insets.getDisplayCutout();left=Math.max(left,cutout.getSafeInsetLeft());top=Math.max(top,cutout.getSafeInsetTop());right=Math.max(right,cutout.getSafeInsetRight());bottom=Math.max(bottom,cutout.getSafeInsetBottom());}
        v.setPadding(left,top,right,bottom);return insets.consumeSystemWindowInsets();
      });
      setContentView(safeArea);safeArea.requestApplyInsets();getWindow().setStatusBarColor(Color.rgb(16,23,34));getWindow().setNavigationBarColor(Color.rgb(16,23,34));
      WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(false);
      web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){String u=r.getUrl().toString();if(u.startsWith(server.origin+"/"))return false;if(r.isForMainFrame()&&("https".equals(r.getUrl().getScheme())||"http".equals(r.getUrl().getScheme())))try{startActivity(new Intent(Intent.ACTION_VIEW,r.getUrl()));}catch(Exception e){message("无法打开外部链接");}return true;}
        @Override public void onPageStarted(WebView v,String u,android.graphics.Bitmap icon){pageReady=false;if(!u.startsWith(server.origin+"/"))v.stopLoading();}
        @Override public void onPageFinished(WebView v,String u){if(u.startsWith(server.origin+"/")){pageReady=true;openWidgetTarget();}}});
      web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params){if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;try{Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/png","image/jpeg","image/webp"});startActivityForResult(pick,30);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;}return true;}});
      widgetDestination=widgetTarget(getIntent());
      CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);CookieManager.getInstance().setCookie(server.origin,"bridgeSession="+server.session+"; HttpOnly; SameSite=Strict; Path=/",ok->web.loadUrl(server.origin+"/?desktop=1"));
      if(Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},41);
      if(getIntent().getBooleanExtra("installUpdate",false))new Handler().postDelayed(this::installUpdate,1200);
    }catch(Exception e){new AlertDialog.Builder(this).setMessage("启动失败："+e.getMessage()).setPositiveButton("关闭",(d,w)->finish()).show();}}
  @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);widgetDestination=widgetTarget(intent);openWidgetTarget();if(intent.getBooleanExtra("installUpdate",false))installUpdate();}
  @Override protected void onResume(){super.onResume();foreground=true;widgetHandler.removeCallbacks(widgetPoll);widgetHandler.post(widgetPoll);if(app!=null){app.activity=new java.lang.ref.WeakReference<>(this);app.updates.foreground();DeviceSyncService.ensure(app);}if(web!=null)web.onResume();if(pendingInstall&&getPackageManager().canRequestPackageInstalls()){pendingInstall=false;installUpdate();}}
  @Override protected void onPause(){foreground=false;widgetHandler.removeCallbacks(widgetPoll);if(web!=null){web.evaluateJavascript("window.remoteCodexSaveDrafts?.()",null);web.onPause();}super.onPause();}
  @Override protected void onDestroy(){foreground=false;widgetHandler.removeCallbacksAndMessages(null);if(web!=null){web.stopLoading();web.destroy();}if(chooser!=null)chooser.onReceiveValue(null);if(app!=null&&app.activity.get()==this)app.activity.clear();io.shutdown();super.onDestroy();}
  @Override public void onBackPressed(){if(web!=null)web.evaluateJavascript("(()=>{let d=document.querySelector('dialog[open]');if(d){d.close();return true}if(document.body.classList.contains('drawer-open')){document.getElementById('drawer-close').click();return true}return false})()",value->{if(!"true".equals(value))moveTaskToBack(true);});else super.onBackPressed();}
  public void message(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
  public void installUpdate(){io.execute(()->{try{app.updates.validateReady();runOnUiThread(()->{if(!getPackageManager().canRequestPackageInstalls()){pendingInstall=true;startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));return;}Uri uri=Uri.parse("content://"+getPackageName()+".updates/RemoteCodex.apk");Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);try{startActivity(intent);}catch(Exception e){message("无法打开系统安装器");}});}catch(Exception e){message(e.getMessage());}});}
  public synchronized void download(JSONObject request)throws Exception{if(pendingFile!=null)throw new Exception("请先完成当前文件保存");pendingFile=new File(getCacheDir(),"download-"+java.util.UUID.randomUUID()+".tmp");File target=pendingFile;String name=request.optString("name","attachment").replaceAll("[\\/\\\\\\r\\n]","_");String route=request.optString("route","");String data=request.optString("dataUrl","");if(!route.isEmpty()&&!route.matches("/api/agents/[a-f0-9-]{36}/bridge/threads/[a-f0-9-]{36}/(file|media)\\?.+")){pendingFile=null;throw new Exception("下载路径必须是当前设备的附件接口");}if(route.isEmpty()&&!data.matches("data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=\\r\\n]+")){pendingFile=null;throw new Exception("图片格式不受支持");}
    io.execute(()->{try{try(OutputStream out=new FileOutputStream(target)){if(!data.isEmpty()){byte[] b=android.util.Base64.decode(data.substring(data.indexOf(',')+1),0);if(b.length>25*1024*1024)throw new Exception("图片超过 25 MiB 下载上限");out.write(b);}else{URI u=new URI(route);String[] p=u.getPath().split("/",6);String remote="/api/"+p[5]+"?"+u.getRawQuery();HttpURLConnection c=server.remote(p[3],remote,"GET",new byte[0],null);try{if(c.getResponseCode()!=200)throw new Exception("原文件不可用");try(InputStream in=c.getInputStream()){byte[] b=new byte[65536];long total=0;int n;while((n=in.read(b))!=-1){total+=n;if(total>256L*1024*1024)throw new Exception("附件超过 256 MB");out.write(b,0,n);}}}finally{c.disconnect();}}}
      runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,name),31));
    }catch(Exception e){target.delete();pendingFile=null;message(e.getMessage());}});
  }
  public static Uri[] selectedImages(int result,Intent data){
    if(result!=RESULT_OK||data==null)return null;
    java.util.LinkedHashSet<Uri> uris=new java.util.LinkedHashSet<>();
    ClipData clip=data.getClipData();
    if(clip!=null)for(int i=0;i<clip.getItemCount();i++){Uri uri=clip.getItemAt(i).getUri();if(uri!=null)uris.add(uri);}
    if(uris.isEmpty()&&data.getData()!=null)uris.add(data.getData());
    return uris.isEmpty()?null:uris.toArray(new Uri[0]);
  }
  public synchronized void downloadImage(byte[] bytes,String filename)throws Exception{
    if(bytes.length>25*1024*1024)throw new Exception("图片超过 25 MiB 下载上限");
    boolean png=bytes.length>=8&&(bytes[0]&255)==137&&bytes[1]==80&&bytes[2]==78&&bytes[3]==71&&bytes[4]==13&&bytes[5]==10&&bytes[6]==26&&bytes[7]==10;
    boolean jpeg=bytes.length>=3&&(bytes[0]&255)==255&&(bytes[1]&255)==216&&(bytes[2]&255)==255;
    boolean webp=bytes.length>=12&&new String(bytes,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")&&new String(bytes,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WEBP");
    if(!png&&!jpeg&&!webp)throw new Exception("原文件不是 PNG/JPEG/WebP 图片");
    if(pendingFile!=null)throw new Exception("请先完成当前文件保存");
    File target=new File(getCacheDir(),"download-"+java.util.UUID.randomUUID()+".tmp");pendingFile=target;
    String name=filename.replaceAll("[\\/\\\\\\r\\n]","_");
    io.execute(()->{try{
      try(OutputStream out=new FileOutputStream(target)){out.write(bytes);}
      runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(png?"image/png":jpeg?"image/jpeg":"image/webp").putExtra(Intent.EXTRA_TITLE,name),31));
    }catch(Exception e){target.delete();pendingFile=null;message(e.getMessage());}});
  }
  @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==30&&chooser!=null){chooser.onReceiveValue(selectedImages(result,data));chooser=null;}if(request==31&&pendingFile!=null){File source=pendingFile;pendingFile=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try(InputStream in=new FileInputStream(source);OutputStream out=getContentResolver().openOutputStream(uri)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);message("已保存原文件");}catch(Exception e){message("保存失败，请重试");}finally{source.delete();}});}else source.delete();}}
}
