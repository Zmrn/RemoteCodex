package com.anso.remotecodex;
import java.io.IOException;
import java.net.*;
import java.util.Arrays;

/** Public GitHub release downloads only. No device keys or GitHub login required. */
public final class UpdateNetwork {
  public interface Factory { HttpURLConnection open(URL url) throws IOException; }
  private final String base, releasePath;
  public UpdateNetwork(String base) throws Exception {
    URL url = new URL(base);
    if (!url.getHost().equals("github.com") || !url.getPath().matches("/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/latest/download/") || url.getQuery()!=null)
      throw new IOException("GitHub 更新入口无效");
    this.base=base; this.releasePath=url.getPath().replace("latest/download/", ""); validate(url);
  }
  public String manifest() { return base+"android-latest.json"; }
  public String artifact(String version) throws Exception {
    if (!version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) throw new IOException("更新版本无效");
    return "https://github.com"+releasePath+"download/v"+version+"/RemoteCodex.apk";
  }
  private void validate(URL url) throws IOException {
    if (!url.getProtocol().equals("https") || url.getUserInfo()!=null || (url.getPort()!=-1 && url.getPort()!=443) || url.getRef()!=null ||
        !(url.getHost().equals("github.com") && url.getPath().startsWith(releasePath) ||
          Arrays.asList("release-assets.githubusercontent.com","objects.githubusercontent.com").contains(url.getHost())))
      throw new IOException("更新下载地址不属于 GitHub Releases");
  }
  public HttpURLConnection open(String address) throws Exception {
    return open(address, url -> (HttpURLConnection)url.openConnection());
  }
  public HttpURLConnection open(String address, Factory factory) throws Exception {
    URL url=new URL(address);
    for(int hop=0;hop<=5;hop++) {
      validate(url);
      HttpURLConnection connection=factory.open(url);
      try {
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000); connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent","RemoteCodex-Updater");
        int code=connection.getResponseCode();
        if(code==200) return connection;
        String location=connection.getHeaderField("Location");
        if(!Arrays.asList(301,302,303,307,308).contains(code) || location==null || hop==5)
          throw new IOException("GitHub 更新资源暂时不可用（"+code+"）");
        url=new URL(url,location);
      } catch(Exception error) { connection.disconnect(); throw error; }
      connection.disconnect();
    }
    throw new IOException("GitHub 更新重定向异常");
  }
}
