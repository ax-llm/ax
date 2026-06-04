#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <string>

int main() {
  const char* api_key = std::getenv("OPENAI_API_KEY");
  if (api_key == nullptr || std::string(api_key).empty()) {
    api_key = std::getenv("OPENAI_APIKEY");
  }
  if (api_key == nullptr || std::string(api_key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }

  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", api_key},
      {"model", std::getenv("AX_LIVE_MODEL") ? std::getenv("AX_LIVE_MODEL") : "gpt-4.1-mini"},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));

  auto program = axllm::ax("question:string -> answer:string");
  axllm::Value output = program.forward(client, axllm::object({
      {"question", "In one sentence, explain Ax as a language-agnostic LLM programming library."},
  }));

  std::cout << axllm::stringify(output) << "\n";
}
