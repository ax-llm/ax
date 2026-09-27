package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class GoogleGeminiClient extends OpenAICompatibleClient {
  public GoogleGeminiClient(String model) {
    this(Map.of("model", model));
  }

  public GoogleGeminiClient(Map<String, Object> options) {
    this("google-gemini", options);
  }

  public GoogleGeminiClient(String profile, Map<String, Object> options) {
    super(
      profile,
      profile,
      normalize(profile, options),
      String.valueOf(Core.asMap(Core.provider_descriptor(profile)).getOrDefault("defaultModel", "")),
      String.valueOf(Core.asMap(Core.provider_descriptor(profile)).getOrDefault("defaultEmbedModel", ""))
    );
  }

  // The Google env vars belong to the google-gemini profile only.
  private static Map<String, Object> normalize(String profile, Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    if (!"google-gemini".equals(profile)) return out;
    boolean vertex = (out.get("project_id") != null || out.get("projectId") != null) && out.get("region") != null;
    String envKey = vertex ? Core.env("GOOGLE_VERTEX_ACCESS_TOKEN") : firstNonBlank(Core.env("GOOGLE_API_KEY"), Core.env("GEMINI_API_KEY"));
    if (envKey != null) out.putIfAbsent("api_key", envKey);
    String baseUrl = Core.env("GOOGLE_GEMINI_BASE_URL");
    if (baseUrl != null && !baseUrl.isBlank()) out.putIfAbsent("base_url", baseUrl);
    return out;
  }

  private static String firstNonBlank(String first, String second) {
    if (first != null && !first.isBlank()) return first;
    return second;
  }
}
