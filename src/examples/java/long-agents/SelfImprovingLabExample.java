// ax-example:start
// title: Java Self-Improving Lab Agent
// group: long-agents
// description: A many-tool agent that runs experiments, grades them against a rubric with an independent verifier, and distills verified rules into memory -- iterating until the rubric passes.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 40
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;
import java.util.regex.*;

public final class SelfImprovingLabExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  // ---------------------------------------------------------------------------
  // The "lab": a deterministic black-box experiment. It scores an ETL config plan
  // against a hidden ideal and returns, for any failing check, the exact fix --
  // so the agent can converge by following the feedback, not by being told.
  // ---------------------------------------------------------------------------
  static final List<String> CHECKS = List.of(
      "no-nulls", "no-duplicates", "numeric-types", "trimmed-strings", "outliers-handled");
  static final Map<String, String> REMEDIES = Map.of(
      "no-nulls", "set nullPolicy=impute (or nullPolicy=drop)",
      "no-duplicates", "set dedup=on",
      "numeric-types", "set coerceTypes=on",
      "trimmed-strings", "set trim=on",
      "outliers-handled", "set outlier=clip (or outlier=winsorize)");

  static Map<String, Object> runInSandbox(String plan) {
    Map<String, String> flags = new LinkedHashMap<>();
    Matcher m = Pattern.compile("([a-z]+)\\s*=\\s*([a-z0-9]+)").matcher(plan.toLowerCase());
    while (m.find()) flags.put(m.group(1), m.group(2));

    Map<String, Boolean> ok = new LinkedHashMap<>();
    ok.put("no-nulls", List.of("impute", "drop").contains(flags.getOrDefault("nullpolicy", "")));
    ok.put("no-duplicates", "on".equals(flags.get("dedup")));
    ok.put("numeric-types", "on".equals(flags.get("coercetypes")));
    ok.put("trimmed-strings", "on".equals(flags.get("trim")));
    ok.put("outliers-handled", List.of("clip", "winsorize").contains(flags.getOrDefault("outlier", "")));

    List<String> passed = new ArrayList<>();
    List<Map<String, Object>> failed = new ArrayList<>();
    for (String c : CHECKS) {
      if (Boolean.TRUE.equals(ok.get(c))) passed.add(c);
      else failed.add(Map.of("check", c, "fix", REMEDIES.get(c)));
    }
    double score = Math.round(((double) passed.size() / CHECKS.size()) * 100.0) / 100.0;
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("score", score);
    out.put("solved", passed.size() == CHECKS.size());
    out.put("passed", passed);
    out.put("failed", failed);
    out.put("logs", passed.size() + "/" + CHECKS.size() + " checks passed");
    return out;
  }

  static Map<String, Object> spec(String name, String description, Map<String, Object> props, List<String> required) {
    Map<String, Object> parameters = new LinkedHashMap<>();
    parameters.put("type", "object");
    parameters.put("properties", props);
    if (required != null && !required.isEmpty()) parameters.put("required", required);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", name);
    out.put("description", description);
    out.put("parameters", parameters);
    return out;
  }

  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }

    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4o-mini"),
        "model_config", Map.of("temperature", 0.0)));

    // An independent verifier -- a separate ax() program, not the agent grading itself.
    AxGen verifier = Ax.ax("rubric:string, evidence:json -> passed:boolean, feedback:string, missing:string[]");
    verifier.setInstruction(
        "You are an independent rubric grader, not a self-critique. Pass only when the evidence clearly satisfies every part of the rubric.");

    // In-memory rule store. Verified, reusable rules go here -- not raw failure notes.
    Map<String, String> memoryStore = new LinkedHashMap<>();

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      runtime.registerCallable("runExperiment", params -> runInSandbox(String.valueOf(asMap(params).getOrDefault("plan", ""))));
      runtime.registerCallable("listChecks", params -> CHECKS);
      runtime.registerCallable("grade", params -> {
        Map<String, Object> p = asMap(params);
        return verifier.forward(client, Map.of(
            "rubric", p.getOrDefault("rubric", ""),
            "evidence", p.getOrDefault("evidence", List.of())));
      });
      runtime.registerCallable("recall", params -> {
        String topic = String.valueOf(asMap(params).getOrDefault("topic", "")).toLowerCase();
        List<String> words = topic.isBlank() ? List.of() : Arrays.asList(topic.split("\\s+"));
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, String> e : memoryStore.entrySet()) {
          boolean hit = e.getKey().contains(topic);
          for (String w : words) if (!w.isBlank() && e.getKey().contains(w)) hit = true;
          if (hit) out.add(e.getValue());
        }
        return out;
      });
      runtime.registerCallable("remember", params -> {
        Map<String, Object> p = asMap(params);
        String rule = String.valueOf(p.getOrDefault("rule", ""));
        String key = rule.toLowerCase();
        key = key.substring(0, Math.min(48, key.length()));
        memoryStore.put(key, rule + " :: " + p.getOrDefault("evidence", ""));
        return Map.of("stored", true, "total", memoryStore.size());
      });

      AxAgent selfImproving = Ax.agent(
          "goal:string, rubric:string -> answer:string, experiments:string[] \"Plans tried, in order\", learnedRules:string[]",
          Map.of(
              "contextFields", List.of(),
              "functions", List.of(
                  spec("runExperiment", "Apply an ETL config plan; returns score, solved, passed[], failed[{check,fix}], logs. Pass an empty plan to discover the fixes.",
                      Map.of("plan", Map.of("type", "string")), List.of("plan")),
                  spec("listChecks", "List the data-quality checks the experiment evaluates.", Map.of(), List.of()),
                  spec("grade", "Independent rubric grader. Pass only when the evidence meets the rubric.",
                      Map.of("rubric", Map.of("type", "string"), "evidence", Map.of("type", "array", "items", Map.of("type", "string"))),
                      List.of("rubric", "evidence")),
                  spec("recall", "Recall verified rules relevant to a topic.",
                      Map.of("topic", Map.of("type", "string")), List.of("topic")),
                  spec("remember", "Store a verified, reusable rule (the rule, not raw notes).",
                      Map.of("rule", Map.of("type", "string"), "evidence", Map.of("type", "string")), List.of("rule", "evidence"))),
              "contextPolicy", Map.of("preset", "adaptive", "budget", "balanced"),
              "executorOptions", Map.of(
                  "description", String.join("\n",
                      "Use the tools -- do not answer from your own knowledge.",
                      "1. recall('etl data quality') to reuse anything already learned.",
                      "2. runExperiment('') once to see every failing check and its fix.",
                      "3. Build a plan applying all the fixes, then runExperiment again. Repeat until solved is true.",
                      "4. grade the passing evidence against the rubric.",
                      "5. For each check you fixed, remember(rule, evidence).",
                      "6. Then return the answer, the plans you tried, and the learned rules.")),
              "runtime", Map.of("language", "JavaScript")));

      Map<String, Object> result = selfImproving.forward(
          client,
          Map.of(
              "goal", "Find an ETL config plan that cleans the dirty dataset so every data-quality check passes.",
              "rubric", "All five checks (no-nulls, no-duplicates, numeric-types, trimmed-strings, outliers-handled) must pass, i.e. score 1.0. The deliverable must also record at least one verified, reusable learnedRule."),
          Map.of("runtime", runtime, "max_actor_steps", 18));

      System.out.println(Json.pretty(result));

      // Persist the agent's verified rules so a future run's recall reuses them.
      Object learned = result.get("learnedRules");
      if (learned instanceof List<?> rules) {
        for (Object rule : rules) {
          String s = String.valueOf(rule).toLowerCase();
          memoryStore.put(s.substring(0, Math.min(48, s.length())), String.valueOf(rule));
        }
      }
      System.out.println("\nMemory now holds " + memoryStore.size() + " rule(s) for next time.");
    }
  }
}
