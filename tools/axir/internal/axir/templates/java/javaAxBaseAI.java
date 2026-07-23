package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public abstract class AxBaseAI implements AxAIService {
  protected final String id = UUID.randomUUID().toString();
  protected final String name;
  protected final String model;
  protected final String embedModel;
  protected Map<String, Object> modelConfig;
  protected Map<String, Object> options;
  protected String lastUsedChatModel;
  protected String lastUsedEmbedModel;
  protected Map<String, Object> lastUsedModelConfig;

  protected AxBaseAI(String name, String model, String embedModel, Map<String, Object> modelConfig, Map<String, Object> options) {
    if (model == null || model.isBlank()) throw new IllegalArgumentException("No model defined");
    this.name = name;
    this.model = model;
    this.embedModel = embedModel;
    this.modelConfig = new LinkedHashMap<>();
    this.modelConfig.put("temperature", 0);
    if (modelConfig != null) this.modelConfig.putAll(modelConfig);
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
  }

  public String getId() { return id; }
  public String getName() { return name; }
  public Map<String, Object> getFeatures(String model) { return Core.defaultFeatures(); }
  public Map<String, Object> getMetrics() { return new LinkedHashMap<>(); }
  public java.util.List<Map<String, Object>> getModelList() {
    java.util.List<Map<String, Object>> models = new java.util.ArrayList<>();
    if (model != null && !model.isBlank()) models.add(Map.of("key", model, "description", name + " chat model", "model", model));
    if (embedModel != null && !embedModel.isBlank()) models.add(Map.of("key", embedModel, "description", name + " embed model", "embedModel", embedModel));
    return models;
  }
  public String getLastUsedChatModel() { return lastUsedChatModel; }
  public String getLastUsedEmbedModel() { return lastUsedEmbedModel; }
  public Map<String, Object> getLastUsedModelConfig() { return lastUsedModelConfig == null ? null : new LinkedHashMap<>(lastUsedModelConfig); }
  public void setOptions(Map<String, Object> options) { this.options = new LinkedHashMap<>(options == null ? Map.of() : options); }
  public Map<String, Object> getOptions() { return new LinkedHashMap<>(options); }

  protected Map<String, Object> mergedOptions(Map<String, Object> callOptions) {
    Map<String, Object> overrides = callOptions == null ? Map.of() : callOptions;
    Map<String, Object> merged = Core.asMap(Core.mapMerge(options, overrides));
    Object defaultContext = options.getOrDefault("usage_context", options.get("usageContext"));
    Object overrideContext = overrides.getOrDefault("usage_context", overrides.get("usageContext"));
    Map<String, Object> context = Core.asMap(Core.merge_usage_context(defaultContext, overrideContext));
    if (!context.isEmpty()) {
      merged.put("usage_context", context);
      merged.put("usageContext", context);
    }
    return merged;
  }

  public Map<String, Object> chat(Map<String, Object> request) throws Exception {
    return chat(request, Map.of());
  }

  public Map<String, Object> chat(Map<String, Object> request, Map<String, Object> callOptions) throws Exception {
    Map<String, Object> req = Core.coerceChatRequest(request);
    Core.validate_chat_request(req);
    Map<String, Object> mergedOptions = mergedOptions(callOptions);
    Object rawModel = req.get("model");
    String selectedModel = rawModel == null ? model : String.valueOf(rawModel);
    Map<String, Object> mergedConfig = Core.asMap(Core.merge_model_config(modelConfig, req.get("model_config"), mergedOptions));
    if (mergedOptions.containsKey("stream")) mergedConfig.put("stream", Boolean.TRUE.equals(mergedOptions.get("stream")));
    req = new LinkedHashMap<>(req);
    req.put("model", selectedModel);
    req.put("model_config", mergedConfig);
    lastUsedChatModel = selectedModel;
    lastUsedModelConfig = new LinkedHashMap<>(mergedConfig);
    Map<String, Object> response = doChat(req, mergedOptions);
    AxGlobals.emitUsage("chat", response, mergedOptions, Boolean.TRUE.equals(mergedConfig.get("stream")));
    return response;
  }

  public Map<String, Object> embed(Map<String, Object> request) throws Exception {
    return embed(request, Map.of());
  }

  public Map<String, Object> embed(Map<String, Object> request, Map<String, Object> callOptions) throws Exception {
    Object texts = request.get("texts");
    if (!(texts instanceof java.util.List<?> list) || list.isEmpty()) throw new AxAIServiceResponseError("Embed texts is empty");
    Object modelValue = request.getOrDefault("embed_model", request.get("embedModel"));
    String selected = modelValue == null ? embedModel : String.valueOf(modelValue);
    if (selected == null || selected.isBlank()) throw new AxAIServiceResponseError("Embed model not set");
    Map<String, Object> req = new LinkedHashMap<>(request);
    req.put("embed_model", selected);
    lastUsedEmbedModel = selected;
    Map<String, Object> mergedOptions = mergedOptions(callOptions);
    Map<String, Object> response = doEmbed(req, mergedOptions);
    AxGlobals.emitUsage("embed", response, mergedOptions, false);
    return response;
  }

  public Map<String, Object> complete(Map<String, Object> request) throws Exception {
    return Core.asMap(Core.chat_response_to_completion(chat(Core.coerceChatRequest(request))));
  }

  protected abstract Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) throws Exception;
  protected abstract Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) throws Exception;
}
