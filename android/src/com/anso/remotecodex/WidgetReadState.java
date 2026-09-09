package com.anso.remotecodex;
import org.json.*;
/** Validates official observations; never combines prior read flags. */
public final class WidgetReadState {
  public static boolean confirmed(JSONObject row) {
    return !row.optBoolean("unknown") && row.optBoolean("runtimeKnown") &&
      (row.optBoolean("running") || row.optBoolean("readStateKnown"));
  }
}
