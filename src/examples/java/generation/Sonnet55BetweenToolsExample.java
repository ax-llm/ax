// ax-example:start
// title: Java Sonnet 5.5 Between-Tool Thinking
// group: generation
// description: Disables pre-response thinking while retaining signed updates for replay.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 46
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class Sonnet55BetweenToolsExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("ANTHROPIC_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("ANTHROPIC_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example.");
    AxAIService client = Ax.ai("anthropic", Map.of("api_key", apiKey, "model", "claude-sonnet-5-5"));
    Map<String, Object> response = client.chat(Map.of(
      "chat_prompt", List.of(Map.of("role", "user", "content", "Reply with exactly: Sonnet 5.5 works")),
      "model_config", Map.of("thinkingTokenBudget", "none", "effort", "high", "maxTokens", 128)
    ));
    List<?> results = (List<?>) response.get("results");
    System.out.println(((Map<?, ?>) results.get(0)).get("content"));
  }
}
