package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public final class AxMultiServiceRouter implements AxAIService {
  public static final class Entry {
    public final String key;
    public final AxAIService service;
    public final String description;
    public final boolean isInternal;
    public Entry(String key, AxAIService service, String description) {
      this(key, service, description, false);
    }
    public Entry(String key, AxAIService service, String description, boolean isInternal) {
      this.key = key;
      this.service = service;
      this.description = description == null ? "" : description;
      this.isInternal = isInternal;
    }
  }

  private final LinkedHashMap<String, Map<String, Object>> services = new LinkedHashMap<>();
  private AxAIService lastUsedService;
  private Map<String, Object> options = new LinkedHashMap<>();

  public AxMultiServiceRouter(List<?> items) {
    if (items == null || items.isEmpty()) throw new IllegalArgumentException("No AI services provided.");
    int index = 0;
    for (Object item : items) {
      if (item instanceof Entry entry) {
        addKeyEntry(entry.key, entry.service, entry.description, entry.isInternal);
      } else if (item instanceof Map<?, ?> raw && raw.containsKey("key")) {
        Map<String, Object> map = Core.asMap(raw);
        addKeyEntry(String.valueOf(map.get("key")), (AxAIService) map.get("service"), String.valueOf(map.getOrDefault("description", "")), Core.truthy(map.getOrDefault("isInternal", map.get("is_internal"))));
      } else {
        AxAIService service = (AxAIService) item;
        List<Map<String, Object>> modelList = service.getModelList();
        if (modelList == null || modelList.isEmpty()) throw new IllegalArgumentException("Service " + index + " '" + service.getName() + "' has no model list.");
        for (Map<String, Object> modelEntry : modelList) {
          String key = String.valueOf(modelEntry.get("key"));
          if (services.containsKey(key)) {
            AxAIService other = (AxAIService) services.get(key).get("service");
            throw new IllegalArgumentException("Service " + index + " '" + service.getName() + "' has duplicate model key: " + key + " as service " + other.getName());
          }
          Map<String, Object> stored = new LinkedHashMap<>();
          stored.put("service", service);
          stored.put("description", modelEntry.getOrDefault("description", ""));
          if (modelEntry.containsKey("model") && modelEntry.get("model") != null) stored.put("model", modelEntry.get("model"));
          else if (modelEntry.containsKey("embedModel") && modelEntry.get("embedModel") != null) stored.put("embedModel", modelEntry.get("embedModel"));
          else throw new IllegalArgumentException("Key " + key + " in model list for service " + index + " '" + service.getName() + "' is missing a model or embedModel property.");
          services.put(key, stored);
        }
      }
      index++;
    }
  }

  public static AxMultiServiceRouter create(List<?> services) { return new AxMultiServiceRouter(services); }

  private void addKeyEntry(String key, AxAIService service, String description, boolean isInternal) {
    if (services.containsKey(key)) throw new IllegalArgumentException("Duplicate model key: " + key);
    Map<String, Object> stored = new LinkedHashMap<>();
    stored.put("service", service);
    stored.put("description", description == null ? "" : description);
    stored.put("isInternal", isInternal);
    services.put(key, stored);
  }

  public String getId() {
    List<String> ids = new ArrayList<>();
    for (Map<String, Object> entry : services.values()) ids.add(((AxAIService) entry.get("service")).getId());
    return "MultiServiceRouter:" + String.join(",", ids);
  }

  public String getName() { return "MultiServiceRouter"; }

  public List<Map<String, Object>> getModelList() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map.Entry<String, Map<String, Object>> raw : services.entrySet()) {
      Map<String, Object> entry = raw.getValue();
      if (Core.truthy(entry.get("isInternal"))) continue;
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("key", raw.getKey());
      item.put("description", entry.getOrDefault("description", ""));
      if (entry.containsKey("model")) item.put("model", entry.get("model"));
      else if (entry.containsKey("embedModel")) item.put("embedModel", entry.get("embedModel"));
      else throw new IllegalArgumentException("Service " + raw.getKey() + " has no model or embedModel");
      out.add(item);
    }
    return out;
  }

  public Map<String, Object> getFeatures(String model) {
    if (model != null && services.containsKey(model)) return ((AxAIService) services.get(model).get("service")).getFeatures(model);
    return Core.defaultRouterFeatures();
  }

  public Map<String, Object> chat(Map<String, Object> request) throws Exception { return chat(request, Map.of()); }

  public Map<String, Object> chat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Object modelKey = request.get("model");
    if (modelKey == null) throw new IllegalArgumentException("Model key must be specified for multi-service");
    Map<String, Object> entry = services.get(String.valueOf(modelKey));
    if (entry == null) throw new IllegalArgumentException("No service found for model key: " + modelKey);
    lastUsedService = (AxAIService) entry.get("service");
    Map<String, Object> req = new LinkedHashMap<>(request);
    if (req.containsKey("modelConfig") && !req.containsKey("model_config")) req.put("model_config", req.get("modelConfig"));
    if (!entry.containsKey("model")) req.remove("model");
    return lastUsedService.chat(req, options);
  }

  public Map<String, Object> embed(Map<String, Object> request) throws Exception {
    return embed(request, Map.of());
  }

  public Map<String, Object> embed(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Object modelKey = request.getOrDefault("embedModel", request.get("embed_model"));
    if (modelKey == null) throw new IllegalArgumentException("Embed model key must be specified for multi-service");
    Map<String, Object> entry = services.get(String.valueOf(modelKey));
    if (entry == null) throw new IllegalArgumentException("No service found for embed model key: " + modelKey);
    lastUsedService = (AxAIService) entry.get("service");
    Map<String, Object> req = new LinkedHashMap<>(request);
    if (!entry.containsKey("model")) {
      req.remove("embedModel");
      req.remove("embed_model");
    }
    return lastUsedService.embed(req, options);
  }

  public Map<String, Object> transcribe(Map<String, Object> request) throws Exception {
    return transcribe(request, Map.of());
  }

  public Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Object modelKey = request.get("model");
    if (modelKey == null) {
      if (services.isEmpty()) throw new IllegalArgumentException("No AI services provided.");
      lastUsedService = (AxAIService) services.values().iterator().next().get("service");
      return lastUsedService.transcribe(request, options);
    }
    Map<String, Object> entry = services.get(String.valueOf(modelKey));
    if (entry == null) throw new IllegalArgumentException("No service found for transcription model key: " + modelKey);
    lastUsedService = (AxAIService) entry.get("service");
    return lastUsedService.transcribe(request, options);
  }

  public Map<String, Object> speak(Map<String, Object> request) throws Exception {
    return speak(request, Map.of());
  }

  public Map<String, Object> speak(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Object modelKey = request.get("model");
    if (modelKey == null) {
      if (services.isEmpty()) throw new IllegalArgumentException("No AI services provided.");
      lastUsedService = (AxAIService) services.values().iterator().next().get("service");
      return lastUsedService.speak(request, options);
    }
    Map<String, Object> entry = services.get(String.valueOf(modelKey));
    if (entry == null) throw new IllegalArgumentException("No service found for speech model key: " + modelKey);
    lastUsedService = (AxAIService) entry.get("service");
    return lastUsedService.speak(request, options);
  }

  public Map<String, Object> getMetrics() {
    AxAIService service = lastUsedService;
    if (service == null && !services.isEmpty()) service = (AxAIService) services.values().iterator().next().get("service");
    if (service == null) throw new IllegalArgumentException("No service available to get metrics.");
    return service.getMetrics();
  }

  public Consumer<String> getLogger() {
    AxAIService service = lastUsedService;
    if (service == null && !services.isEmpty()) service = (AxAIService) services.values().iterator().next().get("service");
    if (service == null) throw new IllegalArgumentException("No service available to get logger.");
    return service.getLogger();
  }

  public double getEstimatedCost(Map<String, Object> modelUsage) {
    return lastUsedService == null ? 0.0 : lastUsedService.getEstimatedCost(modelUsage);
  }

  public String getLastUsedChatModel() { return lastUsedService == null ? null : lastUsedService.getLastUsedChatModel(); }
  public String getLastUsedEmbedModel() { return lastUsedService == null ? null : lastUsedService.getLastUsedEmbedModel(); }
  public Map<String, Object> getLastUsedModelConfig() { return lastUsedService == null ? null : lastUsedService.getLastUsedModelConfig(); }
  public void setOptions(Map<String, Object> options) { this.options = new LinkedHashMap<>(options == null ? Map.of() : options); for (Map<String, Object> entry : services.values()) ((AxAIService) entry.get("service")).setOptions(this.options); }
  public Map<String, Object> getOptions() { return new LinkedHashMap<>(options); }
  public Map<String, Object> complete(Map<String, Object> request) throws Exception { return Core.asMap(Core.chat_response_to_completion(chat(Core.coerceChatRequest(request)))); }
}
