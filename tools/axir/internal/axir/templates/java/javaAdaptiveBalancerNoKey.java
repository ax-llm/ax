import dev.axllm.ax.AxBalancerAdaptiveStrategy;
import dev.axllm.ax.AxBalancerStatsKey;
import dev.axllm.ax.AxBalancerStatsObservation;
import dev.axllm.ax.AxInMemoryBalancerStatsStore;

public final class AdaptiveBalancerNoKeyExample {
  public static void main(String[] args) throws Exception {
    var store = new AxInMemoryBalancerStatsStore();
    var key = new AxBalancerStatsKey("checkout", "interactive", "fast-chat", "openai-us");
    store.observe(key, new AxBalancerStatsObservation("success", 180.0));

    var strategy = new AxBalancerAdaptiveStrategy(800, 0.05)
        .namespace("checkout")
        .statsStore(store)
        .routeKey((service, index) -> service.getId());
    System.out.println(strategy.namespace + " " + store.get(key).successes());
  }
}
