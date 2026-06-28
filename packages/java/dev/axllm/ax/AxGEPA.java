package dev.axllm.ax;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class AxGEPA implements OptimizerEngine {
  private final AiClient reflectionClient;
  private final Map<String, Object> defaults;
  private final Map<String, Map<String, Object>> selectorState = new LinkedHashMap<>();
  private int rngState;

  public AxGEPA() {
    this(null, Map.of());
  }

  public AxGEPA(AiClient reflectionClient) {
    this(reflectionClient, Map.of());
  }

  public AxGEPA(AiClient reflectionClient, Map<String, Object> options) {
    this.reflectionClient = reflectionClient;
    this.defaults = new LinkedHashMap<>(options == null ? Map.of() : options);
    this.rngState = intOpt(this.defaults, "seed", 123456789);
    if (this.rngState == 0) this.rngState = 123456789;
  }

  @Override public String name() { return "GEPA"; }
  @Override public String version() { return "axir-gepa-v1"; }

  @Override
  public Map<String, Object> optimize(Map<String, Object> request) {
    return optimize(request, null);
  }

  private static double num(Object value, double fallback) {
    return value instanceof Number n ? n.doubleValue() : fallback;
  }

  private static int intOpt(Map<String, Object> opts, String key, int fallback) {
    Object value = opts.get(key);
    if (value == null && key.indexOf('_') < 0) value = opts.get(key.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase());
    return Math.max(0, (int) Math.floor(num(value, fallback)));
  }

  private double rand() {
    rngState ^= (rngState << 13);
    rngState ^= (rngState >>> 17);
    rngState ^= (rngState << 5);
    return (rngState & 0xffffffffL) / 4294967296.0;
  }

  private static Map<String, Object> currentMap(List<Object> components) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (Object raw : components) {
      Map<String, Object> component = Core.asMap(raw);
      Object id = component.get("id");
      Object current = component.getOrDefault("current", "");
      if (id != null && current instanceof String) out.put(String.valueOf(id), current);
    }
    return out;
  }

  private static List<Object> trainSet(Object dataset) {
    return Core.asList(Core.asMap(dataset).getOrDefault("train", List.of()));
  }

  private static List<Object> validationSet(Object dataset) {
    Map<String, Object> map = Core.asMap(dataset);
    List<Object> validation = Core.asList(map.getOrDefault("validation", List.of()));
    return validation.isEmpty() ? trainSet(dataset) : validation;
  }

  private static Map<String, Object> datasetFor(List<Object> examples) {
    return new LinkedHashMap<>(Map.of("train", new ArrayList<>(examples), "validation", List.of()));
  }

  private static Map<String, Object> avgVec(List<Object> rows) {
    Map<String, Double> sums = new LinkedHashMap<>();
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (Object rawRow : rows) {
      Map<String, Object> scores = Core.asMap(Core.asMap(rawRow).getOrDefault("scores", Map.of()));
      for (Map.Entry<String, Object> entry : scores.entrySet()) {
        if (entry.getValue() instanceof Number n) {
          sums.put(entry.getKey(), sums.getOrDefault(entry.getKey(), 0.0) + n.doubleValue());
          counts.put(entry.getKey(), counts.getOrDefault(entry.getKey(), 0) + 1);
        }
      }
    }
    Map<String, Object> out = new LinkedHashMap<>();
    for (String key : sums.keySet()) out.put(key, sums.get(key) / Math.max(1, counts.getOrDefault(key, 1)));
    return out;
  }

  private static double scalar(Map<String, Object> scores, Map<String, Object> opts) {
    Object key = opts.getOrDefault("paretoMetricKey", opts.get("pareto_metric_key"));
    if (key != null) return num(scores.get(String.valueOf(key)), 0);
    double sum = 0; int count = 0;
    for (Object value : scores.values()) if (value instanceof Number n) { sum += n.doubleValue(); count++; }
    return count == 0 ? 0 : sum / count;
  }

  private static boolean dominates(Map<String, Object> a, Map<String, Object> b, double eps) {
    Set<String> keys = new HashSet<>();
    keys.addAll(a.keySet());
    keys.addAll(b.keySet());
    boolean atLeast = true;
    boolean strict = false;
    for (String key : keys) {
      double av = num(a.get(key), 0);
      double bv = num(b.get(key), 0);
      if (av + eps < bv) { atLeast = false; break; }
      if (av > bv + eps) strict = true;
    }
    return atLeast && strict;
  }

  private static List<Map<String, Object>> paretoFront(List<Map<String, Object>> candidates, double eps) {
    List<Map<String, Object>> front = new ArrayList<>();
    for (int i = 0; i < candidates.size(); i++) {
      boolean isDominated = false;
      int dominated = 0;
      Map<String, Object> scores = Core.asMap(candidates.get(i).getOrDefault("scores", Map.of()));
      for (int j = 0; j < candidates.size(); j++) {
        if (i == j) continue;
        Map<String, Object> other = Core.asMap(candidates.get(j).getOrDefault("scores", Map.of()));
        if (dominates(other, scores, eps)) { isDominated = true; break; }
        if (dominates(scores, other, eps)) dominated++;
      }
      if (!isDominated) front.add(new LinkedHashMap<>(Map.of("idx", i, "scores", scores, "dominated", dominated)));
    }
    return front;
  }

  private static String extractText(Map<String, Object> response) {
    List<Object> results = Core.asList(response.getOrDefault("results", List.of()));
    if (results.isEmpty()) return "";
    Object content = Core.asMap(results.get(0)).get("content");
    if (!(content instanceof String raw)) return "";
    String text = raw.trim();
    if (text.startsWith("New Value:")) return text.substring("New Value:".length()).trim();
    String fence = "\u0060\u0060\u0060";
    int start = text.indexOf(fence);
    int end = text.lastIndexOf(fence);
    if (start >= 0 && end > start) {
      String inner = text.substring(start + 3, end).trim();
      int newline = inner.indexOf('\n');
      if (newline >= 0 && inner.substring(0, newline).trim().matches("[A-Za-z0-9_+-]+")) inner = inner.substring(newline + 1);
      return inner.trim();
    }
    return text;
  }

  private static Object validateValue(Map<String, Object> component, String value) {
    if (value == null || value.isBlank()) return "component value must be a non-empty string";
    if ("snake_case".equals(component.get("format")) && !value.matches("^[a-z_][a-z0-9_]*$")) return "must be snake_case";
    Object maxLength = component.get("maxLength");
    if (maxLength instanceof Number n && value.length() > n.intValue()) return "must be at most " + n.intValue() + " characters";
    for (Object literal : Core.asList(component.getOrDefault("preserve", List.of()))) if (!value.contains(String.valueOf(literal))) return "must preserve " + literal;
    return Boolean.TRUE;
  }

  private void initSelector(List<Object> components, Object initial) {
    selectorState.clear();
    Map<String, Object> initialMap = Core.asMap(initial);
    for (Object raw : components) {
      Map<String, Object> component = Core.asMap(raw);
      String id = String.valueOf(component.get("id"));
      Map<String, Object> old = Core.asMap(initialMap.getOrDefault(id, Map.of()));
      selectorState.put(id, new LinkedHashMap<>(Map.of(
        "proposals", Math.max(0, intOpt(old, "proposals", 0)),
        "accepts", Math.max(0, intOpt(old, "accepts", 0)),
        "lastAcceptIter", old.getOrDefault("lastAcceptIter", -1),
        "stagnation", Math.max(0, intOpt(old, "stagnation", 0))
      )));
    }
  }

  private Map<String, Object> pickComponent(List<Object> components, int iteration) {
    if (components.size() == 1) return Core.asMap(components.get(0));
    if (rand() < 0.1) return Core.asMap(components.get(Math.min(components.size() - 1, (int) Math.floor(rand() * components.size()))));
    int total = 0;
    for (Map<String, Object> state : selectorState.values()) total += intOpt(state, "proposals", 0);
    total = Math.max(1, total);
    List<Double> weights = new ArrayList<>();
    for (Object raw : components) {
      Map<String, Object> component = Core.asMap(raw);
      Map<String, Object> state = selectorState.get(String.valueOf(component.get("id")));
      int props = intOpt(state, "proposals", 0);
      int accepts = intOpt(state, "accepts", 0);
      double acceptRate = props == 0 ? 0 : ((double) accepts / props);
      double pressure = ((double) props) / total;
      int last = intOpt(state, "lastAcceptIter", -1);
      double stale = last < 0 ? Math.min(iteration + 1, 10) : Math.min(iteration - last, 10);
      weights.add(1.4 * (1 - acceptRate) + 0.8 * intOpt(state, "stagnation", 0) + 0.2 * stale - 0.7 * pressure);
    }
    double max = weights.stream().mapToDouble(Double::doubleValue).max().orElse(0);
    List<Double> exp = new ArrayList<>();
    double totalWeight = 0;
    for (double weight : weights) { double e = Math.exp(weight - max); exp.add(e); totalWeight += e; }
    double threshold = rand() * totalWeight;
    for (int i = 0; i < exp.size(); i++) {
      threshold -= exp.get(i);
      if (threshold <= 0) return Core.asMap(components.get(i));
    }
    return Core.asMap(components.get(components.size() - 1));
  }

  private void recordProposal(String id) {
    Map<String, Object> state = selectorState.get(id);
    if (state != null) state.put("proposals", intOpt(state, "proposals", 0) + 1);
  }

  private void recordResult(String id, boolean accepted, int iteration) {
    Map<String, Object> state = selectorState.get(id);
    if (state == null) return;
    if (accepted) {
      state.put("accepts", intOpt(state, "accepts", 0) + 1);
      state.put("lastAcceptIter", iteration);
      state.put("stagnation", 0);
    } else {
      state.put("stagnation", intOpt(state, "stagnation", 0) + 1);
    }
  }

  private List<Map<String, Object>> componentGroup(Map<String, Object> component, List<Object> components) {
    Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
    for (Object raw : components) byId.put(String.valueOf(Core.asMap(raw).get("id")), Core.asMap(raw));
    List<Map<String, Object>> out = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    visitComponent(String.valueOf(component.get("id")), byId, seen, out);
    return out;
  }

  private void visitComponent(String id, Map<String, Map<String, Object>> byId, Set<String> seen, List<Map<String, Object>> out) {
    if (seen.contains(id) || !byId.containsKey(id)) return;
    seen.add(id);
    Map<String, Object> item = byId.get(id);
    out.add(item);
    for (Object dep : Core.asList(item.getOrDefault("dependsOn", item.getOrDefault("depends_on", List.of())))) visitComponent(String.valueOf(dep), byId, seen, out);
  }

  private Map<String, Object> eval(OptimizerEvaluator evaluator, Map<String, Object> cfg, List<Object> examples, String phase, int maxCalls, int[] totalCalls, boolean required, boolean captureTraces) {
    if (totalCalls[0] + examples.size() > maxCalls) {
      if (required) throw new RuntimeException("AxGEPA: options.maxMetricCalls=" + maxCalls + " is too small to evaluate the initial Pareto set; need at least " + examples.size() + " metric calls");
      return null;
    }
    Map<String, Object> evalOptions = new LinkedHashMap<>();
    evalOptions.put("dataset", datasetFor(examples));
    evalOptions.put("phase", phase);
    evalOptions.put("captureTraces", captureTraces);
    Map<String, Object> result = Core.asMap(evaluator.evaluate(new LinkedHashMap<>(cfg), evalOptions));
    List<Object> rows = Core.asList(result.getOrDefault("rows", List.of()));
    List<Object> scalars = new ArrayList<>();
    for (Object row : rows) scalars.add(num(Core.asMap(row).get("scalar"), 0));
    int count = ((Number) result.getOrDefault("count", rows.size())).intValue();
    totalCalls[0] += count;
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("rows", rows);
    out.put("avgScores", avgVec(rows));
    out.put("avg", num(result.get("avg"), 0));
    out.put("sum", num(result.get("sum"), 0));
    out.put("count", count);
    out.put("scalars", scalars);
    return out;
  }

  private String reflect(Map<String, Object> component, String current, List<Object> tuples, List<Object> traceDataset, Map<String, Object> options) {
    if (reflectionClient == null) throw new RuntimeException("AxGEPA requires a reflection_client for reflective trials");
    int attempts = Math.max(1, intOpt(options, "maxReflectionAttempts", 2));
    Object previous = null;
    for (int i = 0; i < attempts; i++) {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("componentKey", component.get("id"));
      payload.put("componentKind", component.get("kind"));
      payload.put("currentValue", current);
      payload.put("previousValidationError", previous);
      payload.put("minibatch", tuples);
      payload.put("traceDataset", traceDataset);
      try {
        Map<String, Object> response = reflectionClient.chat(Map.of("chatPrompt", List.of(Map.of("role", "user", "content", Json.stringify(payload)))));
        String candidate = extractText(response);
        Object validation = validateValue(component, candidate);
        if (Boolean.TRUE.equals(validation)) return candidate;
        previous = validation;
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
    return current;
  }

  @Override
  public Map<String, Object> optimize(Map<String, Object> request, OptimizerEvaluator evaluator) {
    if (evaluator == null) throw new RuntimeException("AxGEPA requires an OptimizerEvaluator");
    Map<String, Object> options = new LinkedHashMap<>(defaults);
    options.putAll(Core.asMap(request.getOrDefault("options", Map.of())));
    List<Object> components = Core.asList(request.getOrDefault("components", List.of()));
    if (components.isEmpty()) throw new RuntimeException("AxGEPA: program exposes no optimizable components");
    Object dataset = request.getOrDefault("dataset", Map.of());
    List<Object> train = trainSet(dataset);
    List<Object> validation = validationSet(dataset);
    int maxCalls = intOpt(options, "maxMetricCalls", 0);
    if (maxCalls <= 0) throw new RuntimeException("AxGEPA: options.maxMetricCalls must be set to a positive integer");
    int numTrials = intOpt(options, "numTrials", 30);
    boolean minibatch = !Boolean.FALSE.equals(options.getOrDefault("minibatch", Boolean.TRUE));
    int minibatchSize = Math.max(1, intOpt(options, "minibatchSize", 20));
    int earlyStop = Math.max(1, intOpt(options, "earlyStoppingTrials", 5));
    double minImprovement = num(options.getOrDefault("minImprovementThreshold", options.get("min_improvement_threshold")), 0);
    int paretoSize = Math.min(1000, Math.max(1, intOpt(options, "paretoSetSize", Math.max(10, Math.min(200, minibatchSize * 3)))));
    double tieEps = num(options.getOrDefault("tieEpsilon", options.get("tie_epsilon")), 0);
    Map<String, Object> baseCfg = currentMap(components);
    List<Object> paretoSet = validation.subList(0, Math.min(validation.size(), paretoSize));
    initSelector(components, options.getOrDefault("selectorState", options.get("selector_state")));
    int[] totalCalls = new int[] {0};
    List<Object> demos = new ArrayList<>();
    Object bootstrapRaw = options.get("bootstrap");
    if (Core.truthy(bootstrapRaw)) {
      Map<String, Object> bootstrap = Core.asMap(bootstrapRaw);
      double threshold = num(bootstrap.getOrDefault("scoreThreshold", bootstrap.getOrDefault("score_threshold", 0.8)), 0.8);
      int maxDemos = Math.max(1, intOpt(bootstrap, "maxBootstrapDemos", 4));
      int maxBootCalls = Math.max(1, intOpt(bootstrap, "maxBootstrapMetricCalls", Math.min(train.size(), 8)));
      int bootCalls = 0;
      for (Object example : train) {
        if (bootCalls >= maxBootCalls || demos.size() >= maxDemos) break;
        Map<String, Object> bootEval = eval(evaluator, baseCfg, List.of(example), "bootstrap", maxCalls, totalCalls, false, false);
        bootCalls++;
        if (bootEval == null) break;
        List<Object> rows = Core.asList(bootEval.getOrDefault("rows", List.of()));
        if (!rows.isEmpty() && num(Core.asMap(rows.get(0)).get("scalar"), 0) >= threshold) {
          Map<String, Object> demo = new LinkedHashMap<>();
          demo.put("programId", "root");
          demo.put("traces", List.of(Core.asMap(rows.get(0)).getOrDefault("prediction", Core.asMap(rows.get(0)).getOrDefault("input", Map.of()))));
          demos.add(demo);
        }
      }
    }
    Map<String, Object> baseEval = eval(evaluator, baseCfg, paretoSet, "initial Pareto evaluation", maxCalls, totalCalls, true, false);
    List<Map<String, Object>> candidates = new ArrayList<>();
    candidates.add(new LinkedHashMap<>(Map.of("cfg", new LinkedHashMap<>(baseCfg), "scores", Core.asMap(baseEval.getOrDefault("avgScores", Map.of("score", baseEval.get("avg")))))));
    List<List<Object>> perInstance = new ArrayList<>();
    perInstance.add(Core.asList(baseEval.get("scalars")));
    int stagnation = 0;
    for (int iteration = 0; iteration < numTrials; iteration++) {
      if (totalCalls[0] >= maxCalls) break;
      int parentIdx = 0;
      double parentAvg = Double.NEGATIVE_INFINITY;
      for (int i = 0; i < perInstance.size(); i++) {
        double sum = 0; for (Object v : perInstance.get(i)) sum += num(v, 0);
        double avg = perInstance.get(i).isEmpty() ? 0 : sum / perInstance.get(i).size();
        if (avg > parentAvg) { parentAvg = avg; parentIdx = i; }
      }
      List<Object> mini = minibatch ? new ArrayList<>() : new ArrayList<>(train);
      if (minibatch) for (int i = 0; i < Math.min(minibatchSize, train.size()); i++) mini.add(train.get((iteration * minibatchSize + i) % train.size()));
      Map<String, Object> parentEval = eval(evaluator, Core.asMap(candidates.get(parentIdx).get("cfg")), mini, "parent minibatch", maxCalls, totalCalls, false, true);
      if (parentEval == null) break;
      double perfect = num(options.getOrDefault("perfectScore", options.get("perfect_score")), 1);
      boolean allPerfect = !Core.asList(parentEval.get("scalars")).isEmpty();
      for (Object score : Core.asList(parentEval.get("scalars"))) if (num(score, 0) < perfect) allPerfect = false;
      if (!Boolean.FALSE.equals(options.getOrDefault("skipPerfectScore", options.getOrDefault("skip_perfect_score", Boolean.TRUE))) && allPerfect) continue;
      Map<String, Object> target = pickComponent(components, iteration);
      List<Map<String, Object>> group = componentGroup(target, components);
      Map<String, Object> proposed = new LinkedHashMap<>(Core.asMap(candidates.get(parentIdx).get("cfg")));
      List<Object> rows = Core.asList(parentEval.get("rows"));
      List<Object> tuples = new ArrayList<>();
      List<Object> traceDataset = new ArrayList<>();
      for (Object rowRaw : rows) {
        Map<String, Object> row = Core.asMap(rowRaw);
        Map<String, Object> tuple = new LinkedHashMap<>();
        tuple.put("input", row.get("input"));
        tuple.put("prediction", row.get("prediction"));
        tuple.put("score", row.getOrDefault("scalar", 0));
        tuples.add(tuple);
        Map<String, Object> traceRow = new LinkedHashMap<>();
        traceRow.put("score", row.getOrDefault("scalar", 0));
        traceRow.put("trace", row.get("trace"));
        traceRow.put("output", row.get("prediction"));
        traceDataset.add(traceRow);
      }
      for (Map<String, Object> component : group) {
        String id = String.valueOf(component.get("id"));
        recordProposal(id);
        proposed.put(id, reflect(component, String.valueOf(proposed.getOrDefault(id, "")), tuples, traceDataset, options));
      }
      Map<String, Object> childMini = eval(evaluator, proposed, mini, "child minibatch", maxCalls, totalCalls, false, false);
      if (childMini == null) break;
      boolean accepted = num(childMini.get("sum"), 0) > num(parentEval.get("sum"), 0) + minImprovement;
      for (Map<String, Object> component : group) recordResult(String.valueOf(component.get("id")), accepted, iteration);
      if (!accepted) {
        if (++stagnation >= earlyStop) break;
        continue;
      }
      Map<String, Object> childEval = eval(evaluator, proposed, paretoSet, "validation evaluation", maxCalls, totalCalls, false, false);
      if (childEval == null) break;
      candidates.add(new LinkedHashMap<>(Map.of("cfg", new LinkedHashMap<>(proposed), "scores", Core.asMap(childEval.getOrDefault("avgScores", Map.of("score", childEval.get("avg")))))));
      perInstance.add(Core.asList(childEval.get("scalars")));
      stagnation = 0;
    }
    List<Map<String, Object>> front = paretoFront(candidates, tieEps);
    int bestIdx = front.isEmpty() ? 0 : ((Number) front.get(0).get("idx")).intValue();
    double bestScore = Double.NEGATIVE_INFINITY;
    for (Map<String, Object> item : front) {
      double score = scalar(Core.asMap(item.get("scores")), options);
      int idx = ((Number) item.get("idx")).intValue();
      if (score > bestScore || (score == bestScore && idx > bestIdx)) { bestScore = score; bestIdx = idx; }
    }
    Map<String, Object> bestCfg = Core.asMap(candidates.get(bestIdx).get("cfg"));
    Map<String, Object> owners = new LinkedHashMap<>();
    for (Object raw : components) {
      Map<String, Object> c = Core.asMap(raw);
      String id = String.valueOf(c.get("id"));
      owners.put(id, c.getOrDefault("owner", id.split("::")[0]));
    }
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("optimizer", "GEPA");
    metadata.put("selectorState", new LinkedHashMap<>(selectorState));
    metadata.put("paretoFront", front);
    metadata.put("bestScore", bestScore == Double.NEGATIVE_INFINITY ? 0 : bestScore);
    metadata.put("totalMetricCalls", totalCalls[0]);
    metadata.put("candidatesExplored", candidates.size());
    metadata.put("report", Map.of("summary", "GEPA Multi-Objective Optimization Complete", "statistics", Map.of("totalEvaluations", totalCalls[0], "candidatesExplored", candidates.size(), "converged", true), "paretoFrontier", Map.of("solutionCount", front.size())));
    Map<String, Object> artifact = new LinkedHashMap<>();
    artifact.put("artifactVersion", "axir-optimized-artifact-v1");
    artifact.put("optimizerName", "GEPA");
    artifact.put("optimizerVersion", version());
    artifact.put("componentMap", new LinkedHashMap<>(bestCfg));
    artifact.put("demos", demos);
    artifact.put("metadata", metadata);
    artifact.put("evidence", Map.of("avg", bestScore == Double.NEGATIVE_INFINITY ? 0 : bestScore, "count", paretoSet.size(), "totalMetricCalls", totalCalls[0]));
    artifact.put("provenance", Map.of("sourceProgramKind", request.getOrDefault("programKind", "unknown"), "componentOwners", owners));
    return artifact;
  }
}
