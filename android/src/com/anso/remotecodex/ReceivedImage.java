package com.anso.remotecodex;

/** Original received images only; upload limits are intentionally separate. */
public final class ReceivedImage {
  public static final int MAX_BYTES = 64 * 1024 * 1024;
  private static boolean at(byte[] bytes, int offset, int... values) {
    if (bytes.length < offset + values.length) return false;
    for (int i = 0; i < values.length; i++) if ((bytes[offset + i] & 255) != values[i]) return false;
    return true;
  }
  public static String type(byte[] bytes) {
    if (at(bytes, 0, 71, 73, 70, 56, 55, 97) || at(bytes, 0, 71, 73, 70, 56, 57, 97)) return "image/gif";
    if (at(bytes, 0, 137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
    if (at(bytes, 0, 255, 216, 255)) return "image/jpeg";
    if (at(bytes, 0, 82, 73, 70, 70) && at(bytes, 8, 87, 69, 66, 80)) return "image/webp";
    return null;
  }
  public static String validate(byte[] bytes) throws Exception {
    String mime = type(bytes);
    if (mime == null) throw new Exception("原文件不是 PNG/JPEG/WebP/GIF 图片");
    int limit = mime.equals("image/gif") ? MAX_BYTES : 25 * 1024 * 1024;
    if (bytes.length > limit) throw new Exception("图片超过 " + (limit / 1024 / 1024) + " MiB 下载上限");
    return mime;
  }
}
