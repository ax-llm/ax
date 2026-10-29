// ax-example:start
// title: C++ GEPA Optimization
// group: optimization
// description: Scores real OpenAI predictions before and after GEPA instruction search.
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

struct PriorityEvaluator : axllm::OptimizerEvaluator {
  axllm::AxGen& program;
  axllm::AIClient& client;
  PriorityEvaluator(axllm::AxGen& p, axllm::AIClient& c) : program(p), client(c) {}
  axllm::Value evaluate(axllm::Value candidate, axllm::Value options) override {
    auto result = program.evaluate_optimization(client, axllm::Core::get(options, "dataset"), candidate, options);
    double sum = 0;
    auto rows = axllm::Core::get(result, "rows");
    for (auto row : axllm::Core::iter(rows)) {
      auto expected = axllm::Core::get(axllm::Core::get(row, "input"), "expectedOutput");
      auto output = axllm::Core::get(axllm::Core::get(row, "prediction"), "output");
      double score = axllm::Core::truthy(axllm::Core::eq(axllm::Core::get(output, "priority"), axllm::Core::get(expected, "priority"))) ? 1 : 0;
      axllm::Core::set(row, "scores", axllm::object({{"accuracy", score}}));
      axllm::Core::set(row, "scalar", score);
      sum += score;
    }
    axllm::Core::set(result, "avg", sum / axllm::Core::iter(rows).size());
    return result;
  }
};
static axllm::Value task(const char* text, const char* priority) {
  return axllm::object({{"input", axllm::object({{"emailText", text}})}, {"expectedOutput", axllm::object({{"priority", priority}})}});
}

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  auto client = axllm::ai("openai", axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.6-luna" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen program = axllm::ax("emailText:string -> priority:class \"high, normal, low\", rationale:string", axllm::object({{"id", "priority"}, {"instruction", "Classify the email priority."}}));
  axllm::Value baseline = program.forward(*client, axllm::object({{"emailText", "Production checkout is failing for enterprise customers."}}));
  auto request = axllm::object({
      {"programKind", "axgen"}, {"components", program.get_optimizable_components()},
      {"dataset", axllm::object({{"train", axllm::array({task("URGENT: checkout is down", "high"), task("Weekly product newsletter", "low")})},
          {"validation", axllm::array({task("Production payments are failing", "high"), task("Optional community meetup invite", "low")})}})},
      {"options", axllm::object({{"numTrials", 1}, {"minibatchSize", 2}, {"maxMetricCalls", 12}, {"bootstrap", false}, {"seed", 7}})},
  });
  PriorityEvaluator evaluator(program, *client);
  axllm::AxGEPA gepa(client.get(), axllm::object({{"seed", 7}}));
  auto artifact = gepa.optimize(request, &evaluator);
  auto original = axllm::Core::get(artifact, "baselineScore");
  auto best = axllm::Core::get(axllm::Core::get(artifact, "metadata"), "bestScore");
  std::cout << axllm::stringify(axllm::object({{"baselinePrediction", baseline}, {"baselineScore", original},
      {"baselineScores", axllm::Core::get(artifact, "baselineScores")}, {"optimizedScore", best}, {"delta", axllm::Core::number(best) - axllm::Core::number(original)}})) << "\n";
}
