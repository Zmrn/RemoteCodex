package com.anso.remotecodex;

/** Launcher dimensions are usable dp, after the host's own widget padding. */
public final class WidgetSizing {
  public final float side, horizontalInset, verticalInset;
  public WidgetSizing(float width, float height) {
    if (!Float.isFinite(width) || width <= 0) width = 160;
    if (!Float.isFinite(height) || height <= 0) height = width;
    side = Math.min(width, height);
    horizontalInset = (width - side) / 2;
    verticalInset = (height - side) / 2;
  }
  public float digitSize(int length, float fontScale) {
    float scale = Math.max(1, fontScale);
    float preferred = length < 2 ? 46 : length == 2 ? 36 : length == 3 ? 28 : 22;
    float widthLimit = Math.max(1, (side - 16) * .45f) / (Math.max(1, length) * .64f * scale);
    float heightLimit = Math.max(1, side - 74 * scale) / (1.2f * scale);
    return Math.max(8, Math.min(preferred, Math.min(widthLimit, heightLimit)));
  }
}
