package dev.axllm.ax;

import java.util.Map;

public interface AxAIService extends AiClient {
  String getId();
  String getName();
  Map<String, Object> getFeatures(String model);
  default java.util.List<Map<String, Object>> getModelList() { return java.util.List.of(); }
  Map<String, Object> getMetrics();
  default java.util.function.Consumer<String> getLogger() { return ignored -> {}; }
  String getLastUsedChatModel();
  String getLastUsedEmbedModel();
  Map<String, Object> getLastUsedModelConfig();
  void setOptions(Map<String, Object> options);
  Map<String, Object> getOptions();
  Map<String, Object> embed(Map<String, Object> request) throws Exception;
  default Map<String, Object> embed(Map<String, Object> request, Map<String, Object> options) throws Exception { return embed(request); }
  default double getEstimatedCost(Map<String, Object> modelUsage) { return 0.0; }

  default Map<String, Object> chat(Map<String, Object> request, Map<String, Object> options) throws Exception { return chat(request); }

  Map<String, Object> transcribe(Map<String, Object> request) throws Exception;
  default Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) throws Exception { return transcribe(request); }

  Map<String, Object> speak(Map<String, Object> request) throws Exception;
  default Map<String, Object> speak(Map<String, Object> request, Map<String, Object> options) throws Exception { return speak(request); }
}
