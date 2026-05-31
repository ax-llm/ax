package axir

const pyJavaScriptQuickJSProfilePythonExample = `import os

from ax import ProcessCodeRuntime, agent

server = os.environ.get("AXIR_QUICKJS_RUNTIME_SERVER")
if not server:
    raise RuntimeError("AXIR_QUICKJS_RUNTIME_SERVER is required for the javascript-quickjs profile example")

runtime = ProcessCodeRuntime(server)
try:
    qa = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    out = qa.test(runtime, "answer = inputs.question; final({ answer })", {"question": "quickjs"})
    assert out["kind"] == "final", out
    first = out["completion_payload"]["args"][0]
    assert first["answer"] == "quickjs", out
finally:
    runtime.shutdown()

print("python-javascript-quickjs-profile-ok")
`

const javaQuickJSCodeRuntime = `package dev.ax.runtime.quickjs;

import dev.ax.AxCodeRuntime;
import dev.ax.AxCodeSession;
import java.util.Map;

public final class AxQuickJsCodeRuntime implements AxCodeRuntime, AutoCloseable {
  public String getUsageInstructions() {
    return "JavaScript QuickJS runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), and reportFailure(...). Filesystem, network, and native host APIs are not exposed by default.";
  }

  public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
    return new AxQuickJsCodeSession(globals == null ? Map.of() : globals, options == null ? Map.of() : options);
  }

  public void close() {}
}
`

