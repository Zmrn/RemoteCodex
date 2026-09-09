package com.anso.remotecodex;
import org.json.*;

/** Runtime uncertainty and exact-report read evidence have different lifetimes. */
public final class WidgetReadState {
  public static void mergeUnknown(JSONObject incoming, JSONObject before) throws Exception {
    if(!incoming.optBoolean("unknown")||before==null)return;
    String token=incoming.optString("reportToken","");
    boolean same=token.matches("[a-f0-9]{64}")&&token.equals(before.optString("reportToken"));
    incoming.put("running",before.optBoolean("running")).put("cached",true);
    if(!same)incoming.put("unread",before.optBoolean("unread")).put("reportToken",before.optString("reportToken")).put("officialRead",before.optBoolean("officialRead")).put("officialReadCached",true);
  }
  public static boolean canClear(JSONObject row) {
    // Official absence is a refresh-time observation, not a durable receipt.
    return !row.optBoolean("unread")&&(!row.optBoolean("officialRead")||row.optBoolean("officialReadFresh"));
  }
}
