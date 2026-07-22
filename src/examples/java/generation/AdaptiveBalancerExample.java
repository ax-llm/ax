// ax-example:start
// title: Java Adaptive Provider Balancing
// group: generation
// description: Routes equivalent chat traffic using shared reliability, latency, and cost statistics.
// provider: openai-compatible
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// story: 45
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class AdaptiveBalancerExample {
  static String requiredKey() {
    String value = System.getenv("OPENAI_API_KEY");
    if (value == null || value.isBlank()) value = System.getenv("OPENAI_APIKEY");
    if (value == null || value.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    return value;
  }

  public static void main(String[] args) throws Exception {
    String key = requiredKey();
    String model = System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini");
    List<AxAIService> services = List.of(
        new OpenAICompatibleClient(Map.of("api_key", key, "model", model, "base_url", System.getenv().getOrDefault("OPENAI_PRIMARY_BASE_URL", "https://api.openai.com/v1"))),
        new OpenAICompatibleClient(Map.of("api_key", System.getenv().getOrDefault("OPENAI_BACKUP_API_KEY", key), "model", model, "base_url", System.getenv().getOrDefault("OPENAI_BACKUP_BASE_URL", "https://api.openai.com/v1"))));

    var store = new AxInMemoryBalancerStatsStore();
    List<String> routeKeys = List.of("openai-primary", "openai-backup");
    List<String> events = new ArrayList<>();
    var strategy = new AxBalancerAdaptiveStrategy(6_000, 0.02)
        .expectedTokens(1_200, 300)
        .namespace("support-summary-v1")
        .routeKey((service, index) -> routeKeys.get(index))
        .slice(context -> context.get("options") instanceof Map<?, ?> options && Boolean.TRUE.equals(options.get("stream")) ? "streaming" : "interactive")
        .statsStore(store)
        .onRoutingEvent(event -> events.add(event.type()));
    AxBalancer balancer = new AxBalancer(services, new AxBalancerOptions().strategy(strategy));
    Map<String, Object> response = balancer.chat(Map.of("model", model, "chat_prompt", List.of(Map.of("role", "user", "content", "Summarize why shared routing state matters."))));
    System.out.println(Json.stringify(response));
    System.out.println(events);
  }
}
