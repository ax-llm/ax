package dev.axllm.ax;

import java.lang.ref.Cleaner;
import java.lang.ref.Reference;
import java.util.Iterator;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.function.Consumer;

/**
 * The deltas of {@link AxGen#streamingForward}, pulled one at a time.
 *
 * <p>The forward starts on a worker thread when iteration starts, and the worker waits while the
 * caller handles each delta, so processors, assertions and tools never run while the loop body
 * does. Consume the stream once, in try-with-resources: closing it, or leaving the block early,
 * stops the run and waits for the worker to finish; with a run {@code control} the run then ends
 * as aborted, as {@code control.abort()} reports it. An error the forward raises is rethrown from
 * the iterator's {@code hasNext()} as the forward raised it, after the deltas sent before it.
 *
 * <pre>{@code
 * try (AxGenDeltaStream stream = gen.streamingForward(client, values, Map.of())) {
 *   for (AxGenDelta delta : stream) {
 *     // merge delta.delta() into sample delta.index(); start over when delta.version() changes
 *   }
 * }
 * }</pre>
 */
public final class AxGenDeltaStream implements Iterable<AxGenDelta>, AutoCloseable {
  /** Runs the forward, handing each {version, index, delta} envelope to the sink. */
  interface Run {
    void run(Consumer<Map<String, Object>> sink);
  }

  /**
   * The cancellation token of a streamed run. It also records whether the consumer stopped the
   * run early, which a run control reports as aborted rather than failed.
   */
  static final class StopToken extends AxCancellationToken {
    private volatile boolean consumerStopped;

    boolean consumerStopped() {
      return consumerStopped;
    }
  }

  // A stream dropped without close() is stopped once it is garbage collected.
  private static final Cleaner CLEANER = Cleaner.create();

  private final State state;
  private final Cleaner.Cleanable cleanable;

  // stop is the cancellation token the run uses; parent, when given, cancels it too.
  AxGenDeltaStream(Run run, StopToken stop, AxCancellationToken parent) {
    State created = new State(run, stop, parent);
    this.state = created;
    this.cleanable = CLEANER.register(this, created::stop);
  }

  @Override
  public Iterator<AxGenDelta> iterator() {
    state.claimIterator();
    return new Iterator<>() {
      @Override
      public boolean hasNext() {
        try {
          return state.advance();
        } finally {
          Reference.reachabilityFence(AxGenDeltaStream.this);
        }
      }

      @Override
      public AxGenDelta next() {
        try {
          return state.take();
        } finally {
          Reference.reachabilityFence(AxGenDeltaStream.this);
        }
      }
    };
  }

  /** Stops the run if it is still going and waits for the worker to finish. Idempotent. */
  @Override
  public void close() {
    cleanable.clean();
    state.join();
  }

  // Everything the worker thread uses; it never refers back to the stream, so
  // an abandoned stream can be collected and stopped.
  private static final class State {
    private static final String STOPPED = "streaming consumer closed";

    private final Object lock = new Object();
    private final StopToken stopToken;
    private final AxCancellationToken parent;
    private final Runnable body;
    private Thread worker;
    private boolean iteratorCreated;
    // The consumer waits for the next delta; the worker runs only while this is set.
    private boolean demand;
    private AxGenDelta pending;
    private boolean finished;
    private Throwable failure;
    private boolean closed;

    State(Run run, StopToken stopToken, AxCancellationToken parent) {
      this.stopToken = stopToken;
      this.parent = parent;
      // The worker keeps the caller's tracing and runtime-hook scope.
      this.body = AxGlobals.inherit(() -> work(run));
    }

    void claimIterator() {
      synchronized (lock) {
        if (iteratorCreated) throw new IllegalStateException("AxGenDeltaStream can only be consumed once");
        iteratorCreated = true;
      }
    }

    boolean advance() {
      try {
        return awaitNext();
      } catch (InterruptedException interrupted) {
        stop();
        join();
        Thread.currentThread().interrupt();
        throw new AxAIServiceAbortedError("streaming consumer interrupted");
      }
    }

    AxGenDelta take() {
      if (!advance()) throw new NoSuchElementException();
      synchronized (lock) {
        if (pending == null) throw new NoSuchElementException();
        AxGenDelta delta = pending;
        pending = null;
        return delta;
      }
    }

    // Stops the run without waiting: the sink throws, provider calls see the
    // cancelled token, and the worker is interrupted. Idempotent.
    void stop() {
      Thread running;
      synchronized (lock) {
        if (closed) return;
        running = finished ? null : worker;
        // Record why the run stops before the worker can see it stop.
        if (running != null) stopToken.consumerStopped = true;
        closed = true;
        pending = null;
        lock.notifyAll();
      }
      if (running == null) return;
      stopToken.cancel(STOPPED);
      if (running != Thread.currentThread()) running.interrupt();
    }

    void join() {
      Thread running;
      synchronized (lock) {
        running = worker;
      }
      if (running == null || running == Thread.currentThread()) return;
      try {
        running.join();
      } catch (InterruptedException interrupted) {
        // The run is stopped; the worker finishes on its own.
        Thread.currentThread().interrupt();
      }
    }

    private boolean awaitNext() throws InterruptedException {
      synchronized (lock) {
        if (pending != null) return true;
        if (closed) return false;
        if (!finished) {
          if (worker == null) start();
          demand = true;
          lock.notifyAll();
          while (pending == null && !finished && !closed) lock.wait();
          if (pending != null) return true;
          if (closed) return false;
        }
        if (failure == null) return false;
        Throwable error = failure;
        failure = null;
        throw unchecked(error);
      }
    }

    private void start() {
      Thread thread = new Thread(body, "ax-gen-streaming-forward");
      thread.setDaemon(true);
      try {
        thread.start();
        worker = thread;
      } catch (RuntimeException | Error error) {
        finished = true;
        failure = error;
      }
    }

    private void work(Run run) {
      AxCancellationToken.Subscription link = parent == null ? () -> {} : parent.subscribe(() -> stopToken.cancel(parent.reason()));
      Throwable error = null;
      try {
        run.run(this::deliver);
      } catch (Throwable thrown) {
        error = thrown;
      } finally {
        link.close();
      }
      synchronized (lock) {
        finished = true;
        // After stop() the consumer is gone, and the error is the stop itself.
        if (!closed) failure = error;
        lock.notifyAll();
      }
    }

    // The sink: hands one delta to the consumer and waits until it asks for
    // the next one. It throws once the consumer stopped, which ends the run.
    private void deliver(Map<String, Object> envelope) {
      AxGenDelta delta = AxGenDelta.fromEnvelope(envelope);
      synchronized (lock) {
        awaitDemand();
        pending = delta;
        demand = false;
        lock.notifyAll();
        awaitDemand();
      }
    }

    private void awaitDemand() {
      try {
        while (!demand && !closed) lock.wait();
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new AxAIServiceAbortedError(STOPPED);
      }
      if (closed) throw new AxAIServiceAbortedError(STOPPED);
    }

    private static RuntimeException unchecked(Throwable error) {
      if (error instanceof RuntimeException runtime) return runtime;
      if (error instanceof Error fatal) throw fatal;
      return new RuntimeException(error.getMessage(), error);
    }
  }
}
