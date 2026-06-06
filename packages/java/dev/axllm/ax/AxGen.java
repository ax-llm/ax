package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxGen implements AxProgram {
  public interface AssertionCallback { Object apply(Map<String, Object> output); }
  public interface FieldProcessorCallback { Object apply(Object value); }
  public interface FunctionCallHook { void accept(Map<String, Object> record); }

  final AxSignature signature;
  final Map<String, Object> options;
  final List<Tool> functions;
  final PromptTemplate promptTemplate;
  final List<Map<String, Object>> examples;
  final List<Map<String, Object>> demos;
  final List<Object> assertions;
  final List<Object> streamingAssertions;
  final List<Map<String, Object>> fieldProcessors;
  final List<String> stopFunctions;
  final AxMemory memory;
  final List<Map<String, Object>> chatLog;
  final List<Map<String, Object>> functionCallTraces;
  final List<Map<String, Object>> traces;
  final String programId;
  String instruction;

  public AxGen(AxSignature signature) {
    this(signature, java.util.Map.of());
  }

  @SuppressWarnings("unchecked")
  public AxGen(AxSignature signature, Map<String, Object> options) {
    this.signature = signature;
    this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
    Object funcs = this.options.get("functions");
    this.functions = funcs instanceof List<?> list ? new ArrayList<>((List<Tool>) list) : new ArrayList<>();
    this.examples = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("examples", List.of()))) this.examples.add(Core.asMap(item));
    this.demos = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("demos", List.of()))) this.demos.add(Core.asMap(item));
    this.assertions = new ArrayList<>(Core.asList(this.options.getOrDefault("assertions", List.of())));
    this.streamingAssertions = new ArrayList<>(Core.asList(this.options.getOrDefault("streaming_assertions", this.options.getOrDefault("streamingAssertions", List.of()))));
    this.fieldProcessors = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("field_processors", this.options.getOrDefault("fieldProcessors", List.of())))) this.fieldProcessors.add(Core.asMap(item));
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
  }

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

  public AxGen addAssert(Map<String, Object> assertion) {
    this.assertions.add(assertion);
    return this;
  }

  public AxGen addAssert(AssertionCallback assertion) {
    this.assertions.add(assertion);
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

  public AxGen addFieldProcessor(String field, String op) {
    this.fieldProcessors.add(new java.util.LinkedHashMap<>(Map.of("field", field, "processor", op)));
    return this;
  }

  public AxGen addFieldProcessor(String field, FieldProcessorCallback processor) {
    Map<String, Object> spec = new LinkedHashMap<>();
    spec.put("field", field);
    spec.put("processor", processor);
    this.fieldProcessors.add(spec);
    return this;
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
      if (!desc.equals(tool.description) || !name.equals(tool.name)) functions.set(i, new Tool(name, desc, tool.args, tool.returns, tool.handler));
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
    return Core.asMap(Core._forward_impl(this, client, values, forwardOptions == null ? java.util.Map.of() : forwardOptions));
  }

  Map<String, Object> request(List<Map<String, Object>> messages, Map<String, Object> opts) {
    return Core.asMap(Core._build_gen_chat_request(this, messages, opts == null ? java.util.Map.of() : opts));
  }
}
