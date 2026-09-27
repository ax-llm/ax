import dev.axllm.ax.*;
import java.util.*;

public final class AxGenScriptedClientToolExample {
  static final class ScriptedClient implements AiClient {
    int calls = 0;

    public Map<String, Object> complete(Map<String, Object> request) {
      calls += 1;
      if (calls == 1) {
        return Map.of(
          "content", "",
          "function_calls", List.of(Map.of("id", "call_1", "name", "search", "params", Map.of("query", "ax docs")))
        );
      }
      return Map.of("content", "Answer: Found Ax docs");
    }
  }

  public static void main(String[] args) {
    List<Map<String, Object>> searches = new ArrayList<>();
    Tool search = Ax.fn("search")
      .description("Search docs")
      .arg("query", Ax.f().string().min(1))
      .handler(values -> {
        searches.add(values);
        return Map.of("title", "Ax docs");
      })
      .build();
    AxGen qa = Ax.ax("query:string -> answer:string")
      .addTool(search)
      .addAssert(Map.of("field", "answer", "contains", "Ax", "message", "answer should mention Ax"))
      .addFieldTransform("answer", "trim");
    Map<String, Object> out = qa.forward(new ScriptedClient(), Map.of("query", "ax docs"));
    if (!"Found Ax docs".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    // The tool ran once, with the model's arguments.
    if (!List.of(Map.of("query", "ax docs")).equals(searches)) throw new RuntimeException("search did not run once: " + searches);
    if (qa.getTraces().isEmpty()) throw new RuntimeException("missing trace");
    System.out.println("java-axgen-ok");
  }
}
