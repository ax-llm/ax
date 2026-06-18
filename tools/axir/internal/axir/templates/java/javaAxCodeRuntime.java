package dev.axllm.ax;

import java.util.Map;

public interface AxCodeRuntime {
  default String language() { return "JavaScript"; }
  default String getUsageInstructions() { return ""; }
  AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options);

  /** A host callable the runtime can expose to actor code (e.g. llmQuery). */
  @FunctionalInterface
  interface HostCallable { Object call(Object params); }

  /**
   * Register a host callable under {@code name}. Default no-op so runtimes that
   * do not host callables are unaffected; the embedded JS engines override it
   * so the agent wrapper can wire the built-in {@code llmQuery} primitive
   * without depending on the concrete runtime package.
   */
  default void registerHostCallable(String name, HostCallable callable) {}
}
