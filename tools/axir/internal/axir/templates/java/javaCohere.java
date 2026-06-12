package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class CohereClient extends OpenAICompatibleClient {
  public CohereClient(String model) {
    this(Map.of("model", model));
  }

  public CohereClient(Map<String, Object> options) {
    super("cohere", "Cohere", normalize(options), "command-r-plus", "embed-english-v3.0");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", System.getenv("COHERE_API_KEY"));
    out.putIfAbsent("base_url", System.getenv().getOrDefault("COHERE_BASE_URL", "https://api.cohere.ai/compatibility/v1"));
    return out;
  }
}
