// ax-example:start
// title: C++ Parallel Flow
// group: flows
// description: Runs two independent OpenAI-backed steps in parallel before joining their results.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

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
  axllm::AxGen research = axllm::ax("topicText:string -> factList:string[]");
  axllm::AxGen audience = axllm::ax("topicText:string -> audienceAngle:string");
  axllm::AxGen join = axllm::ax("factList:string[], audienceAngle:string -> briefText:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.parallelFlow"}}))
      .execute("research", research,
               axllm::object({{"reads", axllm::array({"topicText"})},
                              {"writes", axllm::array({"researchResult", "factList"})}}))
      .execute("audience", audience,
               axllm::object({{"reads", axllm::array({"topicText"})},
                              {"writes", axllm::array({"audienceResult", "audienceAngle"})}}))
      .execute("join", join,
               axllm::object({{"reads", axllm::array({"factList", "audienceAngle"})},
                              {"writes", axllm::array({"joinResult", "briefText"})}}))
      .returns(axllm::object({{"briefText", "briefText"}}));
  axllm::Value output = program.forward(
      client,
      axllm::object({{"topicText", "Why typed contracts make multi-step LLM systems easier to maintain"}}));
  std::cout << axllm::stringify(output) << "\n";
}
