import dev.axllm.ax.*;
import java.io.File;
import java.util.*;

public final class PythonPyodideExample {
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
      if (responses.isEmpty()) throw new RuntimeException("scripted client exhausted");
      return responses.remove(0);
    }
  }

  static List<String> command(String raw) {
    if (raw == null || raw.isBlank()) throw new RuntimeException("AXIR_PYODIDE_RUNTIME_SERVER is required");
    return Arrays.asList(raw.trim().split("\\s+"));
  }

  static boolean numberEquals(Object value, int expected) {
    if (value instanceof Number n) return n.intValue() == expected;
    return String.valueOf(expected).equals(String.valueOf(value));
  }

  public static void main(String[] args) throws Exception {
    String server = System.getenv("AXIR_PYODIDE_RUNTIME_SERVER");
    String repoRoot = System.getenv("AXIR_REPO_ROOT");
    File cwd = repoRoot == null || repoRoot.isBlank() ? new File(".") : new File(repoRoot);
    try (AxProcessCodeRuntime runtime = new AxProcessCodeRuntime(command(server), cwd, Map.of())) {
      AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      Map<String, Object> out = qa.test(runtime, "answer = inputs['question']\nfinal({'answer': answer})", Map.of("question", "pyodide"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad output: " + out);
      Map<String, Object> payload = asMap(out.get("completion_payload"));
      Map<String, Object> first = asMap(((List<?>) payload.get("args")).get(0));
      if (!"pyodide".equals(first.get("answer"))) throw new RuntimeException("bad payload: " + out);

      AxAgent forwardAgent = Ax.agent("question:string -> answer:string", Map.of(
        "runtime", Map.of("language", "Python"),
        "functionDiscovery", true,
        "memoriesMode", true,
        "memory_search_results", Map.of("prefs", List.of(Map.of("id", "mem1", "content", "likes concise docs"))),
        "functions", List.of(Map.of("name", "search", "description", "Search docs"))
      ));
      ScriptedAI forwardClient = new ScriptedAI(List.of(
        Map.of("content", "{\"pythonCode\":\"final('Run actor', {})\"}"),
        Map.of("content", "{\"pythonCode\":\"counter = 41\\ndiscover({'tools': ['search']})\"}"),
        Map.of("content", "{\"pythonCode\":\"recall('prefs')\"}"),
        Map.of("content", "{\"pythonCode\":\"hit = search({'query': inputs['question']})\\nfinal('Answer', {'answer': hit['title']})\"}"),
        Map.of("content", "{\"answer\":\"Docs\"}")
      ));
      Map<String, Object> forwardOut = forwardAgent.forward(
        forwardClient,
        Map.of("question", "pyodide"),
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
      AxAgent restoredAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      restoredAgent.restoreRuntimeState(forwardAgent.exportRuntimeState());
      if (!String.valueOf(restoredAgent.exportRuntimeState()).contains("likes concise docs")) throw new RuntimeException("state restore lost recalled memory");

      AxAgent guideAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      ScriptedAI guideClient = new ScriptedAI(List.of(
        Map.of("content", "{\"pythonCode\":\"final('Guide', {})\"}"),
        Map.of("content", "{\"pythonCode\":\"guideAgent('Prefer concise final.')\"}"),
        Map.of("content", "{\"pythonCode\":\"final('Answer', {'answer': 'Concise'})\"}"),
        Map.of("content", "{\"answer\":\"Concise\"}")
      ));
      Map<String, Object> guideOut = guideAgent.forward(
        guideClient,
        Map.of("question", "pyodide"),
        Map.of("runtime", runtime, "max_actor_steps", 3)
      );
      if (!"Concise".equals(guideOut.get("answer"))) throw new RuntimeException("bad guide output: " + guideOut);
      String guideText = String.valueOf(guideAgent.getActionLog()) + String.valueOf(guideAgent.exportTrace()) + String.valueOf(guideClient.requests);
      if (!guideText.contains("guide_agent") || !guideText.contains("Prefer concise final.")) throw new RuntimeException("guideAgent parity failed: " + guideText);

      AxAgent clarificationAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      ScriptedAI clarificationClient = new ScriptedAI(List.of(
        Map.of("content", "{\"pythonCode\":\"final('Ask', {})\"}"),
        Map.of("content", "{\"pythonCode\":\"askClarification('Need detail?')\"}")
      ));
      try {
        clarificationAgent.forward(
          clarificationClient,
          Map.of("question", "pyodide"),
          Map.of("runtime", runtime, "max_actor_steps", 1)
        );
        throw new RuntimeException("expected runtime clarification");
      } catch (AxAgentClarificationException expected) {
        if (!String.valueOf(expected.getMessage()).contains("Need detail")) throw expected;
      }

      AxCodeSession session = runtime.createSession(
        Map.of(
          "inputs", Map.of("question", "pyodide"),
          "search", Map.of("__ax_host_callable", true, "native", true),
          "badTool", Map.of("__ax_host_callable", true, "native", true)
        ),
        Map.of("reservedNames", List.of("inputs"))
      );
      Map<String, Object> step = asMap(session.execute("counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})", Map.of()));
      if (!"final".equals(step.get("type"))) throw new RuntimeException("bad step: " + step);
      Map<String, Object> step2 = asMap(session.execute("counter = counter + 1\nfinal({'counter': counter})", Map.of()));
      if (!numberEquals(asMap(((List<?>) step2.get("args")).get(0)).get("counter"), 2)) throw new RuntimeException("binding did not persist: " + step2);
      if (!"askClarification".equals(asMap(session.execute("askClarification({'question': 'Need detail?'})", Map.of())).get("type"))) throw new RuntimeException("askClarification failed");
      if (!"discover".equals(asMap(session.execute("discover({'tools': ['search']})", Map.of())).get("kind"))) throw new RuntimeException("discover failed");
      if (!"recall".equals(asMap(session.execute("recall({'query': 'docs'})", Map.of())).get("kind"))) throw new RuntimeException("recall failed");
      if (!"used".equals(asMap(session.execute("used('mem1', 'helpful')", Map.of())).get("kind"))) throw new RuntimeException("used failed");
      if (!"status".equals(asMap(session.execute("reportSuccess('ok')", Map.of())).get("kind"))) throw new RuntimeException("status failed");
      if (!"status".equals(asMap(session.execute("reportFailure('bad')", Map.of())).get("kind"))) throw new RuntimeException("failure status failed");
      if (!"guide_agent".equals(asMap(session.execute("guideAgent('try this')", Map.of())).get("type"))) throw new RuntimeException("guideAgent failed");
      Map<String, Object> bridged = asMap(session.execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})", Map.of()));
      if (!"Docs".equals(asMap(((List<?>) bridged.get("args")).get(0)).get("title"))) throw new RuntimeException("host bridge failed: " + bridged);
      Map<String, Object> failed = asMap(session.execute("err = badTool({})\nfinal({'error': err['error']})", Map.of()));
      if (!"tool failed".equals(asMap(((List<?>) failed.get("args")).get(0)).get("error"))) throw new RuntimeException("host error failed: " + failed);
      Map<String, Object> diagnostic = asMap(session.execute("print('hello from pyodide')\nfinal({'ok': True})", Map.of()));
      if (!String.valueOf(diagnostic).contains("hello from pyodide")) throw new RuntimeException("diagnostics failed: " + diagnostic);
      Map<String, Object> packageDenied = asMap(session.execute("pkg = loadPackage('numpy')\nfinal({'error': pkg['error']})", Map.of()));
      if (!String.valueOf(packageDenied).contains("package loading is disabled")) throw new RuntimeException("package policy denial failed: " + packageDenied);
      Map<String, Object> snapshot = asMap(session.snapshotGlobals(Map.of()));
      if (asMap(snapshot.get("bindings")).containsKey("inputs")) throw new RuntimeException("reserved input leaked into snapshot: " + snapshot);
      session.patchGlobals(Map.of("bindings", Map.of("safe", 9)), Map.of());
      Map<String, Object> inspected = asMap(session.inspectGlobals(Map.of()));
      if (!numberEquals(inspected.get("safe"), 9)) throw new RuntimeException("patch/inspect failed: " + inspected);
      if (!"runtime".equals(asMap(session.execute("raise Exception('boom')", Map.of())).get("error_category"))) throw new RuntimeException("runtime error normalization failed");
      session.close();
      if (!"session_closed".equals(asMap(session.execute("final({'answer': 'closed'})", Map.of())).get("error_category"))) throw new RuntimeException("closed session behavior failed");
    }
    System.out.println("java-python-pyodide-profile-ok runtime-behavior-parity-ok");
  }
}
