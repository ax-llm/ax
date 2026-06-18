// ax-example:start
// title: Java Specialist Planner Agent
// group: short-agents
// description: A specialist that plans a migration from a long brief held in contextFields, using a checkpointed contextPolicy and a runtime-output cap to stay compact.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class HandoffAgentExample {
  static String apiKey() {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return apiKey;
  }

  static OpenAICompatibleClient client() {
    return new OpenAICompatibleClient(Map.of(
        "api_key", apiKey(),
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4o-mini"),
        "model_config", Map.of("temperature", 0.0)));
  }

  // A long, messy brief -- exactly the kind of input you do not want replayed into
  // the prompt on every turn. `contextFields` holds it in the runtime, the
  // `checkpointed` policy compacts older turns once the prompt grows, and
  // `maxRuntimeChars` caps how much runtime output is echoed back.
  static final String BRIEF = String.join("\n",
      "# Migration brief: monolith -> services (draft, unordered notes)",
      "",
      "Current: single Rails monolith, Postgres primary + 1 replica, Sidekiq for jobs.",
      "Pain: deploys take 40m, one bad migration locks the orders table, on-call burnout.",
      "Constraints: no downtime windows > 5m, PCI scope must shrink, team of 6, 2 quarters.",
      "Hot paths: checkout (writes orders, payments), search (read-heavy), notifications (async).",
      "Known landmines: payments code has no tests; search shares the orders DB; a nightly",
      "cron rebuilds the catalog and pins CPU for ~20m; the replica lags up to 90s under load.",
      "Org wants: independent deploys for checkout, smaller blast radius, an audit trail.",
      "Nice to have: event log for orders, read-model for search, feature flags.",
      "Hard no: a big-bang rewrite; introducing Kubernetes this year.");

  public static void main(String[] args) throws Exception {
    AxAgent specialist = Ax.agent(
        "brief:string, goal:string -> plan:string[] \"Ordered, concrete steps\", answer:string, risks:string[]",
        Map.of(
            "contextFields", List.of("brief"),
            "contextPolicy", Map.of("preset", "checkpointed", "budget", "balanced"),
            "maxRuntimeChars", 3000,
            "runtime", Map.of("language", "JavaScript")));

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      Map<String, Object> result = specialist.forward(
          client(),
          Map.of(
              "brief", BRIEF,
              "goal", "Propose a safe, incremental 2-quarter plan to split checkout out first, respecting the hard constraints."),
          Map.of("runtime", runtime, "max_actor_steps", 12));

      System.out.println(Json.pretty(result));
    }
  }
}
