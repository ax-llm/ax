import dev.axllm.ax.*;
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
