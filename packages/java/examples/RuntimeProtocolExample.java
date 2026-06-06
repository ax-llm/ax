import dev.axllm.ax.*;
import java.io.File;
import java.util.*;

public final class RuntimeProtocolExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  public static void main(String[] args) throws Exception {
    String repoRoot = System.getenv("AXIR_REPO_ROOT");
    String server = System.getenv("AXIR_AXJS_RUNTIME_SERVER");
    if (repoRoot == null || server == null) throw new RuntimeException("AXIR runtime protocol env vars are required");

    try (AxProcessCodeRuntime runtime = new AxProcessCodeRuntime(
      List.of("node", "--import=tsx", server),
      new File(repoRoot),
      Map.of()
    )) {
      AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      Map<String, Object> out = qa.test(runtime, "answer = inputs.question; await final({ answer })", Map.of("question", "protocol"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad test output: " + out);
      Map<String, Object> completion = asMap(out.get("completion_payload"));
      Object firstArg = ((List<?>) completion.get("args")).get(0);
      if (!"protocol".equals(asMap(firstArg).get("answer"))) throw new RuntimeException("bad final payload: " + out);

      AxAgent runner = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      Map<String, Object> step = runner.executeActorStep(runtime, "answer = 'persisted'; await final({ answer })", Map.of("question", "protocol"));
      if (!"final".equals(step.get("kind"))) throw new RuntimeException("bad step output: " + step);
      Map<String, Object> snapshot = asMap(runner.exportSessionState());
      if (!snapshot.containsKey("bindings")) throw new RuntimeException("bad snapshot: " + snapshot);
      runner.restoreSessionState(snapshot);
      Object inspected = runner.inspectRuntime();
      if (!String.valueOf(inspected).contains("persisted")) throw new RuntimeException("bad inspect: " + inspected);
      Map<String, Object> closed = asMap(runner.closeRuntimeSession());
      if (!Boolean.TRUE.equals(closed.get("closed"))) throw new RuntimeException("bad close: " + closed);
    }
    System.out.println("java-runtime-protocol-ok");
  }
}
