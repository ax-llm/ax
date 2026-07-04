// ax-example:start
// title: Java Smart Defaults Agent
// group: long-agents
// description: Shows AxAgent smart defaults: oversized undeclared context stays out of the prompt while relevance hints and runtime tools guide the agent.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 60
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class SmartDefaultsAgentExample {
  static final List<String> TIMELINE = List.of(
      "09:12 checkout-edge v812 deployed behind 25% of traffic",
      "09:18 payments gateway p95 rose from 420ms to 4.8s",
      "09:22 cart completion dropped 31% for enterprise accounts",
      "09:27 retries saturated the checkout-edge connection pool",
      "09:31 rollback to v811 started",
      "09:36 p95 returned below 700ms after pool reset");

  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  static String buildIncidentLog() {
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < 28; i++) {
      if (i > 0) out.append("\n\n");
      out.append("# log shard ").append(i + 1).append('\n');
      out.append(String.join("\n", TIMELINE));
    }
    return out.toString();
  }

  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("GOOGLE_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set GOOGLE_APIKEY to run this example.");
    }

    GoogleGeminiClient client = new GoogleGeminiClient(Map.of(
        "api_key", apiKey, "model", "gemini-3.5-flash"));

    Map<String, Object> incidentSummary = new LinkedHashMap<>();
    incidentSummary.put("service", "checkout");
    incidentSummary.put("severity", "sev-1");
    incidentSummary.put("rootCause",
        "checkout-edge v812 retried payment gateway calls without bounded concurrency, saturating the shared connection pool.");
    incidentSummary.put("errorRate", "38%");
    incidentSummary.put("affectedSessions", 1284);
    incidentSummary.put("candidateRunbook", "payments-timeout-runbook");
    incidentSummary.put("relevantMemory", "decision-enterprise-comms");

    AxQuickJsHostCallable summarizeIncident = params -> {
      Map<String, Object> p = asMap(params);
      Map<String, Object> out = new LinkedHashMap<>(incidentSummary);
      out.put("service", String.valueOf(p.getOrDefault("service", "checkout")));
      return out;
    };

    AxQuickJsHostCallable getTimeline = params -> {
      Map<String, Object> p = asMap(params);
      String service = String.valueOf(p.getOrDefault("service", "checkout"));
      List<Map<String, Object>> out = new ArrayList<>();
      for (String event : TIMELINE) out.add(Map.of("service", service, "event", event));
      return out;
    };

    AxQuickJsHostCallable getRunbook = params -> {
      Map<String, Object> p = asMap(params);
      return Map.of(
          "id", String.valueOf(p.getOrDefault("id", "payments-timeout-runbook")),
          "steps", List.of(
              "Freeze checkout deploys and page the payments owner.",
              "Rollback checkout-edge to v811 and reset saturated pools.",
              "Post enterprise status update after error rate stays below 2%."));
    };

    AxAgent analyst = Ax.agent(
        "incidentLog:string, question:string -> rootCause:string, actions:string[] \"Recommended remediation actions from the runbook\", evidence:string[]",
        Map.of(
            "name", "SmartDefaultsIncidentAgent",
            "description", "Investigate checkout incidents using runtime tools, relevance hints, and compact evidence.",
            // No contextFields and no autoUpgrade option: oversized incidentLog is promoted by default.
            "functions", List.of(
                Map.of(
                    "name", "summarizeIncident",
                    "description", "Summarize the current checkout incident and name the strongest runbook and memory matches.",
                    "parameters", Map.of(
                        "type", "object",
                        "properties", Map.of("service", Map.of("type", "string")),
                        "required", List.of("service"))),
                Map.of(
                    "name", "getTimeline",
                    "description", "Return concrete timestamped evidence for the checkout incident.",
                    "parameters", Map.of(
                        "type", "object",
                        "properties", Map.of("service", Map.of("type", "string")),
                        "required", List.of("service"))),
                Map.of(
                    "name", "getRunbook",
                    "description", "Fetch the operational runbook steps for a relevant incident pattern.",
                    "parameters", Map.of(
                        "type", "object",
                        "properties", Map.of("id", Map.of("type", "string")),
                        "required", List.of("id")))),
            "skillsCatalog", List.of(
                Map.of(
                    "id", "payments-timeout-runbook",
                    "name", "Payments timeout runbook",
                    "content", "Use when checkout latency follows payment gateway retry amplification."),
                Map.of(
                    "id", "status-comms-runbook",
                    "name", "Status communications",
                    "content", "Use when customer-facing enterprise account updates are required.")),
            "memoriesCatalog", List.of(
                Map.of(
                    "id", "decision-enterprise-comms",
                    "content", "For sev-1 checkout incidents, send an enterprise status update only after rollback is complete and error rate is below 2%."),
                Map.of(
                    "id", "checkout-v812-rollback",
                    "content", "checkout-edge v812 rollback completed cleanly once saturated payment pools were reset.")),
            "executorOptions", Map.of(
                "description", String.join("\n",
                    "Call the bare async runtime functions summarizeIncident, getTimeline, and getRunbook before answering.",
                    "Use top-level await, for example: const s = await summarizeIncident({service:'checkout'});",
                    "The large incidentLog input is intentionally not declared as a context field; smart defaults keep it available at runtime without flooding the prompt.",
                    "Return the root cause, the first three remediation actions, and concrete evidence.")),
            "runtime", Map.of("language", "JavaScript")));

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      runtime.registerCallable("summarizeIncident", summarizeIncident);
      runtime.registerCallable("getTimeline", getTimeline);
      runtime.registerCallable("getRunbook", getRunbook);

      Map<String, Object> result = analyst.forward(
          client,
          Map.of(
              "incidentLog", buildIncidentLog(),
              "question", "Find the root cause, first three remediation actions, and concrete evidence for the checkout payment incident."),
          Map.of("runtime", runtime, "max_actor_steps", 30));

      System.out.println(Json.pretty(result));
    }
  }
}
