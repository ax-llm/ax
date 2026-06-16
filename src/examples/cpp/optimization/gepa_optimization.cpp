// ax-example:start
// title: C++ GEPA Optimization
// group: optimization
// description: Pairs a real OpenAI baseline with a local GEPA optimization pass.
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

struct LocalEvaluator : axllm::OptimizerEvaluator {
  axllm::Value evaluate(axllm::Value, axllm::Value) override {
    return axllm::object({{"rows", axllm::array({axllm::object({{"prediction", axllm::object({{"answer", "Ax composes typed LLM programs."}})}, {"scores", axllm::object({{"quality", 0.9}})}, {"scalar", 0.9}})})}, {"avg", 0.9}, {"count", 1}});
  }
};

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
  axllm::AxGen program = axllm::ax("emailText:string -> priority:class \"high, normal, low\", rationale:string", axllm::object({{"id", "priority"}, {"instruction", "Classify the email priority."}}));
  axllm::Value baseline = program.forward(client, axllm::object({{"emailText", "Production checkout is failing for enterprise customers."}}));
  axllm::Value request = axllm::object({{"programKind", "axgen"}, {"components", axllm::array({axllm::object({{"id", "priority::instruction"}, {"owner", "priority"}, {"kind", "instruction"}, {"current", "Classify priority clearly."}})})}, {"dataset", axllm::object({{"train", axllm::array({axllm::object({{"emailText", "URGENT: checkout is down"}})})}})}, {"options", axllm::object({{"numTrials", 0}, {"maxMetricCalls", 4}, {"seed", 7}})}});
  LocalEvaluator evaluator;
  axllm::AxGEPA gepa(axllm::object({{"seed", 7}}));
  axllm::Value artifact = gepa.optimize(request, &evaluator);
  std::cout << axllm::stringify(axllm::object({{"baseline", baseline}, {"artifact", artifact}})) << "\n";
}
