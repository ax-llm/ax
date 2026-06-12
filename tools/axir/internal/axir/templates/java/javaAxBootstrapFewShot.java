package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class AxBootstrapFewShot implements OptimizerEngine {
  private final Map<String, Object> options;

  public AxBootstrapFewShot() {
    this(Map.of());
  }

  public AxBootstrapFewShot(Map<String, Object> options) {
    this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
  }

  public String name() {
    return "BootstrapFewShot";
  }

  public String version() {
    return "axir-bootstrap-fewshot-v1";
  }

  public Map<String, Object> optimize(Map<String, Object> request) {
    return optimize(request, null);
  }

  public Map<String, Object> optimize(Map<String, Object> request, OptimizerEvaluator evaluator) {
    if (evaluator == null) throw new RuntimeException("AxBootstrapFewShot requires an OptimizerEvaluator");
    Map<String, Object> opts = new LinkedHashMap<>(options);
    opts.putAll(Core.asMap((request == null ? Map.of() : request).getOrDefault("options", Map.of())));
    List<Map<String, Object>> components = Core.asMapList((request == null ? Map.of() : request).getOrDefault("components", List.of()));
    Map<String, Object> dataset = Core.asMap((request == null ? Map.of() : request).getOrDefault("dataset", Map.of()));
    List<Object> train = Core.asList(dataset.getOrDefault("train", List.of()));
    double threshold = num(option(opts, "qualityThreshold", "quality_threshold", 0.5), 0.5);
    int maxRounds = intOption(opts, 3, 1, "maxRounds", "max_rounds");
    int maxExamples = intOption(opts, 16, 1, "maxExamples", "max_examples");
    int maxDemos = intOption(opts, 4, 1, "maxDemos", "max_demos");
    int batchSize = intOption(opts, 1, 1, "batchSize", "batch_size");
    Map<String, Object> base = Core.asMap(Core._optimization_component_current_map(components));
    List<Object> demos = new ArrayList<>();
    Set<String> accepted = new LinkedHashSet<>();
    int totalCalls = 0;
    List<Object> sampled = train.subList(0, Math.min(maxExamples, train.size()));
    for (int round = 0; round < maxRounds && demos.size() < maxDemos; round++) {
      for (int offset = 0; offset < sampled.size() && demos.size() < maxDemos; offset += batchSize) {
        for (Object example : sampled.subList(offset, Math.min(offset + batchSize, sampled.size()))) {
          if (demos.size() >= maxDemos) break;
          String exampleKey = Json.stableStringify(example);
          if (accepted.contains(exampleKey)) continue;
          Map<String, Object> evalOptions = new LinkedHashMap<>();
          evalOptions.put("dataset", Map.of("train", List.of(example), "validation", List.of()));
          evalOptions.put("phase", "bootstrap");
          evalOptions.put("round", round);
          Map<String, Object> result = evaluator.evaluate(base, evalOptions);
          List<Object> rows = Core.asList(result.getOrDefault("rows", List.of()));
          totalCalls += ((Number) result.getOrDefault("count", rows.isEmpty() ? 1 : rows.size())).intValue();
          if (rows.isEmpty()) continue;
          Map<String, Object> row = Core.asMap(rows.get(0));
          if (num(row.get("scalar"), 0) >= threshold) {
            accepted.add(exampleKey);
            demos.add(Map.of("programId", "root", "traces", List.of(row.getOrDefault("prediction", row.getOrDefault("input", Map.of())))));
          }
        }
      }
    }
    Map<String, Object> artifact = new LinkedHashMap<>();
    artifact.put("artifactVersion", "axir-optimized-artifact-v1");
    artifact.put("optimizerName", name());
    artifact.put("optimizerVersion", version());
    artifact.put("componentMap", Map.of());
    artifact.put("demos", demos);
    artifact.put("metadata", Map.of("optimizer", name(), "qualityThreshold", threshold, "totalMetricCalls", totalCalls, "demosGenerated", demos.size()));
    artifact.put("evidence", Map.of("count", totalCalls));
    artifact.put("provenance", Map.of("sourceProgramKind", (request == null ? Map.of() : request).getOrDefault("programKind", "unknown")));
    return artifact;
  }

  private static Object option(Map<String, Object> opts, String key1, String key2, Object fallback) {
    if (opts.containsKey(key1) && opts.get(key1) != null) return opts.get(key1);
    if (opts.containsKey(key2) && opts.get(key2) != null) return opts.get(key2);
    return fallback;
  }

  private static int intOption(Map<String, Object> opts, int fallback, int minimum, String key1, String key2) {
    return Math.max(minimum, (int) Math.floor(num(option(opts, key1, key2, fallback), fallback)));
  }

  private static double num(Object value, double fallback) {
    if (value instanceof Number number && Double.isFinite(number.doubleValue())) return number.doubleValue();
    return fallback;
  }
}
