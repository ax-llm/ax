package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class MistralClient extends OpenAICompatibleClient {
  public MistralClient(String model) {
    this(Map.of("model", model));
  }

  public MistralClient(Map<String, Object> options) {
    super("mistral", "Mistral", normalize(options), "mistral-small-latest", "mistral-embed");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", System.getenv("MISTRAL_API_KEY"));
    out.putIfAbsent("base_url", System.getenv().getOrDefault("MISTRAL_BASE_URL", "https://api.mistral.ai/v1"));
    return out;
  }
}
