// ax-example:start
// title: Java Haiku 5.5 Adaptive Thinking
// group: generation
// description: Uses Haiku 5.5 adaptive thinking at low effort for a short response.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 47
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class Haiku55Example {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("ANTHROPIC_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("ANTHROPIC_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example.");
    AxAIService client = Ax.ai("anthropic", Map.of("api_key", apiKey, "model", "claude-haiku-5-5"));
    Map<String, Object> response = client.chat(Map.of(
      "chat_prompt", List.of(Map.of("role", "user", "content", "Reply with exactly: Haiku 5.5 works")),
      "model_config", Map.of("thinkingTokenBudget", "low", "showThoughts", false, "maxTokens", 2048)
    ));
    List<?> results = (List<?>) response.get("results");
    System.out.println(((Map<?, ?>) results.get(0)).get("content"));
  }
}
