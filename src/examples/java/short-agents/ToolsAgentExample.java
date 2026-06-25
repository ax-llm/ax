// ax-example:start
// title: Java Incident Triage Agent
// group: short-agents
// description: Triages a noisy incident report held in contextFields, using a lean contextPolicy to keep the raw log out of the prompt while it reasons.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class ToolsAgentExample {
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
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"),
        "model_config", Map.of("temperature", 0.0)));
  }

  // A raw, noisy incident report. It lives in `contextFields`, so the agent works
  // it inside the runtime; `contextPolicy: lean` keeps the prompt compact by
  // preferring live runtime state and summaries over replaying the raw text.
  static final String REPORT = String.join("\n",
      "[2026-03-02 14:01:22Z] INFO  gateway       deploy svc-checkout-edge v812 -> prod (channel: canary 10%)",
      "[2026-03-02 14:03:10Z] WARN  checkout-api  p95 latency 1180ms (baseline 240ms) region=eu-west-1",
      "[2026-03-02 14:04:55Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise",
      "[2026-03-02 14:05:01Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise",
      "[2026-03-02 14:05:40Z] WARN  payments-gw   circuit half-open, 3 retries exhausted for order=ord_99214",
      "[2026-03-02 14:06:12Z] INFO  gateway       canary widened 10% -> 50% for svc-checkout-edge v812",
      "[2026-03-02 14:07:33Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise",
      "[2026-03-02 14:08:02Z] ERROR checkout-api  user-visible: \"Payment could not be processed\" shown to 1,284 sessions",
      "[2026-03-02 14:09:48Z] WARN  payments-gw   connection pool exhausted (max=64) waiting=210",
      "[2026-03-02 14:11:20Z] INFO  on-call       paged: SEV-2 opened (eu-west-1 checkout error rate 38%)",
      "[2026-03-02 14:14:05Z] INFO  gateway       rollback svc-checkout-edge v812 -> v811 (channel: prod 100%)",
      "[2026-03-02 14:17:41Z] INFO  checkout-api  p95 latency 260ms, error rate 0.4% region=eu-west-1",
      "[2026-03-02 14:19:10Z] INFO  on-call       SEV-2 mitigated, monitoring for 30m");

  public static void main(String[] args) throws Exception {
    AxAgent triage = Ax.agent(
        "report:string, question:string -> severity:class \"low, medium, high, critical\", rootCause:string, nextSteps:string[], evidence:string[] \"Quoted log lines that support the assessment\"",
        Map.of(
            "contextFields", List.of("report"),
            "contextPolicy", Map.of("preset", "lean", "budget", "balanced"),
            "runtime", Map.of("language", "JavaScript")));

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      Map<String, Object> result = triage.forward(
          client(),
          Map.of(
              "report", REPORT,
              "question", "What happened, how bad was it, and what should the on-call do next? Cite the lines you relied on."),
          Map.of("runtime", runtime, "max_actor_steps", 12));

      System.out.println(Json.pretty(result));
    }
  }
}
