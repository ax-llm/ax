// ax-example:start
// title: C++ Refinement Flow
// group: flows
// description: Drafts, critiques, and revises an answer through three OpenAI-backed steps.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
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
  axllm::AxGen draft = axllm::ax("topicText:string -> draftText:string");
  axllm::AxGen critique = axllm::ax("draftText:string -> critiqueText:string");
  axllm::AxGen revise = axllm::ax("draftText:string, critiqueText:string -> revisedText:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.refineFlow"}}))
      .execute("draft", draft,
               axllm::object({{"reads", axllm::array({"topicText"})},
                              {"writes", axllm::array({"draftResult", "draftText"})}}))
      .execute("critique", critique,
               axllm::object({{"reads", axllm::array({"draftText"})},
                              {"writes", axllm::array({"critiqueResult", "critiqueText"})}}))
      .execute("revise", revise,
               axllm::object({{"reads", axllm::array({"draftText", "critiqueText"})},
                              {"writes", axllm::array({"reviseResult", "revisedText"})}}))
      .returns(axllm::object({{"revisedText", "revisedText"}}));
  axllm::Value output = program.forward(
      client,
      axllm::object({{"topicText", "Explain automatic flow parallelism to a backend engineer."}}));
  std::cout << axllm::stringify(output) << "\n";
}
