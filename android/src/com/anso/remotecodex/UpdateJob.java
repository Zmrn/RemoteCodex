package com.anso.remotecodex;
import android.app.job.*;
import android.content.*;
public final class UpdateJob extends JobService {
  public static void schedule(Context c){c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(2712,new ComponentName(c,UpdateJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(6*60*60*1000L).build());}
  @Override public boolean onStartJob(JobParameters p){new Thread(()->{boolean retry=false;try{((App)getApplication()).updates.backgroundCheck();}catch(Exception e){retry=true;}jobFinished(p,retry);},"update-check").start();return true;}
  @Override public boolean onStopJob(JobParameters p){return true;}
}
