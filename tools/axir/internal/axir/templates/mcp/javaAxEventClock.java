package dev.axllm.ax;

public interface AxEventClock {
  long now();
  void sleep(long milliseconds) throws InterruptedException;
  default boolean sleep(long milliseconds,AxCancellationToken cancellation)throws InterruptedException{if(cancellation!=null&&cancellation.cancelled())return false;sleep(milliseconds);return cancellation==null||!cancellation.cancelled();}

  final class SystemClock implements AxEventClock {
    public long now(){return System.currentTimeMillis();}
    public void sleep(long milliseconds)throws InterruptedException{Thread.sleep(Math.max(0,milliseconds));}
    public boolean sleep(long milliseconds,AxCancellationToken cancellation)throws InterruptedException{if(cancellation==null){sleep(milliseconds);return true;}return !cancellation.await(Math.max(0,milliseconds));}
  }

  final class ManualClock implements AxEventClock {
    private long current;
    public ManualClock(long current){this.current=current;}
    public synchronized long now(){return current;}
    public synchronized void advance(long milliseconds){current+=milliseconds;notifyAll();}
    public synchronized void sleep(long milliseconds)throws InterruptedException{long target=current+Math.max(0,milliseconds);while(current<target)wait();}
    public boolean sleep(long milliseconds,AxCancellationToken cancellation)throws InterruptedException{if(cancellation==null){sleep(milliseconds);return true;}AxCancellationToken.Subscription subscription=cancellation.subscribe(()->{synchronized(this){notifyAll();}});try{synchronized(this){long target=current+Math.max(0,milliseconds);while(current<target&&!cancellation.cancelled())wait();return !cancellation.cancelled();}}finally{subscription.close();}}
  }
}
