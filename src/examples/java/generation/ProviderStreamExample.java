// ax-example:start
// title: Java Incremental Provider Stream
// group: generation
// description: Consumes a lazy, closeable OpenAI SSE stream event by event.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class ProviderStreamExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    AxAIService client = Ax.ai("openai", Map.of(
      "api_key", apiKey,
      "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.6-luna")
    ));
    long started = System.nanoTime();
    try (AxChatStream stream = client.openStream(Map.of(
      "chat_prompt", List.of(Map.of("role", "user", "content", "Reply with exactly: streaming works")),
      "model_config", Map.of("temperature", 1)
    ))) {
      for (Map<String, Object> event : stream) {
        List<?> results = (List<?>) event.get("results");
        Object content = results.isEmpty() ? null : ((Map<?, ?>) results.get(0)).get("content");
        if (content != null && !content.toString().isEmpty()) {
          System.out.printf("[%d ms] %s", (System.nanoTime() - started) / 1_000_000, content);
        }
      }
    }
    System.out.println();
  }
}
