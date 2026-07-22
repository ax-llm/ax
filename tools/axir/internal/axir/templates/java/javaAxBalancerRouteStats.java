package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public record AxBalancerRouteStats(int version, long observations, long successes, double failureEwma, double logLatencyMean, double logLatencyM2) {
  static AxBalancerRouteStats fromMap(Map<String, Object> value) {
    return new AxBalancerRouteStats(Core.asInt(value.getOrDefault("version", 1)), (long) Core.asDouble(value.getOrDefault("observations", 0)), (long) Core.asDouble(value.getOrDefault("successes", 0)), Core.asDouble(value.getOrDefault("failureEwma", 0.05)), Core.asDouble(value.getOrDefault("logLatencyMean", 0)), Core.asDouble(value.getOrDefault("logLatencyM2", 0)));
  }
  Map<String, Object> toMap() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("version", version); out.put("observations", observations); out.put("successes", successes); out.put("failureEwma", failureEwma); out.put("logLatencyMean", logLatencyMean); out.put("logLatencyM2", logLatencyM2);
    return out;
  }
}
