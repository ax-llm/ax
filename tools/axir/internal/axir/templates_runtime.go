package axir

const pyRuntime = `from __future__ import annotations

import json
import os
import shlex
import subprocess
import threading
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


class RuntimeProtocolError(RuntimeError):
    def __init__(self, message: str, category: str = "runtime"):
        super().__init__(message)
        self.category = category


class ProcessCodeRuntime:
    language = "JavaScript"

    def __init__(
        self,
        command: list[str] | str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ):
        argv = shlex.split(command) if isinstance(command, str) else list(command)
        if not argv:
            raise ValueError("ProcessCodeRuntime requires a command")
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        self._process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=merged_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._lock = threading.Lock()
        self._next_id = 0

    def get_usage_instructions(self) -> str:
        try:
            response = self._request("capabilities", None, {})
            result = response.get("result") or {}
            if isinstance(result, dict):
                return str(result.get("usage_instructions") or "")
        except Exception:
            return ""
        return ""

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None):
        response = self._request("create_session", None, {"globals": globals or {}, "options": options or {}})
        session_id = response.get("session_id")
        result = response.get("result")
        if not session_id and isinstance(result, dict):
            session_id = result.get("session_id")
        if not session_id:
            raise RuntimeError("runtime protocol did not return a session_id")
        return ProcessCodeSession(self, str(session_id))

    def shutdown(self):
        if self._process.poll() is None:
            try:
                self._request("shutdown", None, {})
            finally:
                try:
                    self._process.terminate()
                except ProcessLookupError:
                    pass

    def _request(self, op: str, session_id: str | None, payload: dict[str, Any] | None) -> dict[str, Any]:
        with self._lock:
            self._next_id += 1
            message: dict[str, Any] = {"id": str(self._next_id), "op": op, "payload": payload or {}}
            if session_id is not None:
                message["session_id"] = session_id
            if self._process.stdin is None or self._process.stdout is None:
                raise RuntimeError("runtime protocol process is closed")
            self._process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            self._process.stdin.flush()
            line = self._process.stdout.readline()
            if not line:
                raise RuntimeError("runtime protocol process closed without a response")
            response = json.loads(line)
            if not isinstance(response, dict):
                raise RuntimeError("runtime protocol response must be an object")
            if response.get("ok") is False:
                error = response.get("error") if isinstance(response.get("error"), dict) else {}
                raise RuntimeProtocolError(
                    str(error.get("message") or "runtime protocol error"),
                    str(error.get("category") or "runtime"),
                )
            return response


class ProcessCodeSession:
    def __init__(self, runtime: ProcessCodeRuntime, session_id: str):
        self._runtime = runtime
        self._session_id = session_id

    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        try:
            return self._runtime._request(
                "execute",
                self._session_id,
                {"code": str(code), "options": options or {}},
            ).get("result")
        except RuntimeProtocolError as exc:
            return RuntimeEnvelope.error(str(exc), exc.category)
        except RuntimeError as exc:
            return RuntimeEnvelope.error(str(exc), "runtime")

    def inspect_globals(self, options: dict[str, Any] | None = None) -> Any:
        return self._runtime._request("inspect_globals", self._session_id, options or {}).get("result")

    def snapshot_globals(self, options: dict[str, Any] | None = None) -> Any:
        return self._runtime._request("snapshot_globals", self._session_id, options or {}).get("result")

    def patch_globals(self, globals: dict[str, Any], options: dict[str, Any] | None = None) -> Any:
        return self._runtime._request(
            "patch_globals",
            self._session_id,
            {"globals": globals or {}, "options": options or {}},
        ).get("result")

    def export_state(self, options: dict[str, Any] | None = None) -> Any:
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot: Any, options: dict[str, Any] | None = None) -> Any:
        return self.patch_globals(snapshot or {}, options or {})

    def close(self) -> Any:
        return self._runtime._request("close", self._session_id, {}).get("result")
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

const javaAxProcessCodeRuntime = `package dev.ax;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxProcessCodeRuntime implements AxCodeRuntime, AutoCloseable {
  private final Process process;
  private final BufferedWriter writer;
  private final BufferedReader reader;
  private int nextId = 0;

  public AxProcessCodeRuntime(List<String> command) {
    this(command, null, Map.of());
  }

  public AxProcessCodeRuntime(List<String> command, File cwd, Map<String, String> env) {
    try {
      ProcessBuilder builder = new ProcessBuilder(command);
      if (cwd != null) builder.directory(cwd);
      if (env != null) builder.environment().putAll(env);
      builder.redirectError(ProcessBuilder.Redirect.INHERIT);
      this.process = builder.start();
      this.writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
      this.reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
    } catch (Exception ex) {
      throw new RuntimeException("failed to start runtime protocol process: " + ex.getMessage(), ex);
    }
  }

  public String getUsageInstructions() {
    try {
      Map<String, Object> response = request("capabilities", null, Map.of(), true);
      Map<String, Object> result = Json.asObject(response.get("result"));
      return String.valueOf(result.getOrDefault("usage_instructions", ""));
    } catch (RuntimeException ex) {
      return "";
    }
  }

  public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("globals", globals == null ? Map.of() : globals);
    payload.put("options", options == null ? Map.of() : options);
    Map<String, Object> response = request("create_session", null, payload, true);
    Object sessionId = response.get("session_id");
    if (sessionId == null && response.get("result") instanceof Map<?, ?> result) sessionId = result.get("session_id");
    if (sessionId == null) throw new RuntimeException("runtime protocol did not return a session_id");
    return new AxProcessCodeSession(this, String.valueOf(sessionId));
  }

  synchronized Map<String, Object> request(String op, String sessionId, Map<String, Object> payload, boolean throwOnError) {
    try {
      Map<String, Object> message = new LinkedHashMap<>();
      message.put("id", String.valueOf(++nextId));
      message.put("op", op);
      message.put("payload", payload == null ? Map.of() : payload);
      if (sessionId != null) message.put("session_id", sessionId);
      writer.write(Json.stringify(message));
      writer.newLine();
      writer.flush();
      String line = reader.readLine();
      if (line == null) throw new RuntimeException("runtime protocol process closed without a response");
      Map<String, Object> response = Json.asObject(Json.parse(line));
      if (Boolean.FALSE.equals(response.get("ok")) && throwOnError) {
        Map<String, Object> error = Json.asObject(response.get("error"));
        throw new RuntimeException(String.valueOf(error.getOrDefault("message", "runtime protocol error")));
      }
      return response;
    } catch (RuntimeException ex) {
      throw ex;
    } catch (Exception ex) {
      throw new RuntimeException("runtime protocol request failed: " + ex.getMessage(), ex);
    }
  }

  public void close() {
    try {
      request("shutdown", null, Map.of(), false);
    } catch (RuntimeException ignored) {
    } finally {
      process.destroy();
    }
  }
}
`

const javaAxProcessCodeSession = `package dev.ax;

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
`
