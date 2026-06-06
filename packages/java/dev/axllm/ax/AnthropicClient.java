package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class AnthropicClient extends OpenAICompatibleClient {
  public AnthropicClient(String model) {
    this(Map.of("model", model));
  }

  public AnthropicClient(Map<String, Object> options) {
    super("anthropic", "anthropic", normalize(options), "claude-3-7-sonnet-latest", "");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", System.getenv("ANTHROPIC_API_KEY"));
    out.putIfAbsent("base_url", System.getenv().getOrDefault("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"));
    return out;
  }
}
