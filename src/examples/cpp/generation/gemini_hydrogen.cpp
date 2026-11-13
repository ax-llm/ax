// ax-example:start
// title: C++ Gemini 4 Hydrogen
// group: generation
// description: Uses Hydrogen with a thinking level and an explicit output limit.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: beginner
// order: 51
// ax-example:end
#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

int main() {
  const char* key = std::getenv("GOOGLE_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("GOOGLE_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.\n";
    return 2;
  }
  auto client = axllm::ai("google-gemini", axllm::object({{"api_key", key}, {"model", "gemini-4-hydrogen"}}));
  auto result = client->chat(axllm::object({
      {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "Why does a hash table usually provide fast lookups?"}})})},
      {"model_config", axllm::object({{"max_tokens", 4096}})},
      // Use "highest" for Hydrogen's xhigh level; "low" keeps this example quick.
  }), axllm::object({{"thinking_token_budget", "low"}}));
  std::cout << axllm::display(axllm::Core::get(axllm::Core::get(axllm::Core::get(result, "results"), 0), "content")) << "\n";
}
