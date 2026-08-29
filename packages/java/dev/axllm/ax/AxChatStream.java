package dev.axllm.ax;

import java.util.Iterator;
import java.util.Map;
import java.util.NoSuchElementException;

/** Pull-based, closeable provider stream. The stream owns its HTTP response until exhausted or closed. */
public final class AxChatStream implements Iterable<Map<String, Object>>, AutoCloseable {
  @FunctionalInterface public interface Next { Map<String, Object> get() throws Exception; }
  @FunctionalInterface public interface Finish { void accept(Throwable failure, boolean cancelled); }
  @FunctionalInterface public interface Open { AxChatStream get() throws Exception; }

  private final Next next;
  private final AutoCloseable close;
  private final Finish finish;
  private boolean iteratorCreated;
  private boolean completed;

  public AxChatStream(Next next, AutoCloseable close) { this(next, close, (failure, cancelled) -> {}); }

  public AxChatStream(Next next, AutoCloseable close, Finish finish) {
    this.next = next;
    this.close = close;
    this.finish = finish;
  }

  public static AxChatStream fromIterable(Iterable<Map<String, Object>> values) {
    Iterator<Map<String, Object>> iterator = values.iterator();
    AutoCloseable close = values instanceof AutoCloseable closeable ? closeable : () -> {};
    return new AxChatStream(() -> iterator.hasNext() ? iterator.next() : null, close);
  }

  /** Defers opening the provider connection until the first item is requested. */
  public static AxChatStream lazy(Open open) {
    AxChatStream[] source = new AxChatStream[1];
    @SuppressWarnings("unchecked")
    Iterator<Map<String, Object>>[] iterator = new Iterator[1];
    return new AxChatStream(
      () -> {
        if (source[0] == null) {
          source[0] = open.get();
          iterator[0] = source[0].iterator();
        }
        return iterator[0].hasNext() ? iterator[0].next() : null;
      },
      () -> { if (source[0] != null) source[0].close(); }
    );
  }

  @Override public synchronized Iterator<Map<String, Object>> iterator() {
    if (iteratorCreated) throw new IllegalStateException("AxChatStream can only be consumed once");
    iteratorCreated = true;
    return new Iterator<>() {
      private Map<String, Object> pending;
      private boolean ready;

      @Override public boolean hasNext() {
        if (ready) return true;
        if (completed) return false;
        try {
          pending = next.get();
          if (pending == null) {
            complete(null, false);
            return false;
          }
          ready = true;
          return true;
        } catch (Throwable error) {
          complete(error, false);
          throw Core.asRuntime(error);
        }
      }

      @Override public Map<String, Object> next() {
        if (!hasNext()) throw new NoSuchElementException();
        Map<String, Object> value = pending;
        pending = null;
        ready = false;
        return value;
      }
    };
  }

  private synchronized void complete(Throwable failure, boolean cancelled) {
    if (completed) return;
    completed = true;
    try { close.close(); }
    catch (Exception closeError) { if (failure == null && !cancelled) failure = closeError; }
    finish.accept(failure, cancelled);
  }

  @Override public void close() { complete(null, true); }
}
