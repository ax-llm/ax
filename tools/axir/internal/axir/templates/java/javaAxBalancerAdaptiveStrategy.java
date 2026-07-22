package dev.axllm.ax;

import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.ToDoubleFunction;

public final class AxBalancerAdaptiveStrategy {
  public final double deadlineMs;
  public final double badOutcomeCost;
  public Map<String, Object> expectedTokens;
  public ToDoubleFunction<Map<String, Object>> estimateCost;
  public String namespace = "default";
  public Function<Map<String, Object>, String> slice;
  public BiFunction<AxAIService, Integer, String> routeKey;
  public AxBalancerStatsStore statsStore;
  public Consumer<AxBalancerRoutingEvent> onRoutingEvent;

  public AxBalancerAdaptiveStrategy(double deadlineMs, double badOutcomeCost) {
    this.deadlineMs = deadlineMs; this.badOutcomeCost = badOutcomeCost;
  }
  public AxBalancerAdaptiveStrategy expectedTokens(long promptTokens, long completionTokens) { this.expectedTokens = Map.of("promptTokens", promptTokens, "completionTokens", completionTokens); return this; }
  public AxBalancerAdaptiveStrategy estimateCost(ToDoubleFunction<Map<String, Object>> value) { this.estimateCost = value; return this; }
  public AxBalancerAdaptiveStrategy namespace(String value) { this.namespace = value; return this; }
  public AxBalancerAdaptiveStrategy slice(Function<Map<String, Object>, String> value) { this.slice = value; return this; }
  public AxBalancerAdaptiveStrategy routeKey(BiFunction<AxAIService, Integer, String> value) { this.routeKey = value; return this; }
  public AxBalancerAdaptiveStrategy statsStore(AxBalancerStatsStore value) { this.statsStore = value; return this; }
  public AxBalancerAdaptiveStrategy onRoutingEvent(Consumer<AxBalancerRoutingEvent> value) { this.onRoutingEvent = value; return this; }
}
