// ax-example:start
// title: C++ Optimization Artifact Reuse
// group: optimization
// description: Saves and reapplies an optimizer artifact after a real OpenAI baseline.
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

struct ExampleOptimizer : axllm::OptimizerEngine {
  std::string name() const override { return "example"; }
  std::string version() const override { return "1"; }
  axllm::Value optimize(axllm::Value request) override { return optimize(std::move(request), nullptr); }
  axllm::Value optimize(axllm::Value, axllm::OptimizerEvaluator*) override {
    return axllm::object({{"componentMap", axllm::object({{"priority::instruction", "Classify operational risk. Use high for production-impacting urgency."}})}, {"metadata", axllm::object({{"source", "artifact"}})}});
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
  ExampleOptimizer optimizer;
  axllm::Value artifact = program.optimize_with(optimizer, axllm::array({axllm::object({{"emailText", "URGENT: checkout is down"}, {"priority", "high"}})}), axllm::object({{"apply", false}}));
  program.apply_optimization(artifact);
  axllm::Value after = program.forward(client, axllm::object({{"emailText", "Production checkout is failing for enterprise customers."}}));
  std::cout << axllm::stringify(axllm::object({{"baseline", baseline}, {"after", after}})) << "\n";
}
