package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Thread-safe, one-shot cancellation shared by provider calls and event clocks. */
public class AxCancellationToken {
  @FunctionalInterface public interface Subscription extends AutoCloseable { @Override void close(); }

  private boolean cancelled;
  private String reason;
  private long nextSubscription;
  private final Map<Long,Runnable> subscriptions=new LinkedHashMap<>();

  public boolean cancel(){return cancel("cancelled");}
  public boolean cancel(String reason){
    List<Runnable> callbacks;
    synchronized(this){
      if(cancelled)return false;
      cancelled=true;
      this.reason=reason;
      callbacks=new ArrayList<>(subscriptions.values());
      subscriptions.clear();
      notifyAll();
    }
    for(Runnable callback:callbacks)callback.run();
    return true;
  }
  public synchronized boolean cancelled(){return cancelled;}
  public synchronized String reason(){return reason;}
  public synchronized int subscriptionCount(){return subscriptions.size();}
  public Subscription subscribe(Runnable callback){
    long id;
    synchronized(this){
      if(cancelled){id=0;}else{id=++nextSubscription;subscriptions.put(id,callback);}
    }
    if(id==0){callback.run();return ()->{};}
    long subscriptionId=id;
    return ()->{synchronized(AxCancellationToken.this){subscriptions.remove(subscriptionId);}};
  }
  public synchronized boolean await(long milliseconds)throws InterruptedException{
    long deadline=System.nanoTime()+Math.max(0,milliseconds)*1_000_000L;
    while(!cancelled){long remaining=deadline-System.nanoTime();if(remaining<=0)return false;long waitMillis=Math.max(1,remaining/1_000_000L);wait(waitMillis);}
    return true;
  }
  public void throwIfCancelled(){if(cancelled())throw new AxAIServiceAbortedError(reason());}
}
