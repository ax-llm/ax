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
import java.util.LinkedHashMap;
import java.util.Map;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;

public final class AxQuickJsCodeSession implements AxCodeSession {
  private final ScriptEngine engine;
  private final Map<String, Object> reserved = new LinkedHashMap<>();
  private boolean closed = false;

  AxQuickJsCodeSession(Map<String, Object> globals, Map<String, Object> options) {
    this.engine = new ScriptEngineManager().getEngineByName("quickjs4j");
    if (this.engine == null) throw new RuntimeException("QuickJS4J script engine not found; add io.roastedroot:quickjs4j to the runtime classpath");
    Object reservedNames = options.get("reservedNames");
    if (reservedNames instanceof Iterable<?> items) {
      for (Object item : items) reserved.put(String.valueOf(item), true);
    }
    for (Map.Entry<String, Object> entry : globals.entrySet()) {
      engine.put(entry.getKey(), entry.getValue());
    }
    engine.put("__ax_bridge", new Bridge());
    try {
      engine.eval("""
        function final() { return __ax_bridge.finalPayload(JSON.stringify(Array.from(arguments))); }
        function askClarification() { return __ax_bridge.askClarification(JSON.stringify(Array.from(arguments))); }
        function discover(request) { return __ax_bridge.discover(JSON.stringify(request)); }
        function recall(request) { return __ax_bridge.recall(JSON.stringify(request)); }
        function used(idOrRequest, reason) { return __ax_bridge.used(JSON.stringify(idOrRequest), reason == null ? null : String(reason)); }
        function reportSuccess(message) { return __ax_bridge.status("success", String(message || "")); }
        function reportFailure(message) { return __ax_bridge.status("failed", String(message || "")); }
        function guideAgent(guidance) { return __ax_bridge.guideAgent(String(guidance || "")); }
        function __ax_snapshot_json() {
          const out = {};
          for (const key of Object.getOwnPropertyNames(globalThis)) {
            if (key.startsWith("__ax_")) continue;
            const value = globalThis[key];
            if (typeof value === "function" || typeof value === "undefined") continue;
            try { JSON.stringify(value); out[key] = value; } catch (_) {}
          }
          return JSON.stringify(out);
        }
      """);
    } catch (Exception ex) {
      throw new RuntimeException("failed to initialize QuickJS runtime profile: " + ex.getMessage(), ex);
    }
  }

