package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public final class AxRuntimeEnvelope {
  private AxRuntimeEnvelope() {}

  private static Map<String, Object> map(Object... values) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i + 1 < values.length; i += 2) out.put(String.valueOf(values[i]), values[i + 1]);
    return out;
  }

  public static Map<String, Object> result(Object value) {
    return map("kind", "result", "result", value);
  }

  public static Map<String, Object> error(String message) {
    return error(message, "runtime");
  }

  public static Map<String, Object> error(String message, String category) {
    return map("kind", "error", "is_error", true, "error_category", category, "error", message);
  }

  public static Map<String, Object> sessionClosed(String message) {
    return error(message == null ? "session closed" : message, "session_closed");
  }

  public static Map<String, Object> timeout(String message) {
    return error(message == null ? "execution timed out" : message, "timeout");
  }

  public static Map<String, Object> finalPayload(Object... args) {
    return map("type", "final", "args", new ArrayList<>(List.of(args)));
  }

  public static Map<String, Object> askClarification(Object... args) {
    return map("type", "askClarification", "args", new ArrayList<>(List.of(args)));
  }

  public static Map<String, Object> discover(Object request) {
    return map("kind", "discover", "discover", request);
  }

  public static Map<String, Object> recall(Object request) {
    return map("kind", "recall", "recall", request);
  }

  public static Map<String, Object> used(Object request) {
    return map("kind", "used", "used", request);
  }

  public static Map<String, Object> used(String id, String reason, String stage) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("id", id);
    if (reason != null) payload.put("reason", reason);
    if (stage != null) payload.put("stage", stage);
    return used(payload);
  }

  public static Map<String, Object> status(String type, String message) {
    return map("kind", "status", "status", map("type", type, "message", message == null ? "" : message));
  }

  public static Map<String, Object> guideAgent(String guidance) {
    return guideAgent(guidance, null);
  }

  public static Map<String, Object> guideAgent(String guidance, String triggeredBy) {
    Map<String, Object> payload = map("type", "guide_agent", "guidance", guidance);
    if (triggeredBy != null) payload.put("triggeredBy", triggeredBy);
    return payload;
  }
}
