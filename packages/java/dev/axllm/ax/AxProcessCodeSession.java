package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class AxProcessCodeSession implements AxCodeSession {
  private final AxProcessCodeRuntime runtime;
  private final String sessionId;

  AxProcessCodeSession(AxProcessCodeRuntime runtime, String sessionId) {
    this.runtime = runtime;
    this.sessionId = sessionId;
  }

  public Object execute(String code, Map<String, Object> options) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("code", code == null ? "" : code);
    payload.put("options", options == null ? Map.of() : options);
    Map<String, Object> response = runtime.request("execute", sessionId, payload, false);
    if (Boolean.FALSE.equals(response.get("ok"))) {
      Map<String, Object> error = Json.asObject(response.get("error"));
      return AxRuntimeEnvelope.error(
        String.valueOf(error.getOrDefault("message", "runtime protocol error")),
        String.valueOf(error.getOrDefault("category", "runtime"))
      );
    }
    return response.get("result");
  }

  public Object inspectGlobals(Map<String, Object> options) {
    return runtime.request("inspect_globals", sessionId, options == null ? Map.of() : options, true).get("result");
  }

  public Object snapshotGlobals(Map<String, Object> options) {
    return runtime.request("snapshot_globals", sessionId, options == null ? Map.of() : options, true).get("result");
  }

  public Object patchGlobals(Object snapshot, Map<String, Object> options) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("globals", snapshot == null ? Map.of() : snapshot);
    payload.put("options", options == null ? Map.of() : options);
    return runtime.request("patch_globals", sessionId, payload, true).get("result");
  }

  public Object close() {
    return runtime.request("close", sessionId, Map.of(), false).get("result");
  }
}
