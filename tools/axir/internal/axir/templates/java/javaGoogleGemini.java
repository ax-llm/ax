package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class GoogleGeminiClient extends OpenAICompatibleClient {
  public GoogleGeminiClient(String model) {
    this(Map.of("model", model));
  }

  public GoogleGeminiClient(Map<String, Object> options) {
    super("google-gemini", "GoogleGeminiAI", normalize(options), "gemini-2.5-flash", "gemini-embedding-2");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", firstNonBlank(System.getenv("GOOGLE_API_KEY"), System.getenv("GEMINI_API_KEY")));
    out.putIfAbsent("base_url", System.getenv().getOrDefault("GOOGLE_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"));
    return out;
  }

  private static String firstNonBlank(String first, String second) {
    if (first != null && !first.isBlank()) return first;
    return second;
  }
}
