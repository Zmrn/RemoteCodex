package com.anso.remotecodex;
import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
public final class UpdateProvider extends ContentProvider {
  @Override public boolean onCreate(){return true;}
  private File file(Uri uri)throws FileNotFoundException{if(!"/RemoteCodex.apk".equals(uri.getPath()))throw new FileNotFoundException();File f=new File(getContext().getFilesDir(),"updates/RemoteCodex.apk");if(!f.isFile())throw new FileNotFoundException();return f;}
  @Override public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException{if(!mode.equals("r"))throw new FileNotFoundException();return ParcelFileDescriptor.open(file(u),ParcelFileDescriptor.MODE_READ_ONLY);}
  @Override public String getType(Uri u){return "application/vnd.android.package-archive";}
  @Override public Cursor query(Uri u,String[] projection,String selection,String[] args,String order){try{File f=file(u);MatrixCursor c=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});c.addRow(new Object[]{f.getName(),f.length()});return c;}catch(Exception e){return null;}}
  @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
  @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
  @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
}
