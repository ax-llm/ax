// ax-example:start
// title: Java Composed Flow
// group: flows
// description: Composes multiple typed programs into one OpenAI-backed flow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class ComposedFlowExample {
  static String apiKey() {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return apiKey;
  }

  static OpenAICompatibleClient client() {
    return new OpenAICompatibleClient(
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini"), "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    AxGen step = Ax.ax("topic:string -> outline:string[]");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.composedFlow"))
            .execute("step", step)
            .map("note", state -> Map.of("note", "Mapped flow state after the provider-backed step."))
            .returns(Map.of("step", "step", "note", "note"));
    Map<String, Object> output = program.forward(client(), Map.of("topic", "How Ax moves from typed generation to agents, flows, and optimization"));
    System.out.println(Json.stringify(output));
  }
}
