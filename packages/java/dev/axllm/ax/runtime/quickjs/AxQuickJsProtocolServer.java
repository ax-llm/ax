package dev.axllm.ax.runtime.quickjs;

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
