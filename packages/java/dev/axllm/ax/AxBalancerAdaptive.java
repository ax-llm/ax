package dev.axllm.ax;

import java.util.Map;

public final class AxBalancerAdaptive {
  private AxBalancerAdaptive() {}
  public static AxBalancerRouteStats createRouteStats() { return AxBalancerRouteStats.fromMap(Core.asMap(Core.provider_balancer_route_stats())); }
  public static AxBalancerRouteStats updateRouteStats(AxBalancerRouteStats current, AxBalancerStatsObservation observation) {
    return AxBalancerRouteStats.fromMap(Core.asMap(Core.provider_balancer_observe_route(current == null ? null : current.toMap(), observation.toMap())));
  }
  public static Map<String, Object> sampleRouteHealth(AxBalancerRouteStats stats, double deadlineMs) {
    return Core.asMap(Core.provider_balancer_sample_health(stats == null ? null : stats.toMap(), deadlineMs));
  }
}
