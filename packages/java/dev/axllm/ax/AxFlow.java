package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxFlow implements AxProgram {
  public interface Mapper {
    Object apply(Map<String, Object> state);
  }

  final Map<String, Object> state;
  final Map<String, Object> options;
  final AxExecutionContext executionContext;

  public AxFlow() {
    this(Map.of());
  }

  public AxFlow(Map<String, Object> options) {
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
    this.executionContext = AxExecutionContext.resolve(this.options, null);
    this.state = Core.asMap(Core._flow_factory(this.options));
  }

  public AxFlow execute(String name, AxProgram program) {
    return execute(name, program, Map.of());
  }

  public AxFlow execute(String name, AxProgram program, Map<String, Object> options) {
    return addStep("execute", name, program, options);
  }

  public AxFlow derive(String name, AxProgram program) {
    return derive(name, program, Map.of());
  }

  public AxFlow derive(String name, AxProgram program, Map<String, Object> options) {
    return addStep("derive", name, program, options);
  }

  public AxFlow map(String name, Mapper mapper) {
    return addStep("map", name, mapper, Map.of());
  }

  public AxFlow map(String name, Mapper mapper, Map<String, Object> options) {
    return addStep("map", name, mapper, options == null ? Map.of() : options);
  }

  public AxFlow branch(String name, Mapper predicate, List<Map<String, Object>> branches) {
    return branch(name, predicate, branches, Map.of());
  }

  public AxFlow branch(String name, Mapper predicate, List<Map<String, Object>> branches, Map<String, Object> options) {
    Map<String, Object> opts = new LinkedHashMap<>(options == null ? Map.of() : options);
    opts.put("predicate", predicate);
    opts.put("branches", branches == null ? List.of() : branches);
    return addStep("branch", name, null, opts);
  }

  public AxFlow whileLoop(String name, Mapper condition, List<Map<String, Object>> steps, int maxIterations) {
    Map<String, Object> opts = new LinkedHashMap<>();
    opts.put("condition", condition);
    opts.put("steps", steps == null ? List.of() : steps);
    opts.put("maxIterations", maxIterations);
    return addStep("while", name, null, opts);
  }

  public AxFlow feedback(String name, Mapper condition, List<Map<String, Object>> steps, int maxIterations) {
    Map<String, Object> opts = new LinkedHashMap<>();
    opts.put("condition", condition);
    opts.put("steps", steps == null ? List.of() : steps);
    opts.put("maxIterations", maxIterations);
    opts.put("label", name);
    return addStep("feedback", name, null, opts);
  }

  public AxFlow nodeExtended(String name, String baseSignature, Map<String, Object> extensions, Map<String, Object> options) {
    String signature = String.valueOf((extensions == null ? Map.of() : extensions).getOrDefault("extended_signature", (extensions == null ? Map.of() : extensions).getOrDefault("extendedSignature", baseSignature)));
    return execute(name, new AxGen(AxSignature.create(signature), options == null ? Map.of() : options), options == null ? Map.of() : options);
  }

  public AxFlow nx(String name, String baseSignature, Map<String, Object> extensions, Map<String, Object> options) {
    return nodeExtended(name, baseSignature, extensions, options);
  }

  public AxFlow parallel(List<Map<String, Object>> steps) {
    for (Map<String, Object> step : steps == null ? List.<Map<String, Object>>of() : steps) {
      addStep(String.valueOf(step.getOrDefault("kind", "execute")), String.valueOf(step.get("name")), step.get("program"), Core.asMap(step.getOrDefault("options", Map.of())));
    }
    return this;
  }

  public AxFlow returns(Map<String, Object> spec) {
    Core._flow_set_returns(state, spec == null ? Map.of() : spec);
    return this;
  }

  public AxFlow setDemos(Object demos) {
    if (demos instanceof Map<?, ?>) return setDemos(Core.asMap(demos));
    List<Object> demoList = Core.asList(demos);
    if (!demoList.isEmpty()) {
      String owner = String.valueOf(state.getOrDefault("program_id", "root.flow"));
      java.util.Set<String> knownIds = new java.util.LinkedHashSet<>();
      knownIds.add(owner);
      knownIds.add("root");
      for (Object raw : Core.asList(state.getOrDefault("steps", List.of()))) {
        String name = String.valueOf(Core.asMap(raw).getOrDefault("name", ""));
        if (!name.isBlank()) {
          knownIds.add(owner + "." + name);
          knownIds.add("root." + name);
        }
      }
      java.util.Set<String> unknown = new java.util.TreeSet<>();
      for (Object raw : demoList) {
        Object id = Core.asMap(raw).get("programId");
        if (id != null && !knownIds.contains(String.valueOf(id))) unknown.add(String.valueOf(id));
      }
      if (!unknown.isEmpty()) throw new RuntimeException("Unknown program ID(s) in demos: " + String.join(", ", unknown));
      state.put("demos", new ArrayList<>(demoList));
    }
    return this;
  }

  public AxFlow setDemos(Map<String, Object> demos) {
    Map<String, Object> demoMap = demos == null ? Map.of() : demos;
    List<Object> steps = Core.asList(state.getOrDefault("steps", List.of()));
    for (String name : demoMap.keySet()) {
      boolean found = false;
      for (Object raw : steps) {
        Map<String, Object> step = Core.asMap(raw);
        if (name.equals(step.get("name"))) {
          found = true;
          Object program = step.get("program");
          if (program instanceof AxGen gen) gen.setDemos(Core.asMapList(demoMap.get(name)));
        }
      }
      if (!found) throw new RuntimeException("unknown flow node in demos: " + name);
    }
    state.put("demos", new LinkedHashMap<>(demoMap));
    return this;
  }

  public Map<String, Object> getPlan() {
    return Core.asMap(Core._flow_plan(state));
  }

  public List<Map<String, Object>> getTraces() {
    return Core.asMapList(state.getOrDefault("traces", List.of()));
  }

  public List<Map<String, Object>> getChatLog() {
    return Core.asMapList(state.getOrDefault("chat_log", List.of()));
  }

  public Map<String, Object> getUsage() {
    return Core.asMap(state.getOrDefault("usage", Map.of()));
  }

  public List<Map<String, Object>> getOptimizableComponents() {
    return Core.asMapList(Core._flow_get_optimizable_components(state));
  }

  public AxFlow applyOptimizedComponents(Map<String, Object> componentMap) {
    Core._flow_apply_optimized_components(state, componentMap == null ? Map.of() : componentMap);
    return this;
  }

  public AxFlow applyOptimization(Object artifact) {
    List<Map<String, Object>> components = getOptimizableComponents();
    Map<String, Object> map = artifact instanceof String text
      ? Core.asMap(Core._deserialize_optimized_artifact(text, components))
      : Core.asMap(Core._validate_optimized_artifact(artifact == null ? Map.of() : artifact, components));
    return applyOptimizedComponents(Core.asMap(map.getOrDefault("componentMap", Map.of())));
  }

  public Map<String, Object> evaluateOptimization(AiClient client, Object dataset, Map<String, Object> candidateMap, Map<String, Object> options) {
    return Core.asMap(Core._flow_evaluate_optimization(state, client, dataset == null ? List.of() : dataset, candidateMap == null ? Map.of() : candidateMap, options == null ? Map.of() : options));
  }

  public Map<String, Object> optimizeWith(OptimizerEngine engine, List<Map<String, Object>> dataset, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Object client = opts.getOrDefault("client", opts.get("ai"));
    Map<String, Object> request = Core.asMap(Core._flow_optimize_with(state, dataset == null ? List.of() : dataset, opts, client instanceof AiClient));
    OptimizerEvaluator evaluator = null;
      if (client instanceof AiClient aiClient) {
      evaluator = (candidateMap, evalOptions) -> {
        Map<String, Object> merged = new LinkedHashMap<>(Core.asMap(Core.mapMerge(opts, evalOptions == null ? Map.of() : evalOptions)));
        Object evalDataset = merged.containsKey("dataset") ? merged.remove("dataset") : merged.remove("_dataset");
        return evaluateOptimization(aiClient, evalDataset == null ? (dataset == null ? List.of() : dataset) : evalDataset, candidateMap, merged);
      };
      }
    Map<String, Object> response = evaluator == null ? engine.optimize(request) : engine.optimize(request, evaluator);
    Map<String, Object> artifact = Core.asMap(Core._normalize_optimizer_engine_response(response, engine.name(), engine.version(), getOptimizableComponents()));
    if (!Boolean.FALSE.equals(opts.getOrDefault("apply", Boolean.TRUE))) applyOptimization(artifact);
    return artifact;
  }

  public Map<String, Object> optimize(List<Map<String, Object>> dataset, Map<String, Object> options) {
    Object engine = options == null ? null : options.getOrDefault("engine", options.get("optimizer"));
    if (!(engine instanceof OptimizerEngine optimizer)) throw new IllegalArgumentException("options.engine must implement OptimizerEngine for optimize()");
    return optimizeWith(optimizer, dataset, options);
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> options) {
    Map<String, Object> callOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    AxExecutionContext context = AxExecutionContext.resolve(callOptions, executionContext);
    if (context != null) {
      callOptions.put("executionContext", context);
      callOptions.put("mcp", context.mcp());
      callOptions.put("ucp", context.ucp());
    }
    return Core.asMap(Core._flow_forward(state, client, values == null ? Map.of() : values, callOptions));
  }

  public List<Map<String, Object>> streamingForward(AiClient client, Map<String, Object> values, Map<String, Object> options) {
    return List.of(Map.of("version", 1, "index", 0, "delta", forward(client, values, options)));
  }

  private AxFlow addStep(String kind, String name, Object program, Map<String, Object> options) {
    Core._flow_add_step(state, Core._flow_step(kind, name, program, options == null ? Map.of() : options));
    return this;
  }
}
