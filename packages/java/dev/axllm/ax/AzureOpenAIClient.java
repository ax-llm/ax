package dev.axllm.ax;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AzureOpenAIClient extends OpenAICompatibleClient {
  public AzureOpenAIClient(String model) {
    this(Map.of("model", model));
  }

  public AzureOpenAIClient(Map<String, Object> options) {
    super("azure-openai", "Azure OpenAI", normalize(options), "gpt-5-mini", "text-embedding-3-small");
  }

  private static Map<String, Object> normalize(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>(options == null ? Map.of() : options);
    out.putIfAbsent("api_key", System.getenv("AZURE_OPENAI_API_KEY"));
    Object version = out.containsKey("version") ? out.remove("version") : out.getOrDefault("api_version", out.get("apiVersion"));
    out.put("api_version", normalizeVersion(version));
    if (!out.containsKey("base_url") && !out.containsKey("baseUrl")) {
      Object resource = out.getOrDefault("resource_name", out.getOrDefault("resourceName", System.getenv("AZURE_OPENAI_RESOURCE_NAME")));
      Object deployment = out.getOrDefault("deployment_name", out.getOrDefault("deploymentName", System.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")));
      String envBase = System.getenv("AZURE_OPENAI_BASE_URL");
      if (envBase != null && !envBase.isBlank()) {
        out.put("base_url", envBase);
      } else if (resource != null && deployment != null && !String.valueOf(resource).isBlank() && !String.valueOf(deployment).isBlank()) {
        String host = String.valueOf(resource);
        if (!host.contains("://")) host = "https://" + host + ".openai.azure.com";
        out.put("base_url", host.replaceAll("/+$", "") + "/openai/deployments/" + URLEncoder.encode(String.valueOf(deployment), StandardCharsets.UTF_8));
      }
    }
    return out;
  }

  private static String normalizeVersion(Object version) {
    String text = String.valueOf(version == null ? "2024-02-15-preview" : version).trim();
    int idx = text.indexOf("api-version=");
    if (idx >= 0) {
      String rest = text.substring(idx + "api-version=".length());
      int amp = rest.indexOf('&');
      return amp >= 0 ? rest.substring(0, amp) : rest;
    }
    return text;
  }
}
