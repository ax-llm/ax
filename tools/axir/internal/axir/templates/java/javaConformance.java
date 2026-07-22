package dev.axllm.ax;

import java.nio.file.Files;
import java.nio.file.Path;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Conformance {
  static final class FixtureError extends AssertionError {
    FixtureError(String message) { super(message); }
  }

  static final class ConformanceScriptedAI extends AxBaseAI {
    final List<Object> responses;
    final List<Object> streamEvents;
    final List<Object> transcribeResponses = new ArrayList<>();
    final List<Map<String, Object>> requests = new ArrayList<>();
    int chatCalls;

    ConformanceScriptedAI(List<Object> responses, List<Object> streamEvents) {
      super("scripted", "scripted-chat", "scripted-embed", Map.of(), Map.of());
      this.responses = new ArrayList<>(responses);
      this.streamEvents = new ArrayList<>(streamEvents);
    }

    protected Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) {
      chatCalls++;
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("scripted client exhausted");
      return Core.legacyResponseToChatResponse(Core.asMap(responses.remove(0)));
    }

    protected Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) {
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("scripted client exhausted");
      return Core.asMap(responses.remove(0));
    }

    public Iterable<Map<String, Object>> stream(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      List<Map<String, Object>> out = new ArrayList<>();
      for (Object event : streamEvents) out.add(Core.asMap(event));
      return out;
    }

    public Map<String, Object> transcribe(Map<String, Object> request) {
      return transcribe(request, Map.of());
    }

    @Override
    public Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) {
      requests.add(new LinkedHashMap<>(request));
      if (!transcribeResponses.isEmpty()) {
        @SuppressWarnings("unchecked")
        Map<String, Object> next = (Map<String, Object>) transcribeResponses.remove(0);
        return next;
      }
      return Map.of("text", "scripted transcript");
    }

    public Map<String, Object> speak(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      return Map.of("audio", "pcm");
    }
  }

  static final class ScriptedTransport implements OpenAICompatibleClient.Transport {
    final List<Object> responses;
    final List<Map<String, Object>> requests = new ArrayList<>();
    ScriptedTransport(List<Object> responses) { this.responses = new ArrayList<>(responses); }
    public Object call(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("scripted transport exhausted");
      return responses.remove(0);
    }
  }

  static RuntimeException fixtureAIServiceError(Map<String, Object> spec) {
    String type = String.valueOf(spec.getOrDefault("type", "network"));
    String message = String.valueOf(spec.getOrDefault("message", "fixture error"));
    return switch (type) {
      case "status" -> new AxAIServiceStatusError(message, Core.asInt(spec.getOrDefault("status", 500)), null, null, null, true);
      case "authentication" -> new AxAIServiceAuthenticationError("Authentication failed", Core.asInt(spec.getOrDefault("status", 401)), null, null, null);
      case "response" -> new AxAIServiceResponseError(message);
      case "timeout" -> new AxAIServiceTimeoutError(message, null, null, null, null, true);
      case "plain" -> new RuntimeException(message);
      default -> new AxAIServiceNetworkError("Network Error: " + message);
    };
  }

  static final class RouterFixtureService extends AxBaseAI {
    final String fixtureId;
    final List<Map<String, Object>> modelList;
    final List<Map<String, Object>> requests = new ArrayList<>();
    final List<Object> responses;
    final Map<String, Object> features;
    final Map<String, Object> metrics;
    final double estimatedCost;

    RouterFixtureService(Map<String, Object> spec) {
      super(String.valueOf(spec.getOrDefault("name", "fixture")), String.valueOf(spec.getOrDefault("model", "fixture-chat")), String.valueOf(spec.getOrDefault("embedModel", spec.getOrDefault("embed_model", "fixture-embed"))), Map.of(), Map.of());
      fixtureId = String.valueOf(spec.getOrDefault("id", name + "-id"));
      modelList = spec.containsKey("modelList") ? Core.asMapList(spec.get("modelList")) : null;
      responses = new ArrayList<>(Core.asList(spec.getOrDefault("responses", List.of())));
      features = new LinkedHashMap<>(Core.asMap(spec.getOrDefault("features", Core.defaultRouterFeatures())));
      metrics = new LinkedHashMap<>(Core.asMap(spec.getOrDefault("metrics", Map.of("service", name, "calls", 0))));
      estimatedCost = Core.asDouble(spec.getOrDefault("estimatedCost", spec.getOrDefault("estimated_cost", 0)));
    }

    public String getId() { return fixtureId; }
    public Map<String, Object> getFeatures(String model) { return new LinkedHashMap<>(features); }
    public List<Map<String, Object>> getModelList() { return modelList == null ? null : new ArrayList<>(modelList); }
    public Map<String, Object> getMetrics() { Map<String, Object> out = new LinkedHashMap<>(metrics); if (out.containsKey("calls")) out.put("calls", requests.size()); return out; }
    public double getEstimatedCost(Map<String, Object> modelUsage) { return estimatedCost; }

    protected Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) {
      requests.add(Map.of("method", "chat", "opt", new LinkedHashMap<>(options)));
      if (!responses.isEmpty()) {
        Object next = responses.remove(0);
        if (next instanceof Map<?, ?> raw) {
          Map<String, Object> map = Core.asMap(raw);
          if (map.containsKey("error")) throw fixtureAIServiceError(Core.asMap(map.get("error")));
          return Core.asMap(map.getOrDefault("response", map));
        }
        return Core.asMap(next);
      }
      return Map.of("results", List.of(Map.of("index", 0, "content", name + " chat")));
    }

    protected Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) {
      requests.add(Map.of("method", "embed", "opt", new LinkedHashMap<>(options)));
      return Map.of("embeddings", List.of(List.of(1, 2)), "modelUsage", Map.of("ai", name));
    }

    public Map<String, Object> transcribe(Map<String, Object> request) {
      return transcribe(request, Map.of());
    }

    public Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) {
      requests.add(Map.of("method", "transcribe", "opt", new LinkedHashMap<>(options)));
      return Map.of("text", name + " transcript");
    }

    public Map<String, Object> speak(Map<String, Object> request) {
      return speak(request, Map.of());
    }

    public Map<String, Object> speak(Map<String, Object> request, Map<String, Object> options) {
      requests.add(Map.of("method", "speak", "opt", new LinkedHashMap<>(options)));
      return Map.of("audio", "pcm");
    }
  }

  static final class ScriptedOptimizerEngine implements OptimizerEngine {
    final Map<String, Object> response;
    final List<Map<String, Object>> requests = new ArrayList<>();
    final List<Map<String, Object>> evaluations = new ArrayList<>();
    final List<Map<String, Object>> transcripts = new ArrayList<>();

    ScriptedOptimizerEngine(Object response) {
      this.response = new LinkedHashMap<>(Core.asMap(response));
    }

    public String name() { return "scripted"; }
    public String version() { return "1"; }

    public Map<String, Object> optimize(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      return new LinkedHashMap<>(response);
    }

    public Map<String, Object> optimize(Map<String, Object> request, OptimizerEvaluator evaluator) {
      requests.add(new LinkedHashMap<>(request));
      if (evaluator != null && response.containsKey("evaluate")) {
        for (Object raw : Core.asList(response.get("evaluate"))) {
          Map<String, Object> step = Core.asMap(raw);
          Map<String, Object> candidate = Core.asMap(step.getOrDefault("component_map", step.getOrDefault("componentMap", Map.of())));
          Map<String, Object> evalOptions = Core.asMap(step.getOrDefault("options", Map.of()));
          Map<String, Object> result = evaluator.evaluate(
            candidate,
            evalOptions
          );
          Map<String, Object> evidence = Core.asMap(Core._build_optimizer_evidence_batch(result, Core.asList(request.getOrDefault("components", List.of()))));
          evaluations.add(result);
          transcripts.add(new LinkedHashMap<>(Map.of("candidateMap", candidate, "options", evalOptions, "result", result, "evidence", evidence)));
        }
      }
      if (evaluator != null && response.containsKey("referenceCandidates")) {
        Map<String, Object> bestMap = new LinkedHashMap<>();
        Double bestScore = null;
        for (Object raw : Core.asList(response.get("referenceCandidates"))) {
          Map<String, Object> step = Core.asMap(raw);
          Map<String, Object> candidate = Core.asMap(step.getOrDefault("component_map", step.getOrDefault("componentMap", Map.of())));
          Map<String, Object> evalOptions = Core.asMap(step.getOrDefault("options", Map.of()));
          Map<String, Object> result = evaluator.evaluate(candidate, evalOptions);
          Map<String, Object> evidence = Core.asMap(Core._build_optimizer_evidence_batch(result, Core.asList(request.getOrDefault("components", List.of()))));
          evaluations.add(result);
          transcripts.add(new LinkedHashMap<>(Map.of("candidateMap", candidate, "options", evalOptions, "result", result, "evidence", evidence)));
          double score = Core.asDouble(result.getOrDefault("avg", 0));
          if (bestScore == null || score > bestScore) {
            bestScore = score;
            bestMap = new LinkedHashMap<>(candidate);
          }
        }
        return new LinkedHashMap<>(Map.of("componentMap", bestMap, "metadata", Map.of("referenceEngine", true, "evaluations", transcripts)));
      }
      return new LinkedHashMap<>(response);
    }
  }

  static final class ScriptedGEPAEvaluator implements OptimizerEvaluator {
    final Map<String, Object> fixture;
    final List<Map<String, Object>> evaluations = new ArrayList<>();

    ScriptedGEPAEvaluator(Map<String, Object> fixture) {
      this.fixture = fixture;
    }

    private String componentId(Map<String, Object> candidateMap) {
      Object explicit = fixture.get("score_component_id");
      if (explicit != null) return String.valueOf(explicit);
      if (candidateMap != null && !candidateMap.isEmpty()) return String.valueOf(candidateMap.keySet().iterator().next());
      return "component";
    }

    public Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options) {
      Map<String, Object> opts = new LinkedHashMap<>(options == null ? Map.of() : options);
      Object datasetInput = opts.containsKey("dataset") ? opts.get("dataset") : fixture.getOrDefault("dataset", List.of());
      Map<String, Object> normalized = Core.asMap(Core._normalize_optimization_dataset(datasetInput));
      List<Object> examples = Core.asList(normalized.getOrDefault("train", List.of()));
      if (examples.isEmpty()) examples = List.of(Map.of("input", Map.of("fixture", "gepa")));
      Map<String, Object> candidate = candidateMap == null ? Map.of() : candidateMap;
      String id = componentId(candidate);
      Object value = candidate.get(id);
      if (value == null) value = fixture.getOrDefault("base_component_value", "");
      boolean hasScoreMap = fixture.containsKey("gepa_scores");
      Map<String, Object> scoreMap = Core.asMap(fixture.getOrDefault("gepa_scores", Map.of()));
      Object rawScore = scoreMap.containsKey(String.valueOf(value)) ? scoreMap.get(String.valueOf(value)) : scoreMap.getOrDefault("*", 0);
      List<Object> scoreList = rawScore instanceof List<?> ? Core.asList(rawScore) : List.of();
      List<Object> rows = new ArrayList<>();
      for (int i = 0; i < examples.size(); i++) {
        Map<String, Object> task = Core.asMap(examples.get(i));
        Object itemScore = hasScoreMap
          ? (scoreList.isEmpty() ? rawScore : scoreList.get(Math.min(i, scoreList.size() - 1)))
          : (task.containsKey("metric_score") ? task.get("metric_score") : task.containsKey("scores") ? task.get("scores") : task.getOrDefault("score", 0));
        Map<String, Object> scores = Core.asMap(Core._normalize_optimization_metric_scores(itemScore));
        Object scalar = Core._scalarize_optimization_scores(scores, Core.asMap(fixture.getOrDefault("score_options", Map.of())));
        Map<String, Object> prediction = new LinkedHashMap<>();
        prediction.put("completionType", "final");
        prediction.put("output", Map.of("componentValue", String.valueOf(value)));
        prediction.put("finalOutput", Map.of("componentValue", String.valueOf(value)));
        prediction.put("functionCalls", List.of());
        prediction.put("actionLog", List.of());
        prediction.put("usage", Map.of());
        Map<String, Object> trace = new LinkedHashMap<>(Map.of("componentValue", String.valueOf(value)));
        prediction.put("trace", trace);
        rows.add(Core._build_optimization_eval_row(task, prediction, scores, scalar, trace, null));
      }
      Map<String, Object> result = Core.asMap(Core._build_optimization_eval_result(rows, candidate, opts.getOrDefault("phase", "gepa")));
      evaluations.add(result);
      return result;
    }
  }

  static final class ScriptedCodeRuntime implements AxCodeRuntime {
    final List<Object> script;
    final List<ScriptedCodeSession> sessions = new ArrayList<>();
    final List<String> executed = new ArrayList<>();
    final List<Map<String, Object>> createRequests = new ArrayList<>();
    final List<Map<String, Object>> executeOptions = new ArrayList<>();
    final String language;
    final String usageInstructions;
    final Map<String, Object> capabilities;

    ScriptedCodeRuntime(List<Object> script) {
      this(script, "JavaScript", "", Map.of());
    }

    ScriptedCodeRuntime(List<Object> script, String language, String usageInstructions) {
      this(script, language, usageInstructions, Map.of());
    }

    ScriptedCodeRuntime(List<Object> script, String language, String usageInstructions, Map<String, Object> capabilities) {
      this.script = new ArrayList<>(script == null ? List.of() : script);
      this.language = language == null || language.isBlank() ? "JavaScript" : language;
      this.usageInstructions = usageInstructions == null ? "" : usageInstructions;
      this.capabilities = new LinkedHashMap<>(Map.of("inspect", true, "snapshot", true, "patch", true));
      if (capabilities != null) this.capabilities.putAll(capabilities);
    }

    public String language() { return language; }
    public String getUsageInstructions() { return usageInstructions; }

    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      createRequests.add(new LinkedHashMap<>(Map.of(
        "globals", new LinkedHashMap<>(globals == null ? Map.of() : globals),
        "options", new LinkedHashMap<>(options == null ? Map.of() : options)
      )));
      ScriptedCodeSession session = new ScriptedCodeSession(this, globals, options);
      sessions.add(session);
      return session;
    }
  }

  static final class ScriptedCodeSession implements AxCodeSession {
    final ScriptedCodeRuntime runtime;
    Map<String, Object> globals;
    Map<String, Object> createOptions;
    boolean closed;

    ScriptedCodeSession(ScriptedCodeRuntime runtime, Map<String, Object> globals, Map<String, Object> options) {
      this.runtime = runtime;
      this.globals = new LinkedHashMap<>(globals == null ? Map.of() : globals);
      this.createOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    }

    public Object execute(String code, Map<String, Object> options) {
      if (closed) return new LinkedHashMap<>(Map.of("is_error", true, "error_category", "session_closed", "error", "session closed"));
      if (runtime.script.isEmpty()) throw new RuntimeException("scripted runtime exhausted");
      Map<String, Object> step = Core.asMap(runtime.script.remove(0));
      Object expected = step.get("expected_code");
      if (expected != null && !String.valueOf(expected).equals(code)) throw new RuntimeException("expected code " + expected + ", got " + code);
      if (step.containsKey("expected_options_subset")) assertSubset(options == null ? Map.of() : options, step.get("expected_options_subset"), "runtime execute options");
      runtime.executed.add(code);
      runtime.executeOptions.add(new LinkedHashMap<>(options == null ? Map.of() : options));
      globals.putAll(Core.asMap(step.get("bindings_patch")));
      if (Boolean.TRUE.equals(step.get("close_before_result"))) closed = true;
      return step.getOrDefault("result", new LinkedHashMap<>(Map.of("kind", "result", "result", new LinkedHashMap<>(globals))));
    }

    public Object inspectGlobals(Map<String, Object> options) {
      if (Boolean.FALSE.equals(runtime.capabilities.get("inspect"))) {
        return "[runtime state inspection unavailable: runtime session does not implement inspectGlobals()]";
      }
      return new LinkedHashMap<>(globals);
    }

    public Object snapshotGlobals(Map<String, Object> options) {
      if (Boolean.FALSE.equals(runtime.capabilities.get("snapshot"))) {
        throw new RuntimeException("AxCodeSession.snapshotGlobals() is required to export AxAgent state");
      }
      List<Object> entries = new ArrayList<>();
      for (Map.Entry<String, Object> entry : globals.entrySet()) {
        entries.add(new LinkedHashMap<>(Map.of(
          "name", entry.getKey(),
          "type", entry.getValue() == null ? "null" : entry.getValue().getClass().getSimpleName(),
          "preview", String.valueOf(entry.getValue())
        )));
      }
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("version", 1);
      out.put("entries", entries);
      out.put("bindings", new LinkedHashMap<>(globals));
      out.put("globals", new LinkedHashMap<>(globals));
      out.put("closed", closed);
      return out;
    }

    public Object patchGlobals(Object snapshot, Map<String, Object> options) {
      if (Boolean.FALSE.equals(runtime.capabilities.get("patch"))) {
        throw new RuntimeException("AxCodeSession.patchGlobals() is required to restore AxAgent state");
      }
      Map<String, Object> snap = Core.asMap(snapshot);
      Object raw = snap.containsKey("bindings") ? snap.get("bindings") : snap.get("globals");
      globals = new LinkedHashMap<>(Core.asMap(raw));
      closed = Boolean.TRUE.equals(snap.get("closed"));
      return snapshotGlobals(options);
    }

    public Object exportState(Map<String, Object> options) {
      return snapshotGlobals(options);
    }

    public Object restoreState(Object snapshot, Map<String, Object> options) {
      return patchGlobals(snapshot, options);
    }

    public Object close() {
      closed = true;
      return new LinkedHashMap<>(Map.of("closed", true));
    }
  }

  static Map<String, Object> protocolOk(Object id, Object result) {
    return protocolOk(id, result, null);
  }

  static Map<String, Object> protocolOk(Object id, Object result, Object sessionId) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", id);
    out.put("ok", true);
    out.put("result", result == null ? Map.of() : result);
    if (sessionId != null) out.put("session_id", sessionId);
    return out;
  }

  static Map<String, Object> protocolFail(Object id, String category, String message) {
    return new LinkedHashMap<>(Map.of(
      "id", id,
      "ok", false,
      "error", new LinkedHashMap<>(Map.of("category", category, "message", message))
    ));
  }

  static Map<String, Object> protocolSnapshot(Map<String, Object> session) {
    Map<String, Object> bindings = new LinkedHashMap<>(Core.asMap(session.getOrDefault("globals", Map.of())));
    List<Object> entries = new ArrayList<>();
    for (Map.Entry<String, Object> entry : bindings.entrySet()) {
      entries.add(new LinkedHashMap<>(Map.of("name", entry.getKey(), "type", entry.getValue() == null ? "null" : entry.getValue().getClass().getSimpleName(), "preview", String.valueOf(entry.getValue()))));
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("version", 1);
    out.put("entries", entries);
    out.put("bindings", bindings);
    out.put("globals", new LinkedHashMap<>(bindings));
    out.put("closed", Boolean.TRUE.equals(session.get("closed")));
    return out;
  }

  static void runRuntimeProtocolFixtureServer() throws Exception {
    String mode = System.getenv().getOrDefault("AXIR_RUNTIME_PROTOCOL_FIXTURE_MODE", "normal");
    Map<String, Map<String, Object>> sessions = new LinkedHashMap<>();
    int nextSession = 0;
    BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8));
    for (String line; (line = reader.readLine()) != null;) {
      if ("eof".equals(mode)) return;
      if ("malformed_json".equals(mode)) {
        writer.write("{not-json");
        writer.newLine();
        writer.flush();
        return;
      }
      if ("nonzero".equals(mode)) {
        System.err.println("fixture stderr before nonzero exit");
        System.exit(7);
      }
      Map<String, Object> message = Core.asMap(Json.parse(line));
      Object id = "id_mismatch".equals(mode) ? "mismatch" : message.get("id");
      String op = String.valueOf(message.get("op"));
      Map<String, Object> response;
      if ("capabilities".equals(op)) {
        response = protocolOk(id, new LinkedHashMap<>(Map.of(
          "language", "JavaScript",
          "usage_instructions", "fixture protocol runtime",
          "inspect", !"unavailable".equals(mode),
          "snapshot", !"unavailable".equals(mode),
          "patch", !"unavailable".equals(mode),
          "abort", true
        )));
      } else if ("create_session".equals(op)) {
        String sessionId = "s" + (++nextSession);
        Map<String, Object> payload = Core.asMap(message.getOrDefault("payload", Map.of()));
        Map<String, Object> globals = new LinkedHashMap<>(Core.asMap(payload.getOrDefault("globals", Map.of())));
        globals.put("__create_options", new LinkedHashMap<>(Core.asMap(payload.getOrDefault("options", Map.of()))));
        sessions.put(sessionId, new LinkedHashMap<>(Map.of("globals", globals, "closed", false)));
        response = protocolOk(id, new LinkedHashMap<>(Map.of("session_id", sessionId)), sessionId);
      } else if ("execute".equals(op)) {
        String sessionId = String.valueOf(message.get("session_id"));
        Map<String, Object> session = sessions.get(sessionId);
        if (session == null || Boolean.TRUE.equals(session.get("closed"))) {
          response = protocolFail(message.get("id"), "session_closed", "session closed or unknown");
	        } else {
	          Map<String, Object> payload = Core.asMap(message.getOrDefault("payload", Map.of()));
	          String code = String.valueOf(payload.getOrDefault("code", ""));
	          Core.asMap(session.get("globals")).put("__last_execute_options", new LinkedHashMap<>(Core.asMap(payload.getOrDefault("options", Map.of()))));
	          if ("timeout()".equals(code)) response = protocolFail(message.get("id"), "timeout", "fixture timeout");
          else if ("sessionClosed()".equals(code)) response = protocolFail(message.get("id"), "session_closed", "fixture session closed");
          else if ("abort()".equals(code)) response = protocolFail(message.get("id"), "abort", "fixture abort");
          else if ("userError()".equals(code)) response = protocolFail(message.get("id"), "user_error", "fixture user error");
          else {
            Core.asMap(session.get("globals")).put("answer", "fixture");
            response = protocolOk(id, new LinkedHashMap<>(Map.of("type", "final", "args", List.of(new LinkedHashMap<>(Map.of("answer", "fixture"))))), sessionId);
          }
        }
        if ("session_mismatch".equals(mode) && Boolean.TRUE.equals(response.get("ok"))) response.put("session_id", "wrong-session");
      } else if ("inspect_globals".equals(op)) {
        if ("unavailable".equals(mode)) response = protocolFail(message.get("id"), "unavailable", "inspectGlobals unavailable");
        else response = protocolOk(id, new LinkedHashMap<>(Core.asMap(sessions.getOrDefault(String.valueOf(message.get("session_id")), Map.of()).getOrDefault("globals", Map.of()))), message.get("session_id"));
      } else if ("snapshot_globals".equals(op)) {
        if ("unavailable".equals(mode)) response = protocolFail(message.get("id"), "unavailable", "snapshotGlobals unavailable");
        else response = protocolOk(id, protocolSnapshot(sessions.getOrDefault(String.valueOf(message.get("session_id")), Map.of())), message.get("session_id"));
      } else if ("patch_globals".equals(op)) {
        if ("unavailable".equals(mode)) response = protocolFail(message.get("id"), "unavailable", "patchGlobals unavailable");
        else {
          Map<String, Object> session = sessions.get(String.valueOf(message.get("session_id")));
          Map<String, Object> payload = Core.asMap(message.getOrDefault("payload", Map.of()));
          Map<String, Object> raw = Core.asMap(payload.getOrDefault("globals", Map.of()));
          Map<String, Object> bindings = raw.containsKey("bindings") ? Core.asMap(raw.get("bindings")) : raw;
          if (session != null) session.put("globals", new LinkedHashMap<>(bindings));
          response = protocolOk(id, protocolSnapshot(session == null ? Map.of() : session), message.get("session_id"));
        }
      } else if ("close".equals(op)) {
        Map<String, Object> session = sessions.get(String.valueOf(message.get("session_id")));
        if (session != null) session.put("closed", true);
        response = protocolOk(id, new LinkedHashMap<>(Map.of("closed", true)), message.get("session_id"));
      } else if ("shutdown".equals(op)) {
        response = protocolOk(id, new LinkedHashMap<>(Map.of("shutdown", true)));
      } else {
        response = protocolFail(message.get("id"), "protocol", "unknown runtime protocol op: " + op);
      }
      writer.write(Json.stringify(response));
      writer.newLine();
      writer.flush();
      if ("shutdown".equals(op)) return;
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length > 0 && "--runtime-protocol-fixture-server".equals(args[0])) {
      runRuntimeProtocolFixtureServer();
      return;
    }
    if (args.length == 0) throw new IllegalArgumentException("usage: java dev.axllm.ax.Conformance <fixture-or-dir>...");
    for (String arg : args) {
      for (Path path : expand(Path.of(arg))) {
        Map<String, Object> fixture = Core.asMap(Json.parse(Files.readString(path)));
        run(fixture);
        System.out.println("ok " + fixture.getOrDefault("name", path.getFileName().toString()));
      }
    }
  }

  static List<Path> expand(Path path) throws Exception {
    if (!Files.isDirectory(path)) return List.of(path);
    try (var stream = Files.list(path)) {
      return stream.filter(p -> p.toString().endsWith(".json")).sorted().toList();
    }
  }

  static void run(Map<String, Object> fixture) {
    String kind = String.valueOf(fixture.getOrDefault("kind", "forward"));
    switch (kind) {
      case "signature_error" -> runSignatureError(fixture);
      case "signature" -> runSignature(fixture);
      case "json_schema" -> runJsonSchema(fixture);
      case "validate_value" -> runValidateValue(fixture);
      case "validate_output" -> runValidateOutput(fixture);
      case "strip_internal" -> runStripInternal(fixture);
      case "prompt" -> runPrompt(fixture);
      case "template" -> assertEqual(Core.render_template_content(fixture.get("template"), fixture.getOrDefault("vars", Map.of()), fixture.getOrDefault("context", "fixture-template")), fixture.getOrDefault("expected_output", ""), "template output");
      case "template_error" -> runTemplateError(fixture);
      case "template_validate" -> assertEqual(Core.validate_prompt_template_syntax(fixture.get("template"), fixture.getOrDefault("context", "fixture-template"), fixture.getOrDefault("required_variables", List.of())), fixture.getOrDefault("expected_result", true), "template validation");
      case "stream" -> runStream(fixture);
      case "forward" -> runForward(fixture);
      case "ai_chat" -> runAIChat(fixture);
      case "ai_embed" -> runAIEmbed(fixture);
      case "ai_stream" -> runAIStream(fixture);
      case "ai_error" -> runAIError(fixture);
      case "ai_unsupported" -> runAIUnsupported(fixture);
      case "ai_provider_descriptor" -> runAIProviderDescriptor(fixture);
      case "ai_provider_registry" -> runAIProviderRegistry(fixture);
      case "ai_model_catalog_audit" -> runAIModelCatalogAudit(fixture);
      case "ai_model_catalog_runtime" -> runAIModelCatalogRuntime(fixture);
      case "ai_multiservice_router" -> runAIMultiServiceRouter(fixture);
      case "ai_provider_router" -> runAIProviderRouter(fixture);
      case "ai_balancer" -> runAIBalancer(fixture);
      case "ai_transcribe" -> runAITranscribe(fixture);
      case "ai_speak" -> runAISpeak(fixture);
      case "ai_realtime" -> runAIRealtime(fixture);
      case "agent_forward" -> runAgentForward(fixture);
      case "agent_playbook_coverage" -> runAgentPlaybookCoverage(fixture);
      case "agent_playbook_evolve" -> runAgentPlaybookEvolve(fixture);
      case "agent_prompt" -> runAgentPrompt(fixture);
      case "agent_runtime_real" -> runAgentForward(fixture);
      case "agent_runtime_policy" -> runAgentRuntimePolicy(fixture);
      case "agent_runtime_session" -> runAgentRuntimeSession(fixture);
      case "agent_runtime_adapter" -> runAgentRuntimeAdapter(fixture);
      case "agent_runtime_protocol" -> runAgentRuntimeProtocol(fixture);
      case "program_contract" -> runProgramContract(fixture);
      case "flow" -> runFlow(fixture);
      case "flow_mermaid" -> runFlowMermaid(fixture);
      case "optimize" -> runOptimize(fixture);
      case "mcp" -> AxMCPClient.runConformanceFixture(fixture);
      case "event" -> runEvent(fixture);
      default -> throw new FixtureError("unknown fixture kind " + kind);
    }
  }

  @SuppressWarnings("unchecked")
  static void runEvent(Map<String,Object> fixture) {
    String operation=String.valueOf(fixture.get("operation"));
    switch(operation){
      case "routing" -> assertEqual(Core.event_route_commands(fixture.get("event"),fixture.get("routes"),fixture.get("identity_scope"),fixture.get("trust")),fixture.get("expected"),"event routing");
      case "retry" -> {for(Object item:(List<Object>)fixture.get("cases")){Map<String,Object> value=(Map<String,Object>)item;assertEqual(Core.event_retry_transition(value.get("invocation_started"),value.get("retry_safety"),value.get("attempt"),value.get("max_attempts")),value.get("expected"),"event retry");}}
      case "continuation" -> {Map<String,Object> key=(Map<String,Object>)fixture.get("correlation");Object actual=Core.event_continuation_match(fixture.get("continuations"),fixture.get("identity_scope"),key.get("kind"),key.get("value"),fixture.get("now"));assertEqual(((Map<String,Object>)actual).get("id"),fixture.get("expected_id"),"event continuation");}
      case "mcp_normalization" -> assertEqual(Core.event_normalize_mcp(fixture.get("namespace"),fixture.get("method"),fixture.get("params")),fixture.get("expected"),"event MCP normalization");
      case "mapping" -> assertEqual(Core.event_map_input(fixture.get("ingress"),fixture.get("plan"),fixture.get("signature_fields"),null),fixture.get("expected"),"event input mapping");
      case "lifecycle" -> {
        Map<String,Object> route=(Map<String,Object>)fixture.get("route");Map<String,Object> event=(Map<String,Object>)fixture.get("event");AxEventRuntime.PushSource source=new AxEventRuntime.PushSource();AxEventRuntime.Target target=new AxEventRuntime.Target(String.valueOf(route.get("targetId")),(input,context)->Map.of("handled",String.valueOf(((Map<String,Object>)input).get("message"))));AxEventRuntime runtime=new AxEventRuntime(List.of(new AxEventRoute(String.valueOf(route.get("id")),String.valueOf(route.get("action")),(Map<String,Object>)route.get("match"),String.valueOf(route.get("targetId")),false,"strict",0))).registerTarget(target).addSource(source);runtime.start();source.publish(new AxEventEnvelope(String.valueOf(event.get("id")),String.valueOf(event.get("source")),String.valueOf(event.get("type")),event.get("data")));AxEventRuntime.PublishReceipt receipt=runtime.publish(new AxEventEnvelope(String.valueOf(event.get("id"))+"-receipt",String.valueOf(event.get("source")),String.valueOf(event.get("type")),event.get("data")),String.valueOf(fixture.get("identity_scope")),String.valueOf(fixture.get("trust")));AxEventRuntime.Run run=runtime.getRun("run:"+route.get("id")+":"+event.get("id")+":1");assertEqual(receipt.accepted(),true,"event publish receipt");assertEqual(run.output,fixture.get("expected_output"),"event automatic dispatch");runtime.close();

        int[] retryCalls={0};AxEventClock.ManualClock retryClock=new AxEventClock.ManualClock(1_000);AxEventRuntime.Target retryTarget=new AxEventRuntime.Target("retry-target",(input,context)->{if(++retryCalls[0]==1)throw new RuntimeException("retry once");return Map.of("attempt",retryCalls[0]);}).retrySafety("idempotent");AxEventRuntime retryRuntime=new AxEventRuntime(List.of(new AxEventRoute("retry-route","wake",Map.of("types",List.of("event.retry")),"retry-target",false,"strict",0)),Map.of("clock",retryClock,"retryBackoffMs",500)).registerTarget(retryTarget);retryRuntime.start();retryRuntime.publish(new AxEventEnvelope("retry-1","test://axevent","event.retry",Map.of()),"anonymous","untrusted");AxEventRuntime.Run retryRun=retryRuntime.getRun("run:retry-route:retry-1:1");assertEqual(List.of(retryRun.attempt,retryRun.status,retryRuntime.nextDueAt()),List.of(1,"queued",1_500L),"event delayed retry");retryClock.advance(500);retryRuntime.runDue();assertEqual(List.of(retryRun.attempt,retryRun.status),List.of(2,"succeeded"),"event retry dispatch");

        List<String> strictCalls=new ArrayList<>();AxEventClock.ManualClock strictClock=new AxEventClock.ManualClock(1_000);AxEventRuntime.Target strictTarget=new AxEventRuntime.Target("strict-target",(input,context)->{String name=String.valueOf(((Map<String,Object>)input).get("name"));strictCalls.add(name);if(name.equals("first")&&strictCalls.size()==1)throw new RuntimeException("retry first");return input;}).retrySafety("idempotent");AxEventRuntime strictRuntime=new AxEventRuntime(List.of(new AxEventRoute("strict-route","wake",Map.of("types",List.of("event.strict")),"strict-target",false,"strict",0)),Map.of("clock",strictClock,"retryBackoffMs",500)).registerTarget(strictTarget);strictRuntime.start();strictRuntime.publish(new AxEventEnvelope("strict-1","test://axevent","event.strict",Map.of("name","first")),"anonymous","untrusted");strictRuntime.publish(new AxEventEnvelope("strict-2","test://axevent","event.strict",Map.of("name","second")),"anonymous","untrusted");assertEqual(strictCalls,List.of("first"),"event strict ordering while retry waits");strictClock.advance(500);strictRuntime.runDue();assertEqual(strictCalls,List.of("first","first","second"),"event strict retry release ordering");

        AxEventClock.ManualClock debounceClock=new AxEventClock.ManualClock(2_000);List<Object> debounceValues=new ArrayList<>();AxEventRuntime.Target debounceTarget=new AxEventRuntime.Target("debounce-target",(input,context)->{debounceValues.add(input);return input;});AxEventRuntime debounceRuntime=new AxEventRuntime(List.of(new AxEventRoute("debounce-route","wake",Map.of("types",List.of("event.debounce")),"debounce-target",false,"strict",250)),Map.of("clock",debounceClock)).registerTarget(debounceTarget);debounceRuntime.start();debounceRuntime.publish(new AxEventEnvelope("debounce-1","test://axevent","event.debounce",Map.of("revision",1)),"anonymous","untrusted");debounceRuntime.publish(new AxEventEnvelope("debounce-2","test://axevent","event.debounce",Map.of("revision",2)),"anonymous","untrusted");assertEqual(List.of(debounceValues,debounceRuntime.nextDueAt()),List.of(List.of(),2_250L),"event debounce scheduling");debounceClock.advance(250);debounceRuntime.runDue();assertEqual(debounceValues,List.of(Map.of("revision",2)),"event latest-value coalescing");

        boolean envelopeRejected=false;try{new AxEventRuntime(List.of(new AxEventRoute("capacity-route","wake",Map.of("types",List.of("event.capacity")),"debounce-target",false,"strict",0)),Map.of("maxEnvelopeBytes",16)).registerTarget(debounceTarget).start().publish(new AxEventEnvelope("capacity-1","test://axevent","event.capacity",Map.of("payload","too-large")),"anonymous","untrusted");}catch(IllegalArgumentException error){envelopeRejected=true;}assertEqual(envelopeRejected,true,"event envelope backpressure");

        int[] state={0};AxEventRuntime.Target stateTarget=new AxEventRuntime.Target("state-target",(input,context)->Map.of("state",++state[0])).retrySafety("idempotent").state(()->state[0],value->state[0]=((Number)value).intValue());AxEventRuntime stateRuntime=new AxEventRuntime(List.of(new AxEventRoute("state-route","wake",Map.of("types",List.of("event.state")),"state-target",false,"strict",0))).registerTarget(stateTarget);stateRuntime.start();stateRuntime.publish(new AxEventEnvelope("state-1","test://axevent","event.state",Map.of()),"anonymous","untrusted");state[0]=0;stateRuntime.publish(new AxEventEnvelope("state-2","test://axevent","event.state",Map.of()),"anonymous","untrusted");assertEqual(stateRuntime.getRun("run:state-route:state-2:2").output,Map.of("state",2),"event state restore");

        AxEventRuntime.Target cancelTarget=new AxEventRuntime.Target("cancel-target",(input,context)->{((AxEventRuntime.CancellationToken)context.get("cancellation")).cancel("fixture");return Map.of("should","not persist");});AxEventRuntime cancelRuntime=new AxEventRuntime(List.of(new AxEventRoute("cancel-route","wake",Map.of("types",List.of("event.cancel")),"cancel-target",false,"strict",0))).registerTarget(cancelTarget);cancelRuntime.start();cancelRuntime.publish(new AxEventEnvelope("cancel-1","test://axevent","event.cancel",Map.of()),"anonymous","untrusted");AxEventRuntime.Run cancelRun=cancelRuntime.getRun("run:cancel-route:cancel-1:1");assertEqual(java.util.Arrays.asList(cancelRun.status,cancelRun.output),java.util.Arrays.asList("cancelled",null),"event cooperative cancellation");

        class FixtureSink implements AxEventSink {int calls;public void write(Object output,Map<String,Object> context){calls++;if(calls==1)throw new RuntimeException("sink once");AxEventRuntime.Run stored=(AxEventRuntime.Run)context.get("run");if(stored==null||!java.util.Objects.equals(stored.output,output))throw new RuntimeException("output was not persisted before sink");}}FixtureSink sink=new FixtureSink();int[] modelCalls={0};AxEventRuntime.Target sinkTarget=new AxEventRuntime.Target("sink-target",(input,context)->{modelCalls[0]++;return input;}).retrySafety("idempotent").sink("fixture-sink",sink);AxEventRuntime sinkRuntime=new AxEventRuntime(List.of(new AxEventRoute("sink-route","wake",Map.of("types",List.of("event.sink")),"sink-target",false,"strict",0))).registerTarget(sinkTarget);sinkRuntime.start();sinkRuntime.publish(new AxEventEnvelope("sink-1","test://axevent","event.sink",Map.of("ok",true)),"anonymous","untrusted");AxEventRuntime.DeadLetter dead=sinkRuntime.listDeadLetters().get(0);sinkRuntime.redrive(dead.id());assertEqual(List.of(modelCalls[0],sink.calls,sinkRuntime.listDeadLetters().size()),List.of(1,2,0),"event sink-only redrive");

        int[] continuationCalls={0};AxEventRuntime.Target continuationTarget=new AxEventRuntime.Target("continuation-target",(input,context)->{continuationCalls[0]++;return input;}).waitFor("job","job",Map.of());AxEventRuntime continuationRuntime=new AxEventRuntime(List.of(new AxEventRoute("continuation-wake","wake",Map.of("types",List.of("event.continuation.start")),"continuation-target",false,"strict",0),new AxEventRoute("continuation-resume","resume",Map.of("types",List.of("event.continuation.done")),null,false,"strict",0))).registerTarget(continuationTarget);continuationRuntime.start();continuationRuntime.publish(new AxEventEnvelope("continuation-1","test://axevent","event.continuation.start",Map.of("job","job-1")),"tenant:test","authenticated");continuationRuntime.publish(new AxEventEnvelope("1.0","continuation-2","test://axevent","event.continuation.done",null,Map.of("job","job-1"),Map.of(),List.of(Map.of("kind","job","value","job-1"))),"tenant:test","authenticated");assertEqual(continuationCalls[0],2,"event continuation resume");

        AxMCPScriptedTransport mcpTransport=new AxMCPScriptedTransport(List.of(Map.of("method","initialize","result",Map.of("protocolVersion","2025-11-25","capabilities",Map.of("resources",Map.of("subscribe",true))))));AxMCPClient mcpClient=new AxMCPClient(mcpTransport,Map.of("namespace","inventory"));int[] lifecycleCalls={0};mcpClient.addLifecycleListener(stateValue->lifecycleCalls[0]++);int[] mcpCalls={0};AxMCPEventSource mcpSource=new AxMCPEventSource(mcpClient,"inventory","tenant:test","authenticated",List.of("demo://inventory"));AxEventRuntime mcpRuntime=new AxEventRuntime(List.of(new AxEventRoute("mcp-wake","wake",Map.of("types",List.of("mcp.resource.updated")),"mcp-target",true,"strict",0))).registerTarget(new AxEventRuntime.Target("mcp-target",(input,context)->{mcpCalls[0]++;return input;})).addSource(mcpSource);mcpRuntime.start();mcpTransport.emit(Map.of("jsonrpc","2.0","method","notifications/resources/updated","params",Map.of("uri","demo://inventory")));mcpClient.emitLifecycle("reconnected");mcpRuntime.close();mcpTransport.emit(Map.of("jsonrpc","2.0","method","notifications/resources/updated","params",Map.of("uri","demo://inventory")));long subscribeCalls=mcpTransport.requests.stream().filter(request->"resources/subscribe".equals(request.get("method"))).count();assertEqual(List.of(mcpCalls[0],lifecycleCalls[0],subscribeCalls),List.of(1,1,2L),"MCP listener composition and resubscription");
        Map<String,Object> ownership=Core.asMap(Core.mcp_resource_subscription_ownership(List.of(),"source-a","acquire"));ownership=Core.asMap(Core.mcp_resource_subscription_ownership(ownership.get("owners"),"source-b","acquire"));ownership=Core.asMap(Core.mcp_resource_subscription_ownership(ownership.get("owners"),"source-a","release"));assertEqual(ownership,Map.of("owners",List.of("source-b"),"wireAction","none","changed",true),"MCP subscription ownership transition");
        List<Map<String,Object>> selectionResources=List.of(Map.of("uri","demo://b"),Map.of("uri","demo://a"),Map.of("uri","demo://b"),Map.of("uri",""));assertEqual(List.of(Core.asList(Core.mcp_resource_subscription_selection(selectionResources,"all",List.of())),Core.asList(Core.mcp_resource_subscription_selection(List.of(),"explicit",List.of("demo://x","demo://y","demo://x"))),Core.asList(Core.mcp_resource_subscription_selection(List.of(selectionResources.get(1)),"selector",List.of()))),List.of(List.of("demo://b","demo://a"),List.of("demo://x","demo://y"),List.of("demo://a")),"MCP subscription selection modes");
        List<Object> mappedInputs=new ArrayList<>();AxEventRuntime.Target mappedTarget=AxEventRuntime.eventTarget("mapped-target").signature(AxSignature.create("url:string, revision:number -> ok:boolean")).invoke((input,context)->{mappedInputs.add(input);return input;}).wakeInput(input->input.field("url",AxEventRuntime.Path.data("uri")).field("revision",AxEventRuntime.Path.data("revision"))).build();AxEventRoute mappedRoute=AxEventRuntime.eventRoute("mapped-route").types("event.mapped").instanceKey(AxEventRuntime.Path.data("uri")).wake(mappedTarget).build();AxEventRuntime mappedRuntime=new AxEventRuntime(List.of(mappedRoute)).registerTarget(mappedTarget);mappedRuntime.start();mappedRuntime.publish(new AxEventEnvelope("mapped-1","test://event","event.mapped",Map.of("uri","demo://one","revision",2)),"anonymous","untrusted");mappedRuntime.publish(new AxEventEnvelope("mapped-2","test://event","event.mapped",Map.of("uri","demo://two","revision","bad")),"anonymous","untrusted");assertEqual(List.of(mappedInputs,mappedRuntime.listDeadLetters().size()),List.of(List.of(Map.of("url","demo://one","revision",2)),1),"signature-aware event mapping");
        List<Object> callbackInputs=new ArrayList<>();AxEventRuntime.Target callbackTarget=new AxEventRuntime.Target("callback-target",(input,context)->{callbackInputs.add(input);return input;}).signature(AxSignature.create("url:string -> ok:boolean")).mapInput((input,continuation)->Map.of("url",((Map<String,Object>)input.data()).get("uri"),"secret","drop-me"));AxEventRuntime callbackRuntime=new AxEventRuntime(List.of(new AxEventRoute("callback-route","wake",Map.of("types",List.of("event.callback")),"callback-target",false,"strict",0))).registerTarget(callbackTarget);callbackRuntime.start();callbackRuntime.publish(new AxEventEnvelope("callback-1","test://event","event.callback",Map.of("uri","demo://callback")),"anonymous","untrusted");assertEqual(callbackInputs,List.of(Map.of("url","demo://callback")),"event callback signature normalization");
      }
      default -> throw new FixtureError("unsupported event operation "+operation);
    }
  }


  static void runSignatureError(Map<String, Object> fixture) {
    try {
      buildSignature(fixture);
    } catch (RuntimeException e) {
      assertErrorCategory(e, fixture);
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return;
    }
    throw new FixtureError("expected signature construction to fail");
  }

  static void runSignature(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    assertEqual(signaturePayload(sig), fixture.get("expected_signature"), "signature");
    if (fixture.containsKey("expected_to_string")) {
      String rendered = sig.toString();
      assertEqual(rendered, fixture.get("expected_to_string"), "signature toString");
      assertEqual(signaturePayload(AxSignature.create(rendered)), fixture.get("expected_signature"), "signature round-trip");
    }
  }

  static String errorCategory(RuntimeException e) {
    String name = e.getClass().getSimpleName();
    if (name.equals("AxSignatureError")) return "signature";
    if (name.equals("AxValidationError")) return "validation";
    if (name.startsWith("AxAI")) return "ai";
    return "runtime";
  }

  static void assertErrorCategory(RuntimeException e, Map<String, Object> fixture) {
    String expected = (String) fixture.get("expected_error_category");
    if (expected == null || expected.isEmpty()) return;
    String category = errorCategory(e);
    if (!category.equals(expected)) throw new FixtureError("expected error category " + expected + ", got " + category);
  }

  static void runJsonSchema(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    Object fields = "inputs".equals(fixture.getOrDefault("target", "outputs")) ? sig.inputs : sig.outputs;
    Object schema = Core.to_json_schema(fields, fixture.getOrDefault("schema_title", "Schema"), fixture.getOrDefault("schema_options", Map.of()));
    assertEqual(schema, fixture.get("expected_schema"), "json schema");
  }

  static void runValidateValue(Map<String, Object> fixture) {
    Field field = fieldFromSpec(Core.asMap(fixture.getOrDefault("field", Map.of()))).toField(String.valueOf(fixture.getOrDefault("field_name", "value")));
    expectMaybeError(() -> Core.validate_value(field, fixture.get("value"), null), fixture);
  }

  static void runValidateOutput(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    Object result = expectMaybeError(() -> Core.validate_output(sig.outputs, fixture.getOrDefault("values", Map.of())), fixture);
    if (!fixture.containsKey("expected_error_contains")) assertEqual(result, fixture.getOrDefault("expected_values", fixture.getOrDefault("values", Map.of())), "validated output");
  }

  static void runStripInternal(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    assertEqual(Core.strip_internal(sig.outputs, fixture.getOrDefault("values", Map.of())), fixture.get("expected_output"), "strip internal");
  }

  static void runPrompt(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    ToolBuild tools = buildTools(Core.asList(fixture.getOrDefault("tools", List.of())));
    Map<String, Object> options = Core.asMap(fixture.getOrDefault("options", Map.of()));
    PromptTemplate prompt = new PromptTemplate(
      sig,
      tools.tools,
      (String) fixture.getOrDefault("structured_output_function_name", options.getOrDefault("structured_output_function_name", options.get("structuredOutputFunctionName"))),
      (String) fixture.getOrDefault("custom_template", options.getOrDefault("custom_template", options.get("customTemplate")))
    );
    if (fixture.get("instruction") != null) prompt.setInstruction(String.valueOf(fixture.get("instruction")));
    Object messages = prompt.render(Core.asMap(fixture.getOrDefault("input", fixture.getOrDefault("values", Map.of()))));
    for (Object item : Core.asList(fixture.getOrDefault("expected_prompt_contains", List.of()))) {
      if (!Json.stringify(messages).contains(String.valueOf(item))) throw new FixtureError("prompt missing " + item + ": " + messages);
    }
    if (fixture.containsKey("expected_messages")) assertEqual(messages, fixture.get("expected_messages"), "messages");
  }

  static void runTemplateError(Map<String, Object> fixture) {
    try {
      if ("validate".equals(fixture.get("operation"))) {
        Object result = Core.validate_prompt_template_syntax(fixture.get("template"), fixture.getOrDefault("context", "fixture-template"), fixture.getOrDefault("required_variables", List.of()));
        if (!Boolean.TRUE.equals(result)) throw new RuntimeException(String.valueOf(result));
      } else {
        Core.render_template_content(fixture.get("template"), fixture.getOrDefault("vars", Map.of()), fixture.getOrDefault("context", "fixture-template"));
      }
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return;
    }
    throw new FixtureError("expected template operation to fail");
  }

  static void runForward(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    ToolBuild toolBuild = buildTools(Core.asList(fixture.getOrDefault("tools", List.of())));
    Map<String, Object> options = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
    options.put("functions", toolBuild.tools);
    AxGen gen = new AxGen(sig, options);
    if (fixture.containsKey("examples")) gen.setExamples(Core.asMapList(fixture.get("examples")));
    if (fixture.containsKey("demos")) gen.setDemos(Core.asMapList(fixture.get("demos")));
    for (Object item : Core.asList(fixture.getOrDefault("assertions", List.of()))) gen.addAssert(Core.asMap(item));
    for (Object item : Core.asList(fixture.getOrDefault("field_processors", fixture.getOrDefault("fieldProcessors", List.of())))) {
      Map<String, Object> processor = Core.asMap(item);
      gen.addFieldProcessor(String.valueOf(processor.get("field")), String.valueOf(processor.getOrDefault("processor", processor.get("op"))));
    }
    if (fixture.containsKey("stop_functions") || fixture.containsKey("stopFunctions")) {
      List<String> names = new ArrayList<>();
      for (Object item : Core.asList(fixture.getOrDefault("stop_functions", fixture.getOrDefault("stopFunctions", List.of())))) names.add(String.valueOf(item));
      gen.setStopFunctions(names);
    }
    ConformanceScriptedAI client = new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
    Object output = expectMaybeError(() -> gen.forward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), Core.asMap(fixture.getOrDefault("forward_options", Map.of()))), fixture);
    if (!fixture.containsKey("expected_error_contains") && fixture.containsKey("expected_output")) assertEqual(output, fixture.get("expected_output"), "forward output");
    if (fixture.containsKey("expected_request_count") && client.requests.size() != Core.asInt(fixture.get("expected_request_count"))) throw new FixtureError("expected request count mismatch");
    if (Boolean.TRUE.equals(fixture.getOrDefault("expect_chat_path", true)) && client.chatCalls == 0) throw new FixtureError("expected AxGen to use AxAIService.chat()");
    if (fixture.containsKey("expected_request")) assertSubset(client.requests.get(0), fixture.get("expected_request"), "request");
    if (fixture.containsKey("expected_request_contains")) {
      String text = Json.stringify(client.requests);
      for (Object item : Core.asList(fixture.get("expected_request_contains"))) if (!text.contains(String.valueOf(item))) throw new FixtureError("request missing " + item + ": " + text);
    }
    if (fixture.containsKey("expected_tool_calls")) assertEqual(toolBuild.calls, fixture.get("expected_tool_calls"), "tool calls");
	    if (fixture.containsKey("expected_trace")) {
	      if (gen.getTraces().isEmpty()) throw new FixtureError("expected trace but none was recorded");
	      assertSubset(gen.getTraces().get(gen.getTraces().size() - 1), fixture.get("expected_trace"), "trace");
	    }
	    if (fixture.containsKey("expected_memory_history_count") && gen.getMemory().history().size() != Core.asInt(fixture.get("expected_memory_history_count"))) throw new FixtureError("expected memory history count mismatch");
	    if (fixture.containsKey("expected_memory_history_subset")) assertListSubset(gen.getMemory().history(), fixture.get("expected_memory_history_subset"), "memory history");
	    if (fixture.containsKey("expected_chat_log_subset")) assertListSubset(gen.getChatLog(), fixture.get("expected_chat_log_subset"), "chat log");
	    if (fixture.containsKey("expected_function_traces_subset")) assertListSubset(gen.getFunctionCallTraces(), fixture.get("expected_function_traces_subset"), "function call traces");
	    if (fixture.containsKey("expected_chat_prompt")) assertEqual(client.requests.get(0).get("chat_prompt"), fixture.get("expected_chat_prompt"), "chat prompt");
	    if (fixture.containsKey("expected_chat_prompt_contains")) {
	      String promptText = Json.stringify(client.requests.get(0).get("chat_prompt"));
	      for (Object item : Core.asList(fixture.get("expected_chat_prompt_contains"))) if (!promptText.contains(String.valueOf(item))) throw new FixtureError("chat prompt missing " + item + ": " + promptText);
	    }
	  }

  static Object flowStateValue(Map<String, Object> state, Object field, Object fallback) {
    if (field == null) return fallback;
    Object cur = state;
    for (String part : String.valueOf(field).split("\\.")) {
      if (cur instanceof Map<?, ?> map) cur = Core.asMap(map).getOrDefault(part, fallback);
      else return fallback;
    }
    return cur;
  }

  static void runStream(Map<String, Object> fixture) {
    List<Object> chunks = new ArrayList<>();
    try {
      for (Object event : Core.asList(fixture.getOrDefault("stream_events", List.of()))) {
        chunks.add(event);
        runStreamingAssertions(fixture, Core.fold_stream(chunks));
      }
    } catch (Exception exc) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && exc.getMessage() != null && exc.getMessage().contains(expected)) return;
      throw exc;
    }
    if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected stream assertion to fail");
    assertEqual(Core.fold_stream(chunks), fixture.getOrDefault("expected_folded", ""), "stream fold");
  }

  static void runStreamingAssertions(Map<String, Object> fixture, Object content) {
    for (Object raw : Core.asList(fixture.getOrDefault("streaming_assertions", List.of()))) {
      Map<String, Object> assertion = Core.asMap(raw);
      Object needle = assertion.getOrDefault("not_contains", assertion.get("notContains"));
      if (needle == null) continue;
      if (String.valueOf(content).contains(String.valueOf(needle))) {
        throw new RuntimeException(String.valueOf(assertion.getOrDefault("message", "streaming assertion failed")));
      }
    }
  }

  static AxFlow.Mapper flowConditionFromSpec(Object rawSpec) {
    Map<String, Object> spec = Core.asMap(rawSpec == null ? Map.of() : rawSpec);
    return state -> {
      String op = String.valueOf(spec.getOrDefault("op", "truthy"));
      if ("field".equals(op)) return flowStateValue(state, spec.get("field"), spec.get("default"));
      if ("lt".equals(op)) return Core.asDouble(flowStateValue(state, spec.get("field"), 0)) < Core.asDouble(spec.getOrDefault("value", 0));
      if ("eq".equals(op)) return java.util.Objects.equals(flowStateValue(state, spec.get("field"), null), spec.get("value"));
      if ("always".equals(op)) return !Boolean.FALSE.equals(spec.getOrDefault("value", Boolean.TRUE));
      return Core.truthy(flowStateValue(state, spec.get("field"), null));
    };
  }

  static AxFlow.Mapper flowMapperFromSpec(Object rawSpec) {
    Map<String, Object> spec = Core.asMap(rawSpec == null ? Map.of() : rawSpec);
    return state -> {
      Map<String, Object> out = new LinkedHashMap<>(state == null ? Map.of() : state);
      String op = String.valueOf(spec.getOrDefault("op", "set"));
      if ("increment".equals(op)) {
        String field = String.valueOf(spec.get("field"));
        out.put(field, Core.asDouble(flowStateValue(out, field, 0)) + Core.asDouble(spec.getOrDefault("by", 1)));
      } else if ("append".equals(op)) {
        String field = String.valueOf(spec.get("field"));
        List<Object> values = new ArrayList<>(Core.asList(flowStateValue(out, field, List.of())));
        values.add(spec.containsKey("valueField") ? flowStateValue(out, spec.get("valueField"), null) : spec.get("value"));
        out.put(field, values);
      } else if ("copy".equals(op)) {
        out.put(String.valueOf(spec.get("to")), flowStateValue(out, spec.get("from"), null));
      } else if ("upper".equals(op)) {
        out.put(String.valueOf(spec.getOrDefault("to", "__derived")), String.valueOf(flowStateValue(out, spec.getOrDefault("from", "__item"), "")).toUpperCase());
      } else {
        out.putAll(Core.asMap(spec.getOrDefault("values", Map.of())));
      }
      return out;
    };
  }

  static Map<String, Object> buildFlowStep(Map<String, Object> step, Map<String, Object> fixture) {
    String kind = String.valueOf(step.getOrDefault("kind", "execute"));
    String name = String.valueOf(step.get("name"));
    Map<String, Object> options = new LinkedHashMap<>(Core.asMap(step.getOrDefault("options", Map.of())));
    if ("map".equals(kind) || "derive".equals(kind)) {
      Object mapper = step.containsKey("mapper") ? flowMapperFromSpec(step.get("mapper")) : (AxFlow.Mapper) state -> step.getOrDefault("output", Map.of());
      return Core.asMap(Core._flow_step(kind, name, mapper, options));
    }
    if ("branch".equals(kind)) {
      options.put("predicate", flowConditionFromSpec(step.getOrDefault("predicate", options.get("predicate"))));
      List<Object> branches = new ArrayList<>();
      for (Object rawBranch : Core.asList(step.getOrDefault("branches", options.getOrDefault("branches", List.of())))) {
        Map<String, Object> branch = Core.asMap(rawBranch);
        List<Object> branchSteps = new ArrayList<>();
        for (Object rawChild : Core.asList(branch.getOrDefault("steps", List.of()))) branchSteps.add(buildFlowStep(Core.asMap(rawChild), fixture));
        branches.add(Map.of("when", branch.get("when"), "steps", branchSteps));
      }
      options.put("branches", branches);
      return Core.asMap(Core._flow_step("branch", name, null, options));
    }
    if ("while".equals(kind) || "feedback".equals(kind)) {
      options.put("condition", flowConditionFromSpec(step.getOrDefault("condition", options.get("condition"))));
      List<Object> bodySteps = new ArrayList<>();
      for (Object rawChild : Core.asList(step.getOrDefault("steps", options.getOrDefault("steps", List.of())))) bodySteps.add(buildFlowStep(Core.asMap(rawChild), fixture));
      options.put("steps", bodySteps);
      return Core.asMap(Core._flow_step(kind, name, null, options));
    }
    if ("parallel".equals(kind) || "parallelMerge".equals(kind)) return Core.asMap(Core._flow_step(kind, name, null, options));
    Object program;
    if ("flow".equals(step.get("program"))) {
      Map<String, Object> nestedFixture = new LinkedHashMap<>();
      nestedFixture.put("flow_options", step.getOrDefault("flow_options", Map.of("id", step.getOrDefault("program_id", "root." + name))));
      nestedFixture.put("steps", step.getOrDefault("steps", List.of()));
      nestedFixture.put("returns", step.getOrDefault("returns", Map.of()));
      nestedFixture.put("signature", step.getOrDefault("signature", fixture.getOrDefault("signature", "question:string -> answer:string")));
      program = buildFlow(nestedFixture);
    } else if ("agent".equals(step.get("program"))) {
      program = Ax.agent(String.valueOf(step.getOrDefault("signature", fixture.getOrDefault("signature", "question:string -> answer:string"))), Core.asMap(step.getOrDefault("options", Map.of())));
    } else {
      String signature = String.valueOf(step.getOrDefault("extended_signature", step.getOrDefault("extendedSignature", step.getOrDefault("signature", fixture.getOrDefault("signature", "question:string -> answer:string")))));
      program = new AxGen(AxSignature.create(signature), Core.asMap(step.getOrDefault("options", Map.of())));
    }
    Map<String, Object> stepOptions = new LinkedHashMap<>(Core.asMap(step.getOrDefault("forward_options", Map.of())));
    stepOptions.putAll(options);
    return Core.asMap(Core._flow_step(kind, name, program, stepOptions));
  }

  static AxFlow buildFlow(Map<String, Object> fixture) {
    AxFlow fl = Ax.flow(Core.asMap(fixture.getOrDefault("flow_options", Map.of("id", fixture.getOrDefault("program_id", "root.flow")))));
    for (Object rawStep : Core.asList(fixture.getOrDefault("steps", List.of()))) {
      Core._flow_add_step(fl.state, buildFlowStep(Core.asMap(rawStep), fixture));
    }
    if (fixture.containsKey("returns")) fl.returns(Core.asMap(fixture.getOrDefault("returns", Map.of())));
    if (fixture.containsKey("demos")) fl.setDemos(fixture.get("demos"));
    return fl;
  }

  static void runProgramContract(Map<String, Object> fixture) {
    Object program = "flow".equals(fixture.get("program")) ? buildFlow(fixture) : new AxGen(AxSignature.create(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string"))), Core.asMap(fixture.getOrDefault("options", Map.of())));
    Object components = program instanceof AxFlow fl ? fl.getOptimizableComponents() : ((AxGen) program).getOptimizableComponents();
    if (fixture.containsKey("expected_component_ids")) {
      List<Object> ids = new ArrayList<>();
      for (Object component : Core.asList(components)) ids.add(Core.asMap(component).get("id"));
      assertEqual(ids, fixture.get("expected_component_ids"), "program component ids");
    }
    if (fixture.containsKey("expected_components_subset")) assertListSubset(Core.asList(components), fixture.get("expected_components_subset"), "program components");
  }

  static void runFlow(Map<String, Object> fixture) {
    try {
      AxFlow fl = buildFlow(fixture);
      if ("cache_key".equals(fixture.get("operation"))) {
        List<Object> keys = new ArrayList<>();
        for (Object item : Core.asList(fixture.getOrDefault("cache_key_inputs", List.of()))) keys.add(Core._flow_cache_key(item));
        if (Boolean.TRUE.equals(fixture.get("expected_cache_keys_equal")) && new java.util.HashSet<>(keys).size() != 1) throw new FixtureError("expected equal flow cache keys, got " + keys);
        if (Boolean.TRUE.equals(fixture.get("expected_cache_keys_distinct")) && new java.util.HashSet<>(keys).size() != keys.size()) throw new FixtureError("expected distinct flow cache keys, got " + keys);
        return;
      }
      if (fixture.containsKey("expected_plan")) assertEqual(fl.getPlan(), fixture.get("expected_plan"), "flow plan");
      if (fixture.containsKey("expected_plan_subset")) assertListSubset(fl.getPlan(), fixture.get("expected_plan_subset"), "flow plan");
      if ("plan".equals(fixture.get("operation"))) return;
      ConformanceScriptedAI client = new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
      Map<String, Object> forwardOptions = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("forward_options", Map.of())));
      if (fixture.containsKey("cache_seed_value")) {
        Map<String, Object> cacheStore = Core.asMap(forwardOptions.getOrDefault("cache_store", new LinkedHashMap<>()));
        cacheStore.put(String.valueOf(Core._flow_cache_key(fixture.getOrDefault("input", Map.of()))), fixture.get("cache_seed_value"));
        forwardOptions.put("cache_store", cacheStore);
      }
      Object output = "streaming".equals(fixture.get("operation"))
        ? fl.streamingForward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), forwardOptions)
        : fl.forward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), forwardOptions);
      if (fixture.containsKey("expected_output")) assertEqual(output, fixture.get("expected_output"), "flow output");
      if (fixture.containsKey("expected_streaming_output")) assertEqual(output, fixture.get("expected_streaming_output"), "flow streaming output");
      if (fixture.containsKey("expected_request_count") && client.requests.size() != Core.asInt(fixture.get("expected_request_count"))) throw new FixtureError("expected request count mismatch");
      if (fixture.containsKey("expected_request_contains")) {
        String text = Json.stringify(client.requests);
        for (Object item : Core.asList(fixture.get("expected_request_contains"))) if (!text.contains(String.valueOf(item))) throw new FixtureError("flow request missing " + item + ": " + text);
      }
      if (fixture.containsKey("expected_chat_log_subset")) assertListSubset(fl.getChatLog(), fixture.get("expected_chat_log_subset"), "flow chat log");
      if (fixture.containsKey("expected_trace_kinds")) {
        List<Object> kinds = new ArrayList<>();
        for (Map<String, Object> event : fl.getTraces()) kinds.add(event.get("kind"));
        assertEqual(kinds, fixture.get("expected_trace_kinds"), "flow trace kinds");
      }
      if (fixture.containsKey("expected_trace_subset")) assertListSubset(fl.getTraces(), fixture.get("expected_trace_subset"), "flow traces");
      if (fixture.containsKey("expected_usage_subset")) assertSubset(fl.getUsage(), fixture.get("expected_usage_subset"), "flow usage");
      if (fixture.containsKey("expected_cache_store_subset")) assertSubset(Core.asMap(forwardOptions.getOrDefault("cache_store", forwardOptions.getOrDefault("cacheStore", Map.of()))), fixture.get("expected_cache_store_subset"), "flow cache store");
      if (fixture.containsKey("expected_cache_value_for_input")) assertEqual(Core.asMap(forwardOptions.getOrDefault("cache_store", forwardOptions.getOrDefault("cacheStore", Map.of()))).get(String.valueOf(Core._flow_cache_key(fixture.getOrDefault("input", Map.of())))), fixture.get("expected_cache_value_for_input"), "flow cache value");
      if (fixture.containsKey("expected_components_subset")) assertListSubset(fl.getOptimizableComponents(), fixture.get("expected_components_subset"), "flow components");
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected flow fixture to fail");
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
  }

  static void runFlowMermaid(Map<String, Object> fixture) {
    String operation = String.valueOf(fixture.getOrDefault("operation", ""));
    Map<String, Object> conditions = new LinkedHashMap<>();
    for (Object raw : Core.asList(fixture.getOrDefault("condition_names", List.of()))) {
      conditions.put(String.valueOf(raw), (AxFlow.Mapper) state -> false);
    }
    Map<String, Object> bindings = Map.of("conditions", conditions);
    if ("error".equals(operation)) {
      try {
        new AxFlow(String.valueOf(fixture.getOrDefault("document", "")), bindings);
      } catch (RuntimeException error) {
        String expected = String.valueOf(fixture.getOrDefault("expected_error_contains", ""));
        if (!String.valueOf(error.getMessage()).contains(expected)) throw error;
        return;
      }
      throw new FixtureError("expected mermaid compilation to fail");
    }
    if ("builder_render".equals(operation)) {
      AxFlow built = new AxFlow();
      for (Object raw : Core.asList(fixture.getOrDefault("builder_steps", List.of()))) {
        Map<String, Object> step = Core.asMap(raw);
        built.execute(
          String.valueOf(step.get("name")),
          new AxGen(AxSignature.create(String.valueOf(step.get("signature")))),
          Map.of("reads", Core.asList(step.getOrDefault("reads", List.of())))
        );
      }
      assertEqual(built.toString(), fixture.get("expected_rendered"), "flow mermaid builder render");
      return;
    }
    AxFlow first = new AxFlow(String.valueOf(fixture.get("document")), bindings);
    String expected = String.valueOf(fixture.getOrDefault("expected_rerendered", fixture.get("expected_rendered")));
    assertEqual(first.toString(), expected, "flow mermaid render");
    AxFlow second = new AxFlow(first.toString(), bindings);
    assertEqual(second.toString(), expected, "flow mermaid canonical roundtrip");
  }

  static void runOptimize(Map<String, Object> fixture) {
    String programKind = String.valueOf(fixture.getOrDefault("program", "agent"));
    String signature = String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string"));
    Map<String, Object> options = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
    ToolBuild toolBuild = buildTools(Core.asList(fixture.getOrDefault("tools", List.of())));
    if (!toolBuild.tools.isEmpty()) options.put("functions", toolBuild.tools);
    Object program = "axgen".equals(programKind)
      ? new AxGen(AxSignature.create(signature), options)
      : "flow".equals(programKind)
        ? buildFlow(fixture)
        : Ax.agent(signature, options);
    String operation = String.valueOf(fixture.getOrDefault("operation", "components"));
    try {
      if ("verification".equals(operation)) {
        assertEqual(verificationInstrumentsSummary(), fixture.get("expected_output"), "verification instruments");
        return;
      }
      if ("components".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        if (fixture.containsKey("expected_components_subset")) assertListSubset(Core.asList(components), fixture.get("expected_components_subset"), "optimizable components");
        if (fixture.containsKey("expected_component_ids")) {
          List<Object> ids = new ArrayList<>();
          for (Object component : Core.asList(components)) ids.add(Core.asMap(component).get("id"));
          assertEqual(ids, fixture.get("expected_component_ids"), "component ids");
        }
        return;
      }
      if ("filter".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        Object filtered = Core._filter_optimization_components(components, fixture.getOrDefault("target", "all"));
        List<Object> ids = new ArrayList<>();
        for (Object component : Core.asList(filtered)) ids.add(Core.asMap(component).get("id"));
        assertEqual(ids, fixture.getOrDefault("expected_component_ids", List.of()), "filtered component ids");
        return;
      }
      if ("apply".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        Map<String, Object> artifact = Core.asMap(Core._optimized_artifact("fixture", "1", fixture.getOrDefault("component_map", Map.of()), fixture.getOrDefault("metadata", Map.of("source", "fixture"))));
        Object validated = Core._validate_optimized_artifact(artifact, components);
        Object payload = Boolean.TRUE.equals(fixture.get("serialized_artifact")) ? Core._serialize_optimized_artifact(validated) : validated;
        if ("axgen".equals(programKind)) ((AxGen) program).applyOptimization(payload);
        else if ("flow".equals(programKind)) ((AxFlow) program).applyOptimization(payload);
        else ((AxAgent) program).applyOptimization(payload);
        Object after = ((AxProgram) program).getOptimizableComponents();
        if (fixture.containsKey("expected_components_subset")) assertListSubset(Core.asList(after), fixture.get("expected_components_subset"), "optimized components");
        if (fixture.containsKey("expected_changed_components")) assertEqual(Core._optimization_changed_components(components, fixture.getOrDefault("component_map", Map.of())), fixture.get("expected_changed_components"), "changed components");
        return;
      }
      if ("artifact".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        Object artifact = Core._optimized_artifact("fixture", "1", fixture.getOrDefault("component_map", Map.of()), fixture.getOrDefault("metadata", Map.of()));
        Object validated = Core._validate_optimized_artifact(artifact, components);
        Object decoded = Core._deserialize_optimized_artifact(Core._serialize_optimized_artifact(validated), components);
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(decoded, fixture.get("expected_artifact_subset"), "optimized artifact");
        return;
      }
      if ("dataset".equals(operation)) {
        Object normalized = Core._normalize_optimization_dataset(fixture.getOrDefault("dataset", List.of()));
        assertEqual(normalized, fixture.get("expected_dataset"), "normalized dataset");
        return;
      }
      if ("playbook-empty".equals(operation)) {
        Object playbook = Core._ace_empty_playbook(fixture.get("description"), fixture.getOrDefault("now", ""));
        assertEqual(playbook, fixture.get("expected_playbook"), "ace empty playbook");
        return;
      }
      if ("playbook-render".equals(operation)) {
        Object rendered = Core._ace_render_playbook(fixture.getOrDefault("playbook", Map.of()));
        assertEqual(rendered, fixture.get("expected_render"), "ace rendered playbook");
        return;
      }
      if ("playbook-stats".equals(operation)) {
        Object playbook = Core._ace_recompute_playbook_stats(fixture.getOrDefault("playbook", Map.of()));
        assertEqual(playbook, fixture.get("expected_playbook"), "ace recomputed stats");
        return;
      }
      if ("playbook-dedupe".equals(operation)) {
        Object playbook = Core._ace_dedupe_playbook(fixture.getOrDefault("playbook", Map.of()));
        assertEqual(playbook, fixture.get("expected_playbook"), "ace deduped playbook");
        return;
      }
      if ("playbook-feedback".equals(operation)) {
        Object playbook = Core._ace_update_bullet_feedback(fixture.getOrDefault("playbook", Map.of()), fixture.getOrDefault("bullet_id", ""), fixture.getOrDefault("tag", ""), fixture.getOrDefault("now", ""));
        assertEqual(playbook, fixture.get("expected_playbook"), "ace bullet feedback");
        return;
      }
      if ("playbook-apply-ops".equals(operation)) {
        Object result = Core._ace_apply_curator_operations(fixture.getOrDefault("playbook", Map.of()), fixture.getOrDefault("operations", List.of()), fixture.getOrDefault("apply_options", Map.of()), fixture.getOrDefault("now", ""));
        assertEqual(result, fixture.get("expected_result"), "ace applied operations");
        return;
      }
      if ("ace-compile".equals(operation) || "ace-online-update".equals(operation)) {
        runAce(fixture, operation);
        return;
      }
      if ("score".equals(operation)) {
        Object scores = Core._normalize_optimization_metric_scores(fixture.get("metric_score"));
        Object scalar = Core._scalarize_optimization_scores(scores, fixture.getOrDefault("score_options", Map.of()));
        Object adjusted = Core._adjust_optimization_score_for_actions(scalar, fixture.getOrDefault("task", Map.of()), fixture.getOrDefault("prediction", Map.of("functionCalls", List.of())));
        if (fixture.containsKey("expected_scores")) assertEqual(scores, fixture.get("expected_scores"), "metric scores");
        if (fixture.containsKey("expected_scalar")) assertEqual(adjusted, fixture.get("expected_scalar"), "metric scalar");
        if (fixture.containsKey("quality")) assertEqual(Core._map_optimization_judge_quality_to_score(fixture.get("quality")), fixture.get("expected_quality_score"), "judge quality score");
        return;
      }
      if ("judge_payload".equals(operation)) {
        Object payload = Core._build_optimization_judge_payload(fixture.getOrDefault("task", Map.of()), fixture.getOrDefault("prediction", Map.of()), fixture.getOrDefault("criteria", ""));
        if (fixture.containsKey("expected_judge_payload_subset")) assertSubset(payload, fixture.get("expected_judge_payload_subset"), "judge payload");
        return;
      }
      if ("evidence".equals(operation)) {
        Object components = fixture.getOrDefault("components", ((AxProgram) program).getOptimizableComponents());
        Object evidence = Core._build_optimizer_evidence_batch(fixture.getOrDefault("eval_result", Map.of()), Core.asList(components));
        if (fixture.containsKey("expected_evidence_subset")) assertSubset(evidence, fixture.get("expected_evidence_subset"), "optimizer evidence");
        return;
      }
      if ("evaluate".equals(operation)) {
        ConformanceScriptedAI client = new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
        Map<String, Object> result = "axgen".equals(programKind)
          ? ((AxGen) program).evaluateOptimization(client, fixture.getOrDefault("dataset", List.of()), Core.asMap(fixture.getOrDefault("candidate_map", Map.of())), Core.asMap(fixture.getOrDefault("eval_options", Map.of())))
          : "flow".equals(programKind)
            ? ((AxFlow) program).evaluateOptimization(client, fixture.getOrDefault("dataset", List.of()), Core.asMap(fixture.getOrDefault("candidate_map", Map.of())), Core.asMap(fixture.getOrDefault("eval_options", Map.of())))
            : ((AxAgent) program).evaluateOptimization(client, fixture.getOrDefault("dataset", List.of()), Core.asMap(fixture.getOrDefault("candidate_map", Map.of())), Core.asMap(fixture.getOrDefault("eval_options", Map.of())));
        if (fixture.containsKey("expected_evaluation_subset")) assertSubset(result, fixture.get("expected_evaluation_subset"), "optimization evaluation");
        if (fixture.containsKey("expected_evaluation_rows_subset")) assertListSubset(Core.asList(result.getOrDefault("rows", List.of())), fixture.get("expected_evaluation_rows_subset"), "optimization evaluation rows");
        if (fixture.containsKey("expected_components_subset_after")) {
          Object after = ((AxProgram) program).getOptimizableComponents();
          assertListSubset(Core.asList(after), fixture.get("expected_components_subset_after"), "post-eval components");
        }
        return;
      }
      if ("engine".equals(operation)) {
        ScriptedOptimizerEngine engine = new ScriptedOptimizerEngine(fixture.getOrDefault("engine_response", Map.of()));
        Map<String, Object> opts = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("optimize_options", Map.of())));
        if (Boolean.TRUE.equals(fixture.get("engine_uses_evaluator"))) {
          opts.put("client", new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of()))));
        }
        Map<String, Object> artifact = "axgen".equals(programKind)
          ? ((AxGen) program).optimizeWith(engine, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts)
          : "flow".equals(programKind)
            ? ((AxFlow) program).optimizeWith(engine, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts)
            : ((AxAgent) program).optimizeWith(engine, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts);
        if (fixture.containsKey("expected_engine_request_subset")) {
          if (engine.requests.isEmpty()) throw new FixtureError("optimizer engine was not called");
          assertSubset(engine.requests.get(0), fixture.get("expected_engine_request_subset"), "optimizer engine request");
        }
        if (fixture.containsKey("expected_engine_evaluations_subset")) assertListSubset(engine.evaluations, fixture.get("expected_engine_evaluations_subset"), "optimizer engine evaluations");
        if (fixture.containsKey("expected_engine_transcripts_subset")) assertListSubset(engine.transcripts, fixture.get("expected_engine_transcripts_subset"), "optimizer engine transcripts");
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(artifact, fixture.get("expected_artifact_subset"), "optimizer artifact");
        if (fixture.containsKey("expected_components_subset")) {
          assertListSubset(((AxProgram) program).getOptimizableComponents(), fixture.get("expected_components_subset"), "optimized components");
        }
        return;
      }
      if ("bootstrap".equals(operation)) {
        List<Map<String, Object>> components = Core.asMapList(fixture.containsKey("components") ? fixture.get("components") : ((AxProgram) program).getOptimizableComponents());
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("contractVersion", "axir-optimize-v1");
        request.put("programId", programKind);
        request.put("programKind", programKind);
        request.put("components", components);
        request.put("targetComponents", components);
        request.put("dataset", Core._normalize_optimization_dataset(fixture.getOrDefault("dataset", List.of())));
        request.put("options", new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("optimize_options", Map.of()))));
        request.put("evidence", Map.of("source", "fixture"));
        AxBootstrapFewShot engine = new AxBootstrapFewShot(Core.asMap(fixture.getOrDefault("optimize_options", Map.of())));
        ScriptedGEPAEvaluator evaluator = new ScriptedGEPAEvaluator(fixture);
        Map<String, Object> artifact = engine.optimize(request, evaluator);
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(artifact, fixture.get("expected_artifact_subset"), "BootstrapFewShot artifact");
        if (fixture.containsKey("expected_demo_count")) {
          int actualDemos = Core.asList(artifact.getOrDefault("demos", List.of())).size();
          int expectedDemos = ((Number) fixture.get("expected_demo_count")).intValue();
          if (actualDemos != expectedDemos) throw new FixtureError("unexpected demo count for " + fixture.getOrDefault("name", "fixture") + ": got " + actualDemos + ", expected " + expectedDemos);
        }
        if (fixture.containsKey("expected_gepa_evaluations_subset")) assertListSubset(evaluator.evaluations, fixture.get("expected_gepa_evaluations_subset"), "BootstrapFewShot evaluations");
        return;
      }
      if ("helper".equals(operation)) {
        Map<String, Object> opts = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("optimize_options", Map.of())));
        ConformanceScriptedAI client = new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
        opts.putIfAbsent("studentAI", client);
        opts.putIfAbsent("teacherAI", client);
        Map<String, Object> artifact = "axgen".equals(programKind)
          ? Ax.optimize((AxGen) program, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts)
          : "flow".equals(programKind)
            ? Ax.optimize((AxFlow) program, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts)
            : Ax.optimize((AxAgent) program, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts);
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(artifact, fixture.get("expected_artifact_subset"), "optimize helper artifact");
        if (fixture.containsKey("expected_demo_count")) {
          int actualDemos = Core.asList(artifact.getOrDefault("demos", List.of())).size();
          int expectedDemos = ((Number) fixture.get("expected_demo_count")).intValue();
          if (actualDemos != expectedDemos) throw new FixtureError("unexpected demo count for " + fixture.getOrDefault("name", "fixture") + ": got " + actualDemos + ", expected " + expectedDemos);
        }
        if (fixture.containsKey("expected_components_subset")) assertListSubset(((AxProgram) program).getOptimizableComponents(), fixture.get("expected_components_subset"), "post-helper components");
        return;
      }
      if ("gepa".equals(operation)) {
        List<Map<String, Object>> components = Core.asMapList(fixture.containsKey("components") ? fixture.get("components") : ((AxProgram) program).getOptimizableComponents());
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("contractVersion", "axir-optimize-v1");
        request.put("programId", programKind);
        request.put("programKind", programKind);
        request.put("components", components);
        request.put("targetComponents", components);
        request.put("dataset", Core._normalize_optimization_dataset(fixture.getOrDefault("dataset", List.of())));
        request.put("options", new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("optimize_options", Map.of()))));
        request.put("evidence", Map.of("source", "fixture"));
        AiClient reflection = fixture.containsKey("reflection_responses")
          ? new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("reflection_responses", List.of())), List.of())
          : null;
        AxGEPA engine = new AxGEPA(reflection, Core.asMap(fixture.getOrDefault("gepa_options", Map.of())));
        ScriptedGEPAEvaluator evaluator = new ScriptedGEPAEvaluator(fixture);
        Map<String, Object> artifact = engine.optimize(request, evaluator);
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(artifact, fixture.get("expected_artifact_subset"), "GEPA artifact");
        if (fixture.containsKey("expected_gepa_evaluations_subset")) assertListSubset(evaluator.evaluations, fixture.get("expected_gepa_evaluations_subset"), "GEPA evaluations");
        return;
      }
      if ("eval".equals(operation)) {
        ConformanceScriptedAI client = new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
        Map<String, Object> prediction = ((AxAgent) program).evaluateOptimizationTask(client, Core.asMap(fixture.getOrDefault("task", Map.of("input", fixture.getOrDefault("input", Map.of())))), Core.asMap(fixture.getOrDefault("eval_options", Map.of())));
        if (fixture.containsKey("expected_prediction_subset")) assertSubset(prediction, fixture.get("expected_prediction_subset"), "eval prediction");
        return;
      }
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
    throw new FixtureError("unknown optimize operation " + operation);
  }

  static void runAce(Map<String, Object> fixture, String operation) {
    List<Object> reflections = new ArrayList<>(Core.asList(fixture.getOrDefault("reflection_responses", List.of())));
    List<Object> curators = new ArrayList<>(Core.asList(fixture.getOrDefault("curator_responses", List.of())));
    List<Object> predictions = new ArrayList<>(Core.asList(fixture.getOrDefault("generator_predictions", List.of())));
    List<Object> scores = new ArrayList<>(Core.asList(fixture.getOrDefault("metric_scores", List.of())));

    AxACE.Reflector reflector = payload -> reflections.isEmpty() ? null : Core.asMap(reflections.remove(0));
    AxACE.Curator curator = payload -> curators.isEmpty() ? null : Core.asMap(curators.remove(0));
    AxACE.Generator generator = example -> predictions.isEmpty() ? new LinkedHashMap<>() : Core.asMap(predictions.remove(0));

    Map<String, Object> options = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("ace_options", Map.of())));
    options.put("now", fixture.getOrDefault("now", "1970-01-01T00:00:00.000Z"));
    if (fixture.get("initial_playbook") != null) options.put("initialPlaybook", fixture.get("initial_playbook"));
    AxACE ace = new AxACE(reflector, curator, generator, options);

    java.util.function.Function<Map<String, Object>, Object> metric = args -> scores.isEmpty() ? 0 : scores.remove(0);

    if ("ace-compile".equals(operation)) {
      Map<String, Object> result = ace.compile(null, Core.asList(fixture.getOrDefault("examples", List.of())), metric, Map.of());
      if (fixture.containsKey("expected_playbook")) assertEqual(ace.getPlaybook(), fixture.get("expected_playbook"), "ace compile playbook");
      if (fixture.containsKey("expected_artifact")) assertEqual(ace.getArtifact(), fixture.get("expected_artifact"), "ace compile artifact");
      if (fixture.containsKey("expected_artifact_subset")) assertSubset(ace.getArtifact(), fixture.get("expected_artifact_subset"), "ace compile artifact");
      if (fixture.containsKey("expected_result_subset")) assertSubset(result, fixture.get("expected_result_subset"), "ace compile result");
      return;
    }

    Map<String, Object> updateArgs = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("update", Map.of())));
    if (!updateArgs.containsKey("prediction")) {
      updateArgs.put("prediction", generator.apply(Core.asMap(updateArgs.getOrDefault("example", Map.of()))));
    }
    Map<String, Object> curatorResult = ace.applyOnlineUpdate(updateArgs);
    if (fixture.containsKey("expected_playbook")) assertEqual(ace.getPlaybook(), fixture.get("expected_playbook"), "ace online playbook");
    if (fixture.containsKey("expected_artifact")) assertEqual(ace.getArtifact(), fixture.get("expected_artifact"), "ace online artifact");
    if (fixture.containsKey("expected_artifact_subset")) assertSubset(ace.getArtifact(), fixture.get("expected_artifact_subset"), "ace online artifact");
    if (fixture.containsKey("expected_curator")) assertEqual(curatorResult, fixture.get("expected_curator"), "ace online curator");
  }

  static Map<String, Object> verificationInstrumentsSummary() {
    List<Object> promptVars = new ArrayList<>(Core.asList(Core.collect_template_variable_names("Hello {{name}} and {{count}}", "verification")));
    promptVars.sort((a, b) -> String.valueOf(a).compareTo(String.valueOf(b)));
    Map<String, Object> chatRequest = new LinkedHashMap<>();
    chatRequest.put("model", "gpt-fixture");
    chatRequest.put("chat_prompt", List.of(Map.of("role", "user", "content", "hello")));
    chatRequest.put("model_config", Map.of());
    Map<String, Object> chatPayload = Core.asMap(Core.build_chat_request(null, chatRequest, Map.of()));
    Object chatResponse = Core.normalize_chat_response(Map.of(
      "id", "chat-1",
      "model", "gpt-fixture",
      "choices", List.of(Map.of("index", 0, "message", Map.of("content", "hello"), "finish_reason", "stop")),
      "usage", Map.of("prompt_tokens", 1, "completion_tokens", 2, "total_tokens", 3)
    ));
    Map<String, Object> embedPayload = Core.asMap(Core.build_embed_request(null, Map.of("embedModel", "embed-fixture", "texts", List.of("hello")), Map.of()));
    Object embedResponse = Core.normalize_embed_response(Map.of(
      "id", "embed-1",
      "model", "embed-fixture",
      "data", List.of(Map.of("embedding", List.of(0.1, 0.2))),
      "usage", Map.of("prompt_tokens", 1, "total_tokens", 1)
    ));
    Object streamResponse = Core.normalize_stream_delta(Map.of(
      "id", "stream-1",
      "model", "gpt-fixture",
      "choices", List.of(Map.of("index", 0, "delta", Map.of("content", "delta")))
    ), new LinkedHashMap<String, Object>());
    Object toolCall = Core._openai_tool_call_to_provider_impl(Map.of("id", "call-1", "function", Map.of("name", "lookup", "params", Map.of("term", "ax"))));
    Object profile = Core.provider_resolve_profile("openai");
    Core._gemini_build_transcribe_request(Map.of("audio", Map.of("data", "audio-bytes", "mimeType", "audio/wav")));
    Core._gemini_build_speak_request(Map.of("text", "speak", "voice", "Kore", "format", "wav"));
    Object geminiTranscript = Core._gemini_normalize_transcribe_response(Map.of("candidates", List.of(Map.of("content", Map.of("parts", List.of(Map.of("text", "transcript")))))));
    Object geminiSpeech = Core._gemini_normalize_speak_response(Map.of("candidates", List.of(Map.of("content", Map.of("parts", List.of(Map.of("inlineData", Map.of("data", "audio-bytes"))))))), Map.of("format", "wav"));
    Object grokTranscribe = Core._grok_build_transcribe_request(Map.of("audio", "audio-bytes", "language", "en", "prompt", "names"));
    Object grokSpeak = Core._grok_build_speak_request(Map.of("text", "speak", "voice", Map.of("id", "eve"), "format", "pcm16", "sampleRate", 16000));
    Map<String, Object> registry = new LinkedHashMap<>();
    registry.put("flags", Map.of("skillsMode", true));
    registry.put("protocol_actions", List.of(Map.of("id", "respond")));
    registry.put("runtime_globals", List.of(Map.of("id", "runtime")));
    registry.put("actor_primitives", List.of(Map.of("id", "speak", "effect", "fixture guidance", "stages", List.of("actor"), "availability_condition", "always")));
    Core._validate_policy_reserved_names(registry, "fixtureCallable");
    Object guidance = Core._render_actor_primitive_guidance(registry, "actor");
    Map<String, Object> policyState = new LinkedHashMap<>();
    Core._record_policy_event(policyState, "respond", Map.of("ok", true));
    Object policyResult = Core._normalize_policy_action_result("respond", Map.of("ok", true));
    Object descriptor = Core._program_descriptor("fixture", "core", Map.of("source", "verification"));
    Object merged = Core._flow_merge_parallel_results(Map.of("base", "keep"), Map.of("answer", "ok"));
    Map<String, Object> genMarker = new LinkedHashMap<>();
    Core._set_examples(genMarker, List.of(Map.of("input", Map.of("question", "q"), "output", Map.of("answer", "a"))));
    Core._set_demos(genMarker, List.of(Map.of("traces", List.of())));
    Object constants = Core.mcp_protocol_constants();
    Object request = Core.mcp_jsonrpc_request("1", "ping", Map.of("ok", true));
    Object notification = Core.mcp_jsonrpc_notification("progress", Map.of("pct", 1));
    Object mcpError = Core.mcp_normalize_error(Map.of("jsonrpc", "2.0", "id", "1", "error", Map.of("code", -32000, "message", "nope")));

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("promptVars", promptVars);
    out.put("chatModel", chatPayload.get("model"));
    out.put("chatContent", Core.get(Core.get(Core.get(chatResponse, "results", List.of()), 0, Map.of()), "content", null));
    out.put("embedModel", embedPayload.get("model"));
    out.put("embedCount", Core.asList(Core.get(embedResponse, "embeddings", List.of())).size());
    out.put("streamContent", Core.get(Core.get(Core.get(streamResponse, "results", List.of()), 0, Map.of()), "content", null));
    out.put("toolName", Core.get(Core.get(toolCall, "function", Map.of()), "name", null));
    out.put("profileId", Core.get(profile, "id", null));
    out.put("geminiText", Core.get(geminiTranscript, "text", null));
    out.put("geminiAudio", Core.get(geminiSpeech, "audio", null));
    out.put("grokCodec", Core.get(Core.get(grokSpeak, "output_format", Map.of()), "codec", null));
    out.put("grokFormat", Core.get(grokTranscribe, "format", null));
    out.put("policyActions", Core.asList(Core._select_protocol_actions(registry)).size());
    out.put("runtimeGlobals", Core.asList(Core._select_runtime_globals(registry)).size());
    out.put("qualityScore", Core._map_optimization_judge_quality_to_score("good"));
    out.put("policyTrace", Core.asList(Core.get(policyState, "policy_trace", List.of())).size());
    out.put("policyEffectOnly", Core.get(policyResult, "effect_only", null));
    out.put("guidance", guidance);
    out.put("programKind", Core.get(descriptor, "kind", null));
    out.put("flowAnswer", Core.get(merged, "answer", null));
    out.put("mcpVersion", Core.get(constants, "protocolVersion", null));
    out.put("mcpRequest", Core.get(request, "method", null));
    out.put("mcpNotification", Core.get(notification, "method", null));
    out.put("mcpError", Core.get(mcpError, "code", null));
    out.put("genExamples", Core.asList(Core.get(genMarker, "examples", List.of())).size());
    out.put("genDemos", Core.asList(Core.get(genMarker, "demos", List.of())).size());
    return out;
  }

  static void assertAgentTrace(AxAgent agent, Map<String, Object> fixture) {
    Map<String, Object> trace = agent.exportTrace();
    if (fixture.containsKey("expected_trace_subset")) assertSubset(trace, fixture.get("expected_trace_subset"), "agent trace");
    if (fixture.containsKey("expected_trace_event_kinds")) {
      List<Object> kinds = new ArrayList<>();
      for (Object rawEvent : Core.asList(trace.getOrDefault("events", List.of()))) {
        kinds.add(Core.asMap(rawEvent).get("kind"));
      }
      assertEqual(kinds, fixture.get("expected_trace_event_kinds"), "agent trace event kinds");
    }
    if (Boolean.TRUE.equals(fixture.get("replay_trace"))) {
      Map<String, Object> replayFixtures = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("replay_fixtures", Map.of())));
      if (fixture.containsKey("expected_trace_event_kinds") && !replayFixtures.containsKey("expected_event_kinds")) replayFixtures.put("expected_event_kinds", fixture.get("expected_trace_event_kinds"));
      if (fixture.containsKey("expected_output") && !replayFixtures.containsKey("expected_output")) replayFixtures.put("expected_output", fixture.get("expected_output"));
      Map<String, Object> replayed = agent.replayTrace(trace, replayFixtures);
      if (fixture.containsKey("expected_replay_result_subset")) assertSubset(replayed, fixture.get("expected_replay_result_subset"), "agent replay");
      else assertSubset(replayed, Map.of("ok", true, "status", "replayed"), "agent replay");
    }
  }

  // Prompt-parity gate (G3): build a real agent and assert the RLM stage instructions
  // were rendered into agent state. A hollow agent has empty description keys, so this
  // fails -- catching the defect that slipped a non-functional agent() past every gate.
  static void runAgentPrompt(Map<String, Object> fixture) {
    AxAgent agent = Ax.agent(
      String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string")),
      Core.asMap(fixture.getOrDefault("options", Map.of())));
    Map<String, Object> state = agent.state;
    Map<String, Object> expects = Core.asMap(fixture.getOrDefault("expected_description_contains", Map.of()));
    for (Map.Entry<String, Object> entry : expects.entrySet()) {
      String field = entry.getKey();
      if (field.equals("__order")) continue;
      Object descObj = state.get(field);
      String desc = descObj instanceof String ? (String) descObj : "";
      if (desc.strip().isEmpty()) {
        throw new RuntimeException("agent stage description " + field + " is empty; RLM prompt was not rendered into agent state");
      }
      for (Object needleObj : Core.asList(entry.getValue())) {
        String needle = String.valueOf(needleObj);
        if (!desc.contains(needle)) {
          throw new RuntimeException("agent stage description " + field + " missing \"" + needle + "\": " + desc);
        }
      }
    }
  }

  static void runAgentPlaybookCoverage(Map<String, Object> fixture) {
    for (Object rawCase : Core.asList(fixture.getOrDefault("cases", List.of()))) {
      Map<String, Object> testCase = Core.asMap(rawCase);
      Object actual = Core._agent_collect_covered_failure_signatures(testCase.getOrDefault("snapshot", Map.of()));
      assertEqual(actual, testCase.getOrDefault("expected_covered", List.of()), "playbook coverage " + testCase.get("name"));
    }
  }

  static void runAgentPlaybookEvolve(Map<String, Object> fixture) {
    List<Object> sourceResponses = Core.asList(fixture.getOrDefault("responses", List.of()));
    Object scriptedResponse = sourceResponses.isEmpty() ? Map.of() : sourceResponses.get(0);
    for (Object rawCase : Core.asList(fixture.getOrDefault("cases", List.of()))) {
      Map<String, Object> testCase = Core.asMap(rawCase);
      List<Object> responses = new ArrayList<>();
      for (int i = 0; i < 32; i++) responses.add(scriptedResponse);
      ConformanceScriptedAI client = new ConformanceScriptedAI(responses, List.of());
      ScriptedCodeRuntime runtime = new ScriptedCodeRuntime(
          Core.asList(fixture.getOrDefault("runtime_script", List.of())),
          String.valueOf(fixture.getOrDefault("runtime_language", "Python")),
          "");
      Map<String, Object> agentOptions = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
      agentOptions.put("runtime", runtime);
      AxAgent agent = Ax.agent(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string")), agentOptions);
      Map<String, Object> playbookOptions = new LinkedHashMap<>();
      playbookOptions.put("target", "responder");
      playbookOptions.put("studentAI", client);
      playbookOptions.put("teacherAI", client);
      playbookOptions.put("maxEpochs", 1);
      AxPlaybook playbook = agent.playbook(playbookOptions);
      if (fixture.get("seed") instanceof Map<?, ?>) playbook.load(Core.asMap(fixture.get("seed")));
      String before = Json.stringify(playbook.toJson());
      Map<String, Object> actual = playbook.evolve(
          fixture.getOrDefault("dataset", Map.of()),
          Core.asMap(testCase.getOrDefault("options", Map.of())));
      List<Object> outcomes = Core.asList(actual.getOrDefault("outcomes", List.of()));
      if (outcomes.isEmpty()) throw new FixtureError("playbook evolve " + testCase.get("name") + " produced no outcome: " + Json.stringify(actual));
      Map<String, Object> outcome = Core.asMap(outcomes.get(0));
      Map<String, Object> expected = Core.asMap(testCase.getOrDefault("expected", Map.of()));
      String label = "playbook evolve " + testCase.get("name");
      if (expected.containsKey("accepted")) assertEqual(outcome.get("accepted"), expected.get("accepted"), label + " accepted");
      if (expected.containsKey("metricCallsUsed")) assertEqual(actual.get("metricCallsUsed"), expected.get("metricCallsUsed"), label + " metric calls");
      if (expected.containsKey("heldIn")) assertSubset(outcome.getOrDefault("heldIn", Map.of()), expected.get("heldIn"), label + " held-in");
      if (expected.containsKey("reason_contains") && !String.valueOf(outcome.getOrDefault("reason", "")).contains(String.valueOf(expected.get("reason_contains")))) {
        throw new FixtureError(label + " reason missing " + expected.get("reason_contains") + ": " + Json.stringify(outcome));
      }
      Map<String, Object> afterState = playbook.toJson();
      if (Boolean.TRUE.equals(testCase.get("expected_rollback"))) assertEqual(Json.stringify(afterState), before, label + " byte-exact rollback");
      if (testCase.containsKey("expected_exported_state_subset")) assertSubset(afterState, testCase.get("expected_exported_state_subset"), label + " exported state");
    }
  }

  static void runAgentForward(Map<String, Object> fixture) {
    ConformanceScriptedAI client = new ConformanceScriptedAI(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
    client.transcribeResponses.addAll(Core.asList(fixture.getOrDefault("transcribe_responses", List.of())));
    Map<String, Object> agentOptions = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
    java.util.concurrent.atomic.AtomicBoolean observerCalled = new java.util.concurrent.atomic.AtomicBoolean(false);
    if (Boolean.TRUE.equals(fixture.get("observer_throws"))) {
      Map<String, Object> citations = new LinkedHashMap<>(Core.asMap(agentOptions.getOrDefault("citations", Map.of())));
      citations.put("onCitations", (java.util.function.Consumer<List<Object>>) ignored -> {
        observerCalled.set(true);
        throw new RuntimeException("citation observer failed");
      });
      agentOptions.put("citations", citations);
    }
    if (agentOptions.get("playbook") instanceof Map<?, ?> rawPlaybook) {
      Map<String, Object> playbook = new LinkedHashMap<>(Core.asMap(rawPlaybook));
      playbook.putIfAbsent("studentAI", client);
      agentOptions.put("playbook", playbook);
    }
    ScriptedCodeRuntime runtime = null;
    if (fixture.containsKey("runtime_script")) {
      Map<String, Object> runtimeConfig = Core.asMap(agentOptions.getOrDefault("runtime", Map.of()));
      runtime = new ScriptedCodeRuntime(
        Core.asList(fixture.getOrDefault("runtime_script", List.of())),
        String.valueOf(runtimeConfig.getOrDefault("language", fixture.getOrDefault("runtime_language", "JavaScript"))),
        String.valueOf(runtimeConfig.getOrDefault("usageInstructions", runtimeConfig.getOrDefault("usage_instructions", "")))
      );
      agentOptions.put("runtime", runtime);
    }
    if (fixture.containsKey("runtime_engine")) {
      try {
        Object qjs = Class.forName("dev.axllm.ax.runtime.quickjs.AxQuickJsCodeRuntime").getDeclaredConstructor().newInstance();
        agentOptions.put("runtime", qjs);
      } catch (ReflectiveOperationException e) {
        throw new RuntimeException("agent_runtime_real requires the quickjs profile (dev.axllm.ax.runtime.quickjs.AxQuickJsCodeRuntime) and quickjs4j on the classpath: " + e);
      }
    }
    AxAgent agent = null;
    try {
      agent = Ax.agent(String.valueOf(fixture.get("signature")), agentOptions);
      if (fixture.containsKey("set_instruction")) agent.setInstruction(String.valueOf(fixture.get("set_instruction")));
      if (fixture.containsKey("add_actor_instruction")) agent.addActorInstruction(String.valueOf(fixture.get("add_actor_instruction")));
      if (fixture.containsKey("set_state")) agent.setState(Core.asMap(fixture.get("set_state")));
      if (fixture.containsKey("restore_runtime_state")) agent.restoreRuntimeState(Core.asMap(fixture.get("restore_runtime_state")));
      Object output = agent.forward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), Core.asMap(fixture.getOrDefault("forward_options", Map.of())));
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected agent forward to fail");
      if (fixture.containsKey("expected_output")) assertEqual(output, fixture.get("expected_output"), "agent output");
      if (Boolean.TRUE.equals(fixture.get("observer_throws")) && !observerCalled.get()) throw new FixtureError("citation observer was not called");
    } catch (AxAgentClarificationException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected == null || !String.valueOf(e.getMessage()).contains(expected)) throw e;
      if (fixture.containsKey("expected_clarification")) assertSubset(e.clarification(), fixture.get("expected_clarification"), "clarification");
      if (agent != null) assertAgentTrace(agent, fixture);
      return;
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) {
        if (agent != null) assertAgentTrace(agent, fixture);
        return;
      }
      throw e;
    }
    if (fixture.containsKey("expected_request_count") && client.requests.size() != Core.asInt(fixture.get("expected_request_count"))) throw new FixtureError("expected agent request count mismatch");
    if (fixture.containsKey("expected_request_contains")) {
      String text = Json.stringify(client.requests);
      for (Object item : Core.asList(fixture.get("expected_request_contains"))) if (!text.contains(String.valueOf(item))) throw new FixtureError("agent request missing " + item + ": " + text);
    }
    if (fixture.containsKey("expected_stage_request_not_contains")) {
      for (Object raw : Core.asList(fixture.get("expected_stage_request_not_contains"))) {
        Map<String, Object> spec = Core.asMap(raw);
        int index = Core.asInt(spec.getOrDefault("index", 0));
        String text = index < client.requests.size() ? Json.stringify(client.requests.get(index)) : "";
        for (Object item : Core.asList(spec.getOrDefault("absent", List.of()))) if (text.contains(String.valueOf(item))) throw new FixtureError("agent request " + index + " unexpectedly contained " + item + ": " + text);
      }
    }
    if (fixture.containsKey("expected_cached_request_indices")) {
      for (Object rawIndex : Core.asList(fixture.get("expected_cached_request_indices"))) {
        int index = Core.asInt(rawIndex);
        if (index >= client.requests.size()) throw new FixtureError("missing cached request index " + index);
        boolean hasCache = false;
        for (Object rawMessage : Core.asList(client.requests.get(index).get("chat_prompt"))) {
          if (Boolean.TRUE.equals(Core.asMap(rawMessage).get("cache"))) {
            hasCache = true;
            break;
          }
        }
        if (!hasCache) throw new FixtureError("agent request " + index + " did not contain a cached prompt message");
      }
    }
    if (fixture.containsKey("expected_chat_log_subset")) assertListSubset(agent.getChatLog(), fixture.get("expected_chat_log_subset"), "agent chat log");
    if (fixture.containsKey("expected_state")) assertSubset(agent.getState(), fixture.get("expected_state"), "agent state");
    Map<String, Object> exported = agent.exportRuntimeState();
    if (fixture.containsKey("expected_runtime_contract_subset")) assertSubset(agent.getRuntimeContract(), fixture.get("expected_runtime_contract_subset"), "runtime contract");
    if (fixture.containsKey("expected_exported_state_subset")) assertSubset(exported, fixture.get("expected_exported_state_subset"), "runtime state");
    if (fixture.containsKey("expected_context_events_subset")) assertListSubset(Core.asList(exported.get("context_events")), fixture.get("expected_context_events_subset"), "agent context events");
    if (fixture.containsKey("expected_action_log_subset")) assertListSubset(Core.asList(exported.get("action_log")), fixture.get("expected_action_log_subset"), "action log");
    if (runtime != null && fixture.containsKey("expected_executed")) assertEqual(runtime.executed, fixture.get("expected_executed"), "executed code");
    assertAgentTrace(agent, fixture);
  }

  static void runAgentRuntimePolicy(Map<String, Object> fixture) {
    AxAgent agent = null;
    try {
      agent = Ax.agent(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string")), Core.asMap(fixture.getOrDefault("options", Map.of())));
      if (fixture.containsKey("set_signature")) agent.setSignature(fixture.get("set_signature"));
      if (fixture.containsKey("discover")) {
        Object discoverValue = fixture.getOrDefault("discover", Map.of());
        Object result = agent.discover(discoverValue instanceof Map<?, ?> ? Core.asMap(discoverValue) : new LinkedHashMap<>(Map.of("tools", discoverValue)));
        if (fixture.containsKey("expected_discover_result")) assertEqual(result, fixture.get("expected_discover_result"), "discover result");
      }
      if (fixture.containsKey("recall")) {
        Object result = agent.recall(fixture.getOrDefault("recall", List.of()));
        if (fixture.containsKey("expected_recall_result")) assertEqual(result, fixture.get("expected_recall_result"), "recall result");
      }
      if (fixture.containsKey("used")) {
        Map<String, Object> used = Core.asMap(fixture.get("used"));
        Object result = agent.used(String.valueOf(used.get("id")), String.valueOf(used.getOrDefault("reason", "")), String.valueOf(used.getOrDefault("stage", "executor")));
        if (fixture.containsKey("expected_used_result")) assertEqual(result, fixture.get("expected_used_result"), "used result");
      }
      if (fixture.containsKey("invoke_callable")) {
        Map<String, Object> call = Core.asMap(fixture.get("invoke_callable"));
        Object result = agent.invokeCallable(String.valueOf(call.getOrDefault("qualified_name", call.get("name"))), Core.asMap(call.getOrDefault("args", Map.of())));
        if (fixture.containsKey("expected_callable_result_subset")) assertSubset(result, fixture.get("expected_callable_result_subset"), "callable result");
      }
      if (fixture.containsKey("replay_trace_input")) {
        Object result = agent.replayTrace(fixture.getOrDefault("replay_trace_input", Map.of()), Core.asMap(fixture.getOrDefault("replay_fixtures", Map.of())));
        if (fixture.containsKey("expected_replay_result_subset")) assertSubset(result, fixture.get("expected_replay_result_subset"), "agent replay");
      }
      if (fixture.containsKey("restore_runtime_state")) agent.restoreRuntimeState(Core.asMap(fixture.get("restore_runtime_state")));
      if (fixture.containsKey("context_operation")) {
        Object result = Core._agent_context_fixture_result(agent.state, fixture);
        if (fixture.containsKey("expected_context_result")) assertEqual(result, fixture.get("expected_context_result"), "agent context result");
        if (fixture.containsKey("expected_context_result_subset")) assertSubset(result, fixture.get("expected_context_result_subset"), "agent context result");
        if (fixture.containsKey("expected_context_events_subset")) {
          Map<String, Object> contextResult = Core.asMap(result);
          Map<String, Object> exportedContext = Core.asMap(contextResult.getOrDefault("exported", Map.of()));
          assertListSubset(Core.asList(exportedContext.get("context_events")), fixture.get("expected_context_events_subset"), "agent context events");
        }
      }
      if (fixture.containsKey("final_payload")) assertEqual(Core._normalize_agent_final_payload(fixture.get("final_payload")), fixture.get("expected_final_payload"), "final payload");
      if (fixture.containsKey("clarification_payload")) assertEqual(Core._normalize_agent_clarification_payload(fixture.get("clarification_payload")), fixture.get("expected_clarification_payload"), "clarification payload");
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
    if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected agent runtime policy fixture to fail");
    if (fixture.containsKey("expected_runtime_contract_subset")) assertSubset(agent.getRuntimeContract(), fixture.get("expected_runtime_contract_subset"), "runtime contract");
    if (fixture.containsKey("expected_policy_subset")) assertSubset(agent.getPolicy(), fixture.get("expected_policy_subset"), "agent policy");
    if (fixture.containsKey("expected_policy_registry_subset")) assertSubset(agent.getPolicyRegistry(), fixture.get("expected_policy_registry_subset"), "policy registry");
    if (fixture.containsKey("expected_state_subset")) assertSubset(agent.getState(), fixture.get("expected_state_subset"), "agent state");
    Map<String, Object> registry = agent.getPolicyRegistry();
    if (fixture.containsKey("expected_actor_primitives_subset")) assertListSubset(Core.asList(registry.get("actor_primitives")), fixture.get("expected_actor_primitives_subset"), "actor primitives");
    if (fixture.containsKey("expected_protocol_actions_subset")) assertListSubset(Core.asList(registry.get("protocol_actions")), fixture.get("expected_protocol_actions_subset"), "protocol actions");
    if (fixture.containsKey("expected_runtime_globals_subset")) assertListSubset(Core.asList(registry.get("runtime_globals")), fixture.get("expected_runtime_globals_subset"), "runtime globals");
    if (fixture.containsKey("expected_host_boundaries_subset")) assertListSubset(Core.asList(registry.get("host_boundaries")), fixture.get("expected_host_boundaries_subset"), "host boundaries");
    if (fixture.containsKey("expected_callable_inventory_subset")) assertListSubset(agent.getCallableInventory(), fixture.get("expected_callable_inventory_subset"), "callable inventory");
    if (fixture.containsKey("expected_discovery_catalog_subset")) assertListSubset(agent.getDiscoveryCatalog(), fixture.get("expected_discovery_catalog_subset"), "discovery catalog");
    Map<String, Object> exported = agent.exportRuntimeState();
    if (fixture.containsKey("expected_discovered_tool_docs_subset")) assertListSubset(Core.asList(exported.get("discovered_tool_docs")), fixture.get("expected_discovered_tool_docs_subset"), "discovered tools");
    if (fixture.containsKey("expected_loaded_skill_docs_subset")) assertListSubset(Core.asList(exported.get("loaded_skill_docs")), fixture.get("expected_loaded_skill_docs_subset"), "loaded skills");
    if (fixture.containsKey("expected_loaded_memories_subset")) assertListSubset(Core.asList(exported.get("loaded_memories")), fixture.get("expected_loaded_memories_subset"), "loaded memories");
    if (fixture.containsKey("expected_used_memories_subset")) assertListSubset(Core.asList(exported.get("used_memories")), fixture.get("expected_used_memories_subset"), "used memories");
    if (fixture.containsKey("expected_used_skills_subset")) assertListSubset(Core.asList(exported.get("used_skills")), fixture.get("expected_used_skills_subset"), "used skills");
    if (fixture.containsKey("expected_guidance_log_subset")) assertListSubset(Core.asList(exported.get("guidance_log")), fixture.get("expected_guidance_log_subset"), "guidance log");
    if (fixture.containsKey("expected_function_call_traces_subset")) assertListSubset(Core.asList(exported.get("function_call_traces")), fixture.get("expected_function_call_traces_subset"), "function call traces");
    if (fixture.containsKey("expected_policy_trace_subset")) assertListSubset(Core.asList(exported.get("policy_trace")), fixture.get("expected_policy_trace_subset"), "policy trace");
    if (fixture.containsKey("expected_exported_state_subset")) assertSubset(exported, fixture.get("expected_exported_state_subset"), "exported runtime state");
    if (fixture.containsKey("expected_optimizer_metadata_subset")) assertSubset(agent.getOptimizerMetadata(), fixture.get("expected_optimizer_metadata_subset"), "optimizer metadata");
    assertAgentTrace(agent, fixture);
  }

	  static void runAgentRuntimeSession(Map<String, Object> fixture) {
    AxAgent agent = Ax.agent(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string")), Core.asMap(fixture.getOrDefault("options", Map.of())));
    ScriptedCodeRuntime runtime = new ScriptedCodeRuntime(
      Core.asList(fixture.getOrDefault("runtime_script", List.of())),
      "JavaScript",
      "",
      Core.asMap(fixture.getOrDefault("runtime_capabilities", Map.of()))
	    );
	    Object result = null;
	    boolean caughtExpectedError = false;
	    try {
      String operation = String.valueOf(fixture.getOrDefault("operation", "test"));
      if ("test".equals(operation)) {
        result = agent.test(runtime, String.valueOf(fixture.getOrDefault("code", "")), Core.asMap(fixture.getOrDefault("context_values", fixture.getOrDefault("input", Map.of()))), Core.asMap(fixture.getOrDefault("runtime_options", Map.of())));
      } else if ("steps".equals(operation)) {
        for (Object rawStep : Core.asList(fixture.getOrDefault("steps", List.of()))) {
          Map<String, Object> step = Core.asMap(rawStep);
          if (step.containsKey("restore_session_state")) agent.restoreSessionState(step.get("restore_session_state"));
          result = agent.executeActorStep(runtime, String.valueOf(step.getOrDefault("code", "")), Core.asMap(step.getOrDefault("values", fixture.getOrDefault("context_values", fixture.getOrDefault("input", Map.of())))), Core.asMap(step.getOrDefault("options", Map.of())));
          if (Boolean.TRUE.equals(step.get("inspect"))) agent.inspectRuntime();
          if (Boolean.TRUE.equals(step.get("export_session_state"))) agent.exportSessionState();
        }
        if (Boolean.TRUE.equals(fixture.get("close_runtime_session"))) agent.closeRuntimeSession();
      } else if ("reserved".equals(operation)) {
        result = agent.test(runtime, String.valueOf(fixture.getOrDefault("code", "")), Core.asMap(fixture.getOrDefault("context_values", Map.of())), Map.of());
      } else {
        throw new FixtureError("unknown agent runtime session operation " + operation);
      }
	    } catch (RuntimeException e) {
	      String expected = (String) fixture.get("expected_error_contains");
	      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) {
	        caughtExpectedError = true;
	        result = null;
	      } else {
	        throw e;
	      }
	    }
	    if (fixture.containsKey("expected_error_contains") && !caughtExpectedError) throw new FixtureError("expected agent runtime session fixture to fail");
    if (fixture.containsKey("expected_result_subset")) assertSubset(result, fixture.get("expected_result_subset"), "runtime result");
    if (fixture.containsKey("expected_result")) assertEqual(result, fixture.get("expected_result"), "runtime result");
    Map<String, Object> exported = agent.exportRuntimeState();
    if (fixture.containsKey("expected_exported_state_subset")) assertSubset(exported, fixture.get("expected_exported_state_subset"), "runtime state");
    if (fixture.containsKey("expected_action_log_subset")) assertListSubset(Core.asList(exported.get("action_log")), fixture.get("expected_action_log_subset"), "action log");
    if (fixture.containsKey("expected_status_log_subset")) assertListSubset(Core.asList(exported.get("status_log")), fixture.get("expected_status_log_subset"), "status log");
	    if (fixture.containsKey("expected_session_count") && runtime.sessions.size() != Core.asInt(fixture.get("expected_session_count"))) throw new FixtureError("expected session count mismatch");
	    if (fixture.containsKey("expected_closed_session_count")) {
	      int closedCount = 0;
	      for (ScriptedCodeSession session : runtime.sessions) if (session.closed) closedCount++;
	      if (closedCount != Core.asInt(fixture.get("expected_closed_session_count"))) throw new FixtureError("expected closed session count mismatch");
	    }
    if (fixture.containsKey("expected_executed")) assertEqual(runtime.executed, fixture.get("expected_executed"), "executed code");
    if (fixture.containsKey("expected_create_globals_subset")) {
      if (runtime.createRequests.isEmpty()) throw new FixtureError("expected at least one runtime create_session request");
      assertSubset(Core.asMap(runtime.createRequests.get(runtime.createRequests.size() - 1).get("globals")), fixture.get("expected_create_globals_subset"), "runtime create globals");
    }
    if (fixture.containsKey("expected_create_options_subset")) {
      if (runtime.createRequests.isEmpty()) throw new FixtureError("expected at least one runtime create_session request");
      assertSubset(Core.asMap(runtime.createRequests.get(runtime.createRequests.size() - 1).get("options")), fixture.get("expected_create_options_subset"), "runtime create options");
    }
    if (fixture.containsKey("expected_execute_options_subset")) {
      if (runtime.executeOptions.isEmpty()) throw new FixtureError("expected at least one runtime execute request");
      assertSubset(runtime.executeOptions.get(runtime.executeOptions.size() - 1), fixture.get("expected_execute_options_subset"), "runtime execute options");
    }
    if (fixture.containsKey("expected_runtime_inspection")) assertEqual(exported.get("runtime_inspection"), fixture.get("expected_runtime_inspection"), "runtime inspection");
    if (fixture.containsKey("expected_runtime_inspection_contains")) {
      String actualInspection = String.valueOf(exported.get("runtime_inspection"));
      if (!actualInspection.contains(String.valueOf(fixture.get("expected_runtime_inspection_contains")))) {
        throw new FixtureError("runtime inspection expected to contain " + fixture.get("expected_runtime_inspection_contains") + ", got " + actualInspection);
      }
    }
    if (fixture.containsKey("expected_absent_runtime_session_globals")) {
      Map<String, Object> globals = Core.asMap(Core.get(Core.get(agent.state, "runtime_session_state", Map.of()), "globals", Map.of()));
      for (Object key : Core.asList(fixture.get("expected_absent_runtime_session_globals"))) {
        if (globals.containsKey(String.valueOf(key))) throw new FixtureError("runtime session globals unexpectedly contained " + key);
      }
    }
	    assertAgentTrace(agent, fixture);
	  }

	  static Object runtimeAdapterCall(Map<String, Object> spec) {
	    String name = String.valueOf(spec.get("name"));
	    List<Object> args = Core.asList(spec.getOrDefault("args", List.of()));
	    Map<String, Object> kwargs = Core.asMap(spec.getOrDefault("kwargs", Map.of()));
	    return switch (name) {
	      case "result" -> AxRuntimeEnvelope.result(args.isEmpty() ? null : args.get(0));
	      case "error" -> AxRuntimeEnvelope.error(args.isEmpty() ? "" : String.valueOf(args.get(0)), args.size() > 1 ? String.valueOf(args.get(1)) : String.valueOf(kwargs.getOrDefault("category", "runtime")));
	      case "session_closed" -> AxRuntimeEnvelope.sessionClosed(args.isEmpty() ? "session closed" : String.valueOf(args.get(0)));
	      case "timeout" -> AxRuntimeEnvelope.timeout(args.isEmpty() ? "execution timed out" : String.valueOf(args.get(0)));
	      case "final" -> AxRuntimeEnvelope.finalPayload(args.toArray());
	      case "ask_clarification" -> AxRuntimeEnvelope.askClarification(args.toArray());
	      case "discover" -> AxRuntimeEnvelope.discover(args.isEmpty() ? Map.of() : args.get(0));
	      case "recall" -> AxRuntimeEnvelope.recall(args.isEmpty() ? List.of() : args.get(0));
	      case "used" -> {
	        if (args.isEmpty()) yield AxRuntimeEnvelope.used(Map.of());
	        Object raw = args.get(0);
	        String id = String.valueOf(raw instanceof String ? raw : Core.asMap(raw).getOrDefault("id", raw));
	        yield AxRuntimeEnvelope.used(id, (String) kwargs.get("reason"), (String) kwargs.get("stage"));
	      }
	      case "status" -> AxRuntimeEnvelope.status(args.isEmpty() ? "success" : String.valueOf(args.get(0)), args.size() > 1 ? String.valueOf(args.get(1)) : "");
	      case "guide_agent" -> AxRuntimeEnvelope.guideAgent(args.isEmpty() ? "" : String.valueOf(args.get(0)), args.size() > 1 ? String.valueOf(args.get(1)) : null);
	      default -> throw new FixtureError("unknown runtime adapter helper " + name);
	    };
	  }

  static void runAgentRuntimeAdapter(Map<String, Object> fixture) {
	    if (fixture.containsKey("capabilities")) {
	      Map<String, Object> raw = Core.asMap(fixture.get("capabilities"));
	      AxRuntimeCapabilities capabilities = new AxRuntimeCapabilities()
	        .inspect(Core.truthy(raw.getOrDefault("inspect", true)))
	        .snapshot(Core.truthy(raw.getOrDefault("snapshot", true)))
	        .patch(Core.truthy(raw.getOrDefault("patch", true)))
	        .abort(Core.truthy(raw.getOrDefault("abort", false)))
	        .language(String.valueOf(raw.getOrDefault("language", "JavaScript")))
	        .usageInstructions(String.valueOf(raw.getOrDefault("usage_instructions", "")));
	      if (fixture.containsKey("expected_capabilities")) assertSubset(capabilities.toMap(), fixture.get("expected_capabilities"), "runtime capabilities");
	    }
	    for (Object rawSpec : Core.asList(fixture.getOrDefault("helper_calls", List.of()))) {
	      Map<String, Object> spec = Core.asMap(rawSpec);
	      Object actual = runtimeAdapterCall(spec);
	      if (spec.containsKey("expected")) assertEqual(actual, spec.get("expected"), "runtime helper " + spec.get("name"));
	      if (spec.containsKey("expected_subset")) assertSubset(actual, spec.get("expected_subset"), "runtime helper " + spec.get("name"));
	      if (Boolean.TRUE.equals(spec.get("normalize"))) {
	        Object normalized = Core._normalize_agent_runtime_step_result(actual, spec.getOrDefault("code", "<adapter>"));
	        if (spec.containsKey("expected_normalized_subset")) assertSubset(normalized, spec.get("expected_normalized_subset"), "normalized runtime helper " + spec.get("name"));
	      }
	    }
	    if (fixture.containsKey("run_session")) {
	      Map<String, Object> sessionFixture = new LinkedHashMap<>();
	      sessionFixture.put("signature", fixture.getOrDefault("signature", "question:string -> answer:string"));
	      sessionFixture.put("operation", "test");
	      sessionFixture.put("code", "adapter()");
	      sessionFixture.put("context_values", fixture.getOrDefault("context_values", Map.of("question", "adapter")));
	      sessionFixture.put("runtime_script", List.of(Map.of("expected_code", "adapter()", "result", runtimeAdapterCall(Core.asMap(fixture.get("run_session"))))));
	      if (fixture.containsKey("expected_result_subset")) sessionFixture.put("expected_result_subset", fixture.get("expected_result_subset"));
	      if (fixture.containsKey("expected_action_log_subset")) sessionFixture.put("expected_action_log_subset", fixture.get("expected_action_log_subset"));
	      if (fixture.containsKey("expected_trace_event_kinds")) sessionFixture.put("expected_trace_event_kinds", fixture.get("expected_trace_event_kinds"));
	      if (fixture.containsKey("expected_closed_session_count")) sessionFixture.put("expected_closed_session_count", fixture.get("expected_closed_session_count"));
	      runAgentRuntimeSession(sessionFixture);
    }
  }

  static AxProcessCodeRuntime runtimeProtocolRuntime(String mode) {
    String javaBin = System.getProperty("java.home") + File.separator + "bin" + File.separator + "java";
    String classPath = System.getProperty("java.class.path");
    return new AxProcessCodeRuntime(
      List.of(javaBin, "-cp", classPath, "dev.axllm.ax.Conformance", "--runtime-protocol-fixture-server"),
      null,
      Map.of("AXIR_RUNTIME_PROTOCOL_FIXTURE_MODE", mode == null ? "normal" : mode)
    );
  }

  static void runAgentRuntimeProtocol(Map<String, Object> fixture) {
    AxProcessCodeRuntime runtime = runtimeProtocolRuntime(String.valueOf(fixture.getOrDefault("mode", "normal")));
    AxCodeSession session = null;
    try {
      String operation = String.valueOf(fixture.getOrDefault("operation", "roundtrip"));
      if ("roundtrip".equals(operation)) {
        Map<String, Object> capabilities = Json.asObject(runtime.request("capabilities", null, Map.of(), true).get("result"));
        if (fixture.containsKey("expected_capabilities_subset")) assertSubset(capabilities, fixture.get("expected_capabilities_subset"), "protocol capabilities");
        session = runtime.createSession(Core.asMap(fixture.getOrDefault("create_globals", Map.of())), Core.asMap(fixture.getOrDefault("create_options", Map.of())));
        Object result = session.execute(String.valueOf(fixture.getOrDefault("execute_code", "final()")), Core.asMap(fixture.getOrDefault("execute_options", Map.of())));
        if (fixture.containsKey("expected_execute_subset")) assertSubset(result, fixture.get("expected_execute_subset"), "protocol execute");
        Object inspected = session.inspectGlobals(Map.of());
        if (fixture.containsKey("expected_inspect_subset")) assertSubset(inspected, fixture.get("expected_inspect_subset"), "protocol inspect");
        Object snapshot = session.snapshotGlobals(Map.of());
        if (fixture.containsKey("expected_snapshot_subset")) assertSubset(snapshot, fixture.get("expected_snapshot_subset"), "protocol snapshot");
        Object patched = session.patchGlobals(fixture.getOrDefault("patch_globals", Map.of()), Map.of());
        if (fixture.containsKey("expected_patch_subset")) assertSubset(patched, fixture.get("expected_patch_subset"), "protocol patch");
        Object closed = session.close();
        if (fixture.containsKey("expected_close_subset")) assertSubset(closed, fixture.get("expected_close_subset"), "protocol close");
        return;
      }
      if ("execute_error".equals(operation)) {
        session = runtime.createSession(Core.asMap(fixture.getOrDefault("create_globals", Map.of())), Core.asMap(fixture.getOrDefault("create_options", Map.of())));
        Object result = session.execute(String.valueOf(fixture.getOrDefault("execute_code", "timeout()")), Core.asMap(fixture.getOrDefault("execute_options", Map.of())));
        if (fixture.containsKey("expected_execute_subset")) assertSubset(result, fixture.get("expected_execute_subset"), "protocol execute error");
        return;
      }
      if ("unknown_op".equals(operation)) {
        runtime.request("unknown_op", null, Map.of(), true);
        throw new FixtureError("expected unknown protocol op to fail");
      }
      if ("capabilities_error".equals(operation)) {
        runtime.request("capabilities", null, Map.of(), true);
        throw new FixtureError("expected protocol capabilities request to fail");
      }
      if ("unavailable".equals(operation)) {
        session = runtime.createSession(Core.asMap(fixture.getOrDefault("create_globals", Map.of())), Core.asMap(fixture.getOrDefault("create_options", Map.of())));
        String method = String.valueOf(fixture.getOrDefault("method", "inspect_globals"));
        if ("snapshot_globals".equals(method)) session.snapshotGlobals(Map.of());
        else if ("patch_globals".equals(method)) session.patchGlobals(Map.of(), Map.of());
        else session.inspectGlobals(Map.of());
        throw new FixtureError("expected unavailable protocol method to fail");
      }
      if ("session_mismatch".equals(operation)) {
        session = runtime.createSession(Core.asMap(fixture.getOrDefault("create_globals", Map.of())), Core.asMap(fixture.getOrDefault("create_options", Map.of())));
        runtime.request("execute", "s1", Map.of("code", fixture.getOrDefault("execute_code", "final()"), "options", Map.of()), true);
        throw new FixtureError("expected protocol session mismatch to fail");
      }
      throw new FixtureError("unknown runtime protocol operation " + operation);
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    } finally {
      try { if (session != null) session.close(); } catch (RuntimeException ignored) {}
      runtime.close();
    }
  }

	  static void runAIChat(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    Object result;
    try { result = cf.client.chat(Core.asMap(fixture.get("request"))); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai chat output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIEmbed(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    Object result;
    try { result = cf.client.embed(Core.asMap(fixture.get("request"))); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai embed output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIStream(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    List<Object> result = new ArrayList<>();
    try { for (Object item : cf.client.stream(Core.asMap(fixture.get("request")))) result.add(item); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai stream output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIError(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    try {
      String method = String.valueOf(fixture.getOrDefault("method", "chat"));
      if ("stream".equals(method)) for (Object ignored : cf.client.stream(Core.asMap(fixture.get("request")))) {}
      else if ("embed".equals(method)) cf.client.embed(Core.asMap(fixture.get("request")));
      else if ("transcribe".equals(method)) cf.client.transcribe(Core.asMap(fixture.getOrDefault("request", Map.of())));
      else if ("speak".equals(method)) cf.client.speak(Core.asMap(fixture.getOrDefault("request", Map.of())));
      else cf.client.chat(Core.asMap(fixture.get("request")));
    } catch (Exception e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      if (fixture.get("expected_error_type") != null && !e.getClass().getSimpleName().equals(fixture.get("expected_error_type"))) throw new FixtureError("expected error type " + fixture.get("expected_error_type") + ", got " + e.getClass().getSimpleName());
      if (fixture.get("expected_status") != null && e instanceof AxAIServiceError ai && !java.util.Objects.equals(ai.status, Core.asInt(fixture.get("expected_status")))) throw new FixtureError("status mismatch");
      assertTransport(fixture, cf.transport);
      return;
    }
    throw new FixtureError("expected AxAI call to fail");
  }

  static void runAIUnsupported(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    try {
      if ("speak".equals(fixture.get("method"))) cf.client.speak(Core.asMap(fixture.getOrDefault("request", Map.of())));
      else cf.client.transcribe(Core.asMap(fixture.getOrDefault("request", Map.of())));
    } catch (Exception e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return;
    }
    throw new FixtureError("expected unsupported capability error");
  }

  static void runAIProviderDescriptor(Map<String, Object> fixture) {
    Object descriptor = Core.provider_descriptor(String.valueOf(fixture.getOrDefault("provider", "openai-compatible")));
    if (fixture.containsKey("expected_output")) assertSubset(descriptor, fixture.get("expected_output"), "provider descriptor");
  }

  static void runAIProviderRegistry(Map<String, Object> fixture) {
    Object registry = Core.provider_profile_registry();
    if (fixture.containsKey("expected_output")) assertSubset(registry, fixture.get("expected_output"), "provider profile registry");
    Map<String, Object> aliases = Core.asMap(fixture.getOrDefault("alias_expectations", Map.of()));
    for (Map.Entry<String, Object> entry : aliases.entrySet()) {
      assertEqual(Core.provider_normalize_profile(entry.getKey()), entry.getValue(), "provider alias " + entry.getKey());
    }
  }

  static void runAIModelCatalogAudit(Map<String, Object> fixture) {
    Object summary = Core.provider_model_catalog_summary();
    if (fixture.containsKey("expected_output")) assertSubset(summary, fixture.get("expected_output"), "provider model catalog audit");
  }

  static void runAIModelCatalogRuntime(Map<String, Object> fixture) {
    Object type = fixture.get("model_type");
    List<Object> result = type == null ? Ax.getSupportedAIModels() : Ax.getSupportedAIModels(String.valueOf(type));
    if (fixture.containsKey("expected_output")) {
      Map<String, Object> actual = new LinkedHashMap<>();
      List<Object> providerNames = new ArrayList<>();
      int modelCount = 0;
      String openaiFirst = null;
      java.util.Set<String> openaiTypes = new java.util.TreeSet<>();
      for (Object item : result) {
        Map<String, Object> provider = Core.asMap(item);
        providerNames.add(provider.get("name"));
        List<Object> models = Core.asList(provider.get("models"));
        modelCount += models.size();
        if ("openai".equals(provider.get("name"))) {
          if (!models.isEmpty()) openaiFirst = String.valueOf(Core.asMap(models.get(0)).get("name"));
          for (Object model : models) openaiTypes.add(String.valueOf(Core.asMap(model).get("type")));
        }
      }
      actual.put("providerCount", result.size());
      actual.put("providerNames", providerNames);
      actual.put("modelCount", modelCount);
      actual.put("openaiFirstModel", openaiFirst);
      actual.put("openaiModelTypes", new ArrayList<>(openaiTypes));
      actual.put("catalog", result);
      assertSubset(actual, fixture.get("expected_output"), "provider model catalog runtime");
    }
  }

  static List<RouterFixtureService> routerServices(Map<String, Object> fixture) {
    List<RouterFixtureService> services = new ArrayList<>();
    for (Object spec : Core.asList(fixture.getOrDefault("services", List.of()))) services.add(new RouterFixtureService(Core.asMap(spec)));
    return services;
  }

  static void runAIMultiServiceRouter(Map<String, Object> fixture) {
    List<RouterFixtureService> services = routerServices(fixture);
    List<Object> entries = new ArrayList<>();
    for (Object raw : Core.asList(fixture.getOrDefault("router_entries", List.of()))) {
      Map<String, Object> entry = Core.asMap(raw);
      if ("key".equals(entry.get("kind"))) {
        entries.add(new AxMultiServiceRouter.Entry(String.valueOf(entry.get("key")), services.get(Core.asInt(entry.getOrDefault("service_index", 0))), String.valueOf(entry.getOrDefault("description", "")), Core.truthy(entry.getOrDefault("isInternal", entry.get("is_internal")))));
      } else {
        entries.add(services.get(Core.asInt(entry.getOrDefault("service_index", 0))));
      }
    }
    try {
      AxMultiServiceRouter router = new AxMultiServiceRouter(entries);
      Map<String, Object> outputs = new LinkedHashMap<>();
      for (Object raw : Core.asList(fixture.getOrDefault("operations", List.of()))) {
        Map<String, Object> op = Core.asMap(raw);
        String name = String.valueOf(op.get("name"));
        if ("chat".equals(name)) outputs.put(name, router.chat(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("embed".equals(name)) outputs.put(name, router.embed(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("transcribe".equals(name)) outputs.put(name, router.transcribe(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("speak".equals(name)) outputs.put(name, router.speak(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("set_options".equals(name)) router.setOptions(Core.asMap(op.getOrDefault("options", Map.of())));
      }
      Map<String, Object> actual = new LinkedHashMap<>();
      actual.put("outputs", outputs);
      actual.put("lastChat", router.getLastUsedChatModel());
      actual.put("lastEmbed", router.getLastUsedEmbedModel());
      actual.put("lastConfig", router.getLastUsedModelConfig());
      actual.put("metrics", router.getMetrics());
      actual.put("options", router.getOptions());
      List<Object> calls = new ArrayList<>();
      for (RouterFixtureService service : services) if (!service.requests.isEmpty()) calls.add(service.requests);
      actual.put("serviceCalls", calls);
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected multi-service router to fail");
      Map<String, Object> expectedOutput = Core.asMap(fixture.getOrDefault("expected_output", Map.of()));
      if (expectedOutput.containsKey("modelList")) actual.put("modelList", router.getModelList());
      if (fixture.containsKey("expected_output")) assertSubset(actual, expectedOutput, "multi-service router");
    } catch (Exception e) {
      if (!fixture.containsKey("expected_error_contains")) throw Core.asRuntime(e);
      String expected = String.valueOf(fixture.get("expected_error_contains"));
      if (!String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
    }
  }

  static void runAIProviderRouter(Map<String, Object> fixture) {
    List<RouterFixtureService> services = routerServices(fixture);
    Map<String, Object> providers = new LinkedHashMap<>();
    providers.put("primary", services.isEmpty() ? null : services.get(Core.asInt(fixture.getOrDefault("primary_index", 0))));
    List<Object> alternatives = new ArrayList<>();
    for (Object index : Core.asList(fixture.getOrDefault("alternative_indices", List.of()))) alternatives.add(services.get(Core.asInt(index)));
    providers.put("alternatives", alternatives);
    Map<String, Object> config = new LinkedHashMap<>();
    config.put("providers", providers);
    config.put("routing", fixture.getOrDefault("routing", Map.of("capability", Map.of("requireExactMatch", false, "allowDegradation", true))));
    config.put("processing", fixture.getOrDefault("processing", Map.of()));
    AxProviderRouter router = new AxProviderRouter(config);
    Map<String, Object> request = Core.asMap(fixture.getOrDefault("request", Map.of()));
    Map<String, Object> rec = router.getRoutingRecommendation(request);
    AxAIService provider = (AxAIService) rec.get("provider");
    Map<String, Object> recommendation = new LinkedHashMap<>();
    recommendation.put("provider", provider == null ? rec.get("providerName") : provider.getName());
    recommendation.put("processingApplied", rec.get("processingApplied"));
    recommendation.put("degradations", rec.get("degradations"));
    recommendation.put("warnings", rec.get("warnings"));
    Map<String, Object> actual = new LinkedHashMap<>();
    actual.put("recommendation", recommendation);
    actual.put("validation", router.validateRequest(request));
    actual.put("stats", router.getRoutingStats());
    if (fixture.containsKey("expected_output")) assertSubset(actual, fixture.get("expected_output"), "provider router");
  }

  static void runAIBalancer(Map<String, Object> fixture) {
    List<RouterFixtureService> services = routerServices(fixture);
    int[] bestEffort = {0, 0, 0};
    try {
      AxBalancer balancer;
      if (Core.truthy(fixture.getOrDefault("adaptive_best_effort", false))) {
        AxBalancerStatsStore store = new AxBalancerStatsStore() {
          public AxBalancerRouteStats get(AxBalancerStatsKey key) { bestEffort[0]++; throw new RuntimeException("fixture store read failed"); }
          public void observe(AxBalancerStatsKey key, AxBalancerStatsObservation observation) { bestEffort[1]++; throw new RuntimeException("fixture store write failed"); }
        };
        Map<String, Object> raw = Core.asMap(Core.asMap(fixture.getOrDefault("options", Map.of())).getOrDefault("strategy", Map.of()));
        AxBalancerAdaptiveStrategy strategy = new AxBalancerAdaptiveStrategy(Core.asDouble(raw.getOrDefault("deadlineMs", 1)), Core.asDouble(raw.getOrDefault("badOutcomeCost", 0)))
            .namespace(String.valueOf(raw.getOrDefault("namespace", "default")))
            .routeKey((service, index) -> "best-effort-route")
            .statsStore(store)
            .onRoutingEvent(event -> { bestEffort[2]++; throw new RuntimeException("fixture event hook failed"); });
        balancer = new AxBalancer(services, new AxBalancerOptions().strategy(strategy));
      } else {
        balancer = new AxBalancer(services, Core.asMap(fixture.getOrDefault("options", Map.of())));
      }
      Map<String, Object> outputs = new LinkedHashMap<>();
      for (Object raw : Core.asList(fixture.getOrDefault("operations", List.of()))) {
        Map<String, Object> op = Core.asMap(raw);
        String name = String.valueOf(op.get("name"));
        if ("chat".equals(name)) outputs.put(name, balancer.chat(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("stream".equals(name)) {
          List<Object> deltas = new ArrayList<>();
          for (Object delta : balancer.stream(Core.asMap(op.getOrDefault("request", Map.of())))) deltas.add(delta);
          outputs.put(name, deltas);
        }
        else if ("embed".equals(name)) outputs.put(name, balancer.embed(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("transcribe".equals(name)) outputs.put(name, balancer.transcribe(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("speak".equals(name)) outputs.put(name, balancer.speak(Core.asMap(op.getOrDefault("request", Map.of())), Core.asMap(op.getOrDefault("options", Map.of()))));
        else if ("set_options".equals(name)) balancer.setOptions(Core.asMap(op.getOrDefault("options", Map.of())));
        else if ("adaptive_stats".equals(name)) {
          AxBalancerRouteStats stats = AxBalancerAdaptive.createRouteStats();
          for (Object observation : Core.asList(op.getOrDefault("observations", List.of()))) {
            Map<String, Object> value = Core.asMap(observation);
            stats = AxBalancerAdaptive.updateRouteStats(stats, new AxBalancerStatsObservation(String.valueOf(value.get("outcome")), value.get("latencyMs") == null ? null : Core.asDouble(value.get("latencyMs"))));
          }
          Core.setMathRandomValues(Core.asList(op.getOrDefault("random_values", List.of())));
          Map<String, Object> health = AxBalancerAdaptive.sampleRouteHealth(stats, Core.asDouble(op.getOrDefault("deadline_ms", 1)));
          double score = Core.asDouble(Core.provider_balancer_adaptive_score(Core.asDouble(op.getOrDefault("estimated_cost", 0)), Core.asDouble(op.getOrDefault("bad_outcome_cost", 0)), Core.asDouble(health.get("failureProbability")), Core.asDouble(health.get("deadlineMissProbability"))));
          java.util.function.DoubleUnaryOperator round = value -> Math.round(value * 1_000_000_000.0) / 1_000_000_000.0;
          outputs.put(name, Map.of(
              "stats", Map.of("version", stats.version(), "observations", stats.observations(), "successes", stats.successes(), "failureEwma", round.applyAsDouble(stats.failureEwma()), "logLatencyMean", round.applyAsDouble(stats.logLatencyMean()), "logLatencyM2", round.applyAsDouble(stats.logLatencyM2())),
              "health", Map.of("failureProbability", round.applyAsDouble(Core.asDouble(health.get("failureProbability"))), "deadlineMissProbability", round.applyAsDouble(Core.asDouble(health.get("deadlineMissProbability")))),
              "score", round.applyAsDouble(score)));
        }
        else if ("adaptive_store".equals(name)) {
          AxInMemoryBalancerStatsStore store = new AxInMemoryBalancerStatsStore();
          for (Object rawWrite : Core.asList(op.getOrDefault("writes", List.of()))) {
            Map<String, Object> write = Core.asMap(rawWrite);
            Map<String, Object> key = Core.asMap(write.get("key"));
            Map<String, Object> observation = Core.asMap(write.get("observation"));
            store.observe(
                new AxBalancerStatsKey(String.valueOf(key.get("namespace")), String.valueOf(key.get("slice")), String.valueOf(key.get("logicalModel")), String.valueOf(key.get("routeKey"))),
                new AxBalancerStatsObservation(String.valueOf(observation.get("outcome")), observation.get("latencyMs") == null ? null : Core.asDouble(observation.get("latencyMs"))));
          }
          List<Object> states = new ArrayList<>();
          for (Object rawKey : Core.asList(op.getOrDefault("reads", List.of()))) {
            Map<String, Object> key = Core.asMap(rawKey);
            AxBalancerRouteStats stats = store.get(new AxBalancerStatsKey(String.valueOf(key.get("namespace")), String.valueOf(key.get("slice")), String.valueOf(key.get("logicalModel")), String.valueOf(key.get("routeKey"))));
            states.add(Map.of("version", stats.version(), "observations", stats.observations(), "successes", stats.successes(), "failureEwma", stats.failureEwma(), "logLatencyMean", stats.logLatencyMean(), "logLatencyM2", stats.logLatencyM2()));
          }
          outputs.put(name, Map.of("states", states));
        }
      }
      Map<String, Object> actual = new LinkedHashMap<>();
      actual.put("id", balancer.getId());
      actual.put("name", balancer.getName());
      actual.put("outputs", outputs);
      actual.put("lastChat", balancer.getLastUsedChatModel());
      actual.put("lastEmbed", balancer.getLastUsedEmbedModel());
      actual.put("lastConfig", balancer.getLastUsedModelConfig());
      actual.put("metrics", balancer.getMetrics());
      actual.put("options", balancer.getOptions());
      List<Object> calls = new ArrayList<>();
      for (RouterFixtureService service : services) if (!service.requests.isEmpty()) calls.add(service.requests);
      actual.put("serviceCalls", calls);
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected balancer to fail");
      Map<String, Object> expectedOutput = Core.asMap(fixture.getOrDefault("expected_output", Map.of()));
      if (expectedOutput.containsKey("modelList")) actual.put("modelList", balancer.getModelList());
      if (expectedOutput.containsKey("features")) actual.put("features", balancer.getFeatures(null));
      if (Core.truthy(fixture.getOrDefault("adaptive_best_effort", false))) actual.put("bestEffort", Map.of("storeGets", bestEffort[0], "storeObserves", bestEffort[1], "eventCalls", bestEffort[2]));
      if (fixture.containsKey("expected_output")) assertSubset(actual, expectedOutput, "balancer");
    } catch (Exception e) {
      if (!fixture.containsKey("expected_error_contains")) throw Core.asRuntime(e);
      String expected = String.valueOf(fixture.get("expected_error_contains"));
      if (!String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
    }
  }

  static void runAITranscribe(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    Object result;
    try { result = cf.client.transcribe(Core.asMap(fixture.getOrDefault("request", Map.of()))); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai transcribe output");
    assertTransport(fixture, cf.transport);
  }

  static void runAISpeak(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    Object result;
    try { result = cf.client.speak(Core.asMap(fixture.getOrDefault("request", Map.of()))); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai speak output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIRealtime(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    try {
      Map<String, Object> request = Core.asMap(fixture.getOrDefault("request", Map.of()));
      if (fixture.containsKey("expected_setup")) assertEqual(cf.client.realtimeAudioSetup(request), fixture.get("expected_setup"), "ai realtime setup");
      if (fixture.containsKey("expected_input")) assertEqual(cf.client.realtimeAudioInput(request), fixture.get("expected_input"), "ai realtime input");
      List<Object> result = new ArrayList<>();
      for (Object item : cf.client.realtime(Core.asList(fixture.getOrDefault("events", List.of())))) result.add(item);
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected ai realtime fixture to fail");
      if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai realtime output");
    } catch (RuntimeException e) {
      if (!fixture.containsKey("expected_error_contains")) throw e;
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
    }
  }

  interface ThrowingSupplier { Object get(); }
  static Object expectMaybeError(ThrowingSupplier supplier, Map<String, Object> fixture) {
    try {
      Object value = supplier.get();
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected operation to fail");
      return value;
    } catch (RuntimeException e) {
      if (!fixture.containsKey("expected_error_contains")) throw e;
      assertErrorCategory(e, fixture);
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return null;
    }
  }

  static AxSignature buildSignature(Map<String, Object> fixture) {
    if (fixture.containsKey("signature_spec")) return signatureFromSpec(Core.asMap(fixture.get("signature_spec")));
    return Ax.s(String.valueOf(fixture.get("signature")));
  }

  static AxSignature signatureFromSpec(Map<String, Object> spec) {
    AxSignature.Builder builder = Ax.f().call();
    if (spec.get("description") != null) builder.description(String.valueOf(spec.get("description")));
    for (Map.Entry<String, Object> e : Core.asMap(spec.get("inputs")).entrySet()) builder.input(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
    for (Map.Entry<String, Object> e : Core.asMap(spec.get("outputs")).entrySet()) builder.output(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
    return builder.build();
  }

  static Field.Fluent fieldFromSpec(Map<String, Object> spec) {
    String typ = String.valueOf(spec.getOrDefault("type", "string"));
    Field.Factory f = Ax.f();
    Field.Fluent field;
    switch (typ) {
      case "class" -> field = f.classification(stringList(spec.get("options")), (String) spec.get("description"));
      case "object" -> {
        Map<String, Field.Fluent> nested = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : Core.asMap(spec.get("fields")).entrySet()) nested.put(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
        field = f.object(nested, (String) spec.get("description"));
      }
      case "number" -> field = f.number((String) spec.get("description"));
      case "boolean" -> field = f.boolean_((String) spec.get("description"));
      case "json" -> field = f.json((String) spec.get("description"));
      case "date" -> field = f.date((String) spec.get("description"));
      case "datetime" -> field = f.datetime((String) spec.get("description"));
      case "dateRange" -> field = f.dateRange((String) spec.get("description"));
      case "datetimeRange" -> field = f.datetimeRange((String) spec.get("description"));
      case "image" -> field = f.image((String) spec.get("description"));
      case "audio" -> field = f.audio((String) spec.get("description"));
      case "file" -> field = f.file((String) spec.get("description"));
      case "url" -> field = f.url((String) spec.get("description"));
      case "code" -> field = f.code((String) spec.get("description"));
      default -> field = f.string((String) spec.get("description"));
    }
    if (Core.truthy(spec.get("array"))) field = field.array((String) spec.get("arrayDescription"));
    if (Core.truthy(spec.get("optional"))) field = field.optional();
    if (Core.truthy(spec.get("internal"))) field = field.internal();
    if (Core.truthy(spec.get("cache"))) field = field.cache();
    if (spec.get("min") != null) field = field.min(Core.asInt(spec.get("min")));
    if (spec.get("max") != null) field = field.max(Core.asInt(spec.get("max")));
    if (Core.truthy(spec.get("email"))) field = field.email();
    if (Core.truthy(spec.get("url"))) field = field.url();
    if (spec.get("pattern") != null) field = field.regex(String.valueOf(spec.get("pattern")), String.valueOf(spec.getOrDefault("patternDescription", spec.get("pattern"))));
    return field;
  }

  static Map<String, Object> signaturePayload(AxSignature sig) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("description", sig.description);
    out.put("inputs", fieldPayloads(sig.inputs));
    out.put("outputs", fieldPayloads(sig.outputs));
    return out;
  }
  static List<Object> fieldPayloads(List<Field> fields) { List<Object> out = new ArrayList<>(); for (Field f : fields) out.add(fieldPayload(f)); return out; }
  static Map<String, Object> fieldPayload(Field field) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", field.name); out.put("title", field.title); out.put("type", typePayload(field.type));
    out.put("isOptional", field.optional); out.put("isInternal", field.internal); out.put("isCached", field.cached);
    if (field.description != null) out.put("description", field.description);
    return out;
  }
  static Map<String, Object> typePayload(FieldType t) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", t.name); out.put("isArray", t.array);
    if (t.options != null) out.put("options", t.options);
    if (t.description != null) out.put("description", t.description);
    if (t.fields != null && !t.fields.isEmpty()) { Map<String, Object> fields = new LinkedHashMap<>(); for (Map.Entry<String, Object> e : t.fields.entrySet()) fields.put(e.getKey(), fieldPayload(e.getValue() instanceof Field f ? f : new Field(e.getKey(), (FieldType) e.getValue(), null, false, false, false))); out.put("fields", fields); }
    if (t.minLength != null) out.put("minLength", t.minLength);
    if (t.maxLength != null) out.put("maxLength", t.maxLength);
    if (t.minimum != null) out.put("minimum", t.minimum);
    if (t.maximum != null) out.put("maximum", t.maximum);
    if (t.pattern != null) out.put("pattern", t.pattern);
    if (t.patternDescription != null) out.put("patternDescription", t.patternDescription);
    if (t.format != null) out.put("format", t.format);
    if (t.language != null) out.put("language", t.language);
    return out;
  }

  static final class ToolBuild {
    final List<Tool> tools = new ArrayList<>();
    final List<Object> calls = new ArrayList<>();
  }
  static ToolBuild buildTools(List<Object> specs) {
    ToolBuild out = new ToolBuild();
    for (Object item : specs) {
      Map<String, Object> spec = Core.asMap(item);
      Tool.Builder builder = Ax.fn(String.valueOf(spec.get("name"))).description(String.valueOf(spec.getOrDefault("description", spec.get("name"))));
      for (Map.Entry<String, Object> e : Core.asMap(spec.get("args")).entrySet()) builder.arg(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
      for (Map.Entry<String, Object> e : Core.asMap(spec.get("returns")).entrySet()) builder.returnsField(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
      Object result = spec.get("result");
      Object error = spec.get("error");
      builder.handler(args -> {
        out.calls.add(new LinkedHashMap<>(Map.of("name", spec.get("name"), "args", new LinkedHashMap<>(args))));
        if (error != null) throw new RuntimeException(String.valueOf(error));
        return result;
      });
      out.tools.add(builder.build());
    }
    return out;
  }

  static final class ClientFixture {
    final OpenAICompatibleClient client;
    final ScriptedTransport transport;
    ClientFixture(OpenAICompatibleClient client, ScriptedTransport transport) { this.client = client; this.transport = transport; }
  }
  static ClientFixture openaiClient(Map<String, Object> fixture) {
    ScriptedTransport transport = new ScriptedTransport(Core.asList(fixture.getOrDefault("transport_responses", fixture.getOrDefault("responses", List.of()))));
    String provider = String.valueOf(Core.provider_normalize_profile(String.valueOf(fixture.getOrDefault("provider", "openai-compatible"))));
    boolean responsesProvider = provider.equals("openai-responses");
    boolean geminiProvider = provider.equals("google-gemini");
    boolean anthropicProvider = provider.equals("anthropic");
    boolean azureProvider = provider.equals("azure-openai");
    boolean deepseekProvider = provider.equals("deepseek");
    boolean mistralProvider = provider.equals("mistral");
    boolean rekaProvider = provider.equals("reka");
    boolean cohereProvider = provider.equals("cohere");
    boolean grokProvider = provider.equals("grok");
    Map<String, Object> options = new LinkedHashMap<>();
    String defaultModel = anthropicProvider ? "claude-3-7-sonnet-latest" : geminiProvider ? "gemini-2.5-flash" : responsesProvider ? "gpt-4o" : azureProvider ? "gpt-5-mini" : deepseekProvider ? "deepseek-v4-flash" : mistralProvider ? "mistral-small-latest" : rekaProvider ? "reka-core" : cohereProvider ? "command-r-plus" : grokProvider ? "grok-4.3" : "gpt-4.1-mini";
    String defaultEmbedModel = anthropicProvider || deepseekProvider || rekaProvider || grokProvider ? "" : geminiProvider ? "gemini-embedding-2" : responsesProvider ? "text-embedding-ada-002" : mistralProvider ? "mistral-embed" : cohereProvider ? "embed-english-v3.0" : "text-embedding-3-small";
    options.put("model", fixture.getOrDefault("model", defaultModel));
    options.put("embed_model", fixture.getOrDefault("embed_model", defaultEmbedModel));
    options.put("api_key", "test-key");
    options.put("transport", transport);
    options.put("model_config", fixture.get("model_config"));
    options.put("options", fixture.getOrDefault("options", Map.of()));
    for (String key : List.of("base_url", "baseUrl", "resource_name", "resourceName", "deployment_name", "deploymentName", "api_version", "apiVersion", "version")) {
      if (fixture.containsKey(key)) options.put(key, fixture.get(key));
    }
    OpenAICompatibleClient client = geminiProvider ? new GoogleGeminiClient(options)
      : anthropicProvider ? new AnthropicClient(options)
      : responsesProvider ? new OpenAIResponsesClient(options)
      : azureProvider ? new AzureOpenAIClient(options)
      : deepseekProvider ? new DeepSeekClient(options)
      : mistralProvider ? new MistralClient(options)
      : rekaProvider ? new RekaClient(options)
      : cohereProvider ? new CohereClient(options)
      : grokProvider ? new GrokClient(options)
      : new OpenAICompatibleClient(options);
    return new ClientFixture(client, transport);
  }

  static boolean jsonPathExists(Object value, String path) {
    Object current = value;
    for (String segment : path.split("\\.")) {
      if (!(current instanceof Map<?, ?> map) || !map.containsKey(segment)) return false;
      current = map.get(segment);
    }
    return true;
  }

  static void assertTransport(Map<String, Object> fixture, ScriptedTransport transport) {
    if (!fixture.containsKey("expected_transport_request") && !fixture.containsKey("expected_transport_json_absent")) return;
    if (transport.requests.isEmpty()) throw new FixtureError("expected provider transport request but none were sent");
    if (fixture.containsKey("expected_transport_request")) assertSubset(transport.requests.get(0), fixture.get("expected_transport_request"), "provider request");
    Map<String, Object> requestJson = Core.asMap(Core.asMap(transport.requests.get(0)).get("json"));
    for (Object rawKey : Core.asList(fixture.getOrDefault("expected_transport_json_absent", List.of()))) {
      String key = String.valueOf(rawKey);
      if (jsonPathExists(requestJson, key)) throw new FixtureError("provider request json unexpectedly contained " + key);
    }
  }
  static List<String> stringList(Object value) { List<String> out = new ArrayList<>(); for (Object item : Core.asList(value)) out.add(String.valueOf(item)); return out; }
  static void assertEqual(Object actual, Object expected, String label) {
    if (actual == null || expected == null) {
      if (actual != expected) throw new FixtureError(label + " mismatch\nactual: " + Json.stringify(actual) + "\nexpected: " + Json.stringify(expected));
      return;
    }
    if (!canonical(actual).equals(canonical(expected))) throw new FixtureError(label + " mismatch\nactual: " + Json.stringify(actual) + "\nexpected: " + Json.stringify(expected));
  }
	  static void assertSubset(Object actual, Object expected, String label) {
	    if (expected instanceof Map<?, ?> exp) {
	      Map<String, Object> act = Core.asMap(actual);
	      for (Map.Entry<?, ?> e : exp.entrySet()) {
	        if (!act.containsKey(e.getKey())) throw new FixtureError(label + " missing key " + e.getKey());
	        assertSubset(act.get(e.getKey()), e.getValue(), label + "." + e.getKey());
	      }
	    } else if (expected instanceof List<?>) assertEqual(actual, expected, label);
	    else {
	      if (actual == null || expected == null) {
	        if (actual != expected) throw new FixtureError(label + " expected " + expected + ", got " + actual);
	      } else if (!canonical(actual).equals(canonical(expected))) throw new FixtureError(label + " expected " + expected + ", got " + actual);
	    }
	  }
	  static void assertListSubset(Object actual, Object expected, String label) {
	    List<Object> act = Core.asList(actual);
	    int start = 0;
	    for (Object expectedItem : Core.asList(expected)) {
	      boolean matched = false;
	      for (int i = start; i < act.size(); i++) {
	        try {
	          assertSubset(act.get(i), expectedItem, label + "[" + i + "]");
	          start = i + 1;
	          matched = true;
	          break;
	        } catch (FixtureError ignored) {}
	      }
	      if (!matched) throw new FixtureError(label + " missing expected item " + Json.stringify(expectedItem));
	    }
	  }
  static Object canonical(Object value) {
    if (value instanceof Number n) {
      double d = n.doubleValue();
      if (Math.rint(d) == d) return (long) d;
      return d;
    }
    if (value instanceof Map<?, ?> map) { Map<String, Object> out = new LinkedHashMap<>(); for (Map.Entry<?, ?> e : map.entrySet()) out.put(String.valueOf(e.getKey()), canonical(e.getValue())); return out; }
    if (value instanceof Iterable<?> list) { List<Object> out = new ArrayList<>(); for (Object item : list) out.add(canonical(item)); return out; }
    return value;
  }
}
