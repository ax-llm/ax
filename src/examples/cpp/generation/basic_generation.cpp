// ax-example:start
// title: C++ Prompt-Cached Generation
// group: generation
// description: Runs GPT-5.6 structured generation with stable OpenAI prompt-cache affinity.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 10
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
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.6-luna" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen program = axllm::ax("question:string -> answer:string");
  axllm::Value output = program.forward(
      client,
      axllm::object({{"question", "In one sentence, explain Ax as a language-agnostic LLM programming library."}}),
      axllm::object({{"promptCacheKey", "ax-openai-example"}, {"contextCache", axllm::object({})}}));
  std::cout << axllm::stringify(output) << "\n";
}
