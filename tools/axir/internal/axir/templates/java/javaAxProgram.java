package dev.axllm.ax;

import java.util.List;
import java.util.Map;

public interface AxProgram {
  Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> options);
  List<Map<String, Object>> getOptimizableComponents();
  default AxProgram applyOptimizedComponents(Map<String, Object> componentMap) { return this; }
  default List<Map<String, Object>> getTraces() { return List.of(); }
  default List<?> getChatLog() { return List.of(); }
  default Object getUsage() { return Map.of(); }
}
