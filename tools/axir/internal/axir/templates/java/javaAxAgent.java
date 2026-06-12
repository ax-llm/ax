package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxAgent implements AxProgram {
  final Map<String, Object> options;
  final Map<String, Object> state;
  final Object signature;
  final AxGen distiller;
  final AxGen executor;
  final AxGen responder;

  public AxAgent(String signature, Map<String, Object> options) {
    this((Object) signature, options);
  }

  @SuppressWarnings("unchecked")
  public AxAgent(Object signature, Map<String, Object> options) {
    this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
    this.state = Core.asMap(Core._agent_factory(signature, this.options));
    this.signature = Core.get(state, "signature", signature);
    this.distiller = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "distiller_signature", "input:json -> completion:json"))), Map.of("validation_retries", 0, "id", "ctx.root.actor"));
    this.executor = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "executor_signature", "input:json -> completion:json"))), Map.of("validation_retries", 0, "id", "task.root.actor"));
    this.responder = new AxGen((AxSignature) this.signature, Map.of("validation_retries", this.options.getOrDefault("validation_retries", 2), "id", "task.root.responder"));
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    return Core.asMap(Core._agent_forward(
      state,
      distiller,
      executor,
      responder,
      client,
      values == null ? Map.of() : values,
      forwardOptions == null ? Map.of() : forwardOptions
    ));
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
    List<Map<String, Object>> components = new ArrayList<>();
    components.addAll(distiller.getOptimizableComponents());
    components.addAll(executor.getOptimizableComponents());
    components.addAll(responder.getOptimizableComponents());
    components.add(Core.asMap(Core._optimization_component(
      "root.agent.runtime",
      "root.agent",
      "runtime-policy",
      getRuntimeContract(),
      "Agent runtime-language metadata and code-field policy.",
      List.of("Keep code field names aligned with the selected runtime language."),
      List.of(),
      true,
      "json",
      Map.of("component", "runtime_contract")
    )));
    components.add(Core.asMap(Core._optimization_component(
      "root.agent.policy",
      "root.agent",
      "agent-policy",
      getPolicy(),
      "Actor primitive, discovery, delegation, and prompt placement policy.",
      List.of("Do not expose protocol-only actions as actor primitives."),
      List.of("root.agent.runtime"),
      true,
      "json",
      Map.of("component", "policy_registry")
    )));
    return components;
  }

  public AxAgent applyOptimizedComponents(Map<String, Object> componentMap) {
    Map<String, Object> updates = componentMap == null ? Map.of() : componentMap;
    Core._validate_optimization_component_map(getOptimizableComponents(), updates);
    distiller.applyOptimizedComponents(updates);
    executor.applyOptimizedComponents(updates);
    responder.applyOptimizedComponents(updates);
    if (updates.get("root.agent.runtime") instanceof Map<?, ?> runtime) state.put("runtime_contract", Core.asMap(runtime));
    if (updates.get("root.agent.policy") instanceof Map<?, ?> policy) state.put("policy", Core.asMap(policy));
    state.put("optimizer_metadata", Core._agent_optimizer_metadata(state));
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
}
