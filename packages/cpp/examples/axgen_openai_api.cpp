#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY to run this provider API example.\n";
    return 2;
  }

  axllm::OpenAICompatibleClient client(axllm::object({
    {"api_key", key},
    {"model", std::getenv("AX_OPENAI_MODEL") ? std::getenv("AX_OPENAI_MODEL") : "gpt-4.1-mini"},
    {"model_config", axllm::object({{"temperature", 0}})}
  }));
  auto program = axllm::ax("question:string -> answer:string");
  axllm::Value out = program.forward(client, axllm::object({
    {"question", "In one sentence, explain Ax as a language-agnostic LLM programming library."}
  }));
  std::cout << axllm::stringify(out) << "\n";
}
