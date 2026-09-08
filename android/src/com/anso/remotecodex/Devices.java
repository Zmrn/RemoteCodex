package com.anso.remotecodex;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.net.*;
import java.security.KeyStore;
import java.util.*;
public final class Devices {
  private final SharedPreferences prefs;
  public Devices(Context c){prefs=c.getSharedPreferences("devices",0);}
  private JSONArray rows() throws Exception{return new JSONArray(prefs.getString("items","[]"));}
  public synchronized JSONObject list() throws Exception{
    JSONArray clean=new JSONArray(), all=rows();
    for(int i=0;i<all.length();i++){JSONObject row=new JSONObject(all.getJSONObject(i).toString());row.put("hasKey",row.has("sealedKey"));row.remove("sealedKey");clean.put(row);}
    return new JSONObject().put("agents",clean).put("selectedId",prefs.getString("selected",all.length()>0?all.getJSONObject(0).getString("id"):""));
  }
  public synchronized JSONObject get(String id) throws Exception{JSONArray a=rows();for(int i=0;i<a.length();i++)if(a.getJSONObject(i).getString("id").equals(id))return a.getJSONObject(i);throw new Exception("设备不存在");}
  private SecretKey secret() throws Exception{
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    String alias="remote-codex-device-keys";
    if(!store.containsAlias(alias)){KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
    return (SecretKey)store.getKey(alias,null);
  }
  private String seal(String key) throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,secret());return Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(key.getBytes("UTF-8")),Base64.NO_WRAP);}
  public synchronized String key(String id) throws Exception{String[] parts=get(id).getString("sealedKey").split(":");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,Base64.decode(parts[0],0)));return new String(c.doFinal(Base64.decode(parts[1],0)),"UTF-8");}
  public static boolean tail(InetAddress a){byte[] b=a.getAddress();return b.length==4?(b[0]&255)==100&&(b[1]&255)>=64&&(b[1]&255)<=127:b.length==16&&(b[0]&255)==253&&(b[1]&255)==122&&(b[2]&255)==17&&(b[3]&255)==92&&(b[4]&255)==161&&(b[5]&255)==224;}
  public static String validateHost(String host) throws Exception{
    host=host.trim().toLowerCase(Locale.ROOT).replaceAll("^\\[|\\]$","");
    boolean literal=host.matches("[0-9.]+")||host.matches("[0-9a-f:]+")&&host.contains(":");
    if(literal){if(!tail(InetAddress.getByName(host)))throw new Exception("地址必须属于 Tailscale 网络");}
    else if(!host.matches("(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+ts\\.net"))throw new Exception("请输入 Tailscale IP 或完整 .ts.net 名称");
    return host;
  }
  public static InetAddress resolve(String host) throws Exception{validateHost(host);InetAddress[] a=InetAddress.getAllByName(host);if(a.length==0)throw new Exception("设备地址无法解析");for(InetAddress x:a)if(!tail(x))throw new Exception("设备地址未解析到 Tailscale 网络");return a[0];}
  public synchronized JSONObject save(JSONObject body) throws Exception{
    String name=body.optString("name","").trim(),id=body.optString("id","");if(id.equals("null"))id="";
    if(name.isEmpty()||name.length()>60)throw new Exception("设备名称需要 1–60 个字符");
    String host=validateHost(body.optString("host",""));int port=body.optInt("port",0);if(port<1||port>65535)throw new Exception("端口必须在 1–65535 之间");
    JSONObject old=id.isEmpty()?null:get(id), row=new JSONObject().put("id",old==null?UUID.randomUUID().toString():id).put("name",name).put("kind","remote").put("host",host).put("port",port);
    String key=body.optString("key","");
    if(!key.isEmpty()){if(!key.matches("[\\x21-\\x7e]{16,256}"))throw new Exception("访问密钥需要 16–256 个可见 ASCII 字符");row.put("sealedKey",seal(key));}
    else if(old!=null&&host.equals(old.getString("host"))&&port==old.getInt("port")&&old.has("sealedKey"))row.put("sealedKey",old.getString("sealedKey"));
    JSONArray all=rows(),out=new JSONArray();for(int i=0;i<all.length();i++){JSONObject a=all.getJSONObject(i);if(!a.getString("id").equals(id)){if(host.equals(a.getString("host"))&&port==a.getInt("port"))throw new Exception("此地址和端口已保存");out.put(a);}}
    out.put(row);SharedPreferences.Editor edit=prefs.edit().putString("items",out.toString());if(all.length()==0)edit.putString("selected",row.getString("id"));if(!edit.commit())throw new Exception("无法保存设备");return list();
  }
  public synchronized JSONObject select(String id) throws Exception{get(id);prefs.edit().putString("selected",id).commit();return list();}
  public synchronized JSONObject remove(String id) throws Exception{get(id);JSONArray all=rows(),out=new JSONArray();for(int i=0;i<all.length();i++)if(!all.getJSONObject(i).getString("id").equals(id))out.put(all.get(i));SharedPreferences.Editor e=prefs.edit().putString("items",out.toString());if(prefs.getString("selected","").equals(id))e.putString("selected",out.length()>0?out.getJSONObject(0).getString("id"):"");e.commit();return list();}
}
