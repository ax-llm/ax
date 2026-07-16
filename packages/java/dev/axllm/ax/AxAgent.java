package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxAgent implements AxProgram {
  final Map<String, Object> options;
  final AxExecutionContext executionContext;
  Map<String, Object> state;
  Object signature;
  AxGen distiller;
  AxGen executor;
  AxGen responder;
  AxGen llmQuery;
  AxPlaybook playbookHandle;
  Object playbookConfig;

  public AxAgent(String signature, Map<String, Object> options) {
    this((Object) signature, options);
  }

  @SuppressWarnings("unchecked")
  public AxAgent(Object signature, Map<String, Object> options) {
    this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
    this.executionContext = AxExecutionContext.resolve(this.options, null);
    if (executionContext != null) {
      List<Object> functions = new ArrayList<>(Core.asList(this.options.getOrDefault("functions", List.of())));
      functions.addAll(executionContext.runtimeModules());
      this.options.put("functions", functions);
      this.options.put("executionContext", executionContext);
    }
    this.playbookConfig = this.options.get("playbook");
    rebuildFromSignature(signature);
    if (this.playbookConfig != null && !Boolean.FALSE.equals(this.playbookConfig)) {
      attachConfiguredPlaybook();
    }
  }

  @SuppressWarnings("unchecked")
  private void rebuildFromSignature(Object signature) {
    this.state = Core.asMap(Core._agent_factory(signature, this.options));
    this.signature = Core.get(state, "signature", signature);
    this.distiller = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "distiller_signature", "input:json -> completion:json"))), childOptions(0, "ctx.root.actor", Core.get(state, "distiller_description", "")));
    this.executor = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "executor_signature", "input:json -> completion:json"))), childOptions(0, "task.root.actor", Core.get(state, "executor_description", "")));
    this.responder = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "responder_signature", "input:json -> completion:json"))), childOptions(this.options.getOrDefault("validation_retries", 2), "task.root.responder", Core.get(state, "responder_description", "")));
    this.llmQuery = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "llm_query_signature", "task:string, context:json -> answer:string"))), childOptions(1, "rlm.llmquery", Core.get(state, "llm_query_description", "")));
  }

  private Map<String, Object> childOptions(Object retries, String id, Object instruction) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("validation_retries", retries);
    out.put("id", id);
    out.put("instruction", instruction);
    if (executionContext != null) out.put("executionContext", executionContext);
    return out;
  }

  public AxAgent setSignature(String signature) {
    return setSignature((Object) signature);
  }

  public AxAgent setSignature(Object signature) {
    rebuildFromSignature(signature);
    return this;
  }

  public String getInstruction() {
    return String.valueOf(Core.get(state, "stage_instruction", ""));
  }

  public AxAgent setInstruction(String instruction) {
    Object composed = Core._agent_set_instruction(state, instruction == null ? "" : instruction);
    options.put("instruction", Core.get(state, "stage_instruction", ""));
    executor.setInstruction(String.valueOf(composed));
    return this;
  }

  public AxAgent addActorInstruction(String addendum) {
    Object composed = Core._agent_add_actor_instruction(state, addendum == null ? "" : addendum);
    options.put("instructionAddenda", new ArrayList<>(Core.asList(Core.get(state, "instruction_addenda", List.of()))));
    executor.setInstruction(String.valueOf(composed));
    return this;
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    Map<String, Object> callOptions = new LinkedHashMap<>(forwardOptions == null ? Map.of() : forwardOptions);
    AxExecutionContext callContext = AxExecutionContext.resolve(callOptions, executionContext);
    if (callContext != null) {
      callOptions.put("executionContext", callContext);
      List<Object> functions = new ArrayList<>(Core.asList(callOptions.getOrDefault("functions", List.of())));
      functions.addAll(callContext.runtimeModules());
      callOptions.put("functions", functions);
    }
    // Wire the built-in llmQuery primitive onto the runtime carried in agent
    // options (the same runtime the actor loop will create sessions on),
    // mirroring the Go/Python/Rust wrappers. The logic lives in the
    // AxIR-generated helper; this only registers the host callable.
    Object runtimeObj = callOptions.get("runtime");
    if (runtimeObj == null) runtimeObj = options.get("runtime");
    if (runtimeObj instanceof AxCodeRuntime runtime) {
      runtime.registerHostCallable("llmQuery", params -> Core._agent_run_llm_query(llmQuery, client, params));
    }
    Map<String, Object> output = Core.asMap(Core._agent_forward(
      state,
      distiller,
      executor,
      responder,
      client,
      values == null ? Map.of() : values,
      callOptions
    ));
    Object citationConfig = this.options.get("citations");
    if (citationConfig instanceof Map<?, ?> rawCitationConfig) {
      Map<String, Object> config = Core.asMap(rawCitationConfig);
      Object callback = config.getOrDefault("onCitations", config.get("on_citations"));
      if (callback instanceof java.util.function.Consumer<?> rawConsumer) {
        @SuppressWarnings("unchecked")
        java.util.function.Consumer<List<Object>> consumer = (java.util.function.Consumer<List<Object>>) rawConsumer;
        try {
          consumer.accept(new ArrayList<>(Core.asList(Core.get(state, "last_citations", List.of()))));
        } catch (RuntimeException ignored) {
          // Citation observers are informational and must not fail forward().
        }
      }
    }
    learnPlaybookFailures(output);
    return output;
  }

  public Map<String, Object> test(AxCodeRuntime runtime, String code) {
    return test(runtime, code, Map.of(), Map.of());
  }

  public Map<String, Object> test(AxCodeRuntime runtime, String code, Map<String, Object> contextFieldValues) {
    return test(runtime, code, contextFieldValues, Map.of());
  }

  public Map<String, Object> test(AxCodeRuntime runtime, String code, Map<String, Object> contextFieldValues, Map<String, Object> options) {
    return Core.asMap(Core._agent_runtime_test(
      state,
      runtime,
      code,
      contextFieldValues == null ? Map.of() : contextFieldValues,
      options == null ? Map.of() : options
    ));
  }

  public Map<String, Object> executeActorStep(AxCodeRuntime runtime, String code, Map<String, Object> values) {
    return executeActorStep(runtime, code, values, Map.of());
  }

  public Map<String, Object> executeActorStep(AxCodeRuntime runtime, String code, Map<String, Object> values, Map<String, Object> options) {
    Core._agent_runtime_build_globals(state, values == null ? Map.of() : values);
    Object session = Core.get(state, "runtime_session", null);
    return Core.asMap(Core._agent_runtime_execute_step(
      state,
      runtime,
      session,
      code,
      options == null ? Map.of() : options
    ));
  }

  public Object inspectRuntime() {
    return inspectRuntime(Map.of());
  }

  public Object inspectRuntime(Map<String, Object> options) {
    return Core._agent_runtime_inspect_state(state, Core.get(state, "runtime_session", null), options == null ? Map.of() : options);
  }

  public Object exportSessionState() {
    return exportSessionState(Map.of());
  }

  public Object exportSessionState(Map<String, Object> options) {
    return Core._agent_runtime_export_session_state(state, Core.get(state, "runtime_session", null), options == null ? Map.of() : options);
  }

  public Object restoreSessionState(Object snapshot) {
    return restoreSessionState(snapshot, Map.of());
  }

  public Object restoreSessionState(Object snapshot, Map<String, Object> options) {
    return Core._agent_runtime_restore_session_state(state, Core.get(state, "runtime_session", null), snapshot == null ? Map.of() : snapshot, options == null ? Map.of() : options);
  }

  public Object closeRuntimeSession() {
    return Core._agent_runtime_close_session(state, Core.get(state, "runtime_session", null));
  }

  public Map<String, Object> getState() {
    return Core.asMap(Core._agent_get_state(state));
  }

  public Object setState(Map<String, Object> newState) {
    return Core._agent_set_state(state, newState == null ? Map.of() : newState);
  }

  public List<Object> getChatLog() {
    return Core.asList(Core.get(state, "chat_log", List.of()));
  }

  public List<Object> getActionLog() {
    return Core.asList(Core.get(state, "action_log", List.of()));
  }

  public Map<String, Object> getTrace() {
    return Core.asMap(Core._agent_export_trace(state));
  }

  public Map<String, Object> exportTrace() {
    return Core.asMap(Core._agent_export_trace(state));
  }

  public Map<String, Object> replayTrace(Object trace, Map<String, Object> fixtures) {
    return Core.asMap(Core._agent_replay_trace(trace == null ? Map.of() : trace, fixtures == null ? Map.of() : fixtures));
  }

  public Map<String, Object> getUsage() {
    return Core.asMap(Core.get(state, "usage", Map.of()));
  }

  public Map<String, Object> getRuntimeContract() {
    return Core.asMap(Core.get(state, "runtime_contract", Map.of()));
  }

  public Map<String, Object> getPolicy() {
    return Core.asMap(Core.get(state, "policy", Map.of()));
  }

  public Map<String, Object> getPolicyRegistry() {
    return Core.asMap(Core.get(state, "policy_registry", Map.of()));
  }

  public List<Object> getCallableInventory() {
    return Core.asList(Core.get(state, "callable_inventory", List.of()));
  }

  public List<Object> getDiscoveryCatalog() {
    return Core.asList(Core.get(state, "discovery_catalog", List.of()));
  }

  public Object discover(Map<String, Object> request) {
    return Core._agent_discover(state, request == null ? Map.of() : request);
  }

  public Object recall(Object request) {
    return Core._agent_recall(state, request == null ? List.of() : request);
  }

  public Object used(String id) {
    return used(id, "", "executor");
  }

  public Object used(String id, String reason, String stage) {
    return Core._agent_used(state, new LinkedHashMap<>(Map.of("id", id, "reason", reason == null ? "" : reason, "stage", stage == null ? "executor" : stage)), stage == null ? "executor" : stage);
  }

  public Object invokeCallable(String qualifiedName, Map<String, Object> args) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("qualified_name", qualifiedName);
    request.put("args", args == null ? Map.of() : args);
    return Core._agent_execute_callable(state, request, Map.of());
  }

  public Map<String, Object> exportRuntimeState() {
    return Core.asMap(Core._agent_export_runtime_state(state));
  }

  public Map<String, Object> restoreRuntimeState(Map<String, Object> snapshot) {
    return Core.asMap(Core._agent_restore_runtime_state(state, snapshot == null ? Map.of() : snapshot));
  }

  public Map<String, Object> getOptimizerMetadata() {
    return Core.asMap(Core._agent_optimizer_metadata(state));
  }

  public List<Map<String, Object>> getOptimizableComponents() {
    List<Object> childComponents = new ArrayList<>();
    childComponents.addAll(distiller.getOptimizableComponents());
    childComponents.addAll(executor.getOptimizableComponents());
    childComponents.addAll(responder.getOptimizableComponents());
    return Core.asMapList(Core._agent_get_optimizable_components(state, childComponents));
  }

  public AxAgent applyOptimizedComponents(Map<String, Object> componentMap) {
    Map<String, Object> updates = componentMap == null ? Map.of() : componentMap;
    Core._validate_optimization_component_map(getOptimizableComponents(), updates);
    distiller.applyOptimizedComponents(updates);
    executor.applyOptimizedComponents(updates);
    responder.applyOptimizedComponents(updates);
    Object composed = Core._agent_apply_optimized_components(state, updates);
    options.putAll(Core.asMap(Core.get(state, "options", Map.of())));
    executor.setInstruction(String.valueOf(composed));
    return this;
  }

  public AxAgent applyOptimization(Object artifact) {
    List<Map<String, Object>> components = getOptimizableComponents();
    Map<String, Object> map = artifact instanceof String text
      ? Core.asMap(Core._deserialize_optimized_artifact(text, components))
      : Core.asMap(Core._validate_optimized_artifact(artifact == null ? Map.of() : artifact, components));
    return applyOptimizedComponents(Core.asMap(map.getOrDefault("componentMap", Map.of())));
  }

  public Map<String, Object> evaluateOptimizationTask(AiClient client, Map<String, Object> task, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    try {
      Map<String, Object> output = forward(client, Core.asMap(task.getOrDefault("input", task)), Core.asMap(opts.getOrDefault("forward_options", Map.of())));
      return Core.asMap(Core._build_agent_eval_prediction(output, getActionLog(), getUsage(), exportTrace()));
    } catch (AxAgentClarificationException e) {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("completionType", "askClarification");
      out.put("clarification", e.clarification());
      out.put("actionLog", getActionLog());
      out.put("functionCalls", Core.asList(state.getOrDefault("function_call_traces", List.of())));
      out.put("toolErrors", List.of());
      out.put("turnCount", 0);
      out.put("usage", getUsage());
      out.put("trace", exportTrace());
      return out;
    } catch (RuntimeException e) {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("completionType", "error");
      out.put("error", Map.of("message", String.valueOf(e.getMessage())));
      out.put("actionLog", getActionLog());
      out.put("functionCalls", Core.asList(state.getOrDefault("function_call_traces", List.of())));
      out.put("toolErrors", List.of(String.valueOf(e.getMessage())));
      out.put("turnCount", 0);
      out.put("usage", getUsage());
      out.put("trace", exportTrace());
      return out;
    }
  }

  public Map<String, Object> evaluateOptimization(AiClient client, Object dataset, Map<String, Object> candidateMap, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Map<String, Object> normalized = Core.asMap(Core._normalize_optimization_dataset(dataset == null ? List.of() : dataset));
    List<Object> rows = new ArrayList<>();
    Map<String, Object> original = Core.asMap(Core._optimization_component_current_map(getOptimizableComponents()));
    Map<String, Object> candidate = candidateMap == null ? Map.of() : candidateMap;
    int maxMetricCalls = ((Number) opts.getOrDefault("maxMetricCalls", opts.getOrDefault("max_metric_calls", Integer.MAX_VALUE))).intValue();
    int calls = 0;
    try {
      if (!candidate.isEmpty()) applyOptimizedComponents(candidate);
      for (Object rawTask : Core.asList(normalized.getOrDefault("train", List.of()))) {
        if (calls >= maxMetricCalls) throw new RuntimeException("max metric calls exceeded: " + maxMetricCalls);
        calls++;
        Map<String, Object> task = Core.asMap(rawTask);
        Map<String, Object> prediction = evaluateOptimizationTask(client, task, opts);
        Object error = prediction.get("error");
        Object rawScore = task.containsKey("metric_score") ? task.get("metric_score") : task.containsKey("scores") ? task.get("scores") : task.getOrDefault("score", "error".equals(prediction.get("completionType")) ? 0 : 1);
        Map<String, Object> scores = Core.asMap(Core._normalize_optimization_metric_scores(rawScore));
        Object scalar = Core._adjust_optimization_score_for_actions(Core._scalarize_optimization_scores(scores, opts), task, prediction);
        rows.add(Core._build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), error));
      }
      return Core.asMap(Core._build_optimization_eval_result(rows, candidate, opts.getOrDefault("phase", "train")));
    } finally {
      applyOptimizedComponents(original);
    }
  }

  public Map<String, Object> optimizeWith(OptimizerEngine engine, List<Map<String, Object>> dataset, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    List<Map<String, Object>> components = getOptimizableComponents();
    Object client = opts.getOrDefault("client", opts.get("ai"));
    Map<String, Object> run = Core.asMap(Core._prepare_optimizer_run("axagent", components, dataset == null ? List.of() : dataset, opts, exportTrace(), client instanceof AiClient));
    Map<String, Object> request = Core.asMap(run.getOrDefault("request", Map.of()));
    OptimizerEvaluator evaluator = client instanceof AiClient aiClient
      ? (candidate, evalOptions) -> {
        Map<String, Object> merged = new LinkedHashMap<>(Core.asMap(evalOptions == null ? Map.of() : evalOptions));
        Object evalDataset = merged.containsKey("dataset") ? merged.remove("dataset") : merged.remove("_dataset");
        return evaluateOptimization(aiClient, evalDataset == null ? (dataset == null ? List.of() : dataset) : evalDataset, candidate, merged);
      }
      : null;
    Map<String, Object> response = engine.optimize(request, evaluator);
    Map<String, Object> artifact = Core.asMap(Core._normalize_optimizer_engine_response(response, engine.name(), engine.version(), components));
    if (!Boolean.FALSE.equals(opts.get("apply"))) applyOptimization(artifact);
    return artifact;
  }

  public Map<String, Object> optimize(List<Map<String, Object>> dataset, Map<String, Object> options) {
    Object engine = options == null ? null : options.getOrDefault("engine", options.get("optimizer"));
    if (!(engine instanceof OptimizerEngine optimizer)) throw new IllegalArgumentException("options.engine must implement OptimizerEngine for optimize()");
    return optimizeWith(optimizer, dataset, options);
  }

  /**
   * Build an evolving context {@link AxPlaybook} bound to an agent stage (the
   * actor/task stage by default; pass {@code "target":"responder"} for the
   * responder). As the playbook evolves it is injected into the live stage prompt
   * unless {@code "apply"} is false. The evolution engine (ACE) is an
   * implementation detail.
   */
  public AxPlaybook playbook(Map<String, Object> options) {
    Map<String, Object> opts = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
    if (this.playbookHandle != null) {
      if (!opts.isEmpty()) throw new IllegalStateException("AxAgent.playbook(): this agent already has a playbook; call playbook(null) to use it.");
      return this.playbookHandle;
    }
    String target = String.valueOf(opts.getOrDefault("target", "actor"));
    Object student = AxPlaybook.option(opts, "studentAI", "student_ai", "student", "client", "ai");
    if (student == null) student = this.options.getOrDefault("ai", this.options.get("client"));
    if (!(student instanceof AiClient)) {
      throw new IllegalArgumentException("AxAgent.playbook(): studentAI is required when the agent has no default ai.");
    }
    AxGen stage = "responder".equals(target) ? this.responder : this.executor;
    opts.put("studentAI", student);
    AxPlaybook handle = new AxPlaybook(stage, opts);
    if (Boolean.FALSE.equals(opts.get("apply"))) {
      handle.setApplyHook(rendered -> {});
    } else {
      String base = stage.getInstruction();
      handle.setApplyHook(rendered -> stage.setInstruction(AxPlaybook.composeInstruction(base, rendered)));
    }
    this.playbookHandle = handle.bindAgent(this);
    return this.playbookHandle;
  }

  public AxPlaybook getPlaybook() { return this.playbookHandle; }

  private void attachConfiguredPlaybook() {
    Map<String, Object> config = this.playbookConfig instanceof Map<?, ?> ? new LinkedHashMap<>(Core.asMap(this.playbookConfig)) : new LinkedHashMap<>();
    config.putIfAbsent("maxReflectorRounds", 1);
    Object seed = config.get("seed");
    if (seed == null && (config.containsKey("playbook") || config.containsKey("artifact"))) seed = config;
    playbook(config);
    if (seed instanceof Map<?, ?> seedMap) {
      Map<String, Object> snapshot = Core.asMap(seedMap);
      if (snapshot.containsKey("playbook")) playbookHandle.load(snapshot);
      else playbookHandle.load(new LinkedHashMap<>(Map.of("playbook", snapshot)));
    }
  }

  @SuppressWarnings("unchecked")
  private void learnPlaybookFailures(Map<String, Object> output) {
    if (playbookHandle == null || playbookConfig == null || Boolean.FALSE.equals(playbookConfig)) return;
    Map<String, Object> config = playbookConfig instanceof Map<?, ?> ? Core.asMap(playbookConfig) : Map.of();
    Object learn = config.getOrDefault("learn", Boolean.TRUE);
    if (Boolean.FALSE.equals(learn)) return;
    Map<String, Object> learnConfig = learn instanceof Map<?, ?> ? Core.asMap(learn) : Map.of();
    try {
      List<Object> signals = new ArrayList<>(Core.asList(Core.get(state, "failure_signals", List.of())));
      int minSignals = ((Number) learnConfig.getOrDefault("minSignals", learnConfig.getOrDefault("min_signals", 1))).intValue();
      if (signals.size() < minSignals) return;
      java.util.Set<String> covered = new java.util.LinkedHashSet<>();
      for (Object signature : Core.asList(Core._agent_collect_covered_failure_signatures(playbookHandle.getState()))) {
        covered.add(String.valueOf(signature));
      }
      if (!Boolean.FALSE.equals(learnConfig.getOrDefault("dedupe", Boolean.TRUE))) {
        signals.removeIf(raw -> covered.contains(String.valueOf(Core.get(raw, "signature", ""))));
      }
      if (signals.isEmpty()) return;
      if (signals.size() > 12) signals = new ArrayList<>(signals.subList(0, 12));
      StringBuilder feedback = new StringBuilder("Agent run failures to avoid:\n");
      List<Object> signatures = new ArrayList<>();
      for (Object raw : signals) {
        Map<String, Object> signal = Core.asMap(raw);
        signatures.add(signal.get("signature"));
        feedback.append("- [").append(signal.get("kind")).append("] ").append(signal.get("signature")).append(": ").append(signal.get("detail")).append('\n');
      }
      feedback.append("Curate ONE bounded avoidance rule into failures_to_avoid.");
      Map<String, Object> example = new LinkedHashMap<>();
      example.put("task", this.options.getOrDefault("instruction", "agent run"));
      example.put("failureSignatures", signatures);
      String before = Json.stringify(playbookHandle.getState().get("playbook"));
      playbookHandle.update(new LinkedHashMap<>(Map.of("example", example, "prediction", output, "feedback", feedback.toString())));
      Object callback = config.getOrDefault("onUpdate", config.get("on_update"));
      if (callback instanceof java.util.function.Consumer<?> rawConsumer) {
        Map<String, Object> snapshot = playbookHandle.getState();
        String status = Json.stringify(snapshot.get("playbook")).equals(before) ? "unchanged" : "updated";
        Map<String, Object> update = new LinkedHashMap<>();
        update.put("status", status);
        update.put("signals", signals);
        update.put("feedback", feedback.toString());
        update.put("snapshot", snapshot);
        ((java.util.function.Consumer<Map<String, Object>>) rawConsumer).accept(update);
      }
    } catch (RuntimeException ignored) {
      // Run-end learning is intentionally non-fatal.
    }
  }
}
