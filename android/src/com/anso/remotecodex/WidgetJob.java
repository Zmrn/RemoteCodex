package com.anso.remotecodex;
import android.app.job.*;
import android.content.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class WidgetJob extends JobService {
  private final java.util.Map<Integer,AtomicBoolean> stopped=new java.util.HashMap<>();
  public static void schedule(Context c){if(!TaskWidget.exists(c))return;JobScheduler scheduler=c.getSystemService(JobScheduler.class);if(scheduler.getPendingJob(2713)==null)scheduler.schedule(new JobInfo.Builder(2713,new ComponentName(c,WidgetJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setPeriodic(15*60*1000L).build());}
  public static void refresh(Context c){c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(2714,new ComponentName(c,WidgetJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(0).build());}
  public static void cancel(Context c){JobScheduler s=c.getSystemService(JobScheduler.class);s.cancel(2713);s.cancel(2714);}
  @Override public boolean onStartJob(JobParameters p){AtomicBoolean token=new AtomicBoolean(false);AtomicBoolean old=stopped.put(p.getJobId(),token);if(old!=null)old.set(true);((App)getApplication()).widgetMonitor.refreshAsync(()->{if(!token.get()){stopped.remove(p.getJobId());jobFinished(p,false);}});return true;}
  @Override public boolean onStopJob(JobParameters p){AtomicBoolean token=stopped.remove(p.getJobId());if(token!=null)token.set(true);return true;}
}
