package dev.axllm.ax.runtime.quickjs;

import dev.axllm.ax.AxCodeSession;
import dev.axllm.ax.Json;
import io.roastedroot.quickjs4j.core.Builtins;
import io.roastedroot.quickjs4j.core.Engine;
import io.roastedroot.quickjs4j.core.GuestFunction;
import io.roastedroot.quickjs4j.core.HostFunction;
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
  private final Map<String, AxQuickJsHostCallable> hostCallables = new LinkedHashMap<>();
  private final Map<String, Object> runtimePolicy;
  private final int timeoutMs;
  private boolean closed = false;

  AxQuickJsCodeSession(Map<String, Object> globals, Map<String, Object> options, Map<String, AxQuickJsHostCallable> hostCallables) {
    if (hostCallables != null) this.hostCallables.putAll(hostCallables);
    this.runtimePolicy = AxQuickJsCodeRuntime.mergePolicy(Map.of(), options.get("runtimePolicy"));
    Object reservedNames = options.get("reservedNames");
    if (reservedNames instanceof Iterable<?> items) {
      for (Object item : items) reserved.put(String.valueOf(item), true);
    }
    for (Map.Entry<String, Object> entry : globals.entrySet()) {
      bindings.put(entry.getKey(), entry.getValue());
      if (isHostCallable(entry.getValue())) reserved.put(entry.getKey(), true);
    }
    for (String name : this.hostCallables.keySet()) {
      reserved.put(name, true);
      bindings.putIfAbsent(name, Map.of("__ax_host_callable", true, "native", true));
    }
    this.timeoutMs = intOption(options.get("timeoutMs"), intOption(runtimePolicy.get("timeoutMs"), 5000));
  }

  public Object execute(String code, Map<String, Object> options) {
    if (closed) return Map.of("kind", "error", "is_error", true, "error_category", "session_closed", "error", "session closed");
    try {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("code", code == null ? "" : code);
      payload.put("bindings", new LinkedHashMap<>(bindings));
      payload.put("reserved", reserved.keySet().stream().toList());
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
      return Map.of("kind", "error", "is_error", true, "error_category", errorCategory(ex), "error", ex.getMessage());
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
    int maxBytes = intOption(runtimePolicy.get("maxSnapshotBytes"), 262144);
    if (Json.stringify(out).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > maxBytes) {
      Map<String, Object> trimmed = new LinkedHashMap<>();
      for (Map.Entry<String, Object> entry : out.entrySet()) {
        trimmed.put(entry.getKey(), entry.getValue());
        if (Json.stringify(trimmed).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > maxBytes) {
          trimmed.remove(entry.getKey());
          trimmed.put("__ax_snapshot_truncated", true);
          return trimmed;
        }
      }
    }
    return out;
  }

  private static int intOption(Object value, int fallback) {
    if (value instanceof Number n) return Math.max(1, n.intValue());
    if (value instanceof String s) {
      try { return Math.max(1, Integer.parseInt(s)); } catch (NumberFormatException ignored) {}
    }
    return fallback;
  }

  private static boolean isHostCallable(Object value) {
    if (!(value instanceof Map<?, ?> map)) return false;
    return Boolean.TRUE.equals(map.get("__ax_host_callable"));
  }

  private static String errorCategory(Exception ex) {
    String text = String.valueOf(ex.getMessage()).toLowerCase();
    if (text.contains("timeout") || text.contains("timed out") || text.contains("interrupted")) return "timeout";
    return "runtime";
  }

  private String callHost(String name, String paramsJson) {
    AxQuickJsHostCallable handler = hostCallables.get(name);
    if (handler == null) {
      return Json.stringify(Map.of("ok", false, "category", "runtime", "error", "unknown QuickJS host callable: " + name));
    }
    try {
      Object params = paramsJson == null || paramsJson.isBlank() ? null : Json.parse(paramsJson);
      Object result = handler.call(params);
      return Json.stringify(Map.of("ok", true, "result", result == null ? Map.of() : result));
    } catch (Exception ex) {
      return Json.stringify(Map.of("ok", false, "category", errorCategory(ex), "error", ex.getMessage() == null ? "QuickJS host callable failed" : ex.getMessage()));
    }
  }

  private String runQuickJs(String payloadJson, int timeoutMs) throws Exception {
    Builtins hostBuiltins = Builtins.builder("axir_host")
      .add(new HostFunction("__ax_host_call", List.of(String.class, String.class), String.class, args -> callHost(String.valueOf(args.get(0)), String.valueOf(args.get(1)))))
      .build();
    Engine engine = Engine.builder().addInvokables(INVOKABLES).addBuiltins(hostBuiltins).build();
    try (Runner runner = Runner.builder().withEngine(engine).withTimeoutMs(timeoutMs).build()) {
      Object raw = runner.invokeGuestFunction("axir", "__ax_run", List.of(payloadJson), QUICKJS_SOURCE);
      return String.valueOf(raw);
    }
  }

  private static final String QUICKJS_SOURCE = """
// Persistence: top-level const/let/var declared this turn are block-scoped to the async
// wrapper and would vanish next turn, but the RLM prompt promises a long-running REPL.
// Extract the declared names so they can be assigned onto globalThis (which persists),
// mirroring the TS runtime. Fail-open.
function axPersistSuffix(src){try{var n=[],s={},re=/(?:^|[\\n;{}])\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,m;while((m=re.exec(src))){if(!s[m[1]]){s[m[1]]=1;n.push(m[1]);}}return n.map(function(x){return 'try{globalThis['+JSON.stringify(x)+']='+x+';}catch(__e){}';}).join('');}catch(__e){return '';}}
async function __ax_run(payloadJson) {
  const payload = JSON.parse(payloadJson || "{}");
  const reserved = new Set([
    "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
    "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
    "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
    "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
    "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
    "console", "Javy", "plugin", "main", "quickjs4j_engine", "axir", "axir_host",
    "final", "respond", "askClarification", "discover", "recall", "used", "reportSuccess",
    "reportFailure", "guideAgent"
  ]);
  function isHostCallable(value) {
    return value && typeof value === "object" && value.__ax_host_callable === true;
  }
  function cloneJson(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
  }
  function makeHostCallable(name, spec) {
    return function(params) {
      if (spec.native === true) {
        const response = JSON.parse(axir_host.__ax_host_call(name, JSON.stringify(params === undefined ? null : params)));
        if (response.ok) return response.result;
        return {
          kind: "error",
          is_error: true,
          error_category: String(response.category || "runtime"),
          error: String(response.error || ("host callable failed: " + name))
        };
      }
      if (spec.error) {
        return {
          kind: "error",
          is_error: true,
          error_category: String(spec.error.category || "runtime"),
          error: String(spec.error.message || spec.error.error || ("host callable failed: " + name))
        };
      }
      if (Object.prototype.hasOwnProperty.call(spec, "result")) return cloneJson(spec.result);
      return {kind: "result", result: null};
    };
  }
  for (const [key, value] of Object.entries(payload.bindings || {})) {
    if (!key.startsWith("__ax_") && (!reserved.has(key) || isHostCallable(value))) {
      globalThis[key] = isHostCallable(value) ? makeHostCallable(key, value) : value;
    }
  }
  function complete(value) { globalThis.__ax_completion = value; return value; }
  globalThis.final = function() { return complete({type: "final", args: Array.from(arguments)}); };
  globalThis.respond = function() { return complete({type: "respond", args: Array.from(arguments)}); };
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
    // RLM actor code uses top-level await (`await final(...)`), illegal in a plain Function
    // body; compile it as an async function so await is legal, and await it so the whole body
    // runs to completion. Without the await a synchronous `throw` becomes an unhandled rejected
    // promise that the surrounding try/catch never sees, silently dropping error_category;
    // awaiting surfaces both synchronous throws and post-await rejections as runtime errors
    // here. quickjs4j resolves this guest function's returned promise before handing the result
    // back to the host, mirroring the libquickjs/py-quickjs engines that drain the job queue.
    await (async function(){}).constructor("with (globalThis) { " + (payload.code || "") + "\\n" + axPersistSuffix(payload.code || "") + "\\n}")();
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
