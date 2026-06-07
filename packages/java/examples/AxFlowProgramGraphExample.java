import dev.axllm.ax.*;
import java.util.*;

public final class AxFlowProgramGraphExample {
  static final class ScriptedClient implements AiClient {
    public Map<String, Object> complete(Map<String, Object> request) {
      return Map.of("content", "{\"answer\":\"Paris\"}");
    }
  }

  public static void main(String[] args) {
    AxGen qa = Ax.ax("question:string -> answer:string");
    AxFlow program = Ax.flow(Map.of("id", "example.flow")).execute("qa", qa).returns(Map.of("answer", "answer"));
    Map<String, Object> out = program.forward(new ScriptedClient(), Map.of("question", "Capital of France?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (!"qa".equals(((Map<?, ?>) ((List<?>) program.getPlan().get("steps")).get(0)).get("name"))) throw new RuntimeException("bad plan");
    System.out.println("java-axflow-ok");
  }
}
