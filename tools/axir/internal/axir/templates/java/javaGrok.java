package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class GrokClient extends OpenAICompatibleClient {
  public GrokClient(String model) {
    this(Map.of("model", model));
  }

  public GrokClient(Map<String, Object> options) {
    super("grok", "Grok", normalize(options), "grok-4.3", "");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    String key = System.getenv("XAI_API_KEY");
    if (key == null || key.isBlank()) key = System.getenv("GROK_API_KEY");
    out.putIfAbsent("api_key", key);
    String base = System.getenv("XAI_BASE_URL");
    if (base == null || base.isBlank()) base = System.getenv().getOrDefault("GROK_BASE_URL", "https://api.x.ai/v1");
    out.putIfAbsent("base_url", base);
    return out;
  }
}
