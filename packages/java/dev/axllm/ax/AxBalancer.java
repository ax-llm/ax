package dev.axllm.ax;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public final class AxBalancer implements AxAIService {
  public static final String inputOrderComparator = "input_order";

  private final List<AxAIService> services;
  private AxAIService currentService;
  private int currentServiceIndex = 0;
  private final Map<String, Map<String, Object>> serviceFailures = new HashMap<>();
  private final Map<String, Object> policy;
  private AdaptiveState adaptive;
  private boolean debug;
  private int maxRetries;

  public AxBalancer(List<? extends AxAIService> services) { this(services, Map.of()); }

  public AxBalancer(List<? extends AxAIService> input, Map<String, Object> options) {
    if (input == null || input.isEmpty()) throw new IllegalArgumentException("No AI services provided.");
    Map<String, Object> supplied = options == null ? Map.of() : options;
    Object rawStrategy = supplied.get("strategy");
    AxBalancerAdaptiveStrategy adaptiveStrategy = null;
    if (rawStrategy instanceof Map<?, ?> raw && "adaptive".equals(String.valueOf(raw.get("type")))) {
      Map<String, Object> value = Core.asMap(raw);
      adaptiveStrategy = new AxBalancerAdaptiveStrategy(Core.asDouble(value.getOrDefault("deadlineMs", value.get("deadline_ms"))), Core.asDouble(value.getOrDefault("badOutcomeCost", value.get("bad_outcome_cost"))));
      adaptiveStrategy.expectedTokens = Core.asMap(value.get("expectedTokens"));
      adaptiveStrategy.namespace = String.valueOf(value.getOrDefault("namespace", "default"));
    }
    this.policy = Core.asMap(Core.provider_balancer_retry_policy(supplied));
    this.debug = Core.truthy(policy.getOrDefault("debug", true));
    this.maxRetries = Core.asInt(policy.getOrDefault("maxRetries", 3));
    this.services = new ArrayList<>(input);
    validateModels();
    this.adaptive = adaptiveStrategy == null ? null : createAdaptiveState(input, adaptiveStrategy);
    if (!"input_order".equals(String.valueOf(policy.getOrDefault("strategy", "metric")))) {
      this.services.sort(Comparator.comparingDouble(service -> Core.asDouble(Core.provider_balancer_metric_score(service.getMetrics()))));
    }
    this.currentService = this.services.get(0);
  }

  public AxBalancer(List<? extends AxAIService> input, AxBalancerOptions options) {
    this(input, Map.of("strategy", "metric", "debug", options == null || options.debug, "maxRetries", options == null ? 3 : options.maxRetries));
    if (options != null && options.strategy != null) {
      this.adaptive = createAdaptiveState(input, options.strategy);
      this.debug = options.debug;
      this.maxRetries = options.maxRetries;
    }
  }

  public static AxBalancer create(List<? extends AxAIService> services, Map<String, Object> options) { return new AxBalancer(services, options); }
  public static AxBalancer create(List<? extends AxAIService> services) { return new AxBalancer(services); }

  private static final class AdaptiveState {
    final AxBalancerAdaptiveStrategy strategy;
    final AxBalancerStatsStore store;
    final Map<AxAIService, String> routeKeys;
    final Map<AxAIService, Integer> indices;
    AdaptiveState(AxBalancerAdaptiveStrategy strategy, AxBalancerStatsStore store, Map<AxAIService, String> routeKeys, Map<AxAIService, Integer> indices) {
      this.strategy = strategy; this.store = store; this.routeKeys = routeKeys; this.indices = indices;
    }
  }

  private record AdaptiveCandidate(AxAIService service, int order, String routeKey, AxBalancerStatsKey statsKey, double score, double estimatedCost, double failureProbability, double deadlineMissProbability) {}

  private AdaptiveState createAdaptiveState(List<? extends AxAIService> input, AxBalancerAdaptiveStrategy strategy) {
    Core.provider_balancer_adaptive_policy(Map.of("deadlineMs", strategy.deadlineMs, "badOutcomeCost", strategy.badOutcomeCost, "namespace", strategy.namespace == null ? "default" : strategy.namespace));
    String namespace = strategy.namespace == null ? "default" : strategy.namespace.trim();
    if (namespace.isEmpty()) throw new IllegalArgumentException("Adaptive namespace must be non-empty.");
    if (strategy.statsStore != null && strategy.routeKey == null) throw new IllegalArgumentException("Adaptive routeKey is required when statsStore is supplied.");
    AxBalancerStatsStore store = strategy.statsStore == null ? new AxInMemoryBalancerStatsStore() : strategy.statsStore;
    Map<AxAIService, String> routeKeys = new java.util.IdentityHashMap<>();
    Map<AxAIService, Integer> indices = new java.util.IdentityHashMap<>();
    java.util.Set<String> seen = new java.util.HashSet<>();
    for (int i = 0; i < input.size(); i++) {
      AxAIService service = input.get(i);
      String key = strategy.routeKey == null ? service.getId() : strategy.routeKey.apply(service, i);
      key = String.valueOf(Core.provider_balancer_validate_route_key(key == null ? "" : key, new ArrayList<>(seen)));
      seen.add(key);
      routeKeys.put(service, key); indices.put(service, i);
    }
    return new AdaptiveState(strategy, store, routeKeys, indices);
  }

  private void validateModels() {
    List<Map<String, Object>> reference = null;
    for (AxAIService service : services) {
      if (service.getModelList() != null) { reference = service.getModelList(); break; }
    }
    if (reference == null) return;
    LinkedHashSet<String> referenceKeys = new LinkedHashSet<>();
    for (Map<String, Object> entry : reference) referenceKeys.add(String.valueOf(entry.get("key")));
    for (int i = 0; i < services.size(); i++) {
      AxAIService service = services.get(i);
      List<Map<String, Object>> modelList = service.getModelList();
      if (modelList == null) throw new IllegalArgumentException("Service at index " + i + " (" + service.getName() + ") has no model list while another service does.");
      LinkedHashSet<String> keys = new LinkedHashSet<>();
      for (Map<String, Object> entry : modelList) keys.add(String.valueOf(entry.get("key")));
      for (String key : referenceKeys) if (!keys.contains(key)) throw new IllegalArgumentException("Service at index " + i + " (" + service.getName() + ") is missing model \"" + key + "\"");
      for (String key : keys) if (!referenceKeys.contains(key)) throw new IllegalArgumentException("Service at index " + i + " (" + service.getName() + ") has extra model \"" + key + "\"");
    }
  }

  private AxAIService nextService(List<AxAIService> services, int currentIndex) {
    int nextIndex = currentIndex + 1;
    return nextIndex < services.size() ? services.get(nextIndex) : null;
  }

  private boolean canRetryService(AxAIService service) { return !serviceFailures.containsKey(service.getId()); }

  private void handleFailure(AxAIService service) {
    Map<String, Object> failure = serviceFailures.getOrDefault(service.getId(), new LinkedHashMap<>());
    int retries = Core.asInt(failure.getOrDefault("retries", 0)) + 1;
    Map<String, Object> next = new LinkedHashMap<>();
    next.put("retries", retries);
    serviceFailures.put(service.getId(), next);
  }

  private void handleSuccess(AxAIService service) { serviceFailures.remove(service.getId()); }

  private boolean retryable(AxAIServiceError error) {
    if (error instanceof AxAIServiceAuthenticationError) return false;
    if (error instanceof AxAIServiceStatusError) {
      return error.status != null && List.of(408, 429, 500, 502, 503, 504, 529).contains(error.status);
    }
    return error instanceof AxAIServiceNetworkError || error instanceof AxAIServiceResponseError || error instanceof AxAIServiceStreamTerminatedError || error instanceof AxAIServiceTimeoutError;
  }

  private List<AxAIService> candidateServices(Map<String, Object> request) {
    List<AxAIService> out = new ArrayList<>();
    String model = request.get("model") == null ? null : String.valueOf(request.get("model"));
    for (AxAIService service : services) {
      if (Core.truthy(Core.provider_balancer_candidate_allowed(service.getFeatures(model), request))) out.add(service);
    }
    if (!out.isEmpty()) return out;
    List<String> requirements = new ArrayList<>();
    Map<String, Object> format = Core.asMap(request.getOrDefault("responseFormat", request.getOrDefault("response_format", Map.of())));
    if ("json_schema".equals(format.get("type"))) requirements.add("structured outputs");
    Map<String, Object> caps = Core.asMap(request.getOrDefault("capabilities", Map.of()));
    if (Core.truthy(caps.getOrDefault("requiresImages", caps.get("requires_images")))) requirements.add("images");
    if (Core.truthy(caps.getOrDefault("requiresAudio", caps.get("requires_audio")))) requirements.add("audio");
    throw new IllegalArgumentException("No services available that support required capabilities: " + String.join(", ", requirements) + ".");
  }

  private void emitRoutingEvent(Map<String, Object> event) {
    if (adaptive == null || adaptive.strategy.onRoutingEvent == null) return;
    try { adaptive.strategy.onRoutingEvent.accept(new AxBalancerRoutingEvent(event)); } catch (Exception ignored) {}
  }

  private AxBalancerRouteStats readStats(AxBalancerStatsKey key) {
    try { return adaptive.store.get(key); }
    catch (Exception error) {
      Map<String, Object> event = eventBase("store-error", key);
      event.put("operation", "get"); event.put("routeKey", key.routeKey()); event.put("errorType", error.getClass().getSimpleName());
      emitRoutingEvent(event); return null;
    }
  }

  private Map<String, Object> eventBase(String type, AxBalancerStatsKey key) {
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("type", type); event.put("namespace", key.namespace()); event.put("slice", key.slice()); event.put("logicalModel", key.logicalModel());
    return event;
  }

  private void observe(AdaptiveCandidate candidate, AxBalancerStatsObservation observation, boolean streaming, String reason, Integer status) {
    try { adaptive.store.observe(candidate.statsKey(), observation); }
    catch (Exception error) {
      Map<String, Object> failed = eventBase("store-error", candidate.statsKey());
      failed.put("operation", "observe"); failed.put("routeKey", candidate.routeKey()); failed.put("errorType", error.getClass().getSimpleName()); emitRoutingEvent(failed);
    }
    Map<String, Object> event = eventBase("observation", candidate.statsKey());
    event.put("routeKey", candidate.routeKey()); event.put("serviceName", candidate.service().getName()); event.put("outcome", observation.outcome());
    event.put("latencyMs", observation.latencyMs()); event.put("streaming", streaming); event.put("reason", reason); event.put("status", status); emitRoutingEvent(event);
  }

  private String failureReason(AxAIServiceError error) {
    if (error instanceof AxAIServiceStatusError) return "status";
    if (error instanceof AxAIServiceNetworkError) return "network";
    if (error instanceof AxAIServiceResponseError) return "response";
    if (error instanceof AxAIServiceStreamTerminatedError) return "stream-terminated";
    if (error instanceof AxAIServiceTimeoutError) return "timeout";
    return "response";
  }

  private double adaptiveCost(AxAIService service, String routeKey, Map<String, Object> request) {
    String logicalModel = String.valueOf(request.getOrDefault("model", "default"));
    String resolvedModel = logicalModel;
    for (Map<String, Object> entry : service.getModelList()) if (java.util.Objects.equals(entry.get("key"), request.get("model"))) { resolvedModel = String.valueOf(entry.getOrDefault("model", logicalModel)); break; }
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("service", service); context.put("serviceIndex", adaptive.indices.get(service)); context.put("routeKey", routeKey); context.put("logicalModel", logicalModel); context.put("resolvedModel", resolvedModel); context.put("expectedTokens", adaptive.strategy.expectedTokens);
    double cost;
    if (adaptive.strategy.estimateCost != null) cost = adaptive.strategy.estimateCost.applyAsDouble(context);
    else if (adaptive.strategy.expectedTokens == null) cost = service.getEstimatedCost(null);
    else {
      double prompt = Core.asDouble(adaptive.strategy.expectedTokens.getOrDefault("promptTokens", adaptive.strategy.expectedTokens.getOrDefault("prompt_tokens", 0)));
      double completion = Core.asDouble(adaptive.strategy.expectedTokens.getOrDefault("completionTokens", adaptive.strategy.expectedTokens.getOrDefault("completion_tokens", 0)));
      cost = service.getEstimatedCost(Map.of("ai", service.getName(), "model", resolvedModel, "tokens", Map.of("promptTokens", prompt, "completionTokens", completion, "totalTokens", prompt + completion)));
    }
    if (!Double.isFinite(cost) || cost < 0) throw new IllegalArgumentException("Adaptive estimated cost for route \"" + routeKey + "\" must be finite and non-negative.");
    return cost;
  }

  private List<AdaptiveCandidate> rankAdaptive(Map<String, Object> request, Map<String, Object> options) {
    List<AxAIService> eligible = candidateServices(request);
    String logicalModel = String.valueOf(request.getOrDefault("model", "default"));
    Map<String, Object> routingContext = new LinkedHashMap<>(); routingContext.put("model", request.get("model")); routingContext.put("options", options == null ? Map.of() : options);
    String slice = adaptive.strategy.slice == null ? "default" : adaptive.strategy.slice.apply(routingContext);
    slice = slice == null ? "" : slice.trim();
    if (slice.isEmpty()) throw new IllegalArgumentException("Adaptive slice must be non-empty.");
    List<AdaptiveCandidate> ranked = new ArrayList<>();
    for (int order = 0; order < eligible.size(); order++) {
      AxAIService service = eligible.get(order); String routeKey = adaptive.routeKeys.get(service);
      AxBalancerStatsKey key = new AxBalancerStatsKey(adaptive.strategy.namespace, slice, logicalModel, routeKey);
      Map<String, Object> health = AxBalancerAdaptive.sampleRouteHealth(readStats(key), adaptive.strategy.deadlineMs);
      double failure = Core.asDouble(health.get("failureProbability")); double late = Core.asDouble(health.get("deadlineMissProbability")); double estimated = adaptiveCost(service, routeKey, request);
      double score = Core.asDouble(Core.provider_balancer_adaptive_score(estimated, adaptive.strategy.badOutcomeCost, failure, late));
      ranked.add(new AdaptiveCandidate(service, order, routeKey, key, score, estimated, failure, late));
    }
    Map<String, AdaptiveCandidate> rankedByKey = new LinkedHashMap<>();
    List<Map<String, Object>> rankInput = new ArrayList<>();
    for (AdaptiveCandidate value : ranked) {
      rankedByKey.put(value.routeKey(), value);
      rankInput.add(Map.of("routeKey", value.routeKey(), "score", value.score(), "order", value.order()));
    }
    List<AdaptiveCandidate> coreRanked = new ArrayList<>();
    for (Object raw : Core.asList(Core.provider_balancer_rank_candidates(rankInput))) coreRanked.add(rankedByKey.get(String.valueOf(Core.asMap(raw).get("routeKey"))));
    ranked = coreRanked;
    Map<String, Object> event = eventBase("ranked", ranked.get(0).statsKey()); List<Map<String, Object>> scores = new ArrayList<>();
    for (AdaptiveCandidate value : ranked) scores.add(Map.of("routeKey", value.routeKey(), "serviceName", value.service().getName(), "score", value.score(), "estimatedCost", value.estimatedCost(), "failureProbability", value.failureProbability(), "deadlineMissProbability", value.deadlineMissProbability()));
    event.put("candidates", scores); emitRoutingEvent(event); return ranked;
  }

  private Map<String, Object> adaptiveChat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    List<AdaptiveCandidate> ranked = rankAdaptive(request, options); AxAIServiceError last = null;
    for (int index = 0; index < ranked.size(); index++) {
      AdaptiveCandidate candidate = ranked.get(index); currentService = candidate.service(); Map<String, Object> selected = eventBase("selected", candidate.statsKey());
      selected.put("routeKey", candidate.routeKey()); selected.put("serviceName", candidate.service().getName()); selected.put("attempt", index + 1); emitRoutingEvent(selected);
      long started = System.nanoTime();
      try {
        Map<String, Object> response = candidate.service().chat(request, options); observe(candidate, AxBalancerStatsObservation.success(Math.max(1, (System.nanoTime() - started) / 1_000_000.0)), false, null, null); return response;
      } catch (AxAIServiceError error) {
        if (!retryable(error)) throw error; last = error; String reason = failureReason(error); observe(candidate, AxBalancerStatsObservation.failure(), false, reason, error.status);
        Map<String, Object> fallback = eventBase("fallback", candidate.statsKey()); fallback.put("fromRouteKey", candidate.routeKey()); fallback.put("toRouteKey", index + 1 < ranked.size() ? ranked.get(index + 1).routeKey() : null); fallback.put("reason", reason); fallback.put("status", error.status); emitRoutingEvent(fallback);
      }
    }
    if (last != null) throw last; throw new IllegalArgumentException("All candidate services exhausted (tried " + ranked.size() + " service(s))");
  }

  private void reset() {
    currentServiceIndex = 0;
    currentService = services.get(0);
  }

  public String getId() { return currentService.getId(); }
  public String getName() { return currentService.getName(); }

  public List<Map<String, Object>> getModelList() {
    for (AxAIService service : services) if (service.getModelList() != null) return service.getModelList();
    return null;
  }

  private static boolean featureTruthy(Map<String, Object> features, String key, String alt) {
    if (Core.truthy(features.get(key))) return true;
    return alt != null && Core.truthy(features.get(alt));
  }

  private static void appendUnique(List<Object> target, Object values) {
    for (Object value : Core.asList(values == null ? List.of() : values)) if (!target.contains(value)) target.add(value);
  }

  private static Map<String, Object> balancerBaseFeatures() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("functions", false);
    out.put("streaming", false);
    out.put("thinking", false);
    out.put("multiTurn", false);
    out.put("structuredOutputs", false);
    Map<String, Object> media = new LinkedHashMap<>();
    media.put("images", new LinkedHashMap<>(Map.of("supported", false, "formats", new ArrayList<>())));
    media.put("audio", new LinkedHashMap<>(Map.of("supported", false, "formats", new ArrayList<>())));
    media.put("files", new LinkedHashMap<>(Map.of("supported", false, "formats", new ArrayList<>(), "uploadMethod", "none")));
    media.put("urls", new LinkedHashMap<>(Map.of("supported", false, "webSearch", false, "contextFetching", false)));
    out.put("media", media);
    out.put("caching", new LinkedHashMap<>(Map.of("supported", false, "types", new ArrayList<>())));
    return out;
  }

  private static Map<String, Object> metricBucket() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("mean", 0.0);
    out.put("p95", 0.0);
    out.put("p99", 0.0);
    out.put("samples", new ArrayList<>());
    return out;
  }

  private static Map<String, Object> errorBucket() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("count", 0.0);
    out.put("rate", 0.0);
    out.put("total", 0.0);
    return out;
  }

  private static Map<String, Object> balancerBaseMetrics() {
    Map<String, Object> latency = new LinkedHashMap<>();
    latency.put("chat", metricBucket());
    latency.put("embed", metricBucket());
    Map<String, Object> errors = new LinkedHashMap<>();
    errors.put("chat", errorBucket());
    errors.put("embed", errorBucket());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("latency", latency);
    out.put("errors", errors);
    return out;
  }

  public Map<String, Object> getFeatures(String model) {
    Map<String, Object> features = balancerBaseFeatures();
    Map<String, Object> media = Core.asMap(features.get("media"));
    for (AxAIService service : services) {
      Map<String, Object> raw = service.getFeatures(model);
      for (String key : List.of("functions", "streaming", "thinking", "multiTurn", "structuredOutputs", "functionCot", "hasThinkingBudget", "hasShowThoughts")) {
        String alt = switch (key) {
          case "multiTurn" -> "multi_turn";
          case "structuredOutputs" -> "structured_outputs";
          case "functionCot" -> "function_cot";
          case "hasThinkingBudget" -> "has_thinking_budget";
          case "hasShowThoughts" -> "has_show_thoughts";
          default -> null;
        };
        if (featureTruthy(raw, key, alt)) features.put(key, true);
      }
      Map<String, Object> rawMedia = Core.asMap(raw.getOrDefault("media", Map.of()));
      for (String kind : List.of("images", "audio", "files")) {
        Map<String, Object> src = Core.asMap(rawMedia.getOrDefault(kind, Map.of()));
        Map<String, Object> dst = Core.asMap(media.get(kind));
        if (Core.truthy(src.get("supported"))) dst.put("supported", true);
        appendUnique(Core.asList(dst.get("formats")), src.get("formats"));
      }
      Object upload = Core.asMap(rawMedia.getOrDefault("files", Map.of())).get("uploadMethod");
      if (upload == null) upload = Core.asMap(rawMedia.getOrDefault("files", Map.of())).get("upload_method");
      if (upload != null && !"none".equals(String.valueOf(upload))) Core.asMap(media.get("files")).put("uploadMethod", upload);
      Map<String, Object> urls = Core.asMap(rawMedia.getOrDefault("urls", Map.of()));
      if (Core.truthy(urls.get("supported"))) Core.asMap(media.get("urls")).put("supported", true);
      if (Core.truthy(urls.getOrDefault("webSearch", urls.get("web_search")))) Core.asMap(media.get("urls")).put("webSearch", true);
      if (Core.truthy(urls.getOrDefault("contextFetching", urls.get("context_fetching")))) Core.asMap(media.get("urls")).put("contextFetching", true);
      Map<String, Object> caching = Core.asMap(raw.getOrDefault("caching", Map.of()));
      if (Core.truthy(caching.get("supported"))) Core.asMap(features.get("caching")).put("supported", true);
      appendUnique(Core.asList(Core.asMap(features.get("caching")).get("types")), caching.get("types"));
    }
    return features;
  }

  public Map<String, Object> getMetrics() {
    Map<String, Object> out = balancerBaseMetrics();
    double chatSum = 0, chatCount = 0, embedSum = 0, embedCount = 0;
    for (AxAIService service : services) {
      Map<String, Object> metrics = service.getMetrics();
      Map<String, Object> errors = Core.asMap(metrics.getOrDefault("errors", Map.of()));
      for (String kind : List.of("chat", "embed")) {
        Map<String, Object> src = Core.asMap(errors.getOrDefault(kind, Map.of()));
        Map<String, Object> dst = Core.asMap(Core.asMap(out.get("errors")).get(kind));
        dst.put("count", Core.asDouble(dst.get("count")) + Core.asDouble(src.getOrDefault("count", 0)));
        dst.put("total", Core.asDouble(dst.get("total")) + Core.asDouble(src.getOrDefault("total", 0)));
      }
      Map<String, Object> latency = Core.asMap(metrics.getOrDefault("latency", Map.of()));
      Map<String, Object> chat = Core.asMap(latency.getOrDefault("chat", Map.of()));
      int chatSamples = Core.asList(chat.getOrDefault("samples", List.of())).size();
      if (chatSamples > 0) { chatSum += Core.asDouble(chat.getOrDefault("mean", 0)) * chatSamples; chatCount += chatSamples; }
      Map<String, Object> embed = Core.asMap(latency.getOrDefault("embed", Map.of()));
      int embedSamples = Core.asList(embed.getOrDefault("samples", List.of())).size();
      if (embedSamples > 0) { embedSum += Core.asDouble(embed.getOrDefault("mean", 0)) * embedSamples; embedCount += embedSamples; }
      Map<String, Object> outLatency = Core.asMap(out.get("latency"));
      for (String p : List.of("p95", "p99")) {
        Core.asMap(outLatency.get("chat")).put(p, Math.max(Core.asDouble(Core.asMap(outLatency.get("chat")).get(p)), Core.asDouble(chat.getOrDefault(p, 0))));
        Core.asMap(outLatency.get("embed")).put(p, Math.max(Core.asDouble(Core.asMap(outLatency.get("embed")).get(p)), Core.asDouble(embed.getOrDefault(p, 0))));
      }
    }
    for (String kind : List.of("chat", "embed")) {
      Map<String, Object> dst = Core.asMap(Core.asMap(out.get("errors")).get(kind));
      double total = Core.asDouble(dst.get("total"));
      if (total > 0) dst.put("rate", Core.asDouble(dst.get("count")) / total);
    }
    if (chatCount > 0) Core.asMap(Core.asMap(out.get("latency")).get("chat")).put("mean", chatSum / chatCount);
    if (embedCount > 0) Core.asMap(Core.asMap(out.get("latency")).get("embed")).put("mean", embedSum / embedCount);
    return out;
  }

  public Map<String, Object> chat(Map<String, Object> request) throws Exception { return chat(request, Map.of()); }

  public Map<String, Object> chat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    if (adaptive != null) return adaptiveChat(request, options);
    List<AxAIService> candidates = candidateServices(request);
    int index = 0;
    AxAIService service = candidates.get(index);
    currentService = service;
    while (true) {
      if (!canRetryService(service)) {
        service = nextService(candidates, index);
        index++;
        if (service == null) throw new IllegalArgumentException("All candidate services exhausted (tried " + candidates.size() + " service(s))");
        currentService = service;
        continue;
      }
      try {
        Map<String, Object> response = service.chat(request, options);
        handleSuccess(service);
        return response;
      } catch (AxAIServiceError e) {
        if (!retryable(e)) throw e;
        handleFailure(service);
        Map<String, Object> failure = serviceFailures.get(service.getId());
        if (Core.asInt(failure.getOrDefault("retries", 0)) >= maxRetries) {
          service = nextService(candidates, index);
          index++;
          if (service == null) throw e;
          currentService = service;
        }
      }
    }
  }

  public Iterable<Map<String, Object>> stream(Map<String, Object> request) throws Exception {
    if (adaptive == null) return AxAIService.super.stream(request);
    List<AdaptiveCandidate> ranked = rankAdaptive(request, Map.of()); AxAIServiceError last = null;
    for (int index = 0; index < ranked.size(); index++) {
      AdaptiveCandidate candidate = ranked.get(index); currentService = candidate.service(); Map<String, Object> selected = eventBase("selected", candidate.statsKey());
      selected.put("routeKey", candidate.routeKey()); selected.put("serviceName", candidate.service().getName()); selected.put("attempt", index + 1); emitRoutingEvent(selected);
      long started = System.nanoTime();
      try {
        List<Map<String, Object>> chunks = new ArrayList<>(); for (Map<String, Object> chunk : candidate.service().stream(request)) chunks.add(chunk);
        observe(candidate, AxBalancerStatsObservation.success(Math.max(1, (System.nanoTime() - started) / 1_000_000.0)), true, null, null); return chunks;
      } catch (AxAIServiceError error) {
        if (!retryable(error)) throw error; last = error; String reason = failureReason(error); observe(candidate, AxBalancerStatsObservation.failure(), true, reason, error.status);
        Map<String, Object> fallback = eventBase("fallback", candidate.statsKey()); fallback.put("fromRouteKey", candidate.routeKey()); fallback.put("toRouteKey", index + 1 < ranked.size() ? ranked.get(index + 1).routeKey() : null); fallback.put("reason", reason); fallback.put("status", error.status); emitRoutingEvent(fallback);
      }
    }
    if (last != null) throw last; throw new IllegalArgumentException("All candidate services exhausted (tried " + ranked.size() + " service(s))");
  }

  public Map<String, Object> embed(Map<String, Object> request) throws Exception { return embed(request, Map.of()); }

  public Map<String, Object> embed(Map<String, Object> request, Map<String, Object> options) throws Exception {
    reset();
    int index = currentServiceIndex;
    while (true) {
      if (!canRetryService(currentService)) {
        AxAIService next = nextService(services, index);
        index++;
        if (next == null) throw new IllegalArgumentException("All services exhausted (tried " + services.size() + " service(s))");
        currentService = next;
        currentServiceIndex = index;
        continue;
      }
      try {
        Map<String, Object> response = currentService.embed(request, options);
        handleSuccess(currentService);
        return response;
      } catch (AxAIServiceError e) {
        if (!retryable(e)) throw e;
        handleFailure(currentService);
        Map<String, Object> failure = serviceFailures.get(currentService.getId());
        if (Core.asInt(failure.getOrDefault("retries", 0)) >= maxRetries) {
          AxAIService next = nextService(services, index);
          index++;
          if (next == null) throw e;
          currentService = next;
          currentServiceIndex = index;
        }
      }
    }
  }

  public Map<String, Object> transcribe(Map<String, Object> request) throws Exception { return transcribe(request, Map.of()); }
  public Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) throws Exception { return currentService.transcribe(request, options); }
  public Map<String, Object> speak(Map<String, Object> request) throws Exception { return speak(request, Map.of()); }
  public Map<String, Object> speak(Map<String, Object> request, Map<String, Object> options) throws Exception { return currentService.speak(request, options); }
  public Consumer<String> getLogger() { return currentService.getLogger(); }
  public double getEstimatedCost(Map<String, Object> modelUsage) { return currentService.getEstimatedCost(modelUsage); }
  public String getLastUsedChatModel() { return currentService.getLastUsedChatModel(); }
  public String getLastUsedEmbedModel() { return currentService.getLastUsedEmbedModel(); }
  public Map<String, Object> getLastUsedModelConfig() { return currentService.getLastUsedModelConfig(); }
  public void setOptions(Map<String, Object> options) { for (AxAIService service : services) service.setOptions(options); currentService.setOptions(options); debug = Core.truthy(Core.asMap(options).getOrDefault("debug", debug)); }
  public Map<String, Object> getOptions() { return currentService.getOptions(); }
  public Map<String, Object> complete(Map<String, Object> request) throws Exception { return Core.asMap(Core.chat_response_to_completion(chat(Core.coerceChatRequest(request)))); }
}