  public Object execute(String code, Map<String, Object> options) {
    if (closed) return Map.of("kind", "error", "is_error", true, "error_category", "session_closed", "error", "session closed");
    try {
      return engine.eval(code == null ? "" : code);
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
    Map<String, Object> bindings = Json.asObject(snapshot);
    if (bindings.containsKey("bindings")) bindings = Json.asObject(bindings.get("bindings"));
    for (Map.Entry<String, Object> entry : bindings.entrySet()) {
      if (reserved.containsKey(entry.getKey())) continue;
      engine.put(entry.getKey(), entry.getValue());
    }
    return snapshotGlobals(options);
  }

  public Object close() {
    closed = true;
    return Map.of("closed", true);
  }

  private Map<String, Object> snapshotBindings() {
    try {
      Object raw = engine.eval("__ax_snapshot_json()");
      Map<String, Object> out = Json.asObject(Json.parse(String.valueOf(raw)));
      for (String name : reserved.keySet()) out.remove(name);
      return out;
    } catch (Exception ex) {
      return Map.of("error", ex.getMessage());
    }
  }

  public static final class Bridge {
    public Map<String, Object> finalPayload(String argsJson) {
      return Map.of("type", "final", "args", Json.parse(argsJson));
    }
    public Map<String, Object> askClarification(String argsJson) {
      return Map.of("type", "askClarification", "args", Json.parse(argsJson));
    }
    public Map<String, Object> discover(String requestJson) {
      return Map.of("kind", "discover", "discover", Json.parse(requestJson));
    }
    public Map<String, Object> recall(String requestJson) {
      return Map.of("kind", "recall", "recall", Json.parse(requestJson));
    }
    public Map<String, Object> used(String requestJson, String reason) {
      Object parsed = Json.parse(requestJson);
      Map<String, Object> payload = parsed instanceof Map<?, ?> ? new LinkedHashMap<>(Json.asObject(parsed)) : new LinkedHashMap<>(Map.of("id", parsed));
      if (reason != null) payload.put("reason", reason);
      return Map.of("kind", "used", "used", payload);
    }
    public Map<String, Object> status(String type, String message) {
      return Map.of("kind", "status", "status", Map.of("type", type, "message", message));
    }
    public Map<String, Object> guideAgent(String guidance) {
      return Map.of("type", "guide_agent", "guidance", guidance);
    }
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
      Map<String, Object> out = qa.test(runtime, "answer = inputs.get('question'); final({answer: answer})", Map.of("question", "quickjs"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad output: " + out);
      Map<String, Object> payload = asMap(out.get("completion_payload"));
      Map<String, Object> first = asMap(((List<?>) payload.get("args")).get(0));
      if (!"quickjs".equals(first.get("answer"))) throw new RuntimeException("bad payload: " + out);
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

namespace ax::runtime::quickjs {

static const char* bootstrap_source = R"JS(
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
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    const value = globalThis[key];
    if (typeof value === "function" || typeof value === "undefined") continue;
    try { JSON.stringify(value); out[key] = value; } catch (_) {}
  }
  return JSON.stringify(out);
}
)JS";

QuickJsCodeSession::QuickJsCodeSession(Value globals, Value options)
    : runtime_(JS_NewRuntime()), context_(nullptr), reserved_(Core::get(options, "reservedNames", Value::array())) {
  if (!runtime_) throw AxError("runtime", "failed to create QuickJS runtime");
  JS_SetMemoryLimit(runtime_, 32 * 1024 * 1024);
  context_ = JS_NewContext(runtime_);
  if (!context_) throw AxError("runtime", "failed to create QuickJS context");
  JS_FreeValue(context_, JS_Eval(context_, bootstrap_source, std::strlen(bootstrap_source), "<ax-bootstrap>", JS_EVAL_TYPE_GLOBAL));
  for (const auto& entry : entries(globals)) set_global(entry.first, entry.second);
}

QuickJsCodeSession::~QuickJsCodeSession() {
  if (context_) JS_FreeContext(context_);
  if (runtime_) JS_FreeRuntime(runtime_);
}

Value QuickJsCodeSession::execute(Value code, Value) {
  if (closed_) return RuntimeEnvelope::session_closed("session closed");
  std::string source = str(code);
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
  for (const auto& entry : entries(bindings)) set_global(entry.first, entry.second);
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

int main() {
  ax::runtime::quickjs::QuickJsCodeRuntime runtime;
  auto qa = ax::agent("question:string -> answer:string", ax::object({{"runtime", ax::object({{"language", "JavaScript"}})}}));
  ax::Value out = qa.test(runtime, "answer = inputs.question; final({answer})", ax::object({{"question", "quickjs"}}));
  if (!ax::equal(ax::Core::get(out, "kind"), "final")) return 1;
  ax::Value payload = ax::Core::get(out, "completion_payload", ax::Value::object());
  ax::Value args = ax::Core::get(payload, "args", ax::Value::array());
  if (!ax::equal(ax::Core::get(ax::Core::get(args, 0), "answer"), "quickjs")) return 2;
  std::cout << "cpp-javascript-quickjs-profile-ok\n";
}
`

const cppQuickJSProfileReadme = `# JavaScript QuickJS Runtime Profile

This optional profile compiles only when QuickJS headers and libraries are supplied.

Example verification:

` + "```bash" + `
AXIR_QUICKJS_CFLAGS="-I/path/to/quickjs" \
AXIR_QUICKJS_LDFLAGS="/path/to/libquickjs.a -lm -ldl -pthread" \
go run . verify --targets cpp --runtime-profiles javascript-quickjs ../../ir/axcore/root.axir
` + "```" + `
`
