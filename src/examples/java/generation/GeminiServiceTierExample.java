// ax-example:start
// title: Java Gemini Flex Inference
// group: generation
// description: Sends latency-tolerant work through Gemini Flex and reports the applied tier.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 50
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class GeminiServiceTierExample {
  private static String apiKey() {
    String value = System.getenv("GOOGLE_API_KEY");
    if (value == null || value.isBlank()) value = System.getenv("GOOGLE_APIKEY");
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.");
    }
    return value;
  }

  public static void main(String[] args) throws Exception {
    GoogleGeminiClient client = new GoogleGeminiClient(Map.of(
        "api_key", apiKey(),
        "model", System.getenv().getOrDefault("AX_GEMINI_MODEL", "gemini-3.7-flash")));
    Map<String, Object> out = client.chat(Map.of(
        "chat_prompt", List.of(Map.of(
            "role", "user",
            "content", "Explain in one sentence why batch evaluations save time."))),
        Map.of("service_tier", "flex"));
    System.out.println(Json.stringify(out));
  }
}
