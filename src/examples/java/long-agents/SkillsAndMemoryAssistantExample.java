// ax-example:start
// title: Java Skills + Memory Ops Assistant
// group: long-agents
// description: An on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand, using the agent skills and memories subsystems.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class SkillsAndMemoryAssistantExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }

    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
        "api_key", apiKey,
        // gpt-4o (not -mini): the recall/discover loop needs reasoning to proactively
        // pull memories + runbooks instead of stopping to ask for clarification.
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4o"),
        "model_config", Map.of("temperature", 0.0)));

    // ---------------------------------------------------------------------------
    // Memory store -- remembered decisions and postmortems. In production this is a
    // vector DB / BM25 index; here a tiny KV. The actor pulls relevant entries into
    // scope via `await recall([...])`; the host search returns matching {id, content}.
    // ---------------------------------------------------------------------------
    List<Map<String, Object>> memoryStore = List.of(
        Map.of("id", "decision/db-failover",
            "content", "Decision (2026-02): during a primary DB failover, freeze writes via the feature flag `writes.enabled=false` BEFORE promoting the replica. Promoting first caused split-brain in inc-118."),
        Map.of("id", "postmortem/inc-118",
            "content", "inc-118 root cause: replica promoted while primary still accepted writes. Mitigation: write-freeze flag + 90s replication-lag gate."),
        Map.of("id", "decision/customer-comms",
            "content", "Decision: for Sev-1s affecting enterprise tenants, post a status-page update within 15 minutes and notify named TAMs directly."));

    // ---------------------------------------------------------------------------
    // Skill store -- runbooks loaded into the executor prompt on demand via
    // `await discover({ skills: [...] })`. Loaded skills persist across calls.
    // ---------------------------------------------------------------------------
    List<Map<String, Object>> skillStore = List.of(
        Map.of("id", "runbook-db-failover", "name", "DB failover runbook",
            "content", "## DB failover\n1. Set `writes.enabled=false`.\n2. Wait for replication lag < 5s.\n3. Promote replica.\n4. Re-point app via service discovery.\n5. Re-enable writes. 6. File postmortem within 48h."),
        Map.of("id", "runbook-status-comms", "name", "Status communications runbook",
            "content", "## Status comms\n- Sev-1: status-page update within 15m, every 30m thereafter.\n- Enterprise impact: notify named TAMs directly.\n- Keep updates factual; no ETAs you cannot keep."));

    // The host memory/skill subsystems resolve recall()/discover() against these
    // stores. A "*" wildcard returns every entry so any actor query surfaces the
    // relevant decisions and runbooks (substring matching in a real index).
    AxAgent assistant = Ax.agent(
        "situation:string -> guidance:string \"What to do, grounded in our decisions and runbooks\", steps:string[]",
        Map.of(
            "contextFields", List.of(),
            // A base skill always loaded, independent of search.
            "skills", List.of(Map.of(
                "name", "house-style",
                "content", "Be concise and operational. Prefer our remembered decisions over generic advice. Never invent flag names or steps -- cite the runbook.")),
            // Presence of these callbacks enables the memories/skills subsystems.
            "onMemoriesSearch", true,
            "onSkillsSearch", true,
            "memory_search_results", Map.of("*", memoryStore),
            "skill_search_results", Map.of("*", skillStore),
            "executorOptions", Map.of(
                "description", String.join("\n",
                    "You do NOT know our internal flag names, incident history, or runbook steps from your own training.",
                    "The only source of truth is our memory (past decisions/postmortems) and our runbook skills.",
                    "1. recall the relevant past decisions and postmortems (e.g. the failover decision, inc-118).",
                    "2. discover the matching runbook skill and read its exact steps and flag names.",
                    "3. Answer with the precise ordered procedure, citing our exact flag names and runbook steps.",
                    "Generic best-practice advice is WRONG here. Do NOT answer from general knowledge and do NOT ask for clarification -- recall and discover first.")),
            "runtime", Map.of("language", "JavaScript")));

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      Map<String, Object> result = assistant.forward(
          client,
          Map.of(
              "situation", String.join(" ",
                  "Our primary database is unhealthy and we're about to fail over -- the same class of",
                  "incident as inc-118, and enterprise checkout is affected. Per our remembered decisions",
                  "and runbooks: what is the exact ordered procedure, and which specific feature flag must",
                  "we set before promoting the replica?")),
          Map.of("runtime", runtime, "max_actor_steps", 12));

      System.out.println("\n=== Response ===");
      System.out.println(Json.pretty(result));
    }
  }
}