const javaQuickJSCodeSession = `package dev.ax.runtime.quickjs;

import dev.ax.AxCodeSession;
import dev.ax.Json;
import io.roastedroot.quickjs4j.core.Engine;
import io.roastedroot.quickjs4j.core.GuestFunction;
import io.roastedroot.quickjs4j.core.Invokables;
import io.roastedroot.quickjs4j.core.Runner;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxQuickJsCodeSession implements AxCodeSession {
  private static final Invokables INVOKABLES = Invokables.builder("axir")
    .add(new GuestFunction("__ax_run", List.of(String.class), String.class))
    .build();
  private final Map<String, Object> bindings = new LinkedHashMap<>();
  private final Map<String, Object> reserved = new LinkedHashMap<>();
  private final int timeoutMs;
  private boolean closed = false;

  AxQuickJsCodeSession(Map<String, Object> globals, Map<String, Object> options) {
    Object reservedNames = options.get("reservedNames");
    if (reservedNames instanceof Iterable<?> items) {
      for (Object item : items) reserved.put(String.valueOf(item), true);
    }
    for (Map.Entry<String, Object> entry : globals.entrySet()) {
      bindings.put(entry.getKey(), entry.getValue());
    }
    this.timeoutMs = intOption(options.get("timeoutMs"), 5000);
  }

  public Object execute(String code, Map<String, Object> options) {
    if (closed) return Map.of("kind", "error", "is_error", true, "error_category", "session_closed", "error", "session closed");
    try {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("code", code == null ? "" : code);
      payload.put("bindings", new LinkedHashMap<>(bindings));
      String raw = runQuickJs(Json.stringify(payload), intOption(options == null ? null : options.get("timeoutMs"), timeoutMs));
      Map<String, Object> response = Json.asObject(Json.parse(raw));
      if (Boolean.FALSE.equals(response.get("ok"))) {
        return Map.of(
          "kind", "error",
          "is_error", true,
          "error_category", String.valueOf(response.getOrDefault("category", "runtime")),
          "error", String.valueOf(response.getOrDefault("error", "QuickJS runtime error"))
        );
      }
      Map<String, Object> preservedReserved = new LinkedHashMap<>();
      for (String name : reserved.keySet()) {
        if (bindings.containsKey(name)) preservedReserved.put(name, bindings.get(name));
      }
      bindings.clear();
      bindings.putAll(Json.asObject(response.get("bindings")));
      for (String name : reserved.keySet()) {
        if (preservedReserved.containsKey(name)) bindings.put(name, preservedReserved.get(name));
        else bindings.remove(name);
      }
      return response.get("result");
    } catch (Exception ex) {
      return Map.of("kind", "error", "is_error", true, "error_category", "runtime", "error", ex.getMessage());
    }
  }

  public Object inspectGlobals(Map<String, Object> options) {
    return snapshotBindings();
  }

  public Object snapshotGlobals(Map<String, Object> options) {
    return Map.of("version", 1, "bindings", snapshotBindings(), "globals", snapshotBindings());
  }

  public Object patchGlobals(Object snapshot, Map<String, Object> options) {
    Map<String, Object> next = Json.asObject(snapshot);
    if (next.containsKey("bindings")) next = Json.asObject(next.get("bindings"));
    Map<String, Object> preserved = new LinkedHashMap<>();
    for (String name : reserved.keySet()) {
      if (this.bindings.containsKey(name)) preserved.put(name, this.bindings.get(name));
    }
    this.bindings.clear();
    this.bindings.putAll(preserved);
    for (Map.Entry<String, Object> entry : next.entrySet()) {
      if (reserved.containsKey(entry.getKey())) continue;
      this.bindings.put(entry.getKey(), entry.getValue());
    }
    return snapshotGlobals(options);
  }

  public Object close() {
    closed = true;
    return Map.of("closed", true);
  }

  private Map<String, Object> snapshotBindings() {
    Map<String, Object> out = new LinkedHashMap<>(bindings);
    for (String name : reserved.keySet()) out.remove(name);
    return out;
  }

  private static int intOption(Object value, int fallback) {
    if (value instanceof Number n) return Math.max(1, n.intValue());
    if (value instanceof String s) {
      try { return Math.max(1, Integer.parseInt(s)); } catch (NumberFormatException ignored) {}
    }
    return fallback;
  }

  private static String runQuickJs(String payloadJson, int timeoutMs) throws Exception {
    Engine engine = Engine.builder().addInvokables(INVOKABLES).build();
    try (Runner runner = Runner.builder().withEngine(engine).withTimeoutMs(timeoutMs).build()) {
      Object raw = runner.invokeGuestFunction("axir", "__ax_run", List.of(payloadJson), QUICKJS_SOURCE);
      return String.valueOf(raw);
    }
  }

  private static final String QUICKJS_SOURCE = """
function __ax_run(payloadJson) {
  const payload = JSON.parse(payloadJson || "{}");
  const reserved = new Set([
    "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
    "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
    "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
    "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
    "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
    "console", "Javy", "plugin", "main", "quickjs4j_engine",
    "final", "askClarification", "discover", "recall", "used", "reportSuccess",
    "reportFailure", "guideAgent"
  ]);
  for (const [key, value] of Object.entries(payload.bindings || {})) {
    if (!reserved.has(key) && !key.startsWith("__ax_")) globalThis[key] = value;
  }
  function complete(value) { globalThis.__ax_completion = value; return value; }
  globalThis.final = function() { return complete({type: "final", args: Array.from(arguments)}); };
  globalThis.askClarification = function() { return complete({type: "askClarification", args: Array.from(arguments)}); };
  globalThis.discover = function(request) { return complete({kind: "discover", discover: request}); };
  globalThis.recall = function(request) { return complete({kind: "recall", recall: request}); };
  globalThis.used = function(idOrRequest, reason) {
    const payload = (idOrRequest && typeof idOrRequest === "object") ? Object.assign({}, idOrRequest) : {id: idOrRequest};
    if (reason !== undefined && reason !== null) payload.reason = String(reason);
    return complete({kind: "used", used: payload});
  };
  globalThis.reportSuccess = function(message) {
    return complete({kind: "status", status: {type: "success", message: String(message || "")}});
  };
  globalThis.reportFailure = function(message) {
    return complete({kind: "status", status: {type: "failed", message: String(message || "")}});
  };
  globalThis.guideAgent = function(guidance) {
    return complete({type: "guide_agent", guidance: String(guidance || "")});
  };
  let result;
  try {
    Function("with (globalThis) { " + (payload.code || "") + "\\n}")();
    result = globalThis.__ax_completion;
  } catch (error) {
    return JSON.stringify({ok: false, category: "runtime", error: String((error && error.message) || error)});
  }
  const out = {};
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (reserved.has(key) || key.startsWith("__ax_")) continue;
    const value = globalThis[key];
    if (typeof value === "function" || typeof value === "undefined") continue;
    try { JSON.stringify(value); out[key] = value; } catch (_) {}
  }
  return JSON.stringify({ok: true, result, bindings: out});
}
""";
}
`

