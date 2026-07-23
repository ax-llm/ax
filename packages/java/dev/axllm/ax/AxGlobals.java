package dev.axllm.ax;

import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

public final class AxGlobals {
  private static final AtomicReference<Consumer<AxUsageEvent>> USAGE_OBSERVER =
      new AtomicReference<>();

  private AxGlobals() {}

  public static void setUsageObserver(Consumer<AxUsageEvent> observer) {
    USAGE_OBSERVER.set(observer);
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
