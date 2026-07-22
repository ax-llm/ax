#include "axllm/axllm.hpp"

#include <iostream>
#include <memory>

int main() {
  auto store = std::make_shared<axllm::AxInMemoryBalancerStatsStore>();
  auto key = axllm::object({
      {"namespace", "checkout"},
      {"slice", "interactive"},
      {"logicalModel", "fast-chat"},
      {"routeKey", "openai-us"},
  });
  store->observe(key, axllm::object({{"outcome", "success"}, {"latencyMs", 180.0}}));

  auto strategy = std::make_shared<axllm::AxBalancerAdaptiveStrategy>();
  strategy->deadline_ms = 800;
  strategy->bad_outcome_cost = 0.05;
  strategy->name_space = "checkout";
  strategy->stats_store = store;
  strategy->route_key = [](const std::shared_ptr<axllm::AxAIService>& service, std::size_t) {
    return service->get_id();
  };
  std::cout << strategy->name_space << " "
            << axllm::display(axllm::Core::get(store->get(key), "successes")) << "\n";
}
