package dev.axllm.ax;

import java.util.Map;
import java.util.LinkedHashMap;
import java.util.IdentityHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

public final class AxGlobals {
  private static final AtomicReference<Consumer<AxUsageEvent>> USAGE_OBSERVER =
      new AtomicReference<>();
  private static final AtomicReference<AxRateLimiter> RATE_LIMITER = new AtomicReference<>();
  private static final AtomicReference<AxTracer> TRACER = new AtomicReference<>();
  private static final AtomicReference<AxMeter> METER = new AtomicReference<>();
  private static final ThreadLocal<Frame> FRAME = new ThreadLocal<>();
  private static final Map<AxMeter, Instruments> INSTRUMENTS = new IdentityHashMap<>();

  private AxGlobals() {}

  public static void setUsageObserver(Consumer<AxUsageEvent> observer) {
    USAGE_OBSERVER.set(observer);
  }

  public static void setRateLimiter(AxRateLimiter limiter) {
    RATE_LIMITER.set(limiter);
  }

  public static void setTracer(AxTracer tracer) {
    TRACER.set(tracer);
  }

  public static void setMeter(AxMeter meter) {
    METER.set(meter);
  }

  static AxRuntimeHooks snapshot() {
    return new AxRuntimeHooks(RATE_LIMITER.get(), TRACER.get(), METER.get());
  }

  static AxRuntimeHooks effective(Map<String, Object> options, AxRuntimeHooks serviceHooks) {
    Frame frame = FRAME.get();
    return AxRuntimeHooks.merge(
        AxRuntimeHooks.fromOptions(options),
        frame == null ? null : frame.hooks,
        serviceHooks,
        frame == null ? snapshot() : frame.globals);
  }

  static Scope openScope(
      AxRuntimeHooks callHooks,
      AxRuntimeHooks programHooks,
      String spanName,
      String metricPrefix,
      Map<String, Object> attributes) {
    Frame parent = FRAME.get();
    AxRuntimeHooks hooks = AxRuntimeHooks.merge(
        callHooks,
        parent == null ? null : parent.hooks,
        programHooks);
    AxRuntimeHooks globals = parent == null ? snapshot() : parent.globals;
    AxRuntimeHooks effective = AxRuntimeHooks.merge(hooks, globals);
    AxSpan ownSpan = startSpan(effective, spanName, "internal", attributes, parent == null ? null : parent.span);
    AxSpan span = ownSpan == null && parent != null ? parent.span : ownSpan;
    Frame frame = new Frame(hooks, globals, span, parent);
    FRAME.set(frame);
    recordMetric(effective.meter(), "counter", metricPrefix + "_requests_total", 1, attributes);
    return new Scope(frame, effective, ownSpan, metricPrefix, attributes);
  }

  static AxSpan currentSpan() {
    Frame frame = FRAME.get();
    return frame == null ? null : frame.span;
  }

  static AxSpan startSpan(
      AxRuntimeHooks hooks,
      String name,
      String kind,
      Map<String, Object> attributes,
      AxSpan parent) {
    if (hooks == null || hooks.tracer() == null) return null;
    try {
      return hooks.tracer().startSpan(new AxSpanStart(name, kind, new LinkedHashMap<>(attributes), parent));
    } catch (Throwable ignored) {
      return null;
    }
  }

  static void finishSpan(AxSpan span, Throwable error) {
    if (span == null) return;
    try {
      if (error == null) {
        span.setStatus("ok", null);
      } else {
        span.recordException(error);
        span.setStatus("error", error.getMessage());
      }
      span.end();
    } catch (Throwable ignored) {
      // Telemetry hooks are deliberately fail-open.
    }
  }

  static void recordMetric(
      AxMeter meter,
      String kind,
      String name,
      double value,
      Map<String, Object> attributes) {
    if (meter == null) return;
    try {
      Instruments cached;
      synchronized (INSTRUMENTS) {
        cached = INSTRUMENTS.computeIfAbsent(meter, ignored -> new Instruments());
      }
      if ("counter".equals(kind)) {
        AxCounter counter;
        synchronized (cached) {
          counter = cached.counters.get(name);
        }
        if (counter == null) {
          AxCounter created = meter.createCounter(name, AxMetricInstrumentOptions.empty());
          synchronized (cached) {
            counter = cached.counters.computeIfAbsent(name, ignored -> created);
          }
        }
        counter.add(value, new LinkedHashMap<>(attributes));
      } else {
        AxHistogram histogram;
        synchronized (cached) {
          histogram = cached.histograms.get(name);
        }
        if (histogram == null) {
          AxHistogram created = meter.createHistogram(name, AxMetricInstrumentOptions.empty());
          synchronized (cached) {
            histogram = cached.histograms.computeIfAbsent(name, ignored -> created);
          }
        }
        histogram.record(value, new LinkedHashMap<>(attributes));
      }
    } catch (Throwable ignored) {
      // Meter creation and recording are deliberately fail-open.
    }
  }

  static final class Scope implements AutoCloseable {
    private final Frame frame;
    private final AxRuntimeHooks hooks;
    private final AxSpan ownSpan;
    private final String metricPrefix;
    private final Map<String, Object> attributes;
    private final long startedNanos = System.nanoTime();
    private Throwable error;
    private boolean closed;

    Scope(
        Frame frame,
        AxRuntimeHooks hooks,
        AxSpan ownSpan,
        String metricPrefix,
        Map<String, Object> attributes) {
      this.frame = frame;
      this.hooks = hooks;
      this.ownSpan = ownSpan;
      this.metricPrefix = metricPrefix;
      this.attributes = new LinkedHashMap<>(attributes);
    }

    void fail(Throwable error) {
      this.error = error;
    }

    @Override
    public void close() {
      if (closed) return;
      closed = true;
      if (error != null) recordMetric(hooks.meter(), "counter", metricPrefix + "_errors_total", 1, attributes);
      recordMetric(hooks.meter(), "histogram", metricPrefix + "_duration_ms", (System.nanoTime() - startedNanos) / 1_000_000.0, attributes);
      finishSpan(ownSpan, error);
      if (frame.parent == null) FRAME.remove(); else FRAME.set(frame.parent);
    }
  }

  private record Frame(AxRuntimeHooks hooks, AxRuntimeHooks globals, AxSpan span, Frame parent) {}

  private static final class Instruments {
    final Map<String, AxCounter> counters = new LinkedHashMap<>();
    final Map<String, AxHistogram> histograms = new LinkedHashMap<>();
  }

  static void emitUsage(
      String operation,
      Map<String, Object> response,
      Map<String, Object> options,
      boolean streaming) {
    Object raw;
    try {
      raw = Core.build_usage_event(operation, response, options, streaming);
    } catch (Throwable ignored) {
      return;
    }
    Map<String, Object> event = Core.asMap(raw);
    if (event.isEmpty()) return;
    Consumer<AxUsageEvent> observer = USAGE_OBSERVER.get();
    if (observer == null) return;
    try {
      observer.accept(new AxUsageEvent(event));
    } catch (Throwable ignored) {
      // Usage observers are deliberately fail-open.
    }
  }
}
