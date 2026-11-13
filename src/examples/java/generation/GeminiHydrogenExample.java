// ax-example:start
// title: Java Gemini 4 Hydrogen
// group: generation
// description: Uses Hydrogen with a thinking level and an explicit output limit.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: beginner
// order: 51
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class GeminiHydrogenExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("GOOGLE_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("GOOGLE_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.");
    }
    var client = Ax.ai("google-gemini", Map.of("api_key", apiKey, "model", "gemini-4-hydrogen"));
    Map<String, Object> result = client.chat(Map.of(
        "chat_prompt", List.of(Map.of("role", "user", "content", "Why does a hash table usually provide fast lookups?")),
        "model_config", Map.of("max_tokens", 4096)),
        // Use "highest" for Hydrogen's xhigh level; "low" keeps this example quick.
        Map.of("thinking_token_budget", "low"));
    System.out.println(((Map<?, ?>)((List<?>)result.get("results")).get(0)).get("content"));
  }
}
