// ax-example:start
// title: Java Incident Log Forensics (RLM)
// group: long-agents
// description: Infers service architecture and root-cause findings from a huge CloudWatch export that never enters the prompt -- held in contextFields and worked through the runtime under a lean contextPolicy.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 10
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.time.*;
import java.time.format.*;
import java.util.*;

public final class IncidentLogForensicsExample {
  static GoogleGeminiClient client() {
    String apiKey = System.getenv("GOOGLE_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set GOOGLE_APIKEY to run this example.");
    }
    return new GoogleGeminiClient(Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_GEMINI_MODEL", "gemini-3.5-flash")));
  }

  // ---------------------------------------------------------------------------
  // Synthetic CloudWatch-style export -- generated large on purpose. Dumping these
  // raw events into a prompt would blow the context window. The agent keeps them
  // in its runtime (contextFields) and only the *evidence it extracts* ever
  // reaches the model. Deterministic so the example is reproducible.
  // ---------------------------------------------------------------------------
  static List<Object> buildLogDump() {
    OffsetDateTime start = OffsetDateTime.of(2026, 3, 2, 13, 0, 0, 0, ZoneOffset.UTC);
    List<Object> events = new ArrayList<>();

    class Push {
      void at(int i, Map<String, Object> event) {
        Map<String, Object> e = new LinkedHashMap<>(event);
        e.put("timestamp", start.plusSeconds((long) i * 2).format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'")));
        e.put("requestId", "req-" + (100000 + i));
        events.add(e);
      }
    }
    Push push = new Push();

    for (int i = 0; i < 1600; i++) {
      // Routine, healthy traffic across the fleet.
      push.at(i, Map.of("level", "INFO", "service", "gateway", "statusCode", 200, "latencyMs", 40 + (i % 30), "message", "route ok GET /checkout"));
      push.at(i, Map.of("level", "INFO", "service", "search-api", "statusCode", 200, "latencyMs", 70 + (i % 50), "message", "query ok q=shoes"));

      // Window A: payments-gw upstream timeouts spill into checkout-api 502s for
      // enterprise tenants, with retry storms + pool exhaustion.
      if (i >= 300 && i < 520) {
        push.at(i, Map.of("level", "ERROR", "service", "payments-gw", "statusCode", 504, "latencyMs", 10000, "tenantTier", "enterprise", "message", "upstream timeout calling acquirer (10s)"));
        push.at(i, Map.of("level", "ERROR", "service", "checkout-api", "statusCode", 502, "tenantTier", "enterprise", "message", "bad gateway from svc-payments-gw"));
        if (i % 3 == 0) {
          push.at(i, Map.of("level", "WARN", "service", "payments-gw", "message", "connection pool exhausted (max=64) waiting=200+"));
          push.at(i, Map.of("level", "WARN", "service", "checkout-api", "tenantTier", "enterprise", "message", "user-visible: \"Payment could not be processed\""));
        }
      }

      // Window B: the nightly catalog-cron pins CPU and search-api returns 429s.
      if (i >= 1000 && i < 1120) {
        push.at(i, Map.of("level", "WARN", "service", "catalog-cron", "latencyMs", 0, "message", "rebuild step pinning CPU at 95% on shared node"));
        push.at(i, Map.of("level", "ERROR", "service", "search-api", "statusCode", 429, "message", "rate limited: downstream catalog unavailable"));
      }
    }

    return events;
  }

  public static void main(String[] args) throws Exception {
    GoogleGeminiClient client = client();

    List<Object> logs = buildLogDump();
    System.out.println("Generated " + logs.size() + " log events (kept out of the prompt).");

    AxAgent logRLM = Ax.agent(
        "task:string, logs:json \"Raw CloudWatch export; keep this out of the prompt\" -> architecture:string[] \"Services and how they call each other\", findings:json[] \"Each: issue, count, window, evidence, impact\", overallHealth:string, nextActions:string[]",
        Map.of(
            // The export stays in the runtime; only extracted evidence reaches the model.
            "contextFields", List.of("logs"),
            "contextPolicy", Map.of("preset", "lean", "budget", "balanced"),
            "maxRuntimeChars", 12000,
            "runtime", Map.of("language", "JavaScript")));

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      Map<String, Object> report = logRLM.forward(
          client,
          Map.of(
              "logs", logs,
              "task", "Infer the service architecture from the logs alone. Then find repeated errors, throttles, retries, and bad user states -- with the affected time window, an occurrence count, and concrete log evidence for each."),
          Map.of("runtime", runtime, "max_actor_steps", 40));

      System.out.println("\n=== Report ===");
      System.out.println(Json.pretty(report));
      System.out.println("\n=== Usage ===");
      System.out.println(Json.pretty(logRLM.getUsage()));
    }
  }
}
