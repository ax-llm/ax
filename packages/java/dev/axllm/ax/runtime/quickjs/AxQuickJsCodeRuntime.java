package dev.axllm.ax.runtime.quickjs;

import dev.axllm.ax.AxCodeRuntime;
import dev.axllm.ax.AxCodeSession;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxQuickJsCodeRuntime implements AxCodeRuntime, AutoCloseable {
  private final Map<String, AxQuickJsHostCallable> hostCallables = new LinkedHashMap<>();
  private final Map<String, Object> runtimePolicy;

  public AxQuickJsCodeRuntime() {
    this(Map.of());
  }

  public AxQuickJsCodeRuntime(Map<String, Object> runtimePolicy) {
    this.runtimePolicy = defaultPolicy(runtimePolicy == null ? Map.of() : runtimePolicy);
  }

  public String getUsageInstructions() {
    return "JavaScript QuickJS runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), and reportFailure(...). Filesystem, network, and native host APIs are not exposed by default.";
  }

  public Map<String, Object> getRuntimePolicy() {
    return new LinkedHashMap<>(runtimePolicy);
  }

  public AxQuickJsCodeRuntime registerCallable(String name, AxQuickJsHostCallable handler) {
    if (name == null || name.isBlank()) throw new IllegalArgumentException("QuickJS host callable name is required");
    if (handler == null) throw new IllegalArgumentException("QuickJS host callable handler is required");
    hostCallables.put(name, handler);
    return this;
  }

  // Adapts the package-neutral AxCodeRuntime.HostCallable seam (used by the
  // agent wrapper to wire llmQuery) onto this runtime's native callable type.
  @Override
  public void registerHostCallable(String name, AxCodeRuntime.HostCallable callable) {
    if (callable == null) return;
    registerCallable(name, callable::call);
  }

  public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
    Map<String, Object> mergedOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    mergedOptions.put("runtimePolicy", mergePolicy(runtimePolicy, mergedOptions.get("runtimePolicy")));
    return new AxQuickJsCodeSession(globals == null ? Map.of() : globals, mergedOptions, hostCallables);
  }

  public void close() {}

  private static Map<String, Object> defaultPolicy(Map<String, Object> overrides) {
    Map<String, Object> policy = new LinkedHashMap<>();
    policy.put("allowFilesystem", false);
    policy.put("allowNetwork", false);
    policy.put("allowProcess", false);
    policy.put("allowNativeHostAccess", false);
    policy.put("maxSnapshotBytes", 262144);
    policy.put("timeoutMs", 5000);
    policy.putAll(overrides);
    return policy;
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> mergePolicy(Map<String, Object> base, Object override) {
    Map<String, Object> policy = defaultPolicy(base == null ? Map.of() : base);
    if (override instanceof Map<?, ?> raw) {
      for (Map.Entry<?, ?> entry : raw.entrySet()) policy.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return policy;
  }
}
