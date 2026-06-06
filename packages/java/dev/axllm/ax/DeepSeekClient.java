package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class DeepSeekClient extends OpenAICompatibleClient {
  public DeepSeekClient(String model) {
    this(Map.of("model", model));
  }

  public DeepSeekClient(Map<String, Object> options) {
    super("deepseek", "DeepSeek", normalize(options), "deepseek-v4-flash", "");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", System.getenv("DEEPSEEK_API_KEY"));
    out.putIfAbsent("base_url", System.getenv().getOrDefault("DEEPSEEK_BASE_URL", "https://api.deepseek.com"));
    return out;
  }
}