const javaQuickJSProtocolServer = `package dev.ax.runtime.quickjs;

import dev.ax.AxCodeSession;
import dev.ax.Json;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxQuickJsProtocolServer {
  private final AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime();
  private final Map<String, AxCodeSession> sessions = new LinkedHashMap<>();
  private int nextSession = 0;

  public static void main(String[] args) throws Exception {
    if (args.length > 0 && "--self-test".equals(args[0])) {
      selfTest();
      return;
    }
    new AxQuickJsProtocolServer().serve();
  }

  private static void selfTest() {
    try (AxQuickJsCodeRuntime rt = new AxQuickJsCodeRuntime()) {
      AxCodeSession session = rt.createSession(Map.of("inputs", Map.of("question", "quickjs")), Map.of("reservedNames", java.util.List.of("inputs")));
      Object result = session.execute("answer = inputs.question; final({answer})", Map.of());
      Map<String, Object> out = Json.asObject(result);
      if (!"final".equals(out.get("type"))) throw new RuntimeException("bad final result: " + result);
      session.close();
    }
    System.out.println("java-javascript-quickjs-protocol-server-ok");
  }

  private void serve() throws Exception {
    BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8));
    String line;
    while ((line = reader.readLine()) != null) {
      Map<String, Object> message;
      try {
        message = Json.asObject(Json.parse(line));
      } catch (Exception ex) {
        continue;
      }
      Map<String, Object> response = handle(message);
      writer.write(Json.stringify(response));
      writer.newLine();
      writer.flush();
      if ("shutdown".equals(String.valueOf(message.get("op")))) return;
    }
  }

  private Map<String, Object> handle(Map<String, Object> message) {
    String id = String.valueOf(message.get("id"));
    String op = String.valueOf(message.get("op"));
    String sessionId = message.get("session_id") == null ? null : String.valueOf(message.get("session_id"));
    try {
      if ("capabilities".equals(op)) {
        return ok(message, Map.of(
          "language", "JavaScript",
          "usage_instructions", runtime.getUsageInstructions(),
          "inspect", true,
          "snapshot", true,
          "patch", true,
          "abort", false
        ), null);
      }
      if ("create_session".equals(op)) {
        Map<String, Object> payload = Json.asObject(message.get("payload"));
        String newId = "qjs-" + (++nextSession);
        AxCodeSession session = runtime.createSession(Json.asObject(payload.get("globals")), Json.asObject(payload.get("options")));
        sessions.put(newId, session);
        return ok(message, Map.of("session_id", newId), newId);
      }
      if ("execute".equals(op)) {
        AxCodeSession session = sessions.get(sessionId);
        if (session == null) return fail(id, sessionId, "session_closed", "session closed or unknown");
        Map<String, Object> payload = Json.asObject(message.get("payload"));
        return ok(message, session.execute(String.valueOf(payload.getOrDefault("code", "")), Json.asObject(payload.get("options"))), sessionId);
      }
      if ("inspect_globals".equals(op)) return ok(message, requireSession(sessionId).inspectGlobals(Json.asObject(message.get("payload"))), sessionId);
      if ("snapshot_globals".equals(op)) return ok(message, requireSession(sessionId).snapshotGlobals(Json.asObject(message.get("payload"))), sessionId);
      if ("patch_globals".equals(op)) {
        Map<String, Object> payload = Json.asObject(message.get("payload"));
        return ok(message, requireSession(sessionId).patchGlobals(payload.getOrDefault("globals", Map.of()), Json.asObject(payload.get("options"))), sessionId);
      }
      if ("close".equals(op)) {
        AxCodeSession session = sessions.remove(sessionId);
        Object result = session == null ? Map.of("closed", true) : session.close();
        return ok(message, result, sessionId);
      }
      if ("shutdown".equals(op)) {
        for (AxCodeSession session : sessions.values()) session.close();
        sessions.clear();
        return ok(message, Map.of("shutdown", true), null);
      }
      return fail(id, sessionId, "unsupported", "unknown runtime protocol op: " + op);
    } catch (Exception ex) {
      return fail(id, sessionId, "runtime", ex.getMessage());
    }
  }

  private AxCodeSession requireSession(String sessionId) {
    AxCodeSession session = sessions.get(sessionId);
    if (session == null) throw new RuntimeException("session closed or unknown");
    return session;
  }

  private static Map<String, Object> ok(Map<String, Object> message, Object result, String sessionId) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", String.valueOf(message.get("id")));
    out.put("ok", true);
    out.put("result", result == null ? Map.of() : result);
    if (sessionId != null) out.put("session_id", sessionId);
    return out;
  }

  private static Map<String, Object> fail(String id, String sessionId, String category, String text) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", id);
    out.put("ok", false);
    out.put("error", Map.of("category", category, "message", text == null ? "runtime protocol error" : text));
    if (sessionId != null) out.put("session_id", sessionId);
    return out;
  }
}
`

