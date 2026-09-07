// ax-example:start
// title: Java Astra Generation
// group: generation
// description: Runs Astra through the standard generator with automatic Responses routing and prompt caching.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 11
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class AstraGenerationExample {
  static String apiKey() {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return apiKey;
  }

  static AxAIService client() {
    return Ax.ai("openai",
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-6-astra"), "model_config", Map.of("thinkingTokenBudget", "low", "max_tokens", 2048)));
  }

  public static void main(String[] args) throws Exception {
    AxGen program = Ax.ax("question:string -> answer:string");
    Map<String, Object> output = program.forward(
        client(),
        Map.of("question", "In one sentence, explain Ax as a language-agnostic LLM programming library."),
        Map.of("serviceTier", "standard", "promptCacheKey", "ax-openai-example", "contextCache", Map.of()));
    System.out.println(Json.stringify(output));
  }
}
