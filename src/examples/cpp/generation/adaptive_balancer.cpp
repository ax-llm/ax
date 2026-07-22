// ax-example:start
// title: C++ Adaptive Provider Balancing
// group: generation
// description: Routes equivalent chat traffic using shared reliability, latency, and cost statistics.
// provider: openai-compatible
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// story: 45
// ax-example:end
#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>
#include <memory>
#include <vector>

int main() {
  const char* raw_key = std::getenv("OPENAI_API_KEY");
  if (raw_key == nullptr || std::string(raw_key).empty()) raw_key = std::getenv("OPENAI_APIKEY");
  if (raw_key == nullptr || std::string(raw_key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const std::string model = std::getenv("AX_OPENAI_MODEL") == nullptr ? "gpt-5.4-mini" : std::getenv("AX_OPENAI_MODEL");
  auto primary = std::make_shared<axllm::OpenAICompatibleClient>(axllm::object({{"api_key", raw_key}, {"model", model}}));
  auto backup = std::make_shared<axllm::OpenAICompatibleClient>(axllm::object({{"api_key", raw_key}, {"model", model}}));

  auto store = std::make_shared<axllm::AxInMemoryBalancerStatsStore>();
  std::vector<std::string> route_keys{"openai-primary", "openai-backup"};
  std::vector<std::string> events;
  auto strategy = std::make_shared<axllm::AxBalancerAdaptiveStrategy>();
  strategy->deadline_ms = 6'000;
  strategy->bad_outcome_cost = 0.02;
  strategy->expected_tokens = axllm::object({{"promptTokens", 1'200}, {"completionTokens", 300}});
  strategy->name_space = "support-summary-v1";
  strategy->route_key = [route_keys](const std::shared_ptr<axllm::AxAIService>&, std::size_t index) { return route_keys.at(index); };
  strategy->slice = [](axllm::Value context) { return axllm::Core::truthy(axllm::Core::get(axllm::Core::get(context, "options"), "stream")) ? "streaming" : "interactive"; };
  strategy->stats_store = store;
  strategy->on_routing_event = [&events](axllm::Value event) { events.push_back(axllm::display(axllm::Core::get(event, "type"))); };

  axllm::AxBalancerOptions options;
  options.strategy = strategy;
  axllm::AxBalancer balancer({primary, backup}, options);
  auto response = balancer.chat(axllm::object({{"model", model}, {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "Summarize why shared routing state matters."}})})}}));
  std::cout << axllm::stringify(response) << "\n" << events.size() << " routing events\n";
}