const javaJavaScriptQuickJSProfileExample = `import dev.ax.*;
import dev.ax.runtime.quickjs.*;
import java.util.*;

public final class JavaScriptQuickJsExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  public static void main(String[] args) {
    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      Map<String, Object> out = qa.test(runtime, "answer = inputs.question; final({answer})", Map.of("question", "quickjs"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad output: " + out);
      Map<String, Object> payload = asMap(out.get("completion_payload"));
      Map<String, Object> first = asMap(((List<?>) payload.get("args")).get(0));
      if (!"quickjs".equals(first.get("answer"))) throw new RuntimeException("bad payload: " + out);

      AxCodeSession session = runtime.createSession(Map.of("inputs", Map.of("question", "quickjs")), Map.of("reservedNames", List.of("inputs")));
      Map<String, Object> step1 = asMap(session.execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})", Map.of()));
      Map<String, Object> step2 = asMap(session.execute("counter = counter + 1; final({counter})", Map.of()));
      if (!"final".equals(step1.get("type")) || !"final".equals(step2.get("type"))) throw new RuntimeException("bad persistent final: " + step2);
      Map<String, Object> step2First = asMap(((List<?>) step2.get("args")).get(0));
      if (!Double.valueOf(2).equals(step2First.get("counter")) && !Integer.valueOf(2).equals(step2First.get("counter"))) {
        throw new RuntimeException("binding did not persist: " + step2);
      }
      Map<String, Object> step3 = asMap(session.execute("final({answer: inputs.question, counter})", Map.of()));
      Map<String, Object> step3First = asMap(((List<?>) step3.get("args")).get(0));
      if (!"quickjs".equals(step3First.get("answer"))) throw new RuntimeException("reserved input did not persist: " + step3);
      if (!"askClarification".equals(asMap(session.execute("askClarification('more?')", Map.of())).get("type"))) throw new RuntimeException("askClarification failed");
      if (!"discover".equals(asMap(session.execute("discover({tools:['search']})", Map.of())).get("kind"))) throw new RuntimeException("discover failed");
      if (!"recall".equals(asMap(session.execute("recall({query:'docs'})", Map.of())).get("kind"))) throw new RuntimeException("recall failed");
      if (!"used".equals(asMap(session.execute("used('mem1', 'helpful')", Map.of())).get("kind"))) throw new RuntimeException("used failed");
      if (!"status".equals(asMap(session.execute("reportSuccess('ok')", Map.of())).get("kind"))) throw new RuntimeException("status failed");
      session.execute("safe = 7; final({safe})", Map.of());
      Map<String, Object> snapshot = asMap(session.snapshotGlobals(Map.of()));
      if (asMap(snapshot.get("bindings")).containsKey("inputs")) throw new RuntimeException("reserved input leaked into snapshot: " + snapshot);
      session.patchGlobals(Map.of("bindings", Map.of("safe", 9)), Map.of());
      Map<String, Object> inspected = asMap(session.inspectGlobals(Map.of()));
      if (!Double.valueOf(9).equals(inspected.get("safe")) && !Integer.valueOf(9).equals(inspected.get("safe"))) {
        throw new RuntimeException("patch/inspect failed: " + inspected);
      }
      if (!"runtime".equals(asMap(session.execute("throw new Error('boom')", Map.of())).get("error_category"))) throw new RuntimeException("runtime error normalization failed");
      session.close();
      if (!"session_closed".equals(asMap(session.execute("final({})", Map.of())).get("error_category"))) throw new RuntimeException("closed session behavior failed");
    }
    System.out.println("java-javascript-quickjs-profile-ok");
  }
}
`

