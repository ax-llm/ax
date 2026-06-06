package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class RekaClient extends OpenAICompatibleClient {
  public RekaClient(String model) {
    this(Map.of("model", model));
  }

  public RekaClient(Map<String, Object> options) {
    super("reka", "Reka", normalize(options), "reka-core", "");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", System.getenv("REKA_API_KEY"));
    out.putIfAbsent("base_url", System.getenv().getOrDefault("REKA_BASE_URL", "https://api.reka.ai/v1"));
    return out;
  }
}
