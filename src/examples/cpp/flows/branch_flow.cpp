// ax-example:start
// title: C++ Branching Flow
// group: flows
// description: Routes a classification through follow-up flow logic backed by OpenAI.
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
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen step = axllm::ax("request:string -> route:class "support, sales, engineering"");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.branchFlow"}}))
      .execute("step", step)
      .map("note", [](axllm::Value) { return axllm::object({{"note", "Mapped flow state after the provider-backed step."}}); })
      .returns(axllm::object({{"step", "step"}, {"note", "note"}}));
  axllm::Value output = program.forward(client, axllm::object({{"request", "A customer says checkout is down for their enterprise account."}}));
  std::cout << axllm::stringify(output) << "\n";
}