const javaQuickJSProfilePom = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.ax.generated</groupId>
  <artifactId>axir-quickjs-profile-example</artifactId>
  <version>0.1.0</version>
  <dependencies>
    <dependency>
      <groupId>io.roastedroot</groupId>
      <artifactId>quickjs4j</artifactId>
      <version>0.0.18</version>
    </dependency>
  </dependencies>
</project>
`

const cppQuickJSRuntimeHeader = `#pragma once

#include "ax/ax.hpp"

extern "C" {
#include <quickjs.h>
}

namespace ax::runtime::quickjs {

class QuickJsCodeSession : public AxCodeSession {
 public:
  QuickJsCodeSession(Value globals, Value options);
  ~QuickJsCodeSession() override;

  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value close() override;

 private:
  JSRuntime* runtime_;
  JSContext* context_;
  bool closed_ = false;
  Value reserved_;

  Value eval_json(const std::string& source);
  void set_global(const std::string& name, const Value& value);
};

class QuickJsCodeRuntime : public AxCodeRuntime {
 public:
  std::string usage_instructions() const override;
  AxCodeSession* create_session(Value globals, Value options = Value::object()) override;
};

}  // namespace ax::runtime::quickjs
`

const cppQuickJSRuntimeSource = `#include "ax/runtime/quickjs/quickjs_runtime.hpp"

#include <cstring>
#include <vector>

namespace ax::runtime::quickjs {

static std::vector<std::pair<std::string, Value>> value_entries(Value value) {
  std::vector<std::pair<std::string, Value>> out;
  for (const auto& key_value : Core::iter(Core::map_keys(value))) {
    std::string key = display(key_value);
    out.push_back({key, Core::get(value, key)});
  }
  return out;
}

static bool contains_name(Value values, const std::string& name) {
  for (const auto& item : Core::iter(values)) {
    if (display(item) == name) return true;
  }
  return false;
}

static const char* bootstrap_source = R"JS(
const __ax_builtin_reserved = [
  "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
  "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
  "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
  "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
  "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  "console", "final", "askClarification", "discover", "recall", "used", "reportSuccess",
  "reportFailure", "guideAgent"
];
function __ax_has_name(values, name) {
  if (!Array.isArray(values)) return false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === name) return true;
  }
  return false;
}
function final() { return { type: "final", args: Array.from(arguments) }; }
function askClarification() { return { type: "askClarification", args: Array.from(arguments) }; }
function discover(request) { return { kind: "discover", discover: request }; }
function recall(request) { return { kind: "recall", recall: request }; }
function used(idOrRequest, reason) {
  const payload = (idOrRequest && typeof idOrRequest === "object") ? idOrRequest : { id: idOrRequest };
  if (reason !== undefined && reason !== null) payload.reason = String(reason);
  return { kind: "used", used: payload };
}
function reportSuccess(message) { return { kind: "status", status: { type: "success", message: String(message || "") } }; }
function reportFailure(message) { return { kind: "status", status: { type: "failed", message: String(message || "") } }; }
function guideAgent(guidance) { return { type: "guide_agent", guidance: String(guidance || "") }; }
function __ax_snapshot_json() {
  const out = {};
  const sessionReserved = Array.isArray(globalThis.__ax_session_reserved) ? globalThis.__ax_session_reserved : [];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    if (__ax_has_name(__ax_builtin_reserved, key) || __ax_has_name(sessionReserved, key)) continue;
    const value = globalThis[key];
    if (typeof value === "function" || typeof value === "undefined") continue;
    try { JSON.stringify(value); out[key] = value; } catch (_) {}
  }
  return JSON.stringify(out);
}
function __ax_clear_user_globals() {
  const sessionReserved = Array.isArray(globalThis.__ax_session_reserved) ? globalThis.__ax_session_reserved : [];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    if (__ax_has_name(__ax_builtin_reserved, key) || __ax_has_name(sessionReserved, key)) continue;
    try { delete globalThis[key]; } catch (_) {}
  }
}
)JS";

