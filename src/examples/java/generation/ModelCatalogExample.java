// ax-example:start
// title: Java Model Catalog
// group: generation
// description: Lists static models and named OpenAI-compatible profiles with portable thinking levels and service tiers.
// provider: openai-compatible
// env: none
// level: beginner
// order: 16
// ax-example:end
import dev.axllm.ax.Ax;
import java.util.*;

public final class ModelCatalogExample {
  private static Map<?, ?> provider(List<Object> catalog, String name) {
    return catalog.stream()
        .map(entry -> (Map<?, ?>) entry)
        .filter(entry -> name.equals(entry.get("name")))
        .findFirst()
        .orElseThrow();
  }

  public static void main(String[] args) {
    List<Object> catalog = Ax.getSupportedAIModels();
    Map<?, ?> azure = provider(catalog, "azure-openai");
    Map<?, ?> openrouter = provider(catalog, "openrouter");
    Map<?, ?> azureCapabilities = (Map<?, ?>) azure.get("capabilities");
    Map<?, ?> openrouterCapabilities = (Map<?, ?>) openrouter.get("capabilities");

    assert Boolean.TRUE.equals(azure.get("isDynamic"));
    assert ((List<?>) azure.get("models")).isEmpty();
    assert ((List<?>) azureCapabilities.get("thinkingLevels")).contains("high");
    assert ((List<?>) azureCapabilities.get("serviceTiers")).contains("priority");
    assert ((List<?>) openrouterCapabilities.get("serviceTiers")).contains("flex");

    System.out.println(catalog.size() + " providers; Azure and OpenRouter named profiles are available");
  }
}
