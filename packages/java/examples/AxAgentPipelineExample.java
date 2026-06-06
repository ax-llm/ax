import dev.axllm.ax.*;
import java.util.*;

public final class AxAgentPipelineExample {
  static final class FakeService implements AiClient {
    final List<Map<String, Object>> responses = new ArrayList<>(List.of(
      Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"),
      Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"),
      Map.of("content", "{\"answer\":\"Paris\"}")
    ));

    public Map<String, Object> complete(Map<String, Object> request) {
      if (responses.isEmpty()) throw new RuntimeException("fake service exhausted");
      return responses.remove(0);
    }
  }

  static final class FakeRuntime implements AxCodeRuntime {
    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      return new FakeSession();
    }
  }

  static final class FakeSession implements AxCodeSession {
    public Object execute(String code, Map<String, Object> options) {
      return Map.of("type", "final", "args", List.of(Map.of("answer", "runtime")));
    }
    public Object inspectGlobals(Map<String, Object> options) { return Map.of(); }
    public Object exportState(Map<String, Object> options) { return Map.of("globals", Map.of()); }
    public Object restoreState(Object snapshot, Map<String, Object> options) { return snapshot; }
    public Object close() { return Map.of("closed", true); }
  }

  public static void main(String[] args) {
    AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("contextFields", List.of()));
    Map<String, Object> out = qa.forward(new FakeService(), Map.of("question", "Capital of France?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (!"responder".equals(((Map<?, ?>) qa.getChatLog().get(qa.getChatLog().size() - 1)).get("name"))) throw new RuntimeException("bad chat log");
    Map<String, Object> runtimeOut = qa.test(new FakeRuntime(), "final({answer:'runtime'})");
    if (!"final".equals(runtimeOut.get("kind"))) throw new RuntimeException("bad runtime output: " + runtimeOut);
    System.out.println("java-axagent-ok");
  }
}
