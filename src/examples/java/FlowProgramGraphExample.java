import dev.axllm.ax.*;
import java.util.*;

public final class FlowProgramGraphExample {
  static final class FakeClient implements AiClient {
    final List<Map<String, Object>> responses =
        new ArrayList<>(
            List.of(
                Map.of("content", "{\"outline\":\"1. Define Ax. 2. Show one concrete use.\"}"),
                Map.of("content", "{\"title\":\"Ax in two steps\"}")));

    public Map<String, Object> complete(Map<String, Object> request) {
      if (responses.isEmpty()) throw new RuntimeException("fake service exhausted");
      return responses.remove(0);
    }
  }

  public static void main(String[] args) throws Exception {
    AxGen outline = Ax.ax("topic:string -> outline:string");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.flow"))
            .execute("outline", outline)
            .map(
                "title",
                state ->
                    Map.of(
                        "title",
                        "Ax in two steps",
                        "outlineLength",
                        String.valueOf(state.get("outline")).length()))
            .returns(Map.of("outline", "outline", "title", "title"));
    Map<String, Object> output = program.forward(new FakeClient(), Map.of("topic", "Ax"));

    System.out.println("flow output:");
    System.out.println(Json.stringify(output));
    System.out.println("flow plan:");
    System.out.println(Json.stringify(program.getPlan()));
  }
}
