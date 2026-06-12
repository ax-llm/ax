package dev.axllm.ax;

import java.util.Map;

public interface AxCodeSession {
  Object execute(String code, Map<String, Object> options);
  default Object inspectGlobals(Map<String, Object> options) {
    return "[runtime state inspection unavailable: runtime session does not implement inspectGlobals()]";
  }
  default Object snapshotGlobals(Map<String, Object> options) {
    throw new RuntimeException("AxCodeSession.snapshotGlobals() is required to export AxAgent state");
  }
  default Object patchGlobals(Object snapshot, Map<String, Object> options) {
    throw new RuntimeException("AxCodeSession.patchGlobals() is required to restore AxAgent state");
  }
  default Object exportState(Map<String, Object> options) { return snapshotGlobals(options); }
  default Object restoreState(Object snapshot, Map<String, Object> options) { return patchGlobals(snapshot, options); }
  Object close();
}
