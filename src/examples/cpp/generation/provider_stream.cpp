// ax-example:start
// title: C++ Incremental Provider Stream
// group: generation
// description: Handles OpenAI SSE chunks incrementally and can cancel by returning false.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
#include "axllm/axllm.hpp"
#include <chrono>
#include <cstdlib>
#include <iostream>

int main() {
  const char* api_key = std::getenv("OPENAI_API_KEY");
  if (api_key == nullptr || std::string(api_key).empty()) api_key = std::getenv("OPENAI_APIKEY");
  if (api_key == nullptr || std::string(api_key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* selected = std::getenv("AX_OPENAI_MODEL");
  std::string model = selected == nullptr || std::string(selected).empty() ? "gpt-5.6-luna" : selected;
  auto client = axllm::ai("openai", axllm::object({{"api_key", api_key}, {"model", model}}));
  const auto started = std::chrono::steady_clock::now();
  client->stream_each(
      axllm::object({{"chat_prompt", axllm::array({axllm::object({
          {"role", "user"}, {"content", "Reply with exactly: streaming works"}})})},
          {"model_config", axllm::object({{"temperature", 1}})}}),
      [&](const axllm::Value& event) {
        std::string content = axllm::display(axllm::Core::get(
            axllm::Core::get(axllm::Core::get(event, "results"), 0), "content", ""));
        if (!content.empty()) {
          auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
              std::chrono::steady_clock::now() - started).count();
          std::cout << "[" << elapsed << " ms] " << content << std::flush;
        }
        return true;
      });
  std::cout << "\n";
}
