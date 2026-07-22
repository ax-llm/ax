package dev.axllm.ax;

import java.util.Map;

public record AxBalancerStatsObservation(String outcome, Double latencyMs) {
  public AxBalancerStatsObservation {
    if (!"success".equals(outcome) && !"failure".equals(outcome)) throw new IllegalArgumentException("Adaptive observation outcome must be success or failure.");
    if ("success".equals(outcome) && (latencyMs == null || !Double.isFinite(latencyMs) || latencyMs < 0)) throw new IllegalArgumentException("Successful adaptive observations require non-negative latencyMs.");
  }
  public static AxBalancerStatsObservation success(double latencyMs) { return new AxBalancerStatsObservation("success", latencyMs); }
  public static AxBalancerStatsObservation failure() { return new AxBalancerStatsObservation("failure", null); }
  Map<String, Object> toMap() { return latencyMs == null ? Map.of("outcome", outcome) : Map.of("outcome", outcome, "latencyMs", latencyMs); }
}