QuickJsCodeSession::QuickJsCodeSession(Value globals, Value options)
    : runtime_(JS_NewRuntime()), context_(nullptr), reserved_(Core::get(options, "reservedNames", Value::array())) {
  if (!runtime_) throw AxError("runtime", "failed to create QuickJS runtime");
  JS_SetMemoryLimit(runtime_, 32 * 1024 * 1024);
  context_ = JS_NewContext(runtime_);
  if (!context_) throw AxError("runtime", "failed to create QuickJS context");
  JS_FreeValue(context_, JS_Eval(context_, bootstrap_source, std::strlen(bootstrap_source), "<ax-bootstrap>", JS_EVAL_TYPE_GLOBAL));
  set_global("__ax_session_reserved", reserved_);
  for (const auto& entry : value_entries(globals)) set_global(entry.first, entry.second);
}

QuickJsCodeSession::~QuickJsCodeSession() {
  if (context_) JS_FreeContext(context_);
  if (runtime_) JS_FreeRuntime(runtime_);
}

Value QuickJsCodeSession::execute(Value code, Value) {
  if (closed_) return RuntimeEnvelope::session_closed("session closed");
  std::string source = display(code);
  JSValue result = JS_Eval(context_, source.c_str(), source.size(), "<actor>", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(result)) {
    JSValue exception = JS_GetException(context_);
    const char* text = JS_ToCString(context_, exception);
    std::string message = text ? text : "QuickJS exception";
    JS_FreeCString(context_, text);
    JS_FreeValue(context_, exception);
    return RuntimeEnvelope::error(message, "runtime");
  }
  JSValue json = JS_JSONStringify(context_, result, JS_UNDEFINED, JS_UNDEFINED);
  const char* text = JS_ToCString(context_, json);
  Value out = text ? parse_json(text) : Value();
  JS_FreeCString(context_, text);
  JS_FreeValue(context_, json);
  JS_FreeValue(context_, result);
  return out;
}

Value QuickJsCodeSession::inspect(Value) { return eval_json("__ax_snapshot_json()"); }

Value QuickJsCodeSession::snapshot_globals(Value) {
  Value bindings = inspect(Value::object());
  return object({{"version", 1}, {"bindings", bindings}, {"globals", bindings}});
}

Value QuickJsCodeSession::patch_globals(Value snapshot, Value) {
  Value bindings = Core::get(snapshot, "bindings", snapshot);
  JS_FreeValue(context_, JS_Eval(context_, "__ax_clear_user_globals()", std::strlen("__ax_clear_user_globals()"), "<ax-clear>", JS_EVAL_TYPE_GLOBAL));
  for (const auto& entry : value_entries(bindings)) {
    if (contains_name(reserved_, entry.first)) continue;
    set_global(entry.first, entry.second);
  }
  return snapshot_globals(Value::object());
}

Value QuickJsCodeSession::close() {
  closed_ = true;
  return object({{"closed", true}});
}

Value QuickJsCodeSession::eval_json(const std::string& source) {
  JSValue result = JS_Eval(context_, source.c_str(), source.size(), "<ax-inspect>", JS_EVAL_TYPE_GLOBAL);
  const char* text = JS_ToCString(context_, result);
  Value out = text ? parse_json(text) : Value::object();
  JS_FreeCString(context_, text);
  JS_FreeValue(context_, result);
  return out;
}

void QuickJsCodeSession::set_global(const std::string& name, const Value& value) {
  std::string source = "globalThis[" + stringify(Value(name)) + "] = JSON.parse(" + stringify(stringify(value)) + ");";
  JS_FreeValue(context_, JS_Eval(context_, source.c_str(), source.size(), "<ax-set-global>", JS_EVAL_TYPE_GLOBAL));
}

std::string QuickJsCodeRuntime::usage_instructions() const {
  return "JavaScript QuickJS runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), and reportFailure(...). Filesystem, network, and native host APIs are not exposed by default.";
}

