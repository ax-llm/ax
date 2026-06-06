package axir

const pyJavaScriptQuickJSProfilePythonExample = `import os

from axllm import ProcessCodeRuntime, agent


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        if not self.responses:
            raise RuntimeError("fake client exhausted")
        return self.responses.pop(0)

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

    forward_agent = agent(
        "question:string -> answer:string",
        {
            "runtime": {"language": "JavaScript"},
            "functionDiscovery": True,
            "memoriesMode": True,
            "functions": [{"name": "search", "description": "Search docs"}],
            "memory_search_results": {
                "prefs": [{"id": "mem1", "content": "likes concise docs"}]
            },
        },
    )
    forward_client = FakeClient(
        [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Run actor\",{}]}}"},
            {"content": "{\"javascriptCode\":\"counter = 41; discover({tools:['search']})\"}"},
            {"content": "{\"javascriptCode\":\"recall('prefs')\"}"},
            {
                "content": "{\"javascriptCode\":\"const hit = search({query: inputs.question}); final('Answer', {answer: hit.title})\"}"
            },
            {"content": "{\"answer\":\"Docs\"}"},
        ]
    )
    forward_out = forward_agent.forward(
        forward_client,
        {"question": "quickjs"},
        {"runtime": runtime, "max_actor_steps": 4},
    )
    assert forward_out["answer"] == "Docs", forward_out
    assert len(forward_client.requests) == 5, forward_client.requests
    action_log_text = str(forward_agent.get_action_log())
    assert "discover" in action_log_text and "recall" in action_log_text and "Docs" in action_log_text, action_log_text
    state_text = str(forward_agent.export_runtime_state())
    assert "likes concise docs" in state_text, state_text
    trace_kinds = [event.get("kind") for event in forward_agent.export_trace().get("events", [])]
    for kind in ["runtime_execute", "discover", "recall", "final"]:
        assert kind in trace_kinds, trace_kinds
    restored_agent = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    restored_agent.restore_runtime_state(forward_agent.export_runtime_state())
    assert "likes concise docs" in str(restored_agent.export_runtime_state()), restored_agent.export_runtime_state()

    guide_agent = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    guide_client = FakeClient(
        [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Guide\",{}]}}"},
            {"content": "{\"javascriptCode\":\"guideAgent('Prefer concise final.')\"}"},
            {"content": "{\"javascriptCode\":\"final('Answer', {answer: 'Concise'})\"}"},
            {"content": "{\"answer\":\"Concise\"}"},
        ]
    )
    guide_out = guide_agent.forward(
        guide_client,
        {"question": "quickjs"},
        {"runtime": runtime, "max_actor_steps": 3},
    )
    assert guide_out["answer"] == "Concise", guide_out
    guide_text = str(guide_agent.get_action_log()) + str(guide_agent.export_trace()) + str(guide_client.requests)
    assert "guide_agent" in guide_text and "Prefer concise final." in guide_text, guide_text

    clarification_agent = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    clarification_client = FakeClient(
        [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Ask\",{}]}}"},
            {"content": "{\"javascriptCode\":\"askClarification('Need detail?')\"}"},
        ]
    )
    try:
        clarification_agent.forward(
            clarification_client,
            {"question": "quickjs"},
            {"runtime": runtime, "max_actor_steps": 1},
        )
    except Exception as exc:
        assert "Need detail" in str(exc), exc
    else:
        raise AssertionError("expected runtime clarification")

    session = runtime.create_session(
        {
            "inputs": {"question": "quickjs"},
            "search": {"__ax_host_callable": True, "native": True},
            "badTool": {"__ax_host_callable": True, "native": True},
        },
        {"reservedNames": ["inputs"]},
    )
    try:
        step1 = session.execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})")
        step2 = session.execute("counter = counter + 1; final({counter})")
        assert step1["type"] == "final", step1
        assert step2["args"][0]["counter"] == 2, step2
        assert session.execute("askClarification('more?')")["type"] == "askClarification"
        assert session.execute("discover({tools:['search']})")["kind"] == "discover"
        assert session.execute("recall({query:'docs'})")["kind"] == "recall"
        assert session.execute("used('mem1', 'helpful')")["kind"] == "used"
        assert session.execute("reportSuccess('ok')")["kind"] == "status"
        assert session.execute("reportFailure('bad')")["kind"] == "status"
        assert session.execute("guideAgent('try this')")["type"] == "guide_agent"
        bridged = session.execute("const hit = search({query: inputs.question}); final({title: hit.title})")
        assert bridged["type"] == "final", bridged
        assert bridged["args"][0]["title"] == "Docs", bridged
        failed = session.execute("final({error: badTool({}).error})")
        assert failed["args"][0]["error"] == "tool failed", failed
        snapshot = session.snapshot_globals()
        assert "inputs" not in snapshot["bindings"], snapshot
        session.patch_globals({"bindings": {"safe": 9}})
        assert session.inspect_globals()["safe"] == 9
        assert session.execute("throw new Error('boom')")["error_category"] == "runtime"
    finally:
        session.close()
    closed = session.execute("final({})")
    assert closed["error_category"] == "session_closed", closed
finally:
    runtime.shutdown()

print("python-javascript-quickjs-profile-ok runtime-behavior-parity-ok")
`

