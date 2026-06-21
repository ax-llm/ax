// ax-example:start
// title: Java Typed Generation
// group: generation
// description: Runs a small typed generation program against OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 10
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class BasicGenerationExample {
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
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"), "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    AxGen program = Ax.ax("question:string -> answer:string");
    Map<String, Object> output = program.forward(client(), Map.of("question", "In one sentence, explain Ax as a language-agnostic LLM programming library."));
    System.out.println(Json.stringify(output));
  }
}
