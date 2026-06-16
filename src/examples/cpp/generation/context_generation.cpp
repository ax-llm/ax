// ax-example:start
// title: C++ Contextual Generation
// group: generation
// description: Answers from supplied context and returns compact citations with OpenAI.
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
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen program = axllm::ax("context:string, question:string -> answer:string, citations:string[]");
  axllm::Value output = program.forward(client, axllm::object({{"context", "Ax uses signatures, ai(), ax(), agent(), flow(), and optimize()."}, {"question", "How should a new developer think about Ax?"}}));
  std::cout << axllm::stringify(output) << "\n";
}