const javaQuickJSCodeRuntime = `package dev.axllm.ax.runtime.quickjs;

import dev.axllm.ax.AxCodeRuntime;
import dev.axllm.ax.AxCodeSession;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxQuickJsCodeRuntime implements AxCodeRuntime, AutoCloseable {
  private final Map<String, AxQuickJsHostCallable> hostCallables = new LinkedHashMap<>();
  private final Map<String, Object> runtimePolicy;

  public AxQuickJsCodeRuntime() {
    this(Map.of());
  }

  public AxQuickJsCodeRuntime(Map<String, Object> runtimePolicy) {
    this.runtimePolicy = defaultPolicy(runtimePolicy == null ? Map.of() : runtimePolicy);
  }

  public String getUsageInstructions() {
    return "JavaScript QuickJS runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), and reportFailure(...). Filesystem, network, and native host APIs are not exposed by default.";
  }

  public Map<String, Object> getRuntimePolicy() {
    return new LinkedHashMap<>(runtimePolicy);
  }

  public AxQuickJsCodeRuntime registerCallable(String name, AxQuickJsHostCallable handler) {
    if (name == null || name.isBlank()) throw new IllegalArgumentException("QuickJS host callable name is required");
    if (handler == null) throw new IllegalArgumentException("QuickJS host callable handler is required");
    hostCallables.put(name, handler);
    return this;
  }

  public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
    Map<String, Object> mergedOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    mergedOptions.put("runtimePolicy", mergePolicy(runtimePolicy, mergedOptions.get("runtimePolicy")));
    return new AxQuickJsCodeSession(globals == null ? Map.of() : globals, mergedOptions, hostCallables);
  }

  public void close() {}

  private static Map<String, Object> defaultPolicy(Map<String, Object> overrides) {
    Map<String, Object> policy = new LinkedHashMap<>();
    policy.put("allowFilesystem", false);
    policy.put("allowNetwork", false);
    policy.put("allowProcess", false);
    policy.put("allowNativeHostAccess", false);
    policy.put("maxSnapshotBytes", 262144);
    policy.put("timeoutMs", 5000);
    policy.putAll(overrides);
    return policy;
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> mergePolicy(Map<String, Object> base, Object override) {
    Map<String, Object> policy = defaultPolicy(base == null ? Map.of() : base);
    if (override instanceof Map<?, ?> raw) {
      for (Map.Entry<?, ?> entry : raw.entrySet()) policy.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return policy;
  }
}
`

const javaQuickJSHostCallable = `package dev.axllm.ax.runtime.quickjs;

@FunctionalInterface
public interface AxQuickJsHostCallable {
  Object call(Object params) throws Exception;
}
`

const javaQuickJSCodeSession = `package dev.axllm.ax.runtime.quickjs;

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
function __ax_run(payloadJson) {
  const payload = JSON.parse(payloadJson || "{}");
  const reserved = new Set([
    "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
    "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
    "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
    "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
    "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
    "console", "Javy", "plugin", "main", "quickjs4j_engine", "axir", "axir_host",
    "final", "askClarification", "discover", "recall", "used", "reportSuccess",
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

const javaQuickJSProtocolServer = `package dev.axllm.ax.runtime.quickjs;

