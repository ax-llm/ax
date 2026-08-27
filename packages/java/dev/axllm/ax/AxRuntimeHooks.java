package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public record AxRuntimeHooks(AxRateLimiter rateLimiter, AxTracer tracer, AxMeter meter) {
  public static AxRuntimeHooks empty() {
    return new AxRuntimeHooks(null, null, null);
  }

  public static AxRuntimeHooks merge(AxRuntimeHooks... layers) {
    AxRateLimiter limiter = null;
    AxTracer tracer = null;
    AxMeter meter = null;
    for (AxRuntimeHooks layer : layers) {
      if (layer == null) continue;
      if (limiter == null && layer.rateLimiter != null) limiter = layer.rateLimiter;
      if (tracer == null && layer.tracer != null) tracer = layer.tracer;
      if (meter == null && layer.meter != null) meter = layer.meter;
    }
    return new AxRuntimeHooks(limiter, tracer, meter);
  }

  public static AxRuntimeHooks fromOptions(Map<String, Object> options) {
    if (options == null) return empty();
    AxRuntimeHooks hooks = empty();
    if (options.get("runtimeHooks") instanceof AxRuntimeHooks value) hooks = value;
    else if (options.get("runtime_hooks") instanceof AxRuntimeHooks value) hooks = value;
    AxRateLimiter limiter = hooks.rateLimiter;
    if (options.get("rateLimiter") instanceof AxRateLimiter value) limiter = value;
    else if (options.get("rate_limiter") instanceof AxRateLimiter value) limiter = value;
    AxTracer tracer = options.get("tracer") instanceof AxTracer value ? value : hooks.tracer;
    AxMeter meter = options.get("meter") instanceof AxMeter value ? value : hooks.meter;
    return new AxRuntimeHooks(limiter, tracer, meter);
  }

  public static Map<String, Object> strip(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    for (String key : new String[] {"runtimeHooks", "runtime_hooks", "rateLimiter", "rate_limiter", "tracer", "meter"}) {
      out.remove(key);
    }
    return out;
  }
}
