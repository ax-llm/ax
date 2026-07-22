package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public record AxBalancerStatsKey(String namespace, String slice, String logicalModel, String routeKey) {
  public AxBalancerStatsKey {
    if (namespace == null || namespace.isBlank() || slice == null || slice.isBlank() || logicalModel == null || logicalModel.isBlank() || routeKey == null || routeKey.isBlank()) {
      throw new IllegalArgumentException("Adaptive stats key fields must be non-empty.");
    }
  }
  Map<String, Object> toMap() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("namespace", namespace); out.put("slice", slice); out.put("logicalModel", logicalModel); out.put("routeKey", routeKey);
    return out;
  }
}
