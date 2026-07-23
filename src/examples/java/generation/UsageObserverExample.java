// ax-example:start
// title: Centralized Usage Observer
// group: generation
// description: Attributes every completed model call to a tenant, user, and request from one global observer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class UsageObserverExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }

    List<AxUsageEvent> events = new ArrayList<>();
    AxGlobals.setUsageObserver(events::add);
    OpenAICompatibleClient client =
        new OpenAICompatibleClient(
            Map.of(
                "api_key", apiKey,
                "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"),
                "usageContext",
                    Map.of(
                        "tenantId", "tenant-42",
                        "feature", "support-chat",
                        "attributes", Map.of("environment", "example"))));
    try {
      client.chat(
          Map.of(
              "chat_prompt",
              List.of(Map.of("role", "user", "content", "Reply with one short greeting."))),
          Map.of(
              "usageContext",
              Map.of("userId", "user-7", "requestId", UUID.randomUUID().toString())));
      System.out.println(Json.stringify(events.stream().map(AxUsageEvent::value).toList()));
    } finally {
      AxGlobals.setUsageObserver(null);
    }
  }
}
