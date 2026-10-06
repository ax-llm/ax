// ax-example:start
// title: C++ Sonnet 5.5 Between-Tool Thinking
// group: generation
// description: Disables pre-response thinking while retaining signed updates for replay.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 46
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* api_key = std::getenv("ANTHROPIC_API_KEY");
  if (api_key == nullptr || std::string(api_key).empty()) api_key = std::getenv("ANTHROPIC_APIKEY");
  if (api_key == nullptr || std::string(api_key).empty()) throw std::runtime_error("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example.");
  auto client = axllm::ai("anthropic", axllm::object({{"api_key", api_key}, {"model", "claude-sonnet-5-5"}}));
  auto response = client->chat(axllm::object({
    {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "Reply with exactly: Sonnet 5.5 works"}})})},
    {"model_config", axllm::object({{"thinkingTokenBudget", "none"}, {"effort", "high"}, {"maxTokens", 128}})}
  }));
  std::cout << axllm::display(axllm::Core::get(axllm::Core::get(axllm::Core::get(response, "results"), 0), "content")) << "\n";
}
