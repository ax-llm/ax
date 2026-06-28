package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Agentic Context Engineering optimizer (Generator -&gt; Reflector -&gt; Curator).
 *
 * <p>The deterministic playbook mutations reuse the Core-owned {@code _ace_*}
 * ops; the LLM-orchestrated reflect/curate steps are delegated to injected
 * callables so the loop is reproducible under conformance with scripted
 * responses (mirrors how {@link AxGEPA} accepts a reflection client).
 */
public final class AxACE {
  /** Reflector contract: question/generator_answer/playbook/feedback -&gt; reflection. */
  public interface Reflector extends Function<Map<String, Object>, Map<String, Object>> {}

  /** Curator contract: playbook/reflection/question_context -&gt; {reasoning, operations}. */
  public interface Curator extends Function<Map<String, Object>, Map<String, Object>> {}

  /** Generator contract: example -&gt; prediction. */
  public interface Generator extends Function<Map<String, Object>, Map<String, Object>> {}

  private final Reflector reflector;
  private final Curator curator;
  private Generator generator;
  private final Map<String, Object> options;
  private final Map<String, Object> config;
  private final Object initialPlaybook;
  private final String now;
  private Object playbook;
  private final List<Object> generatorHistory = new ArrayList<>();
  private final List<Object> deltaHistory = new ArrayList<>();
  private Object lastPrediction;

  public AxACE() {
    this(null, null, null, Map.of());
  }

  public AxACE(Reflector reflector, Curator curator) {
    this(reflector, curator, null, Map.of());
  }

  public AxACE(Reflector reflector, Curator curator, Generator generator, Map<String, Object> options) {
    this.reflector = reflector;
    this.curator = curator;
    this.generator = generator;
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
    this.config = new LinkedHashMap<>();
    this.config.put("maxEpochs", 1);
    this.config.put("maxReflectorRounds", 2);
    this.config.put("maxSectionSize", 25);
    this.config.put("maxSerializedFieldChars", 2000);
    this.config.put("similarityThreshold", 0.95);
    this.config.put("allowDynamicSections", true);
    for (String key : new ArrayList<>(this.config.keySet())) {
      Object value = this.options.get(key);
      if (value != null) this.config.put(key, value);
    }
    this.initialPlaybook = this.options.get("initialPlaybook");
    Object nowOpt = this.options.get("now");
    this.now = nowOpt == null ? "1970-01-01T00:00:00.000Z" : String.valueOf(nowOpt);
    this.playbook = this.initialPlaybook != null
      ? clone(this.initialPlaybook)
      : Core._ace_empty_playbook(null, this.now);
  }

  public String name() { return "ACE"; }
  public String version() { return "axir-ace-v1"; }

  private static Object clone(Object value) {
    if (value == null) return null;
    return Json.parse(Json.stringify(value));
  }

  private int intConfig(String key, int fallback) {
    Object value = config.get(key);
    return value instanceof Number n ? n.intValue() : fallback;
  }

  public void reset() {
    this.playbook = this.initialPlaybook != null
      ? clone(this.initialPlaybook)
      : Core._ace_empty_playbook(null, this.now);
    this.generatorHistory.clear();
    this.deltaHistory.clear();
  }

  public void configureAuto(String level) {
    if ("light".equals(level)) {
      config.put("maxEpochs", 1);
      config.put("maxReflectorRounds", 1);
    } else if ("medium".equals(level)) {
      config.put("maxEpochs", 2);
      config.put("maxReflectorRounds", 2);
    } else if ("heavy".equals(level)) {
      config.put("maxEpochs", 3);
      config.put("maxReflectorRounds", 3);
    }
  }

  public void hydrate(Object program, Map<String, Object> state) {
    state = state == null ? Map.of() : state;
    Object pb = state.get("playbook");
    if (pb != null) {
      this.playbook = clone(pb);
    } else if (this.initialPlaybook != null) {
      this.playbook = clone(this.initialPlaybook);
    } else {
      this.playbook = Core._ace_empty_playbook(null, this.now);
    }
    Map<String, Object> artifact = Core.asMap(state.getOrDefault("artifact", Map.of()));
    this.generatorHistory.clear();
    this.generatorHistory.addAll(Core.asList(clone(artifact.getOrDefault("feedback", List.of()))));
    this.deltaHistory.clear();
    this.deltaHistory.addAll(Core.asList(clone(artifact.getOrDefault("history", List.of()))));
  }

