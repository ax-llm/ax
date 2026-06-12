package dev.axllm.ax;

import java.util.Map;

public interface AxCodeRuntime {
  default String language() { return "JavaScript"; }
  default String getUsageInstructions() { return ""; }
  AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options);
}
