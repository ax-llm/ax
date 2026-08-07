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
    boolean vertex = (out.get("project_id") != null || out.get("projectId") != null) && out.get("region") != null;
    out.putIfAbsent("api_key", vertex ? System.getenv("GOOGLE_VERTEX_ACCESS_TOKEN") : System.getenv("ANTHROPIC_API_KEY"));
    String baseUrl = System.getenv("ANTHROPIC_BASE_URL");
    if (baseUrl != null && !baseUrl.isBlank()) out.putIfAbsent("base_url", baseUrl);
    return out;
  }
}
