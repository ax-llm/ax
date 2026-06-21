// ax-example:start
// title: C++ Structured Extraction
// group: generation
// description: Extracts structured fields and labels from support text with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen program = axllm::ax("ticket:string -> priority:class \"high, normal, low\", summary:string, labels:string[]");
  axllm::Value output = program.forward(client, axllm::object({{"ticket", "Checkout has failed for enterprise customers since 09:00. Support wants a concise summary and tags."}}));
  std::cout << axllm::stringify(output) << "\n";
}
