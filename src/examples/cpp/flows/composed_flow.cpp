// ax-example:start
// title: C++ Composed Flow
// group: flows
// description: Composes multiple typed programs into one OpenAI-backed flow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
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
  axllm::AxGen step = axllm::ax("topic:string -> outline:string[]");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.composedFlow"}}))
      .execute("step", step)
      .map("note", [](axllm::Value) { return axllm::object({{"note", "Mapped flow state after the provider-backed step."}}); })
      .returns(axllm::object({{"step", "step"}, {"note", "note"}}));
  axllm::Value output = program.forward(client, axllm::object({{"topic", "How Ax moves from typed generation to agents, flows, and optimization"}}));
  std::cout << axllm::stringify(output) << "\n";
}
