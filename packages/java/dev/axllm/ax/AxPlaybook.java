package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A live, evolving context playbook bound to a program. Mirrors the TypeScript
 * {@code AxPlaybook}: grow it offline from examples ({@link #evolve}), keep it
 * growing online from live feedback ({@link #update}), render it into the program
 * context ({@link #applyTo}), and persist/restore it ({@link #toJson}/{@link
 * #load}). The evolution engine (ACE) is hidden behind this surface, just as
 * {@code Ax.optimize} hides GEPA.
 */
public final class AxPlaybook {
  private static final String REFLECTOR_SIGNATURE =
      "question:string \"Original task input serialized as JSON\", "
          + "generator_answer:string \"Generator output serialized as JSON\", "
          + "generator_reasoning?:string \"Generator reasoning trace\", "
          + "playbook:string \"Current context playbook rendered as markdown\", "
          + "expected_answer?:string \"Expected output when ground truth is available\", "
          + "feedback?:string \"External feedback or reward signal\", "
          + "previous_reflection?:string \"Most recent reflection JSON when running multi-round refinement\" "
          + "-> reasoning:string \"Step-by-step analysis of generator performance\", "
          + "errorIdentification:string \"Specific mistakes detected\", "
          + "rootCauseAnalysis:string \"Underlying cause of the error\", "
          + "correctApproach:string \"What the generator should do differently\", "
          + "keyInsight:string \"Reusable insight to remember\", "
          + "bulletTags:json \"Array of {id, tag} entries referencing playbook bullets\"";
  private static final String CURATOR_SIGNATURE =
      "playbook:string \"Current playbook serialized as JSON\", "
          + "reflection:string \"Latest reflection output serialized as JSON\", "
          + "question_context:string \"Original task input serialized as JSON\", "
          + "token_budget?:number \"Approximate token budget for curator response\" "
          + "-> reasoning:string \"Justification for the proposed updates\", "
          + "operations:json \"List of operations with type/section/content fields\"";
  private static final String WEAKNESS_MINER_SIGNATURE =
      "clusterSignature:string \"Shared error signature of the cluster\", "
          + "taskSummaries:string \"One line per failing task\", "
          + "actionLogExcerpts:string \"Excerpts of failing runs centered on the failure\", "
          + "functionCallSummary?:string \"Digest of runtime/tool calls\", "
          + "toolErrors?:string \"Tool errors observed\", "
          + "currentPlaybook?:string \"Current failure-avoidance playbook\" "
          + "-> weaknessDescription:string \"Recurring weakness\", "
          + "rootCause:string \"Mechanical root cause\", "
          + "proposedGuidance:string \"One concise imperative avoidance rule\", "
          + "evidenceQuotes:json \"Verbatim substrings copied from actionLogExcerpts\", "
          + "configRecommendations?:json \"Setup suggestions no prompt text can fix\"";
  private static final Pattern ERROR_SIGNATURE = Pattern.compile("^(\\w+Error:\\s*.{0,60})", Pattern.MULTILINE);
  private static final Pattern ACTION_ERROR_SIGNATURE = Pattern.compile("^\\s*(\\w+Error:\\s*.{0,60})", Pattern.MULTILINE);

  private final AxGen program;
  private final AxACE engine;
  private final AiClient studentAI;
  private final AiClient teacherAI;
  private final boolean verbose;
  private final String baseInstruction;
  private boolean started = false;
  private java.util.function.Consumer<String> applyHook;
  private AxGen reflectorProgram;
  private AxGen curatorProgram;
  private Object lastPrediction;
  private AxAgent agent;

  AxPlaybook bindAgent(AxAgent agent) {
    this.agent = agent;
    return this;
  }

  public AxPlaybook(AxGen program, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    this.program = program;
    Object student = option(opts, "studentAI", "student_ai", "student", "client", "ai");
    if (!(student instanceof AiClient studentClient)) {
      throw new IllegalArgumentException("playbook() requires studentAI or client");
    }
    this.studentAI = studentClient;
    Object teacher = option(opts, "teacherAI", "teacher_ai", "teacher");
    this.teacherAI = teacher instanceof AiClient teacherClient ? teacherClient : studentClient;
    this.verbose = Boolean.TRUE.equals(opts.get("verbose"));

    Map<String, Object> engineOptions = new LinkedHashMap<>();
    putIfPresent(engineOptions, "now", opts.get("now"));
    putIfPresent(engineOptions, "maxEpochs", option(opts, "maxEpochs", "max_epochs"));
    putIfPresent(engineOptions, "maxReflectorRounds", option(opts, "maxReflectorRounds", "max_reflector_rounds"));
    putIfPresent(engineOptions, "maxSectionSize", option(opts, "maxSectionSize", "max_section_size"));
    putIfPresent(engineOptions, "allowDynamicSections", option(opts, "allowDynamicSections", "allow_dynamic_sections"));
    putIfPresent(engineOptions, "initialPlaybook", option(opts, "initialPlaybook", "initial_playbook"));
    this.engine = new AxACE(this::runReflector, this::runCurator, this::runGenerator, engineOptions);
    Object auto = opts.get("auto");
    if (auto != null) {
      this.engine.configureAuto(String.valueOf(auto));
    }
    this.baseInstruction = program == null ? null : program.getInstruction();
  }

  // The real LLM generator: run the bound program with the student client.
  private Map<String, Object> runGenerator(Map<String, Object> example) {
    if (this.program == null) {
      return new LinkedHashMap<>();
    }
    inject();
    Map<String, Object> prediction = this.program.forward(this.studentAI, example);
    this.lastPrediction = prediction;
    return prediction;
  }

  private AxGen reflector() {
    if (this.reflectorProgram == null) {
      this.reflectorProgram = Ax.ax(REFLECTOR_SIGNATURE);
    }
    return this.reflectorProgram;
  }

  private AxGen curator() {
    if (this.curatorProgram == null) {
      this.curatorProgram = Ax.ax(CURATOR_SIGNATURE);
    }
    return this.curatorProgram;
  }

  // The real LLM reflector: a focused AxGen sub-program driven by the teacher.
  private Map<String, Object> runReflector(Map<String, Object> payload) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("question", stringify(payload.get("question")));
    request.put("generator_answer", stringify(payload.get("generator_answer")));
    request.put("playbook", payload.get("playbook"));
    putIfPresent(request, "generator_reasoning", payload.get("generator_reasoning"));
    putIfPresent(request, "feedback", payload.get("feedback"));
    if (payload.get("previous_reflection") != null) {
      request.put("previous_reflection", stringify(payload.get("previous_reflection")));
    }
    try {
      return reflector().forward(this.teacherAI, request);
    } catch (RuntimeException e) {
      if (this.verbose) {
        System.out.println("[AxPlaybook] reflector error: " + e.getMessage());
      }
      return null;
    }
  }

  // The real LLM curator: a focused AxGen sub-program driven by the teacher.
  private Map<String, Object> runCurator(Map<String, Object> payload) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("playbook", payload.get("playbook"));
    request.put("reflection", stringify(payload.get("reflection")));
    request.put("question_context", stringify(payload.get("question_context")));
    request.put("token_budget", payload.getOrDefault("token_budget", 1024));
    try {
      return curator().forward(this.teacherAI, request);
    } catch (RuntimeException e) {
      if (this.verbose) {
        System.out.println("[AxPlaybook] curator error: " + e.getMessage());
      }
      return null;
    }
  }

  private static String collapse(String value) {
    return value == null ? "" : value.replaceAll("\\s+", " ").trim();
  }

  private static String extractErrorSignature(Object value) {
    String text = String.valueOf(value == null ? "" : value);
    Matcher match = ERROR_SIGNATURE.matcher(text);
    return match.find() ? match.group(1) : text.substring(0, Math.min(80, text.length()));
  }

  private static String recordSignature(Map<String, Object> record) {
    Map<String, Object> prediction = Core.asMap(record.get("prediction"));
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (Object signal : Core.asList(prediction.getOrDefault("failureSignals", List.of()))) {
      String signature = String.valueOf(Core.get(signal, "signature", "behavioral:no_error"));
      counts.merge(signature, Core.asInt(Core.get(signal, "occurrences", 1)), Integer::sum);
    }
    String best = null;
    int bestCount = 0;
    for (Map.Entry<String, Integer> entry : counts.entrySet()) {
      if (entry.getValue() > bestCount) {
        best = entry.getKey();
        bestCount = entry.getValue();
      }
    }
    if (best != null) return best;
    List<Object> toolErrors = Core.asList(prediction.getOrDefault("toolErrors", List.of()));
    if (!toolErrors.isEmpty()) {
      String line = String.valueOf(toolErrors.get(0)).split("\\R", 2)[0];
      return line.substring(0, Math.min(100, line.length()));
    }
    if (record.get("error") != null) return extractErrorSignature(record.get("error"));
    Matcher actionError = ACTION_ERROR_SIGNATURE.matcher(String.valueOf(prediction.getOrDefault("actionLog", "")));
    return actionError.find() ? extractErrorSignature(actionError.group(1)) : "behavioral:no_error";
  }

  private static String failureExcerpt(Map<String, Object> record, String signature) {
    if (record.get("error") != null) return "Run threw: " + record.get("error");
    String actionLog = String.valueOf(Core.get(record.get("prediction"), "actionLog", ""));
    if (actionLog.length() <= 2000) return actionLog;
    int hit = actionLog.indexOf(signature.substring(0, Math.min(40, signature.length())));
    if (hit < 0) return actionLog.substring(actionLog.length() - 2000);
    int start = Math.max(0, hit - 1000);
    return actionLog.substring(start, Math.min(actionLog.length(), start + 2000));
  }

  private static List<Object> coerceList(Object value) {
    if (value == null) return List.of();
    return value instanceof List<?> list ? new ArrayList<>(list) : List.of(value);
  }

  private Map<String, Object> mineWeakness(
      String signature, List<Map<String, Object>> records, int proposalIndex, AiClient teacher) {
    List<Map<String, Object>> selected = records.subList(0, Math.min(4, records.size()));
    List<String> bodies = new ArrayList<>();
    StringBuilder excerpts = new StringBuilder();
    StringBuilder taskSummaries = new StringBuilder();
    List<String> functionCalls = new ArrayList<>();
    List<String> toolErrors = new ArrayList<>();
    for (int i = 0; i < selected.size(); i++) {
      Map<String, Object> record = selected.get(i);
      String body = failureExcerpt(record, signature);
      bodies.add(body);
      if (i > 0) excerpts.append("\n\n");
      excerpts.append("--- run ").append(i + 1).append(" ---\n").append(body);
      Map<String, Object> task = Core.asMap(record.get("task"));
      String taskId = task.get("id") == null ? "#" + (i + 1) : String.valueOf(task.get("id"));
      String input = Json.stringify(task.get("input"));
      if (input.length() > 240) input = input.substring(0, 240);
      if (i > 0) taskSummaries.append('\n');
      taskSummaries.append("- ").append(taskId).append(" (score ")
          .append(String.format("%.2f", ((Number) record.getOrDefault("score", 0)).doubleValue()))
          .append("): ").append(input);
      Map<String, Object> prediction = Core.asMap(record.get("prediction"));
      for (Object call : Core.asList(prediction.getOrDefault("functionCalls", List.of()))) {
        if (functionCalls.size() < 20) functionCalls.add(Json.stringify(call));
      }
      for (Object error : Core.asList(prediction.getOrDefault("toolErrors", List.of()))) {
        if (toolErrors.size() < 10) toolErrors.add(String.valueOf(error));
      }
    }
    if (bodies.stream().noneMatch(body -> !collapse(body).isEmpty())) return null;
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("clusterSignature", signature);
    request.put("taskSummaries", taskSummaries.toString());
    request.put("actionLogExcerpts", excerpts.toString());
    if (!functionCalls.isEmpty()) request.put("functionCallSummary", String.join("\n", functionCalls));
    if (!toolErrors.isEmpty()) request.put("toolErrors", String.join("\n", toolErrors));
    String currentPlaybook = render();
    if (!currentPlaybook.isBlank()) request.put("currentPlaybook", currentPlaybook);

    AxGen miner = new AxGen(AxSignature.create(WEAKNESS_MINER_SIGNATURE), Map.of(
        "id", "agent.playbook.weakness-miner",
        "instruction", "Identify one recurring weakness and one narrow durable avoidance rule. Every evidence quote must be copied verbatim from actionLogExcerpts."));
    Map<String, Object> mined = miner.forward(teacher, request);
    String haystack = collapse(excerpts.toString());
    List<Object> evidence = new ArrayList<>();
    for (Object quote : coerceList(mined.get("evidenceQuotes"))) {
      String text = String.valueOf(quote);
      String needle = collapse(text);
      if (!needle.isEmpty() && haystack.contains(needle)) evidence.add(text);
    }
    if (evidence.isEmpty()) return null;
    Map<String, Object> weakness = new LinkedHashMap<>();
    weakness.put("id", "weakness-" + (proposalIndex + 1));
    weakness.put("clusterSignature", signature);
    weakness.put("description", String.valueOf(mined.getOrDefault("weaknessDescription", "")));
    weakness.put("rootCause", String.valueOf(mined.getOrDefault("rootCause", "")));
    weakness.put("proposedGuidance", String.valueOf(mined.getOrDefault("proposedGuidance", "")));
    weakness.put("evidenceQuotes", evidence);
    List<Object> taskIds = new ArrayList<>();
    for (int i = 0; i < records.size(); i++) {
      Map<String, Object> record = records.get(i);
      Map<String, Object> task = Core.asMap(record.get("task"));
      taskIds.add(task.get("id") == null ? "task-" + record.getOrDefault("index", i) : task.get("id"));
    }
    weakness.put("taskIds", taskIds);
    List<Object> recommendations = new ArrayList<>();
    for (Object recommendation : coerceList(mined.get("configRecommendations"))) {
      recommendations.add(String.valueOf(recommendation));
    }
    weakness.put("configRecommendations", recommendations);
    return weakness;
  }

  @SuppressWarnings("unchecked")
  private static void progress(Map<String, Object> options, String phase, String message, int used) {
    Object callback = options.get("onProgress");
    if (callback instanceof Consumer<?> raw) {
      ((Consumer<Map<String, Object>>) raw).accept(Map.of("phase", phase, "message", message, "metricCallsUsed", used));
    }
    if (Boolean.TRUE.equals(options.get("verbose"))) {
      System.out.println("[playbook.evolve] " + phase + ": " + message);
    }
  }

  /** Agent-layer verified playbook learning from train/validation task sets. */
  @SuppressWarnings("unchecked")
  public Map<String, Object> evolve(Object dataset, Map<String, Object> options) {
    if (this.agent == null) throw new IllegalStateException("AxAgent.playbook().evolve() requires an agent-bound playbook");
    Map<String, Object> opts = options == null ? Map.of() : options;
    Map<String, Object> normalized = Core.asMap(Core._normalize_optimization_dataset(dataset == null ? List.of() : dataset));
    List<Object> train = new ArrayList<>(Core.asList(normalized.getOrDefault("train", List.of())));
    List<Object> validation = new ArrayList<>(Core.asList(normalized.getOrDefault("validation", List.of())));
    if (train.isEmpty()) throw new IllegalArgumentException("AxAgent.playbook().evolve(): at least one training task is required.");
    AiClient client = opts.get("studentAI") instanceof AiClient ai ? ai : this.studentAI;
    AiClient teacher = opts.get("teacherAI") instanceof AiClient ai ? ai : this.teacherAI;
    double threshold = ((Number) opts.getOrDefault("scoreThreshold", opts.getOrDefault("score_threshold", 0.7))).doubleValue();
    double minGain = ((Number) opts.getOrDefault("minHeldInGain", opts.getOrDefault("min_held_in_gain", 0.05))).doubleValue();
    double epsilon = ((Number) opts.getOrDefault("epsilon", 0.01)).doubleValue();
    int maxProposals = Math.max(1, ((Number) opts.getOrDefault("maxProposals", opts.getOrDefault("max_proposals", 4))).intValue());
    boolean verify = !Boolean.FALSE.equals(opts.getOrDefault("verify", Boolean.TRUE));
    int runsPerTask = Math.max(1, ((Number) opts.getOrDefault("runsPerTask", opts.getOrDefault("runs_per_task", 1))).intValue());
    int datasetSize = (train.size() + validation.size()) * runsPerTask;
    int maxMetricCalls = Math.max(1, ((Number) opts.getOrDefault("maxMetricCalls", opts.getOrDefault("max_metric_calls", Math.max(100, (maxProposals + 1) * datasetSize)))).intValue());
    int[] remaining = new int[] { maxMetricCalls };
    progress(opts, "baseline", "evaluating " + train.size() + " train tasks", maxMetricCalls - remaining[0]);
    Map<String, Object> baselineBatch = runAgentBatch(client, train, opts, runsPerTask, remaining, threshold);
    double heldIn = ((Number) baselineBatch.get("mean")).doubleValue();
    if (!validation.isEmpty()) progress(opts, "baseline", "evaluating " + validation.size() + " validation tasks", maxMetricCalls - remaining[0]);
    double heldOut = validation.isEmpty() ? Double.NaN : ((Number) runAgentBatch(client, validation, opts, runsPerTask, remaining, threshold).get("mean")).doubleValue();
    double baselineHeldOut = heldOut;
    Map<String, List<Map<String, Object>>> clusters = new LinkedHashMap<>();
    for (Object raw : Core.asList(baselineBatch.get("records"))) {
      Map<String, Object> record = Core.asMap(raw);
      Map<String, Object> prediction = Core.asMap(record.get("prediction"));
      double score = ((Number) record.get("score")).doubleValue();
      if (record.get("error") == null && score >= threshold && !"askClarification".equals(prediction.get("completionType"))) continue;
      String signature = recordSignature(record);
      clusters.computeIfAbsent(signature, ignored -> new ArrayList<>()).add(record);
    }
    List<Map.Entry<String, List<Map<String, Object>>>> ranked = new ArrayList<>(clusters.entrySet());
    ranked.sort((left, right) -> Double.compare(clusterSeverity(right.getValue()), clusterSeverity(left.getValue())));
    if (ranked.size() > maxProposals) ranked = new ArrayList<>(ranked.subList(0, maxProposals));
    progress(opts, "mining", ranked.size() + " failure cluster(s) from " + Core.asList(baselineBatch.get("records")).size() + " records", maxMetricCalls - remaining[0]);
    List<Object> outcomes = new ArrayList<>();
    List<Object> weaknesses = new ArrayList<>();
    Map<String, Object> initial = deepCopy(getState());
    int index = 0;
    for (Map.Entry<String, List<Map<String, Object>>> cluster : ranked) {
      index++;
      String signature = cluster.getKey();
      Map<String, Object> weakness;
      try {
        weakness = mineWeakness(signature, cluster.getValue(), index - 1, teacher);
      } catch (RuntimeException error) {
        progress(opts, "mining", "cluster [" + signature + "] miner failed: " + error.getMessage(), maxMetricCalls - remaining[0]);
        continue;
      }
      if (weakness == null) {
        progress(opts, "mining", "cluster [" + signature + "] discarded (no grounded evidence)", maxMetricCalls - remaining[0]);
        continue;
      }
      weaknesses.add(weakness);
      Map<String, Object> proposal = new LinkedHashMap<>();
      proposal.put("weaknessId", weakness.get("id"));
      proposal.put("clusterSignature", signature);
      int requiredCalls = (train.size() + validation.size()) * runsPerTask;
      if (verify && remaining[0] < requiredCalls) {
        proposal.put("feedback", "");
        outcomes.add(new LinkedHashMap<>(Map.of(
            "proposal", proposal,
            "accepted", false,
            "reason", "metric_budget exhausted before validation",
            "heldIn", Map.of("before", heldIn, "after", heldIn))));
        continue;
      }
      Map<String, Object> before = deepCopy(getState());
      List<Object> evidence = Core.asList(weakness.get("evidenceQuotes"));
      StringBuilder quoteLines = new StringBuilder();
      for (int quoteIndex = 0; quoteIndex < Math.min(3, evidence.size()); quoteIndex++) {
        if (quoteIndex > 0) quoteLines.append('\n');
        quoteLines.append("- ").append(evidence.get(quoteIndex));
      }
      String feedback = "A recurring agent weakness was diagnosed from real failed runs.\n\n"
          + "Weakness: " + weakness.get("description") + "\n"
          + "Root cause: " + weakness.get("rootCause") + "\n"
          + "Error signature: [" + signature + "]\nGrounding excerpts:\n" + quoteLines
          + "\n\nCurate ONE durable rule into the playbook (suggested section: \"failures_to_avoid\"): "
          + weakness.get("proposedGuidance")
          + "\nUPDATE an existing bullet if one already covers this failure mode.";
      proposal.put("feedback", feedback);
      progress(opts, "proposal", weakness.get("id") + ": applying playbook proposal", maxMetricCalls - remaining[0]);
      try {
        update(new LinkedHashMap<>(Map.of("example", Map.of("task", "playbook.evolve(): repair a diagnosed agent weakness", "failureSignatures", List.of(signature)), "prediction", Map.of(), "feedback", feedback)));
      } catch (RuntimeException error) {
        outcomes.add(new LinkedHashMap<>(Map.of(
            "proposal", proposal,
            "accepted", false,
            "reason", "apply failed: " + error.getMessage(),
            "heldIn", Map.of("before", heldIn, "after", heldIn))));
        continue;
      }
      boolean accepted = true;
      double nextIn = heldIn;
      double nextOut = heldOut;
      boolean reevalComplete = true;
      if (verify) {
        Map<String, Object> trainBatch = runAgentBatch(client, train, opts, runsPerTask, remaining, threshold);
        nextIn = ((Number) trainBatch.get("mean")).doubleValue();
        Map<String, Object> validationBatch = validation.isEmpty() ? Map.of("mean", Double.NaN, "exhausted", false) : runAgentBatch(client, validation, opts, runsPerTask, remaining, threshold);
        nextOut = ((Number) validationBatch.get("mean")).doubleValue();
        reevalComplete = !Boolean.TRUE.equals(trainBatch.get("exhausted")) && !Boolean.TRUE.equals(validationBatch.get("exhausted"));
        accepted = reevalComplete && nextIn - heldIn >= minGain && (Double.isNaN(nextOut) || Double.isNaN(heldOut) || nextOut - heldOut >= -epsilon);
      }
      Map<String, Object> outcome = new LinkedHashMap<>();
      outcome.put("proposal", proposal);
      outcome.put("accepted", accepted);
      outcome.put("reason", !reevalComplete ? "metric_budget exhausted during re-evaluation" : !verify ? "applied without verification (verify: false)" : accepted ? (Double.isNaN(heldOut) ? "held-in improved (no held-out set provided — consider one)" : "held-in improved, held-out non-regressing") : nextIn - heldIn < minGain ? String.format("held-in gain %.3f below %s", nextIn - heldIn, minGain) : String.format("held-out regressed %.3f", nextOut - heldOut));
      outcome.put("heldIn", Map.of("before", heldIn, "after", nextIn));
      if (!Double.isNaN(nextOut) && !Double.isNaN(heldOut)) outcome.put("heldOut", Map.of("before", heldOut, "after", nextOut));
      outcomes.add(outcome);
      if (accepted) {
        heldIn = nextIn;
        heldOut = nextOut;
        progress(opts, "validation", weakness.get("id") + ": ACCEPTED", maxMetricCalls - remaining[0]);
      } else {
        load(before);
        progress(opts, "validation", weakness.get("id") + ": rejected, rolled back", maxMetricCalls - remaining[0]);
      }
    }
    Map<String, Object> learned = outcomes.stream().anyMatch(raw -> Boolean.TRUE.equals(Core.get(raw, "accepted", false))) ? deepCopy(getState()) : null;
    if (Boolean.FALSE.equals(opts.get("apply")) && learned != null) load(initial);
    Map<String, Object> result = new LinkedHashMap<>();
    Map<String, Object> baselineResult = new LinkedHashMap<>(Map.of("heldIn", ((Number) baselineBatch.get("mean")).doubleValue()));
    Map<String, Object> finalResult = new LinkedHashMap<>(Map.of("heldIn", heldIn));
    if (!Double.isNaN(baselineHeldOut)) baselineResult.put("heldOut", baselineHeldOut);
    if (!Double.isNaN(heldOut)) finalResult.put("heldOut", heldOut);
    result.put("baseline", baselineResult);
    result.put("final", finalResult);
    result.put("weaknesses", weaknesses);
    result.put("outcomes", outcomes);
    List<Object> recommendations = new ArrayList<>();
    for (Object raw : weaknesses) recommendations.addAll(Core.asList(Core.get(raw, "configRecommendations", List.of())));
    result.put("recommendations", recommendations);
    result.put("metricCallsUsed", maxMetricCalls - remaining[0]);
    result.put("records", baselineBatch.get("records"));
    if (learned != null) result.put("playbookSnapshot", learned);
    progress(opts, "done", outcomes.stream().filter(raw -> Boolean.TRUE.equals(Core.get(raw, "accepted", false))).count() + "/" + outcomes.size() + " proposals accepted; held-in " + String.format("%.3f", ((Number) baselineBatch.get("mean")).doubleValue()) + " -> " + String.format("%.3f", heldIn), maxMetricCalls - remaining[0]);
    return result;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> runAgentBatch(AiClient client, List<Object> tasks, Map<String, Object> options, int runsPerTask, int[] remaining, double scoreThreshold) {
    List<Object> records = new ArrayList<>();
    double weightedSum = 0;
    double weightSum = 0;
    boolean exhausted = false;
    Object metric = options.get("metric");
    for (int taskIndex = 0; taskIndex < tasks.size(); taskIndex++) {
      Object rawTask = tasks.get(taskIndex);
      Map<String, Object> task = rawTask instanceof Map<?, ?> ? Core.asMap(rawTask) : new LinkedHashMap<>(Map.of("input", rawTask));
      Map<String, Object> prediction = null;
      String lastError = null;
      double scoreSum = 0;
      int completedRuns = 0;
      for (int run = 0; run < runsPerTask; run++) {
        if (remaining[0] <= 0) { exhausted = true; break; }
        remaining[0]--;
        double score;
        try {
          prediction = agent.evaluateOptimizationTask(client, task, options);
          Object rawScore;
          if (metric instanceof Function<?, ?> rawFunction) {
            Map<String, Object> metricArgs = new LinkedHashMap<>();
            metricArgs.put("example", task);
            metricArgs.put("task", task);
            metricArgs.put("prediction", prediction);
            rawScore = ((Function<Map<String, Object>, Object>) rawFunction).apply(metricArgs);
          } else {
            rawScore = task.containsKey("metric_score") ? task.get("metric_score") : task.containsKey("scores") ? task.get("scores") : task.getOrDefault("score", "error".equals(prediction.get("completionType")) ? 0 : 1);
          }
          score = ((Number) Core._scalarize_optimization_scores(Core._normalize_optimization_metric_scores(rawScore), options)).doubleValue();
          if (!Double.isFinite(score)) score = 0;
        } catch (RuntimeException error) {
          score = 0;
          lastError = error.getMessage();
        }
        scoreSum += score;
        completedRuns++;
      }
      if (completedRuns == 0) break;
      double score = scoreSum / completedRuns;
      double weight = ((Number) task.getOrDefault("weight", 1)).doubleValue();
      weightSum += weight;
      weightedSum += weight * score;
      Map<String, Object> record = new LinkedHashMap<>();
      record.put("task", task);
      record.put("index", taskIndex);
      if (prediction != null) record.put("prediction", prediction);
      else if (lastError != null) record.put("error", lastError);
      record.put("score", score);
      record.put("passed", score >= scoreThreshold && prediction != null && "final".equals(prediction.get("completionType")));
      records.add(record);
      if (completedRuns < runsPerTask) break;
    }
    if (records.size() < tasks.size()) exhausted = true;
    return new LinkedHashMap<>(Map.of("records", records, "mean", weightSum == 0 ? 0.0 : weightedSum / weightSum, "exhausted", exhausted));
  }

  private static double clusterSeverity(List<Map<String, Object>> records) {
    return records.stream().mapToDouble(record -> 1.0 - ((Number) record.get("score")).doubleValue()).sum();
  }

  private static String firstFailureDetail(List<Map<String, Object>> records) {
    for (Map<String, Object> record : records) {
      for (Object raw : Core.asList(Core.get(record.get("prediction"), "failureSignals", List.of()))) {
        String detail = String.valueOf(Core.get(raw, "detail", ""));
        if (!detail.isBlank()) return detail;
      }
    }
    if (!records.isEmpty()) {
      Object prediction = records.get(0).get("prediction");
      List<Object> toolErrors = Core.asList(Core.get(prediction, "toolErrors", List.of()));
      if (!toolErrors.isEmpty()) return String.valueOf(toolErrors.get(0));
      String actionLog = String.valueOf(Core.get(prediction, "actionLog", ""));
      if (!actionLog.isBlank()) return actionLog.length() > 2000 ? actionLog.substring(actionLog.length() - 2000) : actionLog;
      return String.valueOf(Core.jsonStringify(Core.get(records.get(0), "task", Map.of())));
    }
    return "behavioral:no_error";
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> deepCopy(Map<String, Object> value) {
    return Core.asMap(Core.jsonParse(Core.jsonStringify(value)));
  }

  /**
   * Grow the playbook offline from labeled examples, scoring each rollout with
   * {@code metricFn} ({@code {"prediction", "example"}}), then render the result
   * into the bound program.
   */
  public Map<String, Object> evolve(List<Object> examples, Function<Map<String, Object>, Object> metricFn, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Object auto = opts.get("auto");
    if (auto != null) {
      this.engine.configureAuto(String.valueOf(auto));
    }
    Map<String, Object> aceOptions = new LinkedHashMap<>();
    putIfPresent(aceOptions, "maxEpochs", option(opts, "maxEpochs", "max_epochs"));
    Function<Map<String, Object>, Object> wrappedMetric = example -> {
      if (metricFn == null) {
        return 0;
      }
      Map<String, Object> args = new LinkedHashMap<>();
      args.put("prediction", this.lastPrediction);
      args.put("example", example);
      return metricFn.apply(args);
    };
    Map<String, Object> result = this.engine.compile(this.program, examples == null ? List.of() : examples, wrappedMetric, Map.of("aceOptions", aceOptions));
    this.started = true;
    inject();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("bestScore", result.get("bestScore"));
    out.put("playbook", result.get("playbook"));
    return out;
  }

  /**
   * Refine the playbook online from a single live interaction. Safe to call
   * without a prior {@link #evolve}/{@link #load}; the bound program is hydrated
   * lazily on first use.
   */
  public Map<String, Object> update(Map<String, Object> args) {
    if (!this.started) {
      Map<String, Object> state = new LinkedHashMap<>();
      state.put("baseInstruction", this.baseInstruction);
      state.put("playbook", this.engine.getPlaybook());
      this.engine.hydrate(this.program, state);
      this.started = true;
    }
    Map<String, Object> result = this.engine.applyOnlineUpdate(args == null ? Map.of() : args);
    inject();
    return result;
  }

  /** Render the current playbook into a program context (defaults to the bound program). */
  public void applyTo(AxGen target) {
    if (target != null && target != this.program) {
      target.setInstruction(composeInstruction(target.getInstruction(), render()));
      return;
    }
    inject();
  }

  /** The current playbook rendered as a markdown block. */
  public String render() {
    return String.valueOf(Core._ace_render_playbook(this.engine.getPlaybook()));
  }

  /** A serializable snapshot of the current playbook and its history. */
  public Map<String, Object> getState() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("playbook", this.engine.getPlaybook());
    out.put("artifact", this.engine.getArtifact());
    return out;
  }

  /** Alias of {@link #getState}. */
  public Map<String, Object> toJson() {
    return getState();
  }

  /** Restore a snapshot into this handle and render it into the bound program. */
  public AxPlaybook load(Map<String, Object> snapshot) {
    Map<String, Object> snap = snapshot == null ? Map.of() : snapshot;
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("baseInstruction", this.baseInstruction);
    state.put("playbook", snap.get("playbook"));
    state.put("artifact", snap.get("artifact"));
    this.engine.hydrate(this.program, state);
    this.started = true;
    inject();
    return this;
  }

  /** Set the evolution intensity preset. */
  public void configureAuto(String level) {
    this.engine.configureAuto(level);
  }

  /** Clear the playbook back to its initial state. */
  public void reset() {
    this.engine.reset();
    this.started = false;
  }

  /** @hidden Used by {@code AxAgent.playbook()} to redirect injection into a stage. */
  public void setApplyHook(java.util.function.Consumer<String> hook) {
    this.applyHook = hook;
  }

  private void inject() {
    String rendered = render();
    if (this.applyHook != null) {
      this.applyHook.accept(rendered);
      return;
    }
    if (this.program != null) {
      String base = this.baseInstruction == null ? this.program.getInstruction() : this.baseInstruction;
      this.program.setInstruction(composeInstruction(base, rendered));
    }
  }

  static String composeInstruction(String base, String rendered) {
    List<String> parts = new ArrayList<>();
    if (base != null && !base.trim().isEmpty()) {
      parts.add(base.trim());
    }
    if (rendered != null && !rendered.trim().isEmpty()) {
      parts.add(rendered.trim());
    }
    return String.join("\n\n", parts);
  }

  private static String stringify(Object value) {
    if (value == null) {
      return "";
    }
    if (value instanceof String s) {
      return s;
    }
    return Json.stringify(value);
  }

  private static void putIfPresent(Map<String, Object> target, String key, Object value) {
    if (value != null) {
      target.put(key, value);
    }
  }

  static Object option(Map<String, Object> options, String... keys) {
    for (String key : keys) {
      if (options.containsKey(key) && options.get(key) != null) {
        return options.get(key);
      }
    }
    return null;
  }

  /** Create an evolving context {@link AxPlaybook} for a program. */
  public static AxPlaybook playbook(AxGen program, Map<String, Object> options) {
    return new AxPlaybook(program, options);
  }
}
