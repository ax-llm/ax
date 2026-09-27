package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class AnthropicClient extends OpenAICompatibleClient {
  public AnthropicClient(String model) {
    this(Map.of("model", model));
  }

  public AnthropicClient(Map<String, Object> options) {
    this("anthropic", options);
  }

  public AnthropicClient(String profile, Map<String, Object> options) {
    super(
      profile,
      profile,
      normalize(profile, options),
      String.valueOf(Core.asMap(Core.provider_descriptor(profile)).getOrDefault("defaultModel", "")),
      String.valueOf(Core.asMap(Core.provider_descriptor(profile)).getOrDefault("defaultEmbedModel", ""))
    );
  }

  // The Anthropic env vars belong to the anthropic profile only: an Anthropic
  // key never goes to another anthropic-messages host.
  private static Map<String, Object> normalize(String profile, Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    if (!"anthropic".equals(profile)) return out;
    boolean vertex = (out.get("project_id") != null || out.get("projectId") != null) && out.get("region") != null;
    String envKey = vertex ? Core.env("GOOGLE_VERTEX_ACCESS_TOKEN") : Core.env("ANTHROPIC_API_KEY");
    if (envKey != null) out.putIfAbsent("api_key", envKey);
    String baseUrl = Core.env("ANTHROPIC_BASE_URL");
    if (baseUrl != null && !baseUrl.isBlank()) out.putIfAbsent("base_url", baseUrl);
    return out;
  }
}
