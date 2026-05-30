package axir

const pyRuntime = `from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class RuntimeCapabilities:
    inspect: bool = True
    snapshot: bool = True
    patch: bool = True
    abort: bool = False
    language: str = "JavaScript"
    usage_instructions: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "inspect": self.inspect,
            "snapshot": self.snapshot,
            "patch": self.patch,
            "abort": self.abort,
            "language": self.language,
            "usage_instructions": self.usage_instructions,
        }


class RuntimeEnvelope:
    @staticmethod
    def result(value: Any) -> dict[str, Any]:
        return {"kind": "result", "result": value}

    @staticmethod
    def error(message: str, category: str = "runtime") -> dict[str, Any]:
        return {"kind": "error", "is_error": True, "error_category": category, "error": str(message)}

    @staticmethod
    def session_closed(message: str = "session closed") -> dict[str, Any]:
        return RuntimeEnvelope.error(message, "session_closed")

    @staticmethod
    def timeout(message: str = "execution timed out") -> dict[str, Any]:
        return RuntimeEnvelope.error(message, "timeout")

    @staticmethod
    def final(*args: Any) -> dict[str, Any]:
        payload = list(args)
        if len(payload) == 1 and isinstance(payload[0], list):
            payload = list(payload[0])
        return {"type": "final", "args": payload}

    @staticmethod
    def ask_clarification(*args: Any) -> dict[str, Any]:
        payload = list(args)
        if len(payload) == 1 and isinstance(payload[0], list):
            payload = list(payload[0])
        return {"type": "askClarification", "args": payload}

    @staticmethod
    def discover(request: Any) -> dict[str, Any]:
        return {"kind": "discover", "discover": request}

    @staticmethod
    def recall(request: Any) -> dict[str, Any]:
        return {"kind": "recall", "recall": request}

    @staticmethod
    def used(request: Any, reason: str | None = None, stage: str | None = None) -> dict[str, Any]:
        if isinstance(request, dict):
            payload = dict(request)
        else:
            payload = {"id": request}
        if reason is not None:
            payload["reason"] = reason
        if stage is not None:
            payload["stage"] = stage
        return {"kind": "used", "used": payload}

    @staticmethod
    def status(status_type: str, message: str = "", **extra: Any) -> dict[str, Any]:
        payload = {"type": status_type, "message": message}
        payload.update(extra)
        return {"kind": "status", "status": payload}

    @staticmethod
    def guide_agent(guidance: str, triggered_by: str | None = None) -> dict[str, Any]:
        payload = {"type": "guide_agent", "guidance": guidance}
        if triggered_by is not None:
            payload["triggeredBy"] = triggered_by
        return payload
`

const javaAxRuntimeCapabilities = `package dev.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class AxRuntimeCapabilities {
  public boolean inspect = true;
  public boolean snapshot = true;
  public boolean patch = true;
  public boolean abort = false;
  public String language = "JavaScript";
  public String usageInstructions = "";

  public AxRuntimeCapabilities inspect(boolean value) { this.inspect = value; return this; }
  public AxRuntimeCapabilities snapshot(boolean value) { this.snapshot = value; return this; }
  public AxRuntimeCapabilities patch(boolean value) { this.patch = value; return this; }
  public AxRuntimeCapabilities abort(boolean value) { this.abort = value; return this; }
  public AxRuntimeCapabilities language(String value) { this.language = value == null || value.isBlank() ? "JavaScript" : value; return this; }
  public AxRuntimeCapabilities usageInstructions(String value) { this.usageInstructions = value == null ? "" : value; return this; }

  public Map<String, Object> toMap() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("inspect", inspect);
    out.put("snapshot", snapshot);
    out.put("patch", patch);
    out.put("abort", abort);
    out.put("language", language);
    out.put("usage_instructions", usageInstructions);
    return out;
  }
}
`

const javaAxRuntimeEnvelope = `package dev.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
`
