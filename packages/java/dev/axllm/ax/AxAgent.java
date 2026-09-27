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
  // The stage the playbook targets and whether it writes into that stage's
  // prompt, kept to rebind the playbook when a stage changes.
  private String playbookTarget = "actor";
  private boolean playbookApply = true;
  Object playbookConfig;
  volatile AxRuntimeHooks runtimeHooks;

  public AxAgent(String signature, Map<String, Object> options) {
    this((Object) signature, options, AxRuntimeHooks.empty());
  }

  @SuppressWarnings("unchecked")
  public AxAgent(Object signature, Map<String, Object> options) {
    this(signature, options, AxRuntimeHooks.empty());
  }

  @SuppressWarnings("unchecked")
  public AxAgent(Object signature, Map<String, Object> options, AxRuntimeHooks hooks) {
    this.runtimeHooks = AxRuntimeHooks.merge(hooks, AxRuntimeHooks.fromOptions(options));
    this.options = AxRuntimeHooks.strip(options);
    this.executionContext = AxExecutionContext.resolve(this.options, null);
    if (executionContext != null) {
      executionContext.initialize();
      this.options.putAll(Core.asMap(Core._agent_append_runtime_modules(this.options, executionContext.runtimeModules())));
      this.options.put("executionContext", executionContext);
    }
    this.playbookConfig = this.options.get("playbook");
    rebuildFromSignature(signature);
    if (this.playbookConfig != null && !Boolean.FALSE.equals(this.playbookConfig)) {
      attachConfiguredPlaybook();
    }
  }

  public AxAgent setRateLimiter(AxRateLimiter limiter) { this.runtimeHooks = new AxRuntimeHooks(limiter, runtimeHooks.tracer(), runtimeHooks.meter()); return this; }
  public AxAgent setTracer(AxTracer tracer) { this.runtimeHooks = new AxRuntimeHooks(runtimeHooks.rateLimiter(), tracer, runtimeHooks.meter()); return this; }
  public AxAgent setMeter(AxMeter meter) { this.runtimeHooks = new AxRuntimeHooks(runtimeHooks.rateLimiter(), runtimeHooks.tracer(), meter); return this; }

  @SuppressWarnings("unchecked")
  private void rebuildFromSignature(Object signature) {
    this.state = Core.asMap(Core._agent_factory(signature, this.options));
    this.signature = Core.get(state, "signature", signature);
    Object actorValidationRetries = this.options.getOrDefault("validation_retries", this.options.getOrDefault("validationRetries", 1));
    this.distiller = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "distiller_signature", "input:json -> completion:json"))), childOptions(actorValidationRetries, "ctx.root.actor", Core.get(state, "distiller_description", "")));
    this.executor = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "executor_signature", "input:json -> completion:json"))), childOptions(actorValidationRetries, "task.root.actor", Core.get(state, "executor_description", "")));
    this.responder = newResponder();
    this.llmQuery = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "llm_query_signature", "task:string, context:json -> answer:string"))), childOptions(1, "rlm.llmquery", Core.get(state, "llm_query_description", "")));
    rebindPlaybook();
  }

  // As in TypeScript, the responder's validation budget is maxRetries unless
  // validation_retries is set, and with citations on it asserts that the
  // cited ids exist in the run's evidence.
  private AxGen newResponder() {
    Map<String, Object> responderOptions = new LinkedHashMap<>();
    if (this.options.containsKey("validation_retries")) responderOptions.put("validation_retries", this.options.get("validation_retries"));
    responderOptions.put("id", "task.root.responder");
    responderOptions.put("instruction", Core.get(state, "responder_description", ""));
    AxGen built = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "responder_signature", "input:json -> completion:json"))), responderOptions);
    if (Core.truthy(Core.get(Core.get(state, "citations", Map.of()), "enabled", false))) {
      Map<String, Object> runState = this.state;
      built.addAssert((AxGen.AssertionCallback) output -> Core._agent_citation_assert(runState, output));
    }
    return built;
  }

  private Map<String, Object> childOptions(Object retries, String id, Object instruction) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("validation_retries", retries);
    out.put("id", id);
    out.put("instruction", instruction);
    return out;
  }

  public AxAgent addChildAgent(String namespace, String name, AxAgent child) {
    Map<String, Object> updated = Core.asMap(Core._agent_register_child(options, namespace, name, child, child.signature));
    options.clear();
    options.putAll(updated);
    rebuildFromSignature(signature);
    return this;
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
    setStageInstruction(executor, String.valueOf(composed));
    return this;
  }

  public AxAgent addActorInstruction(String addendum) {
    Object composed = Core._agent_add_actor_instruction(state, addendum == null ? "" : addendum);
    options.put("instructionAddenda", new ArrayList<>(Core.asList(Core.get(state, "instruction_addenda", List.of()))));
    setStageInstruction(executor, String.valueOf(composed));
    return this;
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    return forward(client, values, forwardOptions, AxRuntimeHooks.fromOptions(forwardOptions));
  }

  public Map<String,Object> forwardWithCancellation(AiClient client,Map<String,Object> values,AxCancellationToken cancellation){return forwardWithCancellation(client,values,Map.of(),cancellation);}
  public Map<String,Object> forwardWithCancellation(AiClient client,Map<String,Object> values,Map<String,Object> options,AxCancellationToken cancellation){Map<String,Object> resolved=new LinkedHashMap<>(options==null?Map.of():options);resolved.put("cancellation",cancellation);return forward(client,values,resolved);}

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions, AxRuntimeHooks hooks) {
    return run(client, values, forwardOptions, hooks, null);
  }

  /** Streams a run with no options; see {@link #streamingForward(AiClient, Map, Map, AxCancellationToken)}. */
  public AxGenDeltaStream streamingForward(AiClient client, Map<String, Object> values) {
    return streamingForward(client, values, Map.of(), null);
  }

  /** Streams a run; see {@link #streamingForward(AiClient, Map, Map, AxCancellationToken)}. */
  public AxGenDeltaStream streamingForward(AiClient client, Map<String, Object> values, Map<String, Object> options) {
    return streamingForward(client, values, options, null);
  }

  /**
   * Runs the agent and returns the responder's output as it streams, as TypeScript's
   * streamingForward does. The distiller and the executor (or the direct-respond skip) run first
   * without streaming; then the stream yields the responder's {@link AxGenDelta} updates (see
   * {@link AxGen#streamingForward}). With citations {@code surface: "hidden"} the updates leave
   * out the citation field, and {@code onCitations} gets the streamed citations after the stream.
   * The run works on a worker thread that starts when iteration starts and waits while the caller
   * handles each update; closing the stream stops the run, and with a run {@code control} the run
   * then ends with an aborted event. A run control on a client that opens async model sessions is
   * not covered yet and throws {@link UnsupportedOperationException} before any stage runs, as
   * AxGen deltas do.
   */
  public AxGenDeltaStream streamingForward(AiClient client, Map<String, Object> values, Map<String, Object> options, AxCancellationToken cancellation) {
    Map<String, Object> runOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    AxCancellationToken parent = cancellation;
    for (String key : List.of("cancellation", "cancellationToken", "cancellation_token")) {
      Object token = runOptions.remove(key);
      if (parent == null && token instanceof AxCancellationToken given) parent = given;
    }
    AxGenDeltaStream.StopToken stop = new AxGenDeltaStream.StopToken();
    runOptions.put("cancellation", stop);
    Map<String, Object> input = values == null ? new LinkedHashMap<>() : new LinkedHashMap<>(values);
    return new AxGenDeltaStream(sink -> run(client, input, runOptions, AxRuntimeHooks.fromOptions(runOptions), sink), stop, parent);
  }

  // forward, and with a sink the streaming forward.
  private Map<String, Object> run(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions, AxRuntimeHooks hooks, java.util.function.Consumer<Map<String, Object>> sink) {
    Map<String, Object> attributes = new LinkedHashMap<>();
    attributes.put("ax.program.id", "root.agent");
    attributes.put("ax.program.type", "AxAgent");
    if (sink != null) attributes.put("ax.streaming", true);
    AxGlobals.Scope scope = AxGlobals.openScope(hooks, runtimeHooks, "ax_gen_agent_forward", "ax_gen_agent", attributes);
    try {
      return forwardUnscoped(client, values, AxRuntimeHooks.strip(forwardOptions), sink);
    } catch (RuntimeException | Error error) {
      scope.fail(error);
      throw error;
    } finally {
      scope.close();
    }
  }

  // Until AxGen deltas cover async run sessions, an agent stream that would
  // stream its responder through one fails before any stage runs, with the
  // error AxGen deltas raise.
  private void checkStreamRunSession(AiClient client, Map<String, Object> callOptions) {
    Map<String, Object> runOptions = new LinkedHashMap<>(responder.options);
    runOptions.putAll(Core.asMap(Core._agent_stage_options(state, "responder", callOptions)));
    boolean controlled = runOptions.get("control") instanceof AxRunControl;
    boolean sessionCapable = Core.truthy(Core.chat_session_mode_enabled(runOptions))
        && (client instanceof ChatRunSelector || (client instanceof AxChatSession.Provider && Core.truthy(Core.get(Core.aiClientFeatures(client, runOptions.get("model")), "asyncTools", false))));
    if (sessionCapable && (controlled || responder.functions.stream().anyMatch(tool -> "background".equals(tool.execution)))) {
      throw new UnsupportedOperationException("streaming_forward deltas do not cover async run sessions (control or background tools on a session-capable client) yet; use forward()");
    }
  }

  private Map<String, Object> forwardUnscoped(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions, java.util.function.Consumer<Map<String, Object>> sink) {
    Map<String, Object> callOptions = new LinkedHashMap<>(forwardOptions == null ? Map.of() : forwardOptions);
    if (sink != null) checkStreamRunSession(client, callOptions);
    if (callOptions.get("cancellation") instanceof AxCancellationToken cancellation) cancellation.throwIfCancelled();
    AxExecutionContext callContext = AxExecutionContext.resolve(callOptions, executionContext);
    if (callContext != null || Core.truthy(state.get("mcp_run_context_active"))) {
      List<Map<String,Object>> modules = List.of();
      if (callContext != null) { callContext.initialize(); modules = callContext.runtimeModules(); }
      callOptions.put("executionContext", callContext);
      Core._agent_apply_run_context(state, options, callOptions, modules);
      if (Core.truthy(state.get("runtime_enabled"))) {
        setStageInstruction(distiller, String.valueOf(state.get("distiller_description")));
        setStageInstruction(executor, String.valueOf(state.get("executor_description")));
        setStageInstruction(responder, String.valueOf(state.get("responder_description")));
      }
    }
    // Wire the built-in llmQuery primitive onto the runtime carried in agent
    // options (the same runtime the actor loop will create sessions on),
    // mirroring the Go/Python/Rust wrappers. The logic lives in the
    // AxIR-generated helper; this only registers the host callable.
    Object runtimeObj = callOptions.get("runtime");
    if (runtimeObj == null) runtimeObj = options.get("runtime");
    var bindingActive = new java.util.concurrent.atomic.AtomicBoolean(true);
    if (runtimeObj instanceof AxCodeRuntime runtime) {
      java.lang.ref.WeakReference<AxAgent> parent = new java.lang.ref.WeakReference<>(this);
      Thread owner = Thread.currentThread();
      for (Object rawName : Core.asList(Core._agent_runtime_callable_names(state))) {
        String qualified = String.valueOf(rawName);
        runtime.registerHostCallable(qualified, arguments -> {
          if (!bindingActive.get()) throw new IllegalStateException("Agent invocation belongs to a closed run");
          AxAgent active = parent.get();
          if (active == null) throw new IllegalStateException("Agent invocation belongs to a closed run");
          if (Thread.currentThread() != owner) throw new IllegalStateException("Agent runtime callbacks must execute on the owning run thread");
          return Core._agent_runtime_invoke_callable(active.state, qualified, arguments);
        });
      }
      runtime.registerHostCallable("llmQuery", params -> {
        if (!bindingActive.get()) throw new IllegalStateException("Agent invocation belongs to a closed run");
        if (Thread.currentThread() != owner) throw new IllegalStateException("Agent runtime callbacks must execute on the owning run thread");
        return Core._agent_run_llm_query(llmQuery, client, params, callOptions);
      });
    }
    // As TypeScript's forward and streamingForward do, a run control hears
    // the run's own lifecycle at its path; each stage reports at
    // <path>/<stage>.
    AxRunControl control = callOptions.get("control") instanceof AxRunControl given ? given : null;
    String runPath = String.valueOf(callOptions.getOrDefault("execution_path", callOptions.getOrDefault("executionPath", "root")));
    if (control != null) control.emit(Map.of("type", "started", "path", runPath));
    Map<String, Object> output;
    try {
      if (sink == null) {
        output = Core.asMap(Core._agent_forward(
          state,
          distiller,
          executor,
          responder,
          client,
          values == null ? Map.of() : values,
          callOptions
        ));
      } else {
        output = Core.asMap(Core._agent_streaming_forward(
          state,
          distiller,
          executor,
          responder,
          client,
          values == null ? Map.of() : values,
          callOptions,
          sink
        ));
      }
    } catch (RuntimeException | Error error) {
      if (control != null) {
        if (sink != null && callOptions.get("cancellation") instanceof AxGenDeltaStream.StopToken stop && stop.consumerStopped()) {
          // The consumer stopped the stream early: the run ended on purpose,
          // as with control.abort().
          control.emit(Map.of("type", "aborted", "path", runPath));
        } else {
          control.emit(Map.of("type", "failed", "path", runPath, "error", String.valueOf(error)));
        }
      }
      throw error;
    } finally { bindingActive.set(false); }
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
    // TS learns from the responder's answer after forward; a stream has no
    // single answer to hand the playbook.
    learnPlaybookFailures(sink == null ? output : new LinkedHashMap<>());
    if (control != null) control.emit(Map.of("type", "completed", "path", runPath));
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

  private void refreshObservability() {
    Core._merge_agent_chat_log(state, distiller, executor, responder);
    Core._merge_agent_usage(state, distiller, executor, responder);
  }

  public List<Object> getChatLog() {
    refreshObservability();
    return Core.asList(Core.get(state, "chat_log", List.of()));
  }

  public List<Object> getActionLog() {
    return Core.asList(Core.get(state, "action_log", List.of()));
  }

  public Map<String, Object> getTrace() {
    refreshObservability();
    return Core.asMap(Core._agent_export_trace(state));
  }

  public Map<String, Object> exportTrace() {
    refreshObservability();
    return Core.asMap(Core._agent_export_trace(state));
  }

  public Map<String, Object> replayTrace(Object trace, Map<String, Object> fixtures) {
    return Core.asMap(Core._agent_replay_trace(trace == null ? Map.of() : trace, fixtures == null ? Map.of() : fixtures));
  }

  public Map<String, Object> getUsage() {
    refreshObservability();
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
    setStageInstruction(executor, String.valueOf(composed));
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
    this.playbookTarget = target;
    this.playbookApply = !Boolean.FALSE.equals(opts.get("apply"));
    AxGen stage = playbookStage();
    opts.put("studentAI", student);
    AxPlaybook handle = new AxPlaybook(stage, opts);
    bindPlaybookStage(handle, stage);
    this.playbookHandle = handle.bindAgent(this);
    return this.playbookHandle;
  }

  // The stage the playbook targets: the actor, or the responder.
  private AxGen playbookStage() {
    return "responder".equals(playbookTarget) ? responder : executor;
  }

  // Point the playbook at an agent stage: the program it runs and the hook
  // that writes the rendered playbook into the stage prompt.
  private void bindPlaybookStage(AxPlaybook handle, AxGen stage) {
    handle.rebindProgram(stage);
    if (!playbookApply) {
      handle.setApplyHook(rendered -> {});
      return;
    }
    String base = stage.getInstruction();
    handle.setApplyHook(rendered -> stage.setInstruction(AxPlaybook.composeInstruction(base, rendered)));
  }

  // Point the playbook at its stage again and write it into that stage's
  // prompt: setSignature and addChildAgent rebuild the stages, and
  // setStageInstruction rewrites a stage's instruction.
  private void rebindPlaybook() {
    if (playbookHandle == null) return;
    bindPlaybookStage(playbookHandle, playbookStage());
    playbookHandle.applyTo(null);
  }

  // Write an agent stage's instruction. The stage the playbook targets gets
  // the rendered playbook composed on top, as TS keeps it in the stage prompt,
  // so a stage instruction, an actor addendum, optimized components or the
  // run-context refresh never drop it.
  private void setStageInstruction(AxGen stage, String instruction) {
    stage.setInstruction(instruction);
    if (playbookHandle != null && playbookStage() == stage) rebindPlaybook();
  }

  public AxPlaybook getPlaybook() { return this.playbookHandle; }

  private void attachConfiguredPlaybook() {
    Map<String, Object> config = this.playbookConfig instanceof Map<?, ?> ? new LinkedHashMap<>(Core.asMap(this.playbookConfig)) : new LinkedHashMap<>();
    config.putIfAbsent("maxReflectorRounds", 1);
    // TS's `playbook` seed (a snapshot or a bare playbook), or the older `seed`
    // key with a deprecation warning.
    Object seed = Core._agent_playbook_config_seed(config);
    playbook(config);
    if (seed instanceof Map<?, ?> seedMap) playbookHandle.load(Core.asMap(seedMap));
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