AxCodeSession* QuickJsCodeRuntime::create_session(Value globals, Value options) {
  return new QuickJsCodeSession(globals, options);
}

}  // namespace ax::runtime::quickjs
`

const cppJavaScriptQuickJSProfileExample = `#include "ax/ax.hpp"
#include "ax/runtime/quickjs/quickjs_runtime.hpp"
#include <iostream>

static bool is_number(const ax::Value& value, const std::string& expected) {
  return ax::display(value) == expected;
}

int main() {
  ax::runtime::quickjs::QuickJsCodeRuntime runtime;
  auto qa = ax::agent("question:string -> answer:string", ax::object({{"runtime", ax::object({{"language", "JavaScript"}})}}));
  ax::Value out = qa.test(runtime, "answer = inputs.question; final({answer})", ax::object({{"question", "quickjs"}}));
  if (!ax::equal(ax::Core::get(out, "kind"), "final")) return 1;
  ax::Value payload = ax::Core::get(out, "completion_payload", ax::Value::object());
  ax::Value args = ax::Core::get(payload, "args", ax::Value::array());
  if (!ax::equal(ax::Core::get(ax::Core::get(args, 0), "answer"), "quickjs")) return 2;

  ax::AxCodeSession* session = runtime.create_session(
    ax::object({{"inputs", ax::object({{"question", "quickjs"}})}}),
    ax::object({{"reservedNames", ax::array({"inputs"})}})
  );
  ax::Value step1 = session->execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})");
  ax::Value step2 = session->execute("counter = counter + 1; final({counter})");
  if (!ax::equal(ax::Core::get(step1, "type"), "final") || !ax::equal(ax::Core::get(step2, "type"), "final")) return 3;
  ax::Value step2_args = ax::Core::get(step2, "args", ax::Value::array());
  if (!is_number(ax::Core::get(ax::Core::get(step2_args, 0), "counter"), "2")) return 4;
  ax::Value step3 = session->execute("final({answer: inputs.question, counter})");
  if (!ax::equal(ax::Core::get(ax::Core::get(ax::Core::get(step3, "args", ax::Value::array()), 0), "answer"), "quickjs")) return 5;
  if (!ax::equal(ax::Core::get(session->execute("askClarification('more?')"), "type"), "askClarification")) return 6;
  if (!ax::equal(ax::Core::get(session->execute("discover({tools:['search']})"), "kind"), "discover")) return 7;
  if (!ax::equal(ax::Core::get(session->execute("recall({query:'docs'})"), "kind"), "recall")) return 8;
  if (!ax::equal(ax::Core::get(session->execute("used('mem1', 'helpful')"), "kind"), "used")) return 9;
  if (!ax::equal(ax::Core::get(session->execute("reportSuccess('ok')"), "kind"), "status")) return 10;
  session->execute("safe = 7; final({safe})");
  ax::Value snapshot = session->snapshot_globals();
  if (!ax::Core::get(ax::Core::get(snapshot, "bindings", ax::Value::object()), "inputs").is_null()) return 11;
  session->patch_globals(ax::object({{"bindings", ax::object({{"safe", 9}})}}));
  if (!is_number(ax::Core::get(session->inspect(), "safe"), "9")) return 12;
  if (!ax::equal(ax::Core::get(session->execute("throw new Error('boom')"), "error_category"), "runtime")) return 13;
  session->close();
  if (!ax::equal(ax::Core::get(session->execute("final({})"), "error_category"), "session_closed")) return 14;
  delete session;

  std::cout << "cpp-javascript-quickjs-profile-ok\n";
}
`

const cppQuickJSProfileReadme = `# JavaScript QuickJS Runtime Profile

This optional profile compiles only when QuickJS headers and libraries are supplied.

Example verification:

` + "```bash" + `
AXIR_QUICKJS_CFLAGS="-I/opt/homebrew/opt/quickjs/include/quickjs" \
AXIR_QUICKJS_LDFLAGS="/opt/homebrew/opt/quickjs/lib/quickjs/libquickjs.a -lm -ldl -pthread" \
go run . verify --targets cpp --runtime-profiles javascript-quickjs ../../ir/axcore/root.axir
` + "```" + `
`
