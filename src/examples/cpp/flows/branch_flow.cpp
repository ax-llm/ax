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
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen classifier =
      axllm::ax("request:string -> route:class \"support, sales, engineering\"");
  axllm::AxGen responder = axllm::ax("request:string, route:string -> response:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.branchFlow"}}))
      .execute("classifier", classifier,
               axllm::object({{"reads", axllm::array({"request"})},
                              {"writes", axllm::array({"classifierResult", "route"})}}))
      .execute("responder", responder,
               axllm::object({{"reads", axllm::array({"request", "route"})},
                              {"writes", axllm::array({"responderResult", "response"})}}))
      .returns(axllm::object({{"route", "route"}, {"response", "response"}}));
  axllm::Value output = program.forward(client, axllm::object({{"request", "A customer says checkout is down for their enterprise account."}}));
  std::cout << axllm::stringify(output) << "\n";
}
