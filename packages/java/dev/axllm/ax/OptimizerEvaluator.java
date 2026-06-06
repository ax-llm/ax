package dev.axllm.ax;

import java.util.Map;

public interface OptimizerEvaluator {
  Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options);
}
