package dev.axllm.ax;

public interface AxBalancerStatsStore {
  AxBalancerRouteStats get(AxBalancerStatsKey key) throws Exception;
  void observe(AxBalancerStatsKey key, AxBalancerStatsObservation observation) throws Exception;
}
