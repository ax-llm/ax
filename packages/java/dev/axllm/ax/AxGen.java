package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxGen implements AxProgram {
  public java.util.function.Supplier<AxProgram> ownedWorkerFactory() {
    if(executionContext!=null)return null;
    Map<String,Object> snapshot=Core.asMap(Core.ownedCopy(options));
    snapshot.put("functions",new ArrayList<>(functions));snapshot.put("memory",memory.ownedCopy());
    snapshot.put("examples",Core.ownedCopy(examples));snapshot.put("demos",Core.ownedCopy(demos));
    snapshot.put("assertions",Core.ownedCopy(assertions));snapshot.put("streaming_assertions",Core.ownedCopy(streamingAssertions));
    snapshot.put("field_processors",Core.ownedCopy(fieldProcessors));snapshot.put("stop_functions",new ArrayList<>(stopFunctions));
    snapshot.put("feedback_processors",Core.ownedCopy(feedbackProcessors));snapshot.put("streaming_field_processors",Core.ownedCopy(streamingFieldProcessors));
    Object log=Core.ownedCopy(chatLog),calls=Core.ownedCopy(functionCallTraces),trace=Core.ownedCopy(traces);
    String instructions=instruction;AxRuntimeHooks hooks=runtimeHooks;
    return ()->{
      AxGen owned=new AxGen(signature,Core.asMap(Core.ownedCopy(snapshot)),hooks);owned.setInstruction(instructions);
      for(Object item:Core.iter(Core.ownedCopy(log)))owned.chatLog.add(Core.asMap(item));
      for(Object item:Core.iter(Core.ownedCopy(calls)))owned.functionCallTraces.add(Core.asMap(item));
      for(Object item:Core.iter(Core.ownedCopy(trace)))owned.traces.add(Core.asMap(item));
      return owned;
    };
  }
  public interface AssertionCallback { Object apply(Map<String, Object> output); }
  /** A callable assertion with the message TypeScript addAssert(fn, message) takes. */
  public record MessageAssertion(AssertionCallback callback, String message) {}
  public interface FieldProcessorCallback { Object apply(Object value); }
  public interface FunctionCallHook { void accept(Map<String, Object> record); }
  public interface ResultPickerCallback { int pick(List<Map<String, Object>> samples); }

  final AxSignature signature;
  final Map<String, Object> options;
  final List<Tool> baseFunctions;
  final List<Tool> functions;
  final AxExecutionContext executionContext;
  final PromptTemplate promptTemplate;
  final List<Map<String, Object>> examples;
  final List<Map<String, Object>> demos;
  final List<Object> assertions;
  final List<Object> streamingAssertions;
  final List<Map<String, Object>> fieldProcessors;
  // TypeScript field processors: {field, processor(value, {values, done})};
  // a non-empty result is sent back to the model for another step.
  final List<Map<String, Object>> feedbackProcessors;
  final List<Map<String, Object>> streamingFieldProcessors;
  final List<String> stopFunctions;
  final AxMemory memory;
  final List<Map<String, Object>> chatLog;
  final List<Map<String, Object>> functionCallTraces;
  final List<Map<String, Object>> traces;
  final String programId;
  String instruction;
  volatile AxRuntimeHooks runtimeHooks;

  public AxGen(AxSignature signature) {
    this(signature, java.util.Map.of(), AxRuntimeHooks.empty());
  }

  @SuppressWarnings("unchecked")
  public AxGen(AxSignature signature, Map<String, Object> options) {
    this(signature, options, AxRuntimeHooks.empty());
  }

  @SuppressWarnings("unchecked")
  public AxGen(AxSignature signature, Map<String, Object> options, AxRuntimeHooks hooks) {
    this.signature = signature;
    this.runtimeHooks = AxRuntimeHooks.merge(hooks, AxRuntimeHooks.fromOptions(options));
    this.options = AxRuntimeHooks.strip(options);
    Object funcs = this.options.get("functions");
    this.baseFunctions = funcs instanceof List<?> list ? new ArrayList<>((List<Tool>) list) : new ArrayList<>();
    this.executionContext = AxExecutionContext.resolve(this.options, null);
    this.functions = new ArrayList<>(baseFunctions);
    if (executionContext != null) this.functions.addAll(executionContext.nativeTools());
    this.examples = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("examples", List.of()))) this.examples.add(Core.asMap(item));
    this.demos = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("demos", List.of()))) this.demos.add(Core.asMap(item));
    this.assertions = new ArrayList<>(Core.asList(this.options.getOrDefault("assertions", List.of())));
    this.streamingAssertions = new ArrayList<>(Core.asList(this.options.getOrDefault("streaming_assertions", this.options.getOrDefault("streamingAssertions", List.of()))));
    this.fieldProcessors = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("field_processors", this.options.getOrDefault("fieldProcessors", List.of())))) this.fieldProcessors.add(Core.asMap(item));
    this.feedbackProcessors = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("feedback_processors", this.options.getOrDefault("feedbackProcessors", List.of())))) this.feedbackProcessors.add(Core.asMap(item));
    this.streamingFieldProcessors = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("streaming_field_processors", this.options.getOrDefault("streamingFieldProcessors", List.of())))) this.streamingFieldProcessors.add(Core.asMap(item));
    this.stopFunctions = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("stop_functions", this.options.getOrDefault("stopFunctions", List.of())))) this.stopFunctions.add(String.valueOf(item));
    this.memory = this.options.get("memory") instanceof AxMemory mem ? mem : new AxMemory();
    this.chatLog = new ArrayList<>();
    this.functionCallTraces = new ArrayList<>();
    this.traces = new ArrayList<>();
    this.programId = String.valueOf(this.options.getOrDefault("id", this.options.getOrDefault("program_id", this.options.getOrDefault("programId", "root"))));
    this.instruction = String.valueOf(this.options.getOrDefault("instruction", ""));
    this.promptTemplate = new PromptTemplate(
      signature,
      functions,
      (String) this.options.getOrDefault("structured_output_function_name", this.options.get("structuredOutputFunctionName")),
      (String) this.options.getOrDefault("custom_template", this.options.get("customTemplate"))
    );
    if (!this.instruction.isEmpty()) {
      this.promptTemplate.setInstruction(this.instruction);
    }
  }

  public AxGen setRateLimiter(AxRateLimiter limiter) { this.runtimeHooks = new AxRuntimeHooks(limiter, runtimeHooks.tracer(), runtimeHooks.meter()); return this; }
  public AxGen setTracer(AxTracer tracer) { this.runtimeHooks = new AxRuntimeHooks(runtimeHooks.rateLimiter(), tracer, runtimeHooks.meter()); return this; }
  public AxGen setMeter(AxMeter meter) { this.runtimeHooks = new AxRuntimeHooks(runtimeHooks.rateLimiter(), runtimeHooks.tracer(), meter); return this; }

  public AxGen addTool(Tool tool) {
    functions.add(tool);
    return this;
  }

  public AxGen setExamples(List<Map<String, Object>> examples) {
    this.examples.clear();
    if (examples != null) this.examples.addAll(examples);
    return this;
  }

  public AxGen setDemos(List<Map<String, Object>> demos) {
    this.demos.clear();
    if (demos != null) this.demos.addAll(demos);
    return this;
  }

  public AxGen setSampleCount(int sampleCount) {
    this.options.put("sampleCount", sampleCount);
    return this;
  }

  public AxGen setResultPicker(ResultPickerCallback resultPicker) {
    this.options.put("resultPicker", resultPicker);
    return this;
  }

  public AxGen addAssert(Map<String, Object> assertion) {
    this.assertions.add(assertion);
    return this;
  }

  public AxGen addAssert(AssertionCallback assertion) {
    this.assertions.add(assertion);
    return this;
  }

  /**
   * Adds a callable assertion with a message. A {@code false} result fails with
   * the message and is retried with a correction, as in TypeScript; without a
   * message the failure surfaces at once.
   */
  public AxGen addAssert(AssertionCallback assertion, String message) {
    this.assertions.add(message == null ? assertion : new MessageAssertion(assertion, message));
    return this;
  }

  public AxGen addStreamingAssert(Map<String, Object> assertion) {
    this.streamingAssertions.add(assertion);
    return this;
  }

  public AxGen addStreamingAssert(String field, Object notContains) {
    return addStreamingAssert(field, notContains, null);
  }

  public AxGen addStreamingAssert(String field, Object notContains, String message) {
    Map<String, Object> spec = new LinkedHashMap<>();
    spec.put("field", field);
    spec.put("not_contains", notContains);
    if (message != null) spec.put("message", message);
    return addStreamingAssert(spec);
  }

  /** Adds a streaming assertion without a message of its own; see {@link #addStreamingAssert(String, AxStreamingAssertion, String)}. */
  public AxGen addStreamingAssert(String field, AxStreamingAssertion assertion) {
    return addStreamingAssert(field, assertion, null);
  }

  /**
   * Adds a TypeScript streaming assertion on a string or code output field: {@code
   * assertion.check(text, done)} sees the field's text so far as it streams. {@code null} or {@code
   * true} passes; {@code false} or a message string stops the attempt and retries it with a
   * correction (the returned message, else {@code message}, else a default). An exception the check
   * throws ends the forward without a retry.
   *
   * @throws IllegalArgumentException when field is not a string or code output field
   */
  public AxGen addStreamingAssert(String field, AxStreamingAssertion assertion, String message) {
    if (assertion == null) throw new IllegalArgumentException("addStreamingAssert: assertion is required");
    Field output = null;
    for (Field item : signature.outputs) if (item.name.equals(field)) output = item;
    if (output == null) throw new IllegalArgumentException("addStreamingAssert: field " + field + " not found in output signature");
    if (!isTextField(output)) throw new IllegalArgumentException("addStreamingAssert: field " + field + " must be a string field for streaming assertions");
    Map<String, Object> spec = new LinkedHashMap<>();
    spec.put("field", field);
    spec.put("fn", assertion);
    if (message != null) spec.put("message", message);
    return addStreamingAssert(spec);
  }

  /**
   * Rewrites an output field's final value before the assertions run. op is "uppercase",
   * "lowercase", "trim", "prefix:&lt;text&gt;" or "suffix:&lt;text&gt;". This is a port extension:
   * TypeScript field processors send their result back to the model instead ({@link
   * #addFieldProcessor(String, AxFieldProcessor, AxFieldProcessorMode)} with {@link
   * AxFieldProcessorMode#FEEDBACK}). {@link #streamingForward} holds a transformed field back and
   * sends it once, transformed.
   */
  public AxGen addFieldTransform(String field, String op) {
    this.fieldProcessors.add(processorSpec(field, op));
    return this;
  }

  /** Rewrites an output field's final value with {@code transform}'s result; see {@link #addFieldTransform(String, String)}. */
  public AxGen addFieldTransform(String field, FieldProcessorCallback transform) {
    this.fieldProcessors.add(processorSpec(field, transform));
    return this;
  }

  /**
   * Rewrites the field value, as {@link #addFieldTransform(String, String)} does.
   *
   * @deprecated Use {@link #addFieldTransform(String, String)}. In the next major version {@code
   *     addFieldProcessor} follows TypeScript and sends the processor's result back to the model;
   *     opt in now with {@link #addFieldProcessor(String, AxFieldProcessor, AxFieldProcessorMode)}
   *     and {@link AxFieldProcessorMode#FEEDBACK}.
   */
  @Deprecated
  public AxGen addFieldProcessor(String field, String op) {
    Core.axgenDeprecation("java-add-field-processor-transform", FIELD_PROCESSOR_DEPRECATION);
    return addFieldTransform(field, op);
  }

  /**
   * Rewrites the field value with the callback's result, as {@link #addFieldTransform(String,
   * FieldProcessorCallback)} does.
   *
   * @deprecated Use {@link #addFieldTransform(String, FieldProcessorCallback)}. In the next major
   *     version {@code addFieldProcessor} follows TypeScript and sends the processor's result back
   *     to the model; opt in now with {@link #addFieldProcessor(String, AxFieldProcessor,
   *     AxFieldProcessorMode)} and {@link AxFieldProcessorMode#FEEDBACK}.
   */
  @Deprecated
  public AxGen addFieldProcessor(String field, FieldProcessorCallback processor) {
    Core.axgenDeprecation("java-add-field-processor-transform", FIELD_PROCESSOR_DEPRECATION);
    return addFieldTransform(field, processor);
  }

  /**
   * Adds a field processor. With {@link AxFieldProcessorMode#FEEDBACK} it follows TypeScript:
   * {@code processor.process(value, context)} runs on the field's final value, and a non-empty
   * result goes back to the model as a user message for another step, whose answer replaces the
   * earlier one. With {@link AxFieldProcessorMode#TRANSFORM} the returned value rewrites the field,
   * as {@link #addFieldTransform} does.
   *
   * @throws IllegalArgumentException with FEEDBACK, when field is not an output field
   */
  public AxGen addFieldProcessor(String field, AxFieldProcessor processor, AxFieldProcessorMode mode) {
    if (processor == null) throw new IllegalArgumentException("addFieldProcessor: processor is required");
    if (mode == null) throw new IllegalArgumentException("addFieldProcessor: mode is required");
    if (mode == AxFieldProcessorMode.TRANSFORM) {
      this.fieldProcessors.add(processorSpec(field, processor));
      return this;
    }
    outputField("addFieldProcessor", field, false);
    this.feedbackProcessors.add(processorSpec(field, processor));
    return this;
  }

  /**
   * Adds a TypeScript streaming field processor: {@code processor.process(text, context)} runs on
   * each streamed chunk of a string or code output field with the field's text so far ({@code
   * context.done()} marks the final call); a non-empty result goes back to the model as a user
   * message for another step.
   *
   * @throws IllegalArgumentException when field is not a string or code output field
   */
  public AxGen addStreamingFieldProcessor(String field, AxFieldProcessor processor) {
    if (processor == null) throw new IllegalArgumentException("addFieldProcessor: processor is required");
    outputField("addFieldProcessor", field, true);
    this.streamingFieldProcessors.add(processorSpec(field, processor));
    return this;
  }

  private static final String FIELD_PROCESSOR_DEPRECATION =
      "AxGen.addFieldProcessor(field, op or callback) rewrites the field value; use addFieldTransform(field, ...) for that. "
          + "In the next major version addFieldProcessor follows TypeScript and sends the processor's result back "
          + "to the model for another step; opt in now with addFieldProcessor(field, processor, AxFieldProcessorMode.FEEDBACK).";

  // Throws, as TypeScript does, when field is not an output field or, for
  // text, not a string or code field.
  private void outputField(String method, String field, boolean text) {
    for (Field output : signature.outputs) {
      if (!output.name.equals(field)) continue;
      if (text && !isTextField(output)) throw new IllegalArgumentException(method + ": field " + field + " must be a text field");
      return;
    }
    throw new IllegalArgumentException(method + ": field " + field + " not found");
  }

  private static boolean isTextField(Field field) {
    String typeName = field.type == null || field.type.name == null ? "string" : field.type.name;
    return "string".equals(typeName) || "code".equals(typeName);
  }

  private static Map<String, Object> processorSpec(String field, Object processor) {
    Map<String, Object> spec = new LinkedHashMap<>();
    spec.put("field", field);
    spec.put("processor", processor);
    return spec;
  }

  public AxGen onFunctionCall(FunctionCallHook hook) {
    if (hook != null) this.options.put("onFunctionCall", hook);
    return this;
  }

  public AxGen setStopFunctions(List<String> names) {
    this.stopFunctions.clear();
    if (names != null) this.stopFunctions.addAll(names);
    return this;
  }

  public AxGen setInstruction(String instruction) {
    this.instruction = instruction == null ? "" : instruction;
    this.options.put("instruction", this.instruction);
    this.promptTemplate.setInstruction(this.instruction);
    return this;
  }

  public String getInstruction() {
    return instruction;
  }

  public AxGen clearInstruction() {
    return setInstruction("");
  }

  public List<Map<String, Object>> getOptimizableComponents() {
    List<Map<String, Object>> components = new ArrayList<>();
    if (signature.description != null && !signature.description.isBlank()) {
      components.add(Core.asMap(Core._optimization_component(
        programId + "::description",
        programId,
        "description",
        signature.description,
        "Program signature description.",
        List.of("Preserve the task intent and field references."),
        List.of(),
        false,
        "markdown",
        Map.of("required_placeholders", List.of())
      )));
    }
    components.add(Core.asMap(Core._optimization_component(
      programId + "::instruction",
      programId,
      "instruction",
      instruction,
      "Prompt instruction text used by this generator.",
      List.of("Keep required input and output fields intact."),
      List.of(),
      false,
      "markdown",
      Map.of("required_placeholders", List.of())
    )));
    for (Tool tool : functions) {
      components.add(Core.asMap(Core._optimization_component(
        programId + "::fn:" + tool.name + ":desc",
        programId,
        "fn-desc",
        tool.description,
        "Description for tool " + tool.name + ".",
        List.of("Non-empty, concise, and faithful to the tool behavior."),
        List.of(),
        false,
        "text",
        Map.of("maxLength", 320)
      )));
      components.add(Core.asMap(Core._optimization_component(
        programId + "::fn:" + tool.name + ":name",
        programId,
        "fn-name",
        tool.name,
        "Callable name for tool " + tool.name + ".",
        List.of("snake_case", "32 characters or fewer", "unique among tools"),
        List.of(),
        true,
        "snake_case",
        Map.of("pattern", "^[a-z][a-z0-9_]{0,31}$")
      )));
    }
    return components;
  }

  public AxGen applyOptimizedComponents(Map<String, Object> componentMap) {
    Map<String, Object> updates = componentMap == null ? Map.of() : componentMap;
    if (updates.containsKey(programId + "::description")) this.options.put("optimized_description", String.valueOf(updates.get(programId + "::description")));
    if (updates.containsKey(programId + "::instruction")) setInstruction(String.valueOf(updates.get(programId + "::instruction")));
    for (int i = 0; i < functions.size(); i++) {
      Tool tool = functions.get(i);
      String desc = updates.containsKey(programId + "::fn:" + tool.name + ":desc") ? String.valueOf(updates.get(programId + "::fn:" + tool.name + ":desc")) : tool.description;
      String name = updates.containsKey(programId + "::fn:" + tool.name + ":name") ? String.valueOf(updates.get(programId + "::fn:" + tool.name + ":name")).trim() : tool.name;
      if (!name.matches("^[a-z][a-z0-9_]{0,31}$")) throw new RuntimeException("invalid optimized function name: " + name);
      for (Tool other : functions) if (other != tool && other.name.equals(name)) throw new RuntimeException("duplicate optimized function name: " + name);
      if (!desc.equals(tool.description) || !name.equals(tool.name)) functions.set(i, new Tool(name, desc, tool.args, tool.returns, tool.handler,tool.execution,tool.contextHandler));
    }
    return this;
  }

  @SuppressWarnings("unchecked")
  public AxGen applyOptimization(Object artifact) {
    List<Map<String, Object>> components = getOptimizableComponents();
    Map<String, Object> map = artifact instanceof String text
      ? Core.asMap(Core._deserialize_optimized_artifact(text, components))
      : Core.asMap(Core._validate_optimized_artifact(artifact == null ? Map.of() : artifact, components));
    return applyOptimizedComponents((Map<String, Object>) map.getOrDefault("componentMap", Map.of()));
  }

  public Map<String, Object> evaluateOptimization(AiClient client, Object dataset, Map<String, Object> candidateMap, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Map<String, Object> normalized = Core.asMap(Core._normalize_optimization_dataset(dataset == null ? List.of() : dataset));
    List<Object> rows = new ArrayList<>();
    Map<String, Object> original = Core.asMap(Core._optimization_component_current_map(getOptimizableComponents()));
    Map<String, Object> candidate = candidateMap == null ? Map.of() : candidateMap;
    try {
      if (!candidate.isEmpty()) applyOptimizedComponents(candidate);
      for (Object rawTask : Core.asList(normalized.getOrDefault("train", List.of()))) {
        Map<String, Object> task = Core.asMap(rawTask);
        Object error = null;
        Map<String, Object> prediction;
        try {
          Object output = forward(client, Core.asMap(task.getOrDefault("input", task)), Core.asMap(opts.getOrDefault("forward_options", Map.of())));
          prediction = new LinkedHashMap<>();
          prediction.put("completionType", "final");
          prediction.put("output", output);
          prediction.put("finalOutput", output);
          prediction.put("functionCalls", getFunctionCallTraces());
          prediction.put("actionLog", getChatLog());
          prediction.put("usage", Map.of());
          prediction.put("trace", Map.of("traces", getTraces()));
        } catch (RuntimeException e) {
          error = Map.of("message", String.valueOf(e.getMessage()));
          prediction = new LinkedHashMap<>();
          prediction.put("completionType", "error");
          prediction.put("error", error);
          prediction.put("functionCalls", getFunctionCallTraces());
          prediction.put("actionLog", getChatLog());
          prediction.put("usage", Map.of());
          prediction.put("trace", Map.of("traces", getTraces()));
        }
        Map<String, Object> scores = Core.asMap(Core._normalize_optimization_metric_scores(task.containsKey("metric_score") ? task.get("metric_score") : task.containsKey("scores") ? task.get("scores") : task.getOrDefault("score", "error".equals(prediction.get("completionType")) ? 0 : 1)));
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
    Map<String, Object> run = Core.asMap(Core._prepare_optimizer_run("axgen", components, dataset == null ? List.of() : dataset, opts, Map.of("traces", getTraces(), "chat_log", getChatLog()), client instanceof AiClient));
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

  public List<Map<String, Object>> getTraces() {
    return new ArrayList<>(traces);
  }

  public List<Map<String, Object>> getChatLog() {
    return new ArrayList<>(chatLog);
  }

  public List<Map<String, Object>> getFunctionCallTraces() {
    return new ArrayList<>(functionCallTraces);
  }

  public AxMemory getMemory() {
    return memory;
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, java.util.Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    return forward(client, values, forwardOptions, AxRuntimeHooks.fromOptions(forwardOptions));
  }

  public Map<String,Object> forwardWithCancellation(AiClient client,Map<String,Object> values,AxCancellationToken cancellation){return forwardWithCancellation(client,values,Map.of(),cancellation);}
  public Map<String,Object> forwardWithCancellation(AiClient client,Map<String,Object> values,Map<String,Object> options,AxCancellationToken cancellation){Map<String,Object> resolved=new LinkedHashMap<>(options==null?Map.of():options);resolved.put("cancellation",cancellation);return forward(client,values,resolved);}

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions, AxRuntimeHooks hooks) {
    // As in TypeScript, the cache is read before the run's span and metrics,
    // so a stored output records neither; an error from the read propagates.
    Map<String, Object> callOptions = AxRuntimeHooks.strip(forwardOptions);
    Map<String, Object> cached = readCacheFirst(values, callOptions, false);
    if (cached != null) return cached;
    AxGlobals.Scope scope = AxGlobals.openScope(
        hooks,
        runtimeHooks,
        "ax_gen_forward",
        "ax_gen_generation",
        Map.of("ax.program.id", programId, "ax.program.type", "AxGen"));
    try {
      return forwardUnscoped(client, values, callOptions);
    } catch (RuntimeException | Error error) {
      scope.fail(error);
      throw error;
    } finally {
      scope.close();
    }
  }

  // The forward's cache read (Core._cache_lookup_impl), made before the run
  // opens its span and metrics. It returns the stored output on a hit;
  // after a miss it adds the lookup to callOptions as _ax_cache_lookup, so
  // the forward only stores, and returns null. Options that already carry a
  // lookup (an enclosing forward made it) are left as they are, and without
  // a caching function the options stay unchanged.
  private Map<String, Object> readCacheFirst(Map<String, Object> values, Map<String, Object> callOptions, boolean ignoreReadErrors) {
    if (callOptions.containsKey(CACHE_LOOKUP)) return null;
    Map<String, Object> lookup = Core.asMap(Core._cache_lookup_impl(this, values, callOptions, ignoreReadErrors));
    if (lookup.get("fn") == null) return null;
    if (Core.truthy(lookup.get("hit"))) return Core.asMap(lookup.get("value"));
    callOptions.put(CACHE_LOOKUP, lookup);
    return null;
  }

  // Call options holding only the cache lookup, for a call-scoped generator.
  private static Map<String, Object> cacheLookupOnly(Map<String, Object> options) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (options != null && options.containsKey(CACHE_LOOKUP)) out.put(CACHE_LOOKUP, options.get(CACHE_LOOKUP));
    return out;
  }

  private static final String CACHE_LOOKUP = "_ax_cache_lookup";

  /** Streams a forward with no options; see {@link #streamingForward(AiClient, Map, Map, AxCancellationToken)}. */
  public AxGenDeltaStream streamingForward(AiClient client, Map<String, Object> values) {
    return streamingForward(client, values, Map.of(), null);
  }

  /** Streams a forward; see {@link #streamingForward(AiClient, Map, Map, AxCancellationToken)}. */
  public AxGenDeltaStream streamingForward(AiClient client, Map<String, Object> values, Map<String, Object> options) {
    return streamingForward(client, values, options, null);
  }

  /**
   * Runs the forward and returns TypeScript's streamed updates as the model streams (see {@link
   * AxGenDelta}): merge each index's deltas (strings and lists append, other values replace) and
   * discard what you merged when the version changes. Retries, steps, tools, assertions and field
   * processors work as in {@link #forward}. The forward runs on a worker thread that starts when
   * iteration starts and waits while the caller handles each delta. Use try-with-resources: closing
   * the stream stops the run; cancelling {@code cancellation} (or an {@code AxCancellationToken}
   * under the {@code cancellation} option) aborts it, and the iterator then throws the {@link
   * AxAIServiceAbortedError}. A forward error is rethrown from the iterator as the forward raised it.
   * With a run {@code control} option the run reports started, then completed or failed, and applies
   * the control's updates at each request, as {@link #forward} does; a stream closed early ends the
   * run with an aborted event rather than failed.
   */
  public AxGenDeltaStream streamingForward(AiClient client, Map<String, Object> values, Map<String, Object> options, AxCancellationToken cancellation) {
    Map<String, Object> runOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    AxCancellationToken parent = cancellation;
    for (String key : List.of("cancellation", "cancellationToken", "cancellation_token")) {
      Object token = runOptions.remove(key);
      if (parent == null && token instanceof AxCancellationToken given) parent = given;
    }
    // A token among the constructor options applies too, as it does in forward().
    for (String key : List.of("cancellation", "cancellationToken", "cancellation_token")) {
      if (parent == null && this.options.get(key) instanceof AxCancellationToken given) parent = given;
    }
    AxGenDeltaStream.StopToken stop = new AxGenDeltaStream.StopToken();
    runOptions.put("cancellation", stop);
    Map<String, Object> input = values == null ? new LinkedHashMap<>() : new LinkedHashMap<>(values);
    return new AxGenDeltaStream(sink -> streamingForwardWith(client, input, runOptions, sink), stop, parent);
  }

  // Runs the TypeScript streaming forward on the calling thread, handing each
  // {version, index, delta} envelope to sink as the provider stream arrives,
  // and returns the merged output of the picked sample. A sink that throws
  // (e.g. AxAIServiceAbortedError) stops the run. streamingForward() runs it
  // on a worker thread.
  Map<String, Object> streamingForwardWith(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions, java.util.function.Consumer<Map<String, Object>> sink) {
    Map<String, Object> input = values == null ? new LinkedHashMap<>() : values;
    // As in TypeScript, the cache is read before the run's span and metrics,
    // an error from the read is ignored, and a stored output arrives as one
    // delta without a run.
    Map<String, Object> callOptions = AxRuntimeHooks.strip(forwardOptions);
    Map<String, Object> cached = readCacheFirst(input, callOptions, true);
    if (cached != null) {
      Map<String, Object> envelope = new LinkedHashMap<>();
      envelope.put("version", 0);
      envelope.put("index", 0);
      envelope.put("delta", cached);
      sink.accept(envelope);
      return cached;
    }
    Map<String, Object> attributes = new LinkedHashMap<>();
    attributes.put("ax.program.id", programId);
    attributes.put("ax.program.type", "AxGen");
    attributes.put("ax.streaming", true);
    AxGlobals.Scope scope = AxGlobals.openScope(AxRuntimeHooks.fromOptions(forwardOptions), runtimeHooks, "ax_gen_forward", "ax_gen_generation", attributes);
    try {
      java.util.function.Consumer<Object> emit = envelope -> sink.accept(Core.asMap(envelope));
      return streamingForwardUnscoped(client, input, callOptions, emit);
    } catch (RuntimeException | Error error) {
      scope.fail(error);
      throw error;
    } finally {
      scope.close();
    }
  }

  private Map<String, Object> streamingForwardUnscoped(AiClient client, Map<String, Object> values, Map<String, Object> options, java.util.function.Consumer<Object> emit) {
    if (!(client instanceof SessionRun)) {
      Map<String, Object> runOptions = new LinkedHashMap<>(this.options);
      runOptions.putAll(options);
      boolean controlled = runOptions.get("control") instanceof AxRunControl;
      boolean sessionCapable = Core.truthy(Core.chat_session_mode_enabled(runOptions))
          && (client instanceof ChatRunSelector || (client instanceof AxChatSession.Provider && Core.truthy(Core.get(Core.aiClientFeatures(client, runOptions.get("model")), "asyncTools", false))));
      if (sessionCapable && (controlled || functions.stream().anyMatch(tool -> "background".equals(tool.execution)))) {
        throw new UnsupportedOperationException("streaming_forward deltas do not cover async run sessions (control or background tools on a session-capable client) yet; use forward()");
      }
      // Run controls apply at each request boundary, as in forward().
      if (controlled) {
        SessionRun bounded = new SessionRun(this, client, null, runOptions);
        try {
          Map<String, Object> output = streamingForwardUnscoped(bounded, values, options, emit);
          bounded.finish(null);
          return output;
        } catch (RuntimeException | Error error) {
          // A run the streamingForward() consumer stopped early ends with an
          // aborted event rather than failed.
          bounded.finish(error, runOptions.get("cancellation") instanceof AxGenDeltaStream.StopToken stop && stop.consumerStopped());
          throw error;
        }
      }
    }
    AxExecutionContext callContext = AxExecutionContext.resolve(options, executionContext);
    if (callContext == executionContext) return Core.asMap(Core._streaming_forward_impl(this, client, values, options, emit));
    AxGen call = callScoped(callContext, options);
    try {
      return Core.asMap(Core._streaming_forward_impl(call, client, values, cacheLookupOnly(options), emit));
    } finally {
      chatLog.addAll(call.chatLog);
      functionCallTraces.addAll(call.functionCallTraces);
      traces.addAll(call.traces);
    }
  }

  // A generator for one call with its own execution context (MCP/UCP tools),
  // keeping this generator's assertions, processors, examples and memory.
  private AxGen callScoped(AxExecutionContext callContext, Map<String, Object> forwardOptions) {
    Map<String, Object> callOptions = new LinkedHashMap<>(options);
    callOptions.putAll(forwardOptions);
    callOptions.remove(CACHE_LOOKUP);
    callOptions.put("functions", baseFunctions);
    if (callContext == null) {
      callOptions.remove("mcp");
      callOptions.remove("ucp");
      callOptions.remove("executionContext");
    } else callOptions.put("executionContext", callContext);
    callOptions.put("memory", memory);
    AxGen call = new AxGen(signature, callOptions, runtimeHooks);
    call.setExamples(examples);
    call.setDemos(demos);
    call.assertions.clear();
    call.assertions.addAll(assertions);
    call.streamingAssertions.clear();
    call.streamingAssertions.addAll(streamingAssertions);
    call.fieldProcessors.clear();
    call.fieldProcessors.addAll(fieldProcessors);
    call.feedbackProcessors.clear();
    call.feedbackProcessors.addAll(feedbackProcessors);
    call.streamingFieldProcessors.clear();
    call.streamingFieldProcessors.addAll(streamingFieldProcessors);
    call.setStopFunctions(stopFunctions);
    return call;
  }

  private Map<String, Object> forwardUnscoped(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    Map<String,Object> runOptions=new LinkedHashMap<>(options);
    if(forwardOptions!=null) runOptions.putAll(forwardOptions);
    AxExecutionContext callContext = AxExecutionContext.resolve(forwardOptions, executionContext);
    if (callContext != executionContext) {
      Map<String, Object> callOptions = new LinkedHashMap<>(runOptions);
      callOptions.remove(CACHE_LOOKUP);
      callOptions.put("functions", baseFunctions);
      if (callContext == null) {
        callOptions.remove("mcp");
        callOptions.remove("ucp");
        callOptions.remove("executionContext");
      } else callOptions.put("executionContext", callContext);
      AxGen call = new AxGen(signature, callOptions);
      // The call-scoped forward keeps this forward's cache read.
      Map<String, Object> result = call.forward(client, values, cacheLookupOnly(forwardOptions));
      chatLog.addAll(call.chatLog);
      functionCallTraces.addAll(call.functionCallTraces);
      traces.addAll(call.traces);
      return result;
    }
    if(!(client instanceof SessionRun)) {
      boolean controlled=runOptions.get("control") instanceof AxRunControl;
      AxChatSession.Provider opener=null;
      if(client instanceof AxChatSession.Provider provider && Core.truthy(Core.chat_session_mode_enabled(runOptions))) {
        if(Core.truthy(Core.get(Core.aiClientFeatures(client,runOptions.get("model")),"asyncTools",false)))opener=provider;
      }
      if(controlled || ((opener!=null || (client instanceof ChatRunSelector && Core.truthy(Core.chat_session_mode_enabled(runOptions)))) && functions.stream().anyMatch(tool->"background".equals(tool.execution)))) {
        SessionRun session=new SessionRun(this,client,opener,runOptions);
        if(opener!=null || client instanceof ChatRunSelector)runOptions.put("infraRetries",0);
        try {var output=forwardUnscoped(session,values,runOptions);session.finish(null);return output;}
        catch(RuntimeException|Error error){session.finish(error);throw error;}
      }
    }
    return Core.asMap(Core._forward_impl(this, client, values, forwardOptions == null ? java.util.Map.of() : forwardOptions));
  }

  Map<String, Object> request(List<Map<String, Object>> messages, Map<String, Object> opts) {
    Map<String, Object> requestOptions = opts == null ? java.util.Map.of() : opts;
    Map<String, Object> selection = Core.asMap(Core._select_structured_output_rung(signature, java.util.Map.of(), requestOptions));
    return Core.asMap(Core._build_gen_chat_request(this, messages, requestOptions, selection, 0));
  }
}
