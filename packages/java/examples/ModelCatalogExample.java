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

    if (!Boolean.TRUE.equals(azure.get("isDynamic")) || !((List<?>) azure.get("models")).isEmpty()) throw new AssertionError();
    if (!((List<?>) azureCapabilities.get("thinkingLevels")).contains("high")) throw new AssertionError();
    if (!((List<?>) azureCapabilities.get("serviceTiers")).contains("priority")) throw new AssertionError();
    if (!((List<?>) openrouterCapabilities.get("serviceTiers")).contains("flex")) throw new AssertionError();
    provider(Ax.getSupportedAIModels("text"), "azure-openai");

    System.out.println("java-model-catalog-ok");
  }
}
