// docs:start provider-flow
#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.\n";
    return 2;
  }

  const char* model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen outline = axllm::ax("topic:string -> outline:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.openaiApiFlow"}}))
      .execute("outline", outline)
      .map("summary",
           [](axllm::Value) {
             return axllm::object({{"summary", "Generated outline with typed Ax program steps."}});
           })
      .returns(axllm::object({{"outline", "outline"}, {"summary", "summary"}}));
  axllm::Value output = program.forward(
      client,
      axllm::object({{"topic", "how Ax composes typed LLM programs"}}));
  std::cout << axllm::stringify(output) << "\n";
}
// docs:end provider-flow
