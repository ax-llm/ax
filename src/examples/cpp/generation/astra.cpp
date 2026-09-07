// ax-example:start
// title: C++ Astra Generation
// group: generation
// description: Runs Astra through the standard generator with automatic Responses routing and prompt caching.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 11
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>


int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  auto client = axllm::ai("openai", axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-6-astra" : model},
      {"model_config", axllm::object({{"thinkingTokenBudget", "low"}, {"max_tokens", 2048}})},
  }));
  axllm::AxGen program = axllm::ax("question:string -> answer:string");
  axllm::Value output = program.forward(
      *client,
      axllm::object({{"question", "In one sentence, explain Ax as a language-agnostic LLM programming library."}}),
      axllm::object({{"serviceTier", "standard"}, {"promptCacheKey", "ax-openai-example"}, {"contextCache", axllm::object({})}}));
  std::cout << axllm::stringify(output) << "\n";
}
