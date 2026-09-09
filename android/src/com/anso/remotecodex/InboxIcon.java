package com.anso.remotecodex;

import android.graphics.*;
import android.graphics.drawable.Drawable;

/** Small stroke icons, avoiding font-dependent Unicode glyphs. */
final class InboxIcon extends Drawable {
  private final String kind;private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
  InboxIcon(String kind,int color){this.kind=kind;paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.8f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);}
  private void path(Canvas c,float... points){Path p=new Path();p.moveTo(points[0],points[1]);for(int i=2;i<points.length;i+=2)p.lineTo(points[i],points[i+1]);c.drawPath(p,paint);}
  @Override public void draw(Canvas c){int save=c.save();Rect b=getBounds();c.translate(b.left,b.top);c.scale(b.width()/24f,b.height()/24f);
    switch(kind){
      case "back":path(c,15,5,8,12,15,19);break;
      case "right":path(c,9,5,16,12,9,19);break;
      case "down":path(c,5,9,12,16,19,9);break;
      case "device":c.drawRoundRect(4,4,20,17,1,1,paint);path(c,2,20,22,20);path(c,7,17,6,20);path(c,17,17,18,20);break;
      case "refresh":c.drawArc(4,4,20,20,210,140,false,paint);c.drawArc(4,4,20,20,30,140,false,paint);path(c,20,4,20,10,14,10);path(c,4,20,4,14,10,14);break;
      case "open":path(c,13,4,20,4,20,11);path(c,20,4,10,14);path(c,9,5,5,5,5,20,20,20,20,15);break;
      case "info":c.drawCircle(12,12,9,paint);path(c,12,11,12,17);c.drawPoint(12,7,paint);break;
      case "cache":c.drawOval(5,3,19,9,paint);path(c,5,6,5,18);path(c,19,6,19,18);c.drawArc(5,9,19,15,0,180,false,paint);c.drawArc(5,15,19,21,0,180,false,paint);break;
      case "offline":c.drawArc(0,5,24,25,230,80,false,paint);c.drawArc(5,10,19,24,230,80,false,paint);c.drawPoint(12,20,paint);path(c,3,3,21,21);break;
      default:c.drawRoundRect(5,3,19,21,2,2,paint);path(c,8,8,16,8);path(c,8,12,16,12);path(c,8,16,13,16);
    }c.restoreToCount(save);
  }
  @Override public void setAlpha(int alpha){paint.setAlpha(alpha);invalidateSelf();}
  @Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);invalidateSelf();}
  @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}
