import dev.axllm.ax.*;
import java.util.*;

public final class AxGenFakeClientToolExample {
  static final class FakeClient implements AiClient {
    int calls = 0;

    public Map<String, Object> complete(Map<String, Object> request) {
      calls += 1;
      if (calls == 1) {
        return Map.of(
          "content", "",
          "function_calls", List.of(Map.of("id", "call_1", "name", "search", "params", Map.of("query", "ax docs")))
        );
      }
      return Map.of("content", "{\"answer\":\"Found Ax docs\"}");
    }
  }

  public static void main(String[] args) {
    Tool search = Ax.fn("search")
      .description("Search docs")
      .arg("query", Ax.f().string().min(1))
      .handler(values -> Map.of("title", "Ax docs"))
      .build();
    AxGen qa = Ax.ax("query:string -> answer:string")
      .addTool(search)
      .addAssert(Map.of("field", "answer", "contains", "Ax", "message", "answer should mention Ax"))
      .addFieldProcessor("answer", "trim");
    Map<String, Object> out = qa.forward(new FakeClient(), Map.of("query", "ax docs"));
    if (!"Found Ax docs".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (qa.getTraces().isEmpty()) throw new RuntimeException("missing trace");
    System.out.println("java-axgen-ok");
  }
}
