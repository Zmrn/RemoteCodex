package com.anso.remotecodex;

import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.json.*;

/** A committed journal is the authority. Legacy preferences are migration input only. */
public final class DeviceStore {
  public interface Legacy { JSONObject read() throws Exception; }
  public interface Change { JSONObject apply(JSONObject state) throws Exception; }
  public interface BeforeWrite { void check(File target) throws Exception; }
  private static final Map<String,Object> LOCKS=new ConcurrentHashMap<>();
  private final File primary,history,lock;private final Legacy legacy;private final BeforeWrite beforeWrite;
  public DeviceStore(File directory,Legacy legacy){this(directory,legacy,target->{});}
  public DeviceStore(File directory,Legacy legacy,BeforeWrite beforeWrite){primary=new File(directory,"devices-v2.json");history=new File(directory,"devices-v2.history");lock=new File(directory,"devices-v2.lock");this.legacy=legacy;this.beforeWrite=beforeWrite;}
  private static String digest(String raw)throws Exception{StringBuilder b=new StringBuilder();for(byte v:MessageDigest.getInstance("SHA-256").digest(raw.getBytes("UTF-8")))b.append(String.format(Locale.ROOT,"%02x",v));return b.toString();}
  private static String raw(File file)throws Exception{if(file.length()>8*1024*1024)throw new IOException("设备配置过大，已保留原文件");return new String(Files.readAllBytes(file.toPath()),"UTF-8");}
  private static JSONObject validate(JSONObject value)throws Exception{
    JSONArray rows=value.getJSONArray("items");String selected=value.getString("selected");Set<String> ids=new HashSet<>();
    for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String id=row.getString("id");
      if(!id.matches("[a-f0-9-]{36}")||!ids.add(id)||row.getString("name").trim().isEmpty()||!"remote".equals(row.getString("kind"))||row.getString("host").isEmpty()||row.getInt("port")<1||row.getInt("port")>65535||(row.has("sealedKey")&&!(row.get("sealedKey") instanceof String)))throw new IOException("设备配置无法校验，未重置设备");}
    if(rows.length()==0?!selected.isEmpty():!ids.contains(selected))throw new IOException("设备选择无法校验，未重置设备");return value;
  }
  private static JSONObject envelope(JSONObject value,long revision)throws Exception{String payload=validate(value).toString();return new JSONObject().put("format",1).put("revision",revision).put("payload",payload).put("sha256",digest(revision+"\n"+payload));}
  private static JSONObject checked(File file)throws Exception{JSONObject e=new JSONObject(raw(file));long r=e.getLong("revision");String p=e.getString("payload");if(e.getInt("format")!=1||r<1||!digest(r+"\n"+p).equals(e.getString("sha256")))throw new IOException("设备保护记录无法校验，未重置设备");validate(new JSONObject(p));return e;}
  private String name(JSONObject e)throws Exception{return String.format(Locale.ROOT,"%016d-%s.json",e.getLong("revision"),e.getString("sha256"));}
  private void write(File target,String data)throws Exception{
    beforeWrite.check(target);File parent=target.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("无法创建设备保护目录");
    File temp=new File(parent,target.getName()+"."+UUID.randomUUID()+".tmp");
    try{try(FileOutputStream stream=new FileOutputStream(temp)){stream.write(data.getBytes("UTF-8"));stream.getFD().sync();}Files.move(temp.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
    finally{if(temp.exists())temp.delete();}
  }
  private JSONObject load()throws Exception{
    File[] files=history.listFiles((dir,name)->name.matches("[0-9]{16}-[a-f0-9]{64}\\.json"));
    if(history.exists()&&files==null)throw new IOException("无法读取设备保护目录，未重置设备");
    if(files!=null&&files.length>0){Arrays.sort(files,Comparator.comparing(File::getName).reversed());JSONObject latest=checked(files[0]);if(!name(latest).equals(files[0].getName())||(files.length>1&&files[1].getName().substring(0,16).equals(files[0].getName().substring(0,16))))throw new IOException("设备保护记录冲突，已保留全部内容");return latest;}
    if(primary.exists()){JSONObject e=checked(primary);write(new File(history,name(e)),e.toString());return e;}
    JSONObject migrated=envelope(legacy.read(),1);write(new File(history,name(migrated)),migrated.toString());
    try{write(primary,migrated.toString());}catch(Exception e){throw new IOException("设备迁移副本保存未完成，请重新读取确认；原配置已保留",e);}return migrated;
  }
  private JSONObject locked(Change operation)throws Exception{
    synchronized(LOCKS.computeIfAbsent(lock.getCanonicalPath(),key->new Object())){
      File parent=lock.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("无法访问设备数据目录");
      try(RandomAccessFile f=new RandomAccessFile(lock,"rw");FileChannel channel=f.getChannel();FileLock held=channel.lock()){
        JSONObject current=load(),state=new JSONObject(current.getString("payload"));if(operation==null)return state;
        JSONObject next=validate(operation.apply(new JSONObject(state.toString())));if(next.toString().equals(state.toString()))return state;
        JSONObject committed=envelope(next,Math.addExact(current.getLong("revision"),1));
        // A completed checkpoint makes deletes durable, even if the mirror write fails.
        write(new File(history,name(committed)),committed.toString());
        try{write(primary,committed.toString());}catch(Exception e){throw new IOException("设备保护记录已提交，主副本保存未完成；请刷新确认，勿重复添加设备",e);}return next;
      }
    }
  }
  public JSONObject read()throws Exception{return locked(null);}
  public JSONObject change(Change operation)throws Exception{return locked(operation);}
}
