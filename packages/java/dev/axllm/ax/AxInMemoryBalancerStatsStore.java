package dev.axllm.ax;

import java.util.HashMap;
import java.util.Map;

public final class AxInMemoryBalancerStatsStore implements AxBalancerStatsStore {
  private final Map<AxBalancerStatsKey, AxBalancerRouteStats> stats = new HashMap<>();
  public synchronized AxBalancerRouteStats get(AxBalancerStatsKey key) { return stats.get(key); }
  public synchronized void observe(AxBalancerStatsKey key, AxBalancerStatsObservation observation) {
    stats.put(key, AxBalancerAdaptive.updateRouteStats(stats.get(key), observation));
  }
}