  public Object getPlaybook() { return clone(this.playbook); }

  public Object getArtifact() { return createArtifact(); }

  public Object createArtifact() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("playbook", clone(this.playbook));
    out.put("feedback", clone(this.generatorHistory));
    out.put("history", clone(this.deltaHistory));
    return out;
  }

  private String renderPlaybook() {
    return String.valueOf(Core._ace_render_playbook(clone(this.playbook)));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> generatorOutput(Object prediction) {
    String reasoning = "";
    List<Object> bulletIds = new ArrayList<>();
    if (prediction instanceof Map<?, ?> map) {
      Object thought = map.get("thought");
      if (thought != null) reasoning = String.valueOf(thought);
      Object ids = map.get("bullet_ids");
      if (ids instanceof List<?> list) bulletIds = new ArrayList<>((List<Object>) list);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("reasoning", reasoning);
    out.put("answer", prediction);
    out.put("bulletIds", bulletIds);
    return out;
  }

  private Object runReflectionRounds(Map<String, Object> example, Map<String, Object> generatorOutput, Object feedback) {
    int rounds = Math.max(intConfig("maxReflectorRounds", 1), 1);
    Map<String, Object> previous = null;
    for (int round = 0; round < rounds; round++) {
      Map<String, Object> reflection = runReflector(example, generatorOutput, feedback, previous);
      if (reflection == null || reflection.isEmpty()) break;
      previous = reflection;
      String errorText = String.valueOf(reflection.getOrDefault("errorIdentification", "")).toLowerCase().trim();
      Object metadata = reflection.get("metadata");
      Boolean resolved = metadata instanceof Map<?, ?> m && Boolean.TRUE.equals(m.get("resolved")) ? Boolean.TRUE : null;
      if (Boolean.TRUE.equals(resolved) || errorText.isEmpty() || errorText.startsWith("no error") || errorText.startsWith("resolved")) {
        break;
      }
    }
    return previous;
  }

  private Map<String, Object> runReflector(Map<String, Object> example, Map<String, Object> generatorOutput, Object feedback, Object previousReflection) {
    if (this.reflector == null) return null;
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("question", example);
    payload.put("generator_answer", generatorOutput.get("answer"));
    payload.put("generator_reasoning", generatorOutput.get("reasoning"));
    payload.put("playbook", renderPlaybook());
    payload.put("feedback", feedback);
    payload.put("previous_reflection", previousReflection);
    return this.reflector.apply(payload);
  }

  private Map<String, Object> runCurator(Map<String, Object> example, Object reflection) {
    if (reflection == null) return null;
    if (this.curator == null) return null;
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("playbook", renderPlaybook());
    payload.put("reflection", reflection);
    payload.put("question_context", example);
    payload.put("token_budget", 1024);
    return this.curator.apply(payload);
  }

  private List<Object> collectProtectedIds(List<Object> operations) {
    List<Object> protectedIds = new ArrayList<>();
    for (Object opObj : operations) {
      Map<String, Object> op = Core.asMap(opObj);
      if ("UPDATE".equals(op.get("type")) && op.get("bulletId") != null) {
        protectedIds.add(op.get("bulletId"));
      }
    }
    return protectedIds;
  }

  private Object metricFeedback(Object score) {
    if (!(score instanceof Number)) return null;
    return "Metric score: " + Core.jsonStringify(score);
  }

  @SuppressWarnings("unchecked")
  private void processExample(Map<String, Object> example, Object score, String source, int epoch, int index) {
    Map<String, Object> generatorOutput = generatorOutput(this.lastPrediction);
    Object reflection = runReflectionRounds(example, generatorOutput, metricFeedback(score));
    Map<String, Object> rawCurator = runCurator(example, reflection);
    Object operations = Core._ace_normalize_curator_operations(rawCurator == null ? null : rawCurator.get("operations"));
    Object resolvedObj = Core._ace_resolve_curator_operation_targets(operations, this.playbook, reflection, generatorOutput);
    List<Object> resolved = Core.asList(resolvedObj);
    Map<String, Object> curatorResult = null;
    if (rawCurator != null || !resolved.isEmpty()) {
      curatorResult = new LinkedHashMap<>(rawCurator == null ? Map.of() : rawCurator);
      curatorResult.put("operations", resolved);
    }
    List<Object> appliedIds = new ArrayList<>();
    if (!resolved.isEmpty()) {
      List<Object> protectedIds = collectProtectedIds(resolved);
      Map<String, Object> applyOptions = new LinkedHashMap<>();
      applyOptions.put("maxSectionSize", config.get("maxSectionSize"));
      applyOptions.put("allowDynamicSections", config.get("allowDynamicSections"));
      applyOptions.put("enableAutoPrune", true);
      applyOptions.put("protectedBulletIds", protectedIds);
      Map<String, Object> result = Core.asMap(Core._ace_apply_curator_operations(this.playbook, resolved, applyOptions, this.now));
      this.playbook = result.get("playbook");
      appliedIds = Core.asList(result.getOrDefault("updatedBulletIds", List.of()));
      List<Object> autoRemoved = Core.asList(result.getOrDefault("autoRemoved", List.of()));
      if (!autoRemoved.isEmpty()) {
        resolved = new ArrayList<>(resolved);
        resolved.addAll(autoRemoved);
        if (curatorResult != null) curatorResult.put("operations", resolved);
      }
    }
    if (reflection instanceof Map<?, ?> reflectionMap) {
      for (Object tagObj : Core.asList(((Map<String, Object>) reflectionMap).getOrDefault("bulletTags", List.of()))) {
        Map<String, Object> tag = Core.asMap(tagObj);
        this.playbook = Core._ace_update_bullet_feedback(this.playbook, tag.get("id"), tag.get("tag"), this.now);
      }
    }
    if (!resolved.isEmpty() && !appliedIds.isEmpty()) {
      this.playbook = Core._ace_dedupe_playbook(this.playbook);
    }
    Map<String, Object> feedbackEvent = new LinkedHashMap<>();
    feedbackEvent.put("example", example);
    feedbackEvent.put("prediction", this.lastPrediction);
    feedbackEvent.put("score", score instanceof Number ? score : 0);
    feedbackEvent.put("generatorOutput", generatorOutput);
    feedbackEvent.put("reflection", reflection);
    feedbackEvent.put("curator", curatorResult);
    feedbackEvent.put("timestamp", this.now);
    this.generatorHistory.add(feedbackEvent);
    if (!appliedIds.isEmpty() && curatorResult != null && !Core.asList(curatorResult.getOrDefault("operations", List.of())).isEmpty()) {
      Map<String, Object> delta = new LinkedHashMap<>();
      delta.put("source", source);
      delta.put("epoch", epoch);
      delta.put("exampleIndex", index);
      delta.put("operations", curatorResult.get("operations"));
      this.deltaHistory.add(delta);
    }
  }

  private Map<String, Object> runGenerator(Map<String, Object> example) {
    if (this.generator != null) {
      Map<String, Object> prediction = this.generator.apply(example);
      return prediction == null ? new LinkedHashMap<>() : prediction;
    }
    return new LinkedHashMap<>();
  }

  @SuppressWarnings("unchecked")
  public Map<String, Object> compile(Object program, List<Object> examples, Function<Map<String, Object>, Object> metricFn, Map<String, Object> options) {
    options = options == null ? Map.of() : options;
    Object aceOptions = options.containsKey("aceOptions") ? options.get("aceOptions") : options.get("ace_options");
    if (aceOptions instanceof Map<?, ?> aceMap) {
      for (String key : new ArrayList<>(config.keySet())) {
        Object value = ((Map<String, Object>) aceMap).get(key);
        if (value != null) config.put(key, value);
      }
    }
    reset();
    List<Object> exampleList = examples == null ? List.of() : examples;
    int epochs = Math.max(intConfig("maxEpochs", 1), 1);
    Double bestScore = null;
    for (int epoch = 0; epoch < epochs; epoch++) {
      for (int index = 0; index < exampleList.size(); index++) {
        Map<String, Object> example = Core.asMap(exampleList.get(index));
        Map<String, Object> prediction = runGenerator(example);
        this.lastPrediction = prediction;
        Object score = metricFn == null ? 0 : metricFn.apply(example);
        if (score instanceof Number n) {
          bestScore = bestScore == null ? n.doubleValue() : Math.max(bestScore, n.doubleValue());
        }
        processExample(example, score, "compile", epoch, index);
      }
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("playbook", clone(this.playbook));
    out.put("artifact", createArtifact());
    out.put("bestScore", bestScore == null ? 0 : bestScore);
    Map<String, Object> finalConfig = new LinkedHashMap<>();
    finalConfig.put("strategy", "ace");
    finalConfig.put("epochs", epochs);
    out.put("finalConfiguration", finalConfig);
    return out;
  }

  @SuppressWarnings("unchecked")
  public Map<String, Object> applyOnlineUpdate(Map<String, Object> args) {
    args = args == null ? Map.of() : args;
    if (this.generator == null) {
      throw new RuntimeException("AxACE: compile must run before applyOnlineUpdate");
    }
    Map<String, Object> example = Core.asMap(args.getOrDefault("example", Map.of()));
    Object prediction = args.get("prediction");
    this.lastPrediction = prediction;
    Map<String, Object> generatorOutput = generatorOutput(prediction);
    Object reflection = runReflectionRounds(example, generatorOutput, args.get("feedback"));
    Map<String, Object> rawCurator = runCurator(example, reflection);
    Object operations = Core._ace_normalize_curator_operations(rawCurator == null ? null : rawCurator.get("operations"));
    Object resolvedObj = Core._ace_resolve_curator_operation_targets(operations, this.playbook, reflection, generatorOutput);
    List<Object> resolved = Core.asList(resolvedObj);
    Map<String, Object> curatorResult = null;
    if (rawCurator != null || !resolved.isEmpty()) {
      curatorResult = new LinkedHashMap<>(rawCurator == null ? Map.of() : rawCurator);
      curatorResult.put("operations", resolved);
    }
    if (reflection instanceof Map<?, ?> reflectionMap) {
      for (Object tagObj : Core.asList(((Map<String, Object>) reflectionMap).getOrDefault("bulletTags", List.of()))) {
        Map<String, Object> tag = Core.asMap(tagObj);
        this.playbook = Core._ace_update_bullet_feedback(this.playbook, tag.get("id"), tag.get("tag"), this.now);
      }
    }
    List<Object> appliedIds = new ArrayList<>();
    if (!resolved.isEmpty()) {
      List<Object> protectedIds = collectProtectedIds(resolved);
      Map<String, Object> applyOptions = new LinkedHashMap<>();
      applyOptions.put("maxSectionSize", config.get("maxSectionSize"));
      applyOptions.put("allowDynamicSections", config.get("allowDynamicSections"));
      applyOptions.put("enableAutoPrune", true);
      applyOptions.put("protectedBulletIds", protectedIds);
      Map<String, Object> result = Core.asMap(Core._ace_apply_curator_operations(this.playbook, resolved, applyOptions, this.now));
      this.playbook = result.get("playbook");
      appliedIds = Core.asList(result.getOrDefault("updatedBulletIds", List.of()));
      List<Object> autoRemoved = Core.asList(result.getOrDefault("autoRemoved", List.of()));
      if (!autoRemoved.isEmpty()) {
        resolved = new ArrayList<>(resolved);
        resolved.addAll(autoRemoved);
        if (curatorResult != null) curatorResult.put("operations", resolved);
      }
      this.playbook = Core._ace_dedupe_playbook(this.playbook);
    }
    Map<String, Object> feedbackEvent = new LinkedHashMap<>();
    feedbackEvent.put("example", example);
    feedbackEvent.put("prediction", prediction);
    feedbackEvent.put("score", 0);
    feedbackEvent.put("generatorOutput", generatorOutput);
    feedbackEvent.put("reflection", reflection);
    feedbackEvent.put("curator", curatorResult);
    feedbackEvent.put("timestamp", this.now);
    this.generatorHistory.add(feedbackEvent);
    if (!appliedIds.isEmpty() && curatorResult != null && !Core.asList(curatorResult.getOrDefault("operations", List.of())).isEmpty()) {
      Map<String, Object> delta = new LinkedHashMap<>();
      delta.put("source", "online");
      delta.put("epoch", -1);
      delta.put("exampleIndex", this.generatorHistory.size() - 1);
      delta.put("operations", curatorResult.get("operations"));
      this.deltaHistory.add(delta);
    }
    return curatorResult;
  }

  public void setGenerator(Generator generator) { this.generator = generator; }
}
