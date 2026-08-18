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
      normalize(options),
      String.valueOf(Core.asMap(Core.provider_descriptor(profile)).getOrDefault("defaultModel", "")),
      String.valueOf(Core.asMap(Core.provider_descriptor(profile)).getOrDefault("defaultEmbedModel", ""))
    );
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    boolean vertex = (out.get("project_id") != null || out.get("projectId") != null) && out.get("region") != null;
    out.putIfAbsent("api_key", vertex ? System.getenv("GOOGLE_VERTEX_ACCESS_TOKEN") : firstNonBlank(System.getenv("GOOGLE_API_KEY"), System.getenv("GEMINI_API_KEY")));
    String baseUrl = System.getenv("GOOGLE_GEMINI_BASE_URL");
    if (baseUrl != null && !baseUrl.isBlank()) out.putIfAbsent("base_url", baseUrl);
    return out;
  }

  private static String firstNonBlank(String first, String second) {
    if (first != null && !first.isBlank()) return first;
    return second;
  }
}
