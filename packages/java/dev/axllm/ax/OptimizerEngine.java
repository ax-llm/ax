package dev.axllm.ax;

import java.util.Map;

public interface OptimizerEngine {
  default String name() { return "host"; }
  default String version() { return "host"; }
  Map<String, Object> optimize(Map<String, Object> request);
  default Map<String, Object> optimize(Map<String, Object> request, OptimizerEvaluator evaluator) {
    return optimize(request);
  }
}
