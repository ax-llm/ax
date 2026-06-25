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
  private boolean debug;
  private int maxRetries;

  public AxBalancer(List<? extends AxAIService> services) { this(services, Map.of()); }

  public AxBalancer(List<? extends AxAIService> input, Map<String, Object> options) {
    if (input == null || input.isEmpty()) throw new IllegalArgumentException("No AI services provided.");
    this.policy = Core.asMap(Core.provider_balancer_retry_policy(options == null ? Map.of() : options));
    this.debug = Core.truthy(policy.getOrDefault("debug", true));
    this.maxRetries = Core.asInt(policy.getOrDefault("maxRetries", 3));
    this.services = new ArrayList<>(input);
    validateModels();
    if (!"input_order".equals(String.valueOf(policy.getOrDefault("strategy", "metric")))) {
      this.services.sort(Comparator.comparingDouble(service -> Core.asDouble(Core.provider_balancer_metric_score(service.getMetrics()))));
    }
    this.currentService = this.services.get(0);
  }

  public static AxBalancer create(List<? extends AxAIService> services, Map<String, Object> options) { return new AxBalancer(services, options); }
  public static AxBalancer create(List<? extends AxAIService> services) { return new AxBalancer(services); }

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
