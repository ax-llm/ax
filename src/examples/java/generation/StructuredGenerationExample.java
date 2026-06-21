// ax-example:start
// title: Java Structured Extraction
// group: generation
// description: Extracts structured fields and labels from support text with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class StructuredGenerationExample {
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
    AxGen program = Ax.ax("ticket:string -> priority:class \"high, normal, low\", summary:string, labels:string[]");
    Map<String, Object> output = program.forward(client(), Map.of("ticket", "Checkout has failed for enterprise customers since 09:00. Support wants a concise summary and tags."));
    System.out.println(Json.stringify(output));
  }
}