import dev.axllm.ax.AxCodeSession;
import dev.axllm.ax.Json;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxQuickJsProtocolServer {
  private final AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()
    .registerCallable("search", params -> Map.of("title", "Docs", "query", Json.asObject(params).getOrDefault("query", "")))
    .registerCallable("badTool", params -> { throw new RuntimeException("tool failed"); });
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
    try (AxQuickJsCodeRuntime rt = new AxQuickJsCodeRuntime()
        .registerCallable("search", params -> Map.of("title", "Docs"))
        .registerCallable("badTool", params -> { throw new RuntimeException("tool failed"); })) {
      if (!Boolean.FALSE.equals(rt.getRuntimePolicy().get("allowFilesystem")) || !Boolean.FALSE.equals(rt.getRuntimePolicy().get("allowNetwork"))) {
        throw new RuntimeException("QuickJS protocol runtime policy must default-deny filesystem/network access");
      }
      AxCodeSession session = rt.createSession(Map.of("inputs", Map.of("question", "quickjs")), Map.of("reservedNames", java.util.List.of("inputs")));
      Object result = session.execute("answer = inputs.question; final({answer})", Map.of());
      Map<String, Object> out = Json.asObject(result);
      if (!"final".equals(out.get("type"))) throw new RuntimeException("bad final result: " + result);
      Map<String, Object> step1 = Json.asObject(session.execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})", Map.of()));
      Map<String, Object> step2 = Json.asObject(session.execute("counter = counter + 1; final({counter})", Map.of()));
      if (!"final".equals(step1.get("type")) || !"final".equals(step2.get("type"))) throw new RuntimeException("bad persistent state: " + step2);
      if (!"askClarification".equals(Json.asObject(session.execute("askClarification('more?')", Map.of())).get("type"))) throw new RuntimeException("askClarification failed");
      if (!"discover".equals(Json.asObject(session.execute("discover({tools:['search']})", Map.of())).get("kind"))) throw new RuntimeException("discover failed");
      if (!"recall".equals(Json.asObject(session.execute("recall({query:'docs'})", Map.of())).get("kind"))) throw new RuntimeException("recall failed");
      if (!"used".equals(Json.asObject(session.execute("used('mem1', 'helpful')", Map.of())).get("kind"))) throw new RuntimeException("used failed");
      if (!"status".equals(Json.asObject(session.execute("reportSuccess('ok')", Map.of())).get("kind"))) throw new RuntimeException("status failed");
      if (!"guide_agent".equals(Json.asObject(session.execute("guideAgent('try this')", Map.of())).get("type"))) throw new RuntimeException("guideAgent failed");
      Map<String, Object> bridged = Json.asObject(session.execute("const hit = search({query: inputs.question}); final({title: hit.title})", Map.of()));
      if (!"Docs".equals(Json.asObject(((java.util.List<?>) bridged.get("args")).get(0)).get("title"))) throw new RuntimeException("bad host callable result: " + bridged);
      Map<String, Object> failedCall = Json.asObject(session.execute("final({error: badTool({}).error})", Map.of()));
      if (!"tool failed".equals(Json.asObject(((java.util.List<?>) failedCall.get("args")).get(0)).get("error"))) throw new RuntimeException("bad host callable error: " + failedCall);
      Map<String, Object> ambient = Json.asObject(session.execute("final({fetchType: typeof fetch, requireType: typeof require, processType: typeof process})", Map.of()));
      Map<String, Object> ambientPayload = Json.asObject(((java.util.List<?>) ambient.get("args")).get(0));
      if (!"undefined".equals(ambientPayload.get("fetchType")) || !"undefined".equals(ambientPayload.get("requireType")) || !"undefined".equals(ambientPayload.get("processType"))) {
        throw new RuntimeException("ambient host APIs should be absent by default: " + ambient);
      }
      Map<String, Object> snapshot = Json.asObject(session.snapshotGlobals(Map.of()));
      if (Json.asObject(snapshot.get("bindings")).containsKey("inputs")) throw new RuntimeException("reserved input leaked into snapshot: " + snapshot);
      session.patchGlobals(Map.of("bindings", Map.of("safe", 9)), Map.of());
      if (!Json.asObject(session.inspectGlobals(Map.of())).containsKey("safe")) throw new RuntimeException("patch/inspect failed");
      session.close();
      if (!"session_closed".equals(Json.asObject(session.execute("final({})", Map.of())).get("error_category"))) throw new RuntimeException("closed session behavior failed");
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
          "abort", false,
          "runtime_policy", runtime.getRuntimePolicy(),
          "policy_support", Map.of(
            "filesystem", false,
            "network", false,
            "process", false,
            "nativeHostAccess", "explicit-callables-only",
            "maxSnapshotBytes", true,
            "timeoutMs", "engine-supported",
            "memoryLimitBytes", false
          )
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

const javaJavaScriptQuickJSProfileExample = `import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class JavaScriptQuickJsExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  static final class ScriptedAI implements AiClient {
    final List<Map<String, Object>> responses = new ArrayList<>();
    final List<Map<String, Object>> requests = new ArrayList<>();

    ScriptedAI(List<Map<String, Object>> responses) {
      this.responses.addAll(responses);
    }

    public Map<String, Object> complete(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("fake client exhausted");
      return responses.remove(0);
    }
  }

  public static void main(String[] args) {
    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()
        .registerCallable("search", params -> Map.of("title", "Docs", "query", asMap(params).getOrDefault("query", "")))
        .registerCallable("badTool", params -> { throw new RuntimeException("tool failed"); })) {
      Map<String, Object> policy = runtime.getRuntimePolicy();
      if (!Boolean.FALSE.equals(policy.get("allowFilesystem")) || !Boolean.FALSE.equals(policy.get("allowNetwork"))) {
        throw new RuntimeException("QuickJS runtime policy must default-deny filesystem/network access: " + policy);
      }

      AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      Map<String, Object> out = qa.test(runtime, "answer = inputs.question; final({answer})", Map.of("question", "quickjs"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad output: " + out);
      Map<String, Object> payload = asMap(out.get("completion_payload"));
      Map<String, Object> first = asMap(((List<?>) payload.get("args")).get(0));
      if (!"quickjs".equals(first.get("answer"))) throw new RuntimeException("bad payload: " + out);

      AxAgent forwardAgent = Ax.agent("question:string -> answer:string", Map.of(
        "runtime", Map.of("language", "JavaScript"),
        "functionDiscovery", true,
        "memoriesMode", true,
        "memory_search_results", Map.of("prefs", List.of(Map.of("id", "mem1", "content", "likes concise docs"))),
        "functions", List.of(Map.of("name", "search", "description", "Search docs"))
      ));
      ScriptedAI forwardClient = new ScriptedAI(List.of(
        Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Run actor\",{}]}}"),
        Map.of("content", "{\"javascriptCode\":\"counter = 41; discover({tools:['search']})\"}"),
        Map.of("content", "{\"javascriptCode\":\"recall('prefs')\"}"),
        Map.of("content", "{\"javascriptCode\":\"const hit = search({query: inputs.question}); final('Answer', {answer: hit.title})\"}"),
        Map.of("content", "{\"answer\":\"Docs\"}")
      ));
      Map<String, Object> forwardOut = forwardAgent.forward(
        forwardClient,
        Map.of("question", "quickjs"),
        Map.of("runtime", runtime, "max_actor_steps", 4)
      );
      if (!"Docs".equals(forwardOut.get("answer"))) throw new RuntimeException("bad forward output: " + forwardOut);
      String actionLogText = String.valueOf(forwardAgent.getActionLog());
      if (!actionLogText.contains("discover") || !actionLogText.contains("recall") || !actionLogText.contains("Docs")) {
        throw new RuntimeException("runtime actor loop did not record expected actions: " + actionLogText);
      }
      String forwardState = String.valueOf(forwardAgent.exportRuntimeState());
      if (!forwardState.contains("likes concise docs")) throw new RuntimeException("runtime actor loop did not preserve recalled memory: " + forwardState);
      String forwardTrace = String.valueOf(forwardAgent.exportTrace());
      for (String kind : List.of("runtime_execute", "discover", "recall", "final")) {
        if (!forwardTrace.contains(kind)) throw new RuntimeException("runtime actor trace missing " + kind + ": " + forwardTrace);
      }
      AxAgent restoredAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      restoredAgent.restoreRuntimeState(forwardAgent.exportRuntimeState());
      if (!String.valueOf(restoredAgent.exportRuntimeState()).contains("likes concise docs")) throw new RuntimeException("state restore lost recalled memory");

      AxAgent guideAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      ScriptedAI guideClient = new ScriptedAI(List.of(
        Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Guide\",{}]}}"),
        Map.of("content", "{\"javascriptCode\":\"guideAgent('Prefer concise final.')\"}"),
        Map.of("content", "{\"javascriptCode\":\"final('Answer', {answer: 'Concise'})\"}"),
        Map.of("content", "{\"answer\":\"Concise\"}")
      ));
      Map<String, Object> guideOut = guideAgent.forward(
        guideClient,
        Map.of("question", "quickjs"),
        Map.of("runtime", runtime, "max_actor_steps", 3)
      );
      if (!"Concise".equals(guideOut.get("answer"))) throw new RuntimeException("bad guide output: " + guideOut);
      String guideText = String.valueOf(guideAgent.getActionLog()) + String.valueOf(guideAgent.exportTrace()) + String.valueOf(guideClient.requests);
      if (!guideText.contains("guide_agent") || !guideText.contains("Prefer concise final.")) throw new RuntimeException("guideAgent parity failed: " + guideText);

      AxAgent clarificationAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      ScriptedAI clarificationClient = new ScriptedAI(List.of(
        Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Ask\",{}]}}"),
        Map.of("content", "{\"javascriptCode\":\"askClarification('Need detail?')\"}")
      ));
      try {
        clarificationAgent.forward(
          clarificationClient,
          Map.of("question", "quickjs"),
          Map.of("runtime", runtime, "max_actor_steps", 1)
        );
        throw new RuntimeException("expected runtime clarification");
      } catch (AxAgentClarificationException expected) {
        if (!String.valueOf(expected.getMessage()).contains("Need detail")) throw expected;
      }

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
      AxCodeSession hostSession = runtime.createSession(
        Map.of("inputs", Map.of("question", "quickjs")),
        Map.of("reservedNames", List.of("inputs"))
      );
      Map<String, Object> bridged = asMap(hostSession.execute("const hit = search({query: inputs.question}); final({title: hit.title})", Map.of()));
      if (!"Docs".equals(asMap(((List<?>) bridged.get("args")).get(0)).get("title"))) throw new RuntimeException("host callable bridge failed: " + bridged);
      Map<String, Object> failedCall = asMap(hostSession.execute("final({error: badTool({}).error})", Map.of()));
      if (!"tool failed".equals(asMap(((List<?>) failedCall.get("args")).get(0)).get("error"))) throw new RuntimeException("host callable error bridge failed: " + failedCall);
      hostSession.close();
      Map<String, Object> ambient = asMap(session.execute("final({fetchType: typeof fetch, requireType: typeof require, processType: typeof process})", Map.of()));
      Map<String, Object> ambientPayload = asMap(((List<?>) ambient.get("args")).get(0));
      if (!"undefined".equals(ambientPayload.get("fetchType")) || !"undefined".equals(ambientPayload.get("requireType")) || !"undefined".equals(ambientPayload.get("processType"))) {
        throw new RuntimeException("ambient host APIs should be absent by default: " + ambient);
      }
      AxCodeSession cappedSession = runtime.createSession(Map.of(), Map.of("runtimePolicy", Map.of("maxSnapshotBytes", 64)));
      cappedSession.execute("big = 'x'.repeat(1000); final({ok:true})", Map.of());
      Map<String, Object> cappedSnapshot = asMap(cappedSession.snapshotGlobals(Map.of()));
      if (!Boolean.TRUE.equals(asMap(cappedSnapshot.get("bindings")).get("__ax_snapshot_truncated"))) {
        throw new RuntimeException("snapshot cap did not mark truncation: " + cappedSnapshot);
      }
      cappedSession.close();
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
    System.out.println("java-javascript-quickjs-profile-ok runtime-behavior-parity-ok");
  }
}
`

const javaQuickJSProfilePom = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.axllm.ax.generated</groupId>
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

const javaQuickJSProfileGradle = `plugins {
  id 'java'
}

repositories {
  mavenCentral()
}

dependencies {
  implementation 'io.roastedroot:quickjs4j:0.0.18'
}
`

const javaQuickJSClasspathHelper = `#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
POM_FILE="${1:-"$SCRIPT_DIR/quickjs4j-pom.xml"}"
WORK_DIR="${AXIR_QUICKJS4J_WORKDIR:-"${TMPDIR:-/tmp}/axir-quickjs4j-cp"}"
OUT_FILE="$WORK_DIR/classpath.txt"
M2_REPO="${AXIR_QUICKJS4J_M2_REPO:-"$WORK_DIR/m2"}"

mkdir -p "$WORK_DIR"
mvn -q -f "$POM_FILE" dependency:build-classpath -Dmaven.repo.local="$M2_REPO" -Dmdep.outputFile="$OUT_FILE" -Dmdep.includeScope=runtime
cat "$OUT_FILE"
`

const quickJSRuntimePolicyJSON = `{
  "allowFilesystem": false,
  "allowNetwork": false,
  "allowProcess": false,
  "allowNativeHostAccess": false,
  "timeoutMs": 5000,
  "maxSnapshotBytes": 262144,
  "memoryLimitBytes": 33554432
}
`

const javaQuickJSProfileReadme = `# JavaScript QuickJS Runtime Profile

This optional profile is a Java adapter for the AxAgent RLM actor-code REPL.
The agent's executor loop sends one actor-code step at a time into an
` + "`AxCodeRuntime`" + ` session, observes envelopes such as ` + "`final(...)`" + `,
` + "`discover(...)`" + `, and ` + "`recall(...)`" + `, then continues from the result.

It runs JavaScript actor code in QuickJS4J. It is not a TypeScript transpiler,
not a way to run your original Ax TypeScript application in Java, and not part
of the base generated Java compile path. Compile it only when you want the
` + "`javascript-quickjs`" + ` runtime profile for RLM agent sessions.

QuickJS4J dependency metadata is provided in both ` + "`quickjs4j-pom.xml`" + ` and
` + "`quickjs4j-build.gradle`" + `. To resolve the classpath with Maven:

` + "```bash" + `
AXIR_QUICKJS4J_WORKDIR=/private/tmp/axir-quickjs4j-cp \
AXIR_QUICKJS4J_CP="$(sh examples/runtime_profiles/resolve_quickjs4j_cp.sh)"
` + "```" + `

` + "`axir verify --runtime-profiles javascript-quickjs`" + ` also accepts
` + "`AXIR_QUICKJS4J_CP_FILE`" + `, or ` + "`AXIR_QUICKJS4J_RESOLVE=1`" + ` to run the same
generated Maven helper during verification. The helper keeps Maven's local
repository under ` + "`AXIR_QUICKJS4J_WORKDIR`" + ` by default; set
` + "`AXIR_QUICKJS4J_M2_REPO`" + ` to override it.

Python profile verification can point ` + "`AXIR_QUICKJS_RUNTIME_SERVER`" + ` at
` + "`java -cp ... dev.axllm.ax.runtime.quickjs.AxQuickJsProtocolServer`" + ` explicitly. When
that variable is not set, ` + "`axir verify --runtime-profiles javascript-quickjs`" + `
auto-compiles and runs this generated Java protocol server whenever the
QuickJS4J classpath is available.

Host callbacks are registered with ` + "`AxQuickJsCodeRuntime.registerCallable`" + ` and
are exposed to actor JavaScript as ordinary functions. Arguments and results must
be JSON-compatible. Callback failures are normalized to runtime error objects;
filesystem, network, process, and arbitrary host object access are not exposed by
default.

Runtime productization policy is explicit and deny-by-default. Java accepts a
JSON-compatible ` + "`runtimePolicy`" + ` map in ` + "`AxQuickJsCodeRuntime`" + ` and per-session
options. C++ accepts the same policy object in ` + "`QuickJsCodeRuntime`" + `. The
generated ` + "`quickjs-runtime-policy.json`" + ` shows the supported keys. Java reports
` + "`memoryLimitBytes`" + ` as unsupported capability metadata because QuickJS4J does not
expose that limit through the profile surface; C++ applies it through the
QuickJS C API.

Profile examples check the same observable runtime/session contract as the
TypeScript ` + "`AxJSRuntime`" + ` reference: actor primitive envelopes, host-call
success/failure, persistent bindings, reserved-name-safe snapshots,
inspect/snapshot/patch, runtime errors, and session-closed normalization.
`

const cppQuickJSRuntimeHeader = `#pragma once

#include "axllm/axllm.hpp"

extern "C" {
#include <quickjs.h>
}

namespace axllm::runtime::quickjs {

using HostCallable = std::function<Value(Value)>;

class QuickJsCodeSession : public AxCodeSession {
 public:
  QuickJsCodeSession(Value globals, Value options, Value runtime_policy, std::map<std::string, HostCallable> host_callables);
  ~QuickJsCodeSession() override;

  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value close() override;
  std::string call_host_json(const std::string& name, const std::string& params_json);

 private:
  JSRuntime* runtime_;
  JSContext* context_;
  bool closed_ = false;
  Value reserved_;
  Value runtime_policy_;
  std::map<std::string, HostCallable> host_callables_;

  Value eval_json(const std::string& source);
  void set_global(const std::string& name, const Value& value);
};

class QuickJsCodeRuntime : public AxCodeRuntime {
 public:
  explicit QuickJsCodeRuntime(Value runtime_policy = Value::object());
  QuickJsCodeRuntime& register_callable(std::string name, HostCallable handler);
  std::string usage_instructions() const override;
  AxCodeSession* create_session(Value globals, Value options = Value::object()) override;
  Value runtime_policy() const;

 private:
  Value runtime_policy_;
  std::map<std::string, HostCallable> host_callables_;
};

}  // namespace axllm::runtime::quickjs
`

const cppQuickJSRuntimeSource = `#include "axllm/runtime/quickjs/quickjs_runtime.hpp"

#include <chrono>
#include <cstring>
#include <vector>

namespace axllm::runtime::quickjs {

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

static bool is_host_callable(Value value) {
  return value.is_object() && Core::truthy(Core::get(value, "__ax_host_callable", Value(false)));
}

static int int_option(Value options, const std::string& key, int fallback) {
  Value value = Core::get(options, key);
  if (value.is_null()) return fallback;
  try {
    int parsed = static_cast<int>(std::stod(display(value)));
    return parsed < 1 ? 1 : parsed;
  } catch (...) {
    return fallback;
  }
}

static Value default_runtime_policy(Value overrides = Value::object()) {
  Value policy = object({
      {"allowFilesystem", false},
      {"allowNetwork", false},
      {"allowProcess", false},
      {"allowNativeHostAccess", false},
      {"maxSnapshotBytes", 262144},
      {"memoryLimitBytes", 32 * 1024 * 1024},
      {"timeoutMs", 5000},
  });
  for (const auto& entry : value_entries(overrides)) {
    Core::set(policy, entry.first, entry.second);
  }
  return policy;
}

static Value merge_runtime_policy(Value base, Value options) {
  Value policy = default_runtime_policy(std::move(base));
  Value overrides = Core::get(options, "runtimePolicy", Value::object());
  for (const auto& entry : value_entries(overrides)) {
    Core::set(policy, entry.first, entry.second);
  }
  return policy;
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
function __ax_complete(value) { globalThis.__ax_completion = value; return value; }
function __ax_clone_json(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
function __ax_make_host_callable(name, spec) {
  return function(params) {
    if (spec && spec.native === true) {
      const response = JSON.parse(globalThis.__ax_host_call(name, JSON.stringify(params === undefined ? null : params)));
      if (response.ok) return response.result;
      return {
        kind: "error",
        is_error: true,
        error_category: String(response.category || "runtime"),
        error: String(response.error || ("host callable failed: " + name))
      };
    }
    if (spec && spec.error) {
      return {
        kind: "error",
        is_error: true,
        error_category: String(spec.error.category || "runtime"),
        error: String(spec.error.message || spec.error.error || ("host callable failed: " + name))
      };
    }
    if (spec && Object.prototype.hasOwnProperty.call(spec, "result")) return __ax_clone_json(spec.result);
    return { kind: "result", result: null };
  };
}
function __ax_install_host_callables() {
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    const value = globalThis[key];
    if (value && typeof value === "object" && value.__ax_host_callable === true) {
      globalThis[key] = __ax_make_host_callable(key, value);
    }
  }
}
function final() { return __ax_complete({ type: "final", args: Array.from(arguments) }); }
function askClarification() { return __ax_complete({ type: "askClarification", args: Array.from(arguments) }); }
function discover(request) { return __ax_complete({ kind: "discover", discover: request }); }
function recall(request) { return __ax_complete({ kind: "recall", recall: request }); }
function used(idOrRequest, reason) {
  const payload = (idOrRequest && typeof idOrRequest === "object") ? idOrRequest : { id: idOrRequest };
  if (reason !== undefined && reason !== null) payload.reason = String(reason);
  return __ax_complete({ kind: "used", used: payload });
}
function reportSuccess(message) { return __ax_complete({ kind: "status", status: { type: "success", message: String(message || "") } }); }
function reportFailure(message) { return __ax_complete({ kind: "status", status: { type: "failed", message: String(message || "") } }); }
function guideAgent(guidance) { return __ax_complete({ type: "guide_agent", guidance: String(guidance || "") }); }
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

static int quickjs_interrupt_handler(JSRuntime*, void* opaque) {
  auto* deadline = static_cast<std::chrono::steady_clock::time_point*>(opaque);
  if (deadline == nullptr) return 0;
  return std::chrono::steady_clock::now() > *deadline ? 1 : 0;
}

static JSValue quickjs_host_call(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
  auto* session = static_cast<QuickJsCodeSession*>(JS_GetContextOpaque(context));
  if (session == nullptr || argc < 2) return JS_NewString(context, "{\"ok\":false,\"category\":\"runtime\",\"error\":\"invalid QuickJS host call\"}");
  const char* raw_name = JS_ToCString(context, argv[0]);
  const char* raw_params = JS_ToCString(context, argv[1]);
  std::string name = raw_name ? raw_name : "";
  std::string params = raw_params ? raw_params : "null";
  JS_FreeCString(context, raw_name);
  JS_FreeCString(context, raw_params);
  std::string out = session->call_host_json(name, params);
  return JS_NewString(context, out.c_str());
}

QuickJsCodeSession::QuickJsCodeSession(Value globals, Value options, Value runtime_policy, std::map<std::string, HostCallable> host_callables)
    : runtime_(JS_NewRuntime()), context_(nullptr), reserved_(Core::get(options, "reservedNames", Value::array())), runtime_policy_(merge_runtime_policy(std::move(runtime_policy), options)), host_callables_(std::move(host_callables)) {
  if (!runtime_) throw AxError("runtime", "failed to create QuickJS runtime");
  JS_SetMemoryLimit(runtime_, static_cast<size_t>(int_option(runtime_policy_, "memoryLimitBytes", 32 * 1024 * 1024)));
  context_ = JS_NewContext(runtime_);
  if (!context_) throw AxError("runtime", "failed to create QuickJS context");
  JS_SetContextOpaque(context_, this);
  JSValue global = JS_GetGlobalObject(context_);
  JS_SetPropertyStr(context_, global, "__ax_host_call", JS_NewCFunction(context_, quickjs_host_call, "__ax_host_call", 2));
  JS_FreeValue(context_, global);
  JS_FreeValue(context_, JS_Eval(context_, bootstrap_source, std::strlen(bootstrap_source), "<ax-bootstrap>", JS_EVAL_TYPE_GLOBAL));
  set_global("__ax_session_reserved", reserved_);
  for (const auto& entry : value_entries(globals)) {
    if (is_host_callable(entry.second) && !contains_name(reserved_, entry.first)) Core::append(reserved_, entry.first);
    set_global(entry.first, entry.second);
  }
  for (const auto& entry : host_callables_) {
    if (!contains_name(reserved_, entry.first)) Core::append(reserved_, entry.first);
    set_global(entry.first, object({{"__ax_host_callable", true}, {"native", true}}));
  }
  set_global("__ax_session_reserved", reserved_);
  JS_FreeValue(context_, JS_Eval(context_, "__ax_install_host_callables()", std::strlen("__ax_install_host_callables()"), "<ax-host-callables>", JS_EVAL_TYPE_GLOBAL));
}

QuickJsCodeSession::~QuickJsCodeSession() {
  if (context_) JS_FreeContext(context_);
  if (runtime_) JS_FreeRuntime(runtime_);
}

Value QuickJsCodeSession::execute(Value code, Value options) {
  if (closed_) return RuntimeEnvelope::session_closed("session closed");
  std::string source = display(code);
  int timeout_ms = int_option(options, "timeoutMs", int_option(runtime_policy_, "timeoutMs", 5000));
  auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
  JS_SetInterruptHandler(runtime_, quickjs_interrupt_handler, &deadline);
  JS_FreeValue(context_, JS_Eval(context_, "globalThis.__ax_completion = undefined; __ax_install_host_callables();", std::strlen("globalThis.__ax_completion = undefined; __ax_install_host_callables();"), "<ax-before-execute>", JS_EVAL_TYPE_GLOBAL));
  JSValue result = JS_Eval(context_, source.c_str(), source.size(), "<actor>", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(result)) {
    JSValue exception = JS_GetException(context_);
    const char* text = JS_ToCString(context_, exception);
    std::string message = text ? text : "QuickJS exception";
    JS_FreeCString(context_, text);
    JS_FreeValue(context_, exception);
    JS_SetInterruptHandler(runtime_, nullptr, nullptr);
    if (std::chrono::steady_clock::now() > deadline || message.find("interrupted") != std::string::npos) {
      return RuntimeEnvelope::timeout("QuickJS execution timed out");
    }
    return RuntimeEnvelope::error(message, "runtime");
  }
  if (JS_IsUndefined(result)) {
    JS_FreeValue(context_, result);
    result = JS_Eval(context_, "globalThis.__ax_completion", std::strlen("globalThis.__ax_completion"), "<ax-completion>", JS_EVAL_TYPE_GLOBAL);
  }
  JSValue json = JS_JSONStringify(context_, result, JS_UNDEFINED, JS_UNDEFINED);
  const char* text = JS_ToCString(context_, json);
  std::string json_text = text ? text : "";
  JS_FreeCString(context_, text);
  JS_FreeValue(context_, json);
  JS_FreeValue(context_, result);
  JS_SetInterruptHandler(runtime_, nullptr, nullptr);
  if (json_text.empty() || json_text == "undefined") {
    return RuntimeEnvelope::error("QuickJS actor code did not return a JSON-compatible value", "runtime");
  }
  try {
    return parse_json(json_text);
  } catch (const std::exception& error) {
    return RuntimeEnvelope::error(std::string("malformed QuickJS actor output: ") + error.what(), "runtime");
  }
}

Value QuickJsCodeSession::inspect(Value) { return eval_json("__ax_snapshot_json()"); }

Value QuickJsCodeSession::snapshot_globals(Value) {
  Value bindings = inspect(Value::object());
  int max_bytes = int_option(runtime_policy_, "maxSnapshotBytes", 262144);
  if (static_cast<int>(stringify(bindings).size()) > max_bytes) {
    Value trimmed = Value::object();
    for (const auto& entry : value_entries(bindings)) {
      Core::set(trimmed, entry.first, entry.second);
      if (static_cast<int>(stringify(trimmed).size()) > max_bytes) {
        Core::set(trimmed, entry.first, Value());
        Core::set(trimmed, "__ax_snapshot_truncated", true);
        bindings = trimmed;
        break;
      }
    }
  }
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

std::string QuickJsCodeSession::call_host_json(const std::string& name, const std::string& params_json) {
  auto it = host_callables_.find(name);
  if (it == host_callables_.end()) {
    return stringify(object({{"ok", false}, {"category", "runtime"}, {"error", "unknown QuickJS host callable: " + name}}));
  }
  try {
    Value params = params_json.empty() ? Value() : parse_json(params_json);
    return stringify(object({{"ok", true}, {"result", it->second(params)}}));
  } catch (const AxError& error) {
    return stringify(object({{"ok", false}, {"category", error.category.empty() ? "runtime" : error.category}, {"error", std::string(error.what())}}));
  } catch (const std::exception& error) {
    return stringify(object({{"ok", false}, {"category", "runtime"}, {"error", std::string(error.what())}}));
  }
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

QuickJsCodeRuntime::QuickJsCodeRuntime(Value runtime_policy) : runtime_policy_(default_runtime_policy(std::move(runtime_policy))) {}

QuickJsCodeRuntime& QuickJsCodeRuntime::register_callable(std::string name, HostCallable handler) {
  if (name.empty()) throw AxError("runtime", "QuickJS host callable name is required");
  if (!handler) throw AxError("runtime", "QuickJS host callable handler is required");
  host_callables_[std::move(name)] = std::move(handler);
  return *this;
}

AxCodeSession* QuickJsCodeRuntime::create_session(Value globals, Value options) {
  return new QuickJsCodeSession(globals, options, runtime_policy_, host_callables_);
}

Value QuickJsCodeRuntime::runtime_policy() const { return runtime_policy_; }

}  // namespace axllm::runtime::quickjs
`

const cppJavaScriptQuickJSProfileExample = `#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <iostream>
#include <vector>

static bool is_number(const axllm::Value& value, const std::string& expected) {
  return axllm::display(value) == expected;
}

struct ProfileAIClient : axllm::AIClient {
  std::vector<axllm::Value> responses;
  std::vector<axllm::Value> requests;
  std::size_t index = 0;

  explicit ProfileAIClient(std::initializer_list<axllm::Value> values) : responses(values) {}

  axllm::Value complete(axllm::Value request) override {
    requests.push_back(request);
    if (index >= responses.size()) throw axllm::AxError("runtime", "fake client exhausted");
    return responses[index++];
  }
};

int main() {
  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  runtime
    .register_callable("search", [](axllm::Value params) {
      return axllm::object({{"title", "Docs"}, {"query", axllm::Core::get(params, "query", "")}});
    })
    .register_callable("badTool", [](axllm::Value) -> axllm::Value {
      throw axllm::AxError("runtime", "tool failed");
    });
  axllm::Value policy = runtime.runtime_policy();
  if (!axllm::equal(axllm::Core::get(policy, "allowFilesystem"), false) || !axllm::equal(axllm::Core::get(policy, "allowNetwork"), false)) return 28;

  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  axllm::Value out = qa.test(runtime, "answer = inputs.question; final({answer})", axllm::object({{"question", "quickjs"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  axllm::Value payload = axllm::Core::get(out, "completion_payload", axllm::Value::object());
  axllm::Value args = axllm::Core::get(payload, "args", axllm::Value::array());
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(args, 0), "answer"), "quickjs")) return 2;

  auto forward_agent = axllm::agent(
    "question:string -> answer:string",
    axllm::object({
      {"runtime", axllm::object({{"language", "JavaScript"}})},
      {"functionDiscovery", true},
      {"memoriesMode", true},
      {"memory_search_results", axllm::object({{"prefs", axllm::array({axllm::object({{"id", "mem1"}, {"content", "likes concise docs"}})})}})},
      {"functions", axllm::array({axllm::object({{"name", "search"}, {"description", "Search docs"}})})},
    })
  );
  ProfileAIClient forward_client({
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Run actor\",{}]}}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"counter = 41; discover({tools:['search']})\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"recall('prefs')\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"const hit = search({query: inputs.question}); final('Answer', {answer: hit.title})\"}"}}),
    axllm::object({{"content", "{\"answer\":\"Docs\"}"}}),
  });
  axllm::Value forward_out = forward_agent.forward(
    forward_client,
    axllm::object({{"question", "quickjs"}}),
    axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 4}})
  );
  if (!axllm::equal(axllm::Core::get(forward_out, "answer"), "Docs")) return 17;
  std::string action_log_text = axllm::stringify(forward_agent.get_action_log());
  if (action_log_text.find("discover") == std::string::npos || action_log_text.find("recall") == std::string::npos || action_log_text.find("Docs") == std::string::npos) return 18;
  if (axllm::stringify(forward_agent.export_runtime_state()).find("likes concise docs") == std::string::npos) return 20;
  std::string forward_trace = axllm::stringify(forward_agent.export_trace());
  for (const auto& kind : {"runtime_execute", "discover", "recall", "final"}) {
    if (forward_trace.find(kind) == std::string::npos) return 21;
  }
  auto restored_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  restored_agent.restore_runtime_state(forward_agent.export_runtime_state());
  if (axllm::stringify(restored_agent.export_runtime_state()).find("likes concise docs") == std::string::npos) return 22;

  auto guide_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  ProfileAIClient guide_client({
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Guide\",{}]}}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"guideAgent('Prefer concise final.')\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"final('Answer', {answer: 'Concise'})\"}"}}),
    axllm::object({{"content", "{\"answer\":\"Concise\"}"}}),
  });
  axllm::Value guide_out = guide_agent.forward(
    guide_client,
    axllm::object({{"question", "quickjs"}}),
    axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 3}})
  );
  if (!axllm::equal(axllm::Core::get(guide_out, "answer"), "Concise")) return 23;
  std::string guide_text = axllm::stringify(guide_agent.get_action_log()) + axllm::stringify(guide_agent.export_trace());
  if (guide_text.find("guide_agent") == std::string::npos || guide_text.find("Prefer concise final.") == std::string::npos) return 24;

  auto clarification_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  ProfileAIClient clarification_client({
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Ask\",{}]}}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"askClarification('Need detail?')\"}"}}),
  });
  bool saw_clarification = false;
  try {
    clarification_agent.forward(
      clarification_client,
      axllm::object({{"question", "quickjs"}}),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 1}})
    );
  } catch (const axllm::AxError& error) {
    saw_clarification = std::string(error.what()).find("Need detail") != std::string::npos;
  }
  if (!saw_clarification) return 19;

  axllm::AxCodeSession* session = runtime.create_session(
    axllm::object({{"inputs", axllm::object({{"question", "quickjs"}})}}),
    axllm::object({{"reservedNames", axllm::array({"inputs"})}})
  );
  axllm::Value step1 = session->execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})");
  axllm::Value step2 = session->execute("counter = counter + 1; final({counter})");
  if (!axllm::equal(axllm::Core::get(step1, "type"), "final") || !axllm::equal(axllm::Core::get(step2, "type"), "final")) return 3;
  axllm::Value step2_args = axllm::Core::get(step2, "args", axllm::Value::array());
  if (!is_number(axllm::Core::get(axllm::Core::get(step2_args, 0), "counter"), "2")) return 4;
  axllm::Value step3 = session->execute("final({answer: inputs.question, counter})");
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(step3, "args", axllm::Value::array()), 0), "answer"), "quickjs")) return 5;
  if (!axllm::equal(axllm::Core::get(session->execute("askClarification('more?')"), "type"), "askClarification")) return 6;
  if (!axllm::equal(axllm::Core::get(session->execute("discover({tools:['search']})"), "kind"), "discover")) return 7;
  if (!axllm::equal(axllm::Core::get(session->execute("recall({query:'docs'})"), "kind"), "recall")) return 8;
  if (!axllm::equal(axllm::Core::get(session->execute("used('mem1', 'helpful')"), "kind"), "used")) return 9;
  if (!axllm::equal(axllm::Core::get(session->execute("reportSuccess('ok')"), "kind"), "status")) return 10;
  axllm::AxCodeSession* host_session = runtime.create_session(
    axllm::object({{"inputs", axllm::object({{"question", "quickjs"}})}}),
    axllm::object({{"reservedNames", axllm::array({"inputs"})}})
  );
  axllm::Value bridged = host_session->execute("const hit = search({query: inputs.question}); final({title: hit.title})");
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(bridged, "args", axllm::Value::array()), 0), "title"), "Docs")) return 15;
  axllm::Value failed_call = host_session->execute("final({error: badTool({}).error})");
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(failed_call, "args", axllm::Value::array()), 0), "error"), "tool failed")) return 16;
  host_session->close();
  delete host_session;
  axllm::Value ambient = session->execute("final({fetchType: typeof fetch, requireType: typeof require, processType: typeof process})");
  axllm::Value ambient_payload = axllm::Core::get(axllm::Core::get(axllm::Core::get(ambient, "args", axllm::Value::array()), 0), "fetchType");
  if (!axllm::equal(ambient_payload, "undefined")) return 29;
  axllm::runtime::quickjs::QuickJsCodeRuntime capped_runtime(axllm::object({{"maxSnapshotBytes", 64}}));
  axllm::AxCodeSession* capped_session = capped_runtime.create_session(axllm::Value::object(), axllm::Value::object());
  capped_session->execute("big = 'x'.repeat(1000); final({ok:true})");
  axllm::Value capped_snapshot = capped_session->snapshot_globals();
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(capped_snapshot, "bindings", axllm::Value::object()), "__ax_snapshot_truncated"), true)) return 30;
  capped_session->close();
  delete capped_session;
  session->execute("safe = 7; final({safe})");
  axllm::Value snapshot = session->snapshot_globals();
  if (!axllm::Core::get(axllm::Core::get(snapshot, "bindings", axllm::Value::object()), "inputs").is_null()) return 11;
  session->patch_globals(axllm::object({{"bindings", axllm::object({{"safe", 9}})}}));
  if (!is_number(axllm::Core::get(session->inspect(), "safe"), "9")) return 12;
  if (!axllm::equal(axllm::Core::get(session->execute("throw new Error('boom')"), "error_category"), "runtime")) return 13;
  session->close();
  if (!axllm::equal(axllm::Core::get(session->execute("final({})"), "error_category"), "session_closed")) return 14;
  delete session;

  std::cout << "cpp-javascript-quickjs-profile-ok runtime-behavior-parity-ok\n";
}
`

const cppQuickJSProfileReadme = `# JavaScript QuickJS Runtime Profile

This optional profile is a C++ adapter for the AxAgent RLM actor-code REPL.
The agent's executor loop sends one actor-code step at a time into an
` + "`AxCodeRuntime`" + ` session, observes envelopes such as ` + "`final(...)`" + `,
` + "`discover(...)`" + `, and ` + "`recall(...)`" + `, then continues from the result.

It runs JavaScript actor code through the QuickJS C API. It is not a TypeScript
transpiler and not a way to run your original Ax TypeScript application in C++.
This profile compiles only when QuickJS headers and libraries are supplied. On
Homebrew systems, ` + "`axir verify`" + ` auto-detects the usual QuickJS prefix when
` + "`AXIR_QUICKJS_CFLAGS`" + ` and ` + "`AXIR_QUICKJS_LDFLAGS`" + ` are not set.
Host callbacks are registered with ` + "`QuickJsCodeRuntime::register_callable`" + `
and are exposed to actor JavaScript as ordinary functions returning
JSON-compatible values.

Runtime policy is explicit and deny-by-default. Pass a policy object to
` + "`QuickJsCodeRuntime`" + ` to tune ` + "`timeoutMs`" + `, ` + "`maxSnapshotBytes`" + `, or
` + "`memoryLimitBytes`" + `. Filesystem, network, process, and arbitrary native host
access remain unavailable unless host code exposes an explicit callback.

Example verification:

` + "```bash" + `
AXIR_QUICKJS_CFLAGS="-I/opt/homebrew/opt/quickjs/include/quickjs" \
AXIR_QUICKJS_LDFLAGS="/opt/homebrew/opt/quickjs/lib/quickjs/libquickjs.a -lm -ldl -pthread" \
go run . verify --targets cpp --runtime-profiles javascript-quickjs ../../ir/axcore/root.axir
` + "```" + `
`
