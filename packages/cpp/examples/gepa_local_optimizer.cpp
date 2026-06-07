#include "axllm/axllm.hpp"

#include <iostream>

struct LocalEvaluator : axllm::OptimizerEvaluator {
  axllm::Value evaluate(axllm::Value candidate_map, axllm::Value options = axllm::Value::object()) override {
    axllm::Value rows = axllm::Value::array();
    double total = 0.0;
    axllm::Value examples = axllm::Core::get(axllm::Core::get(options, "dataset"), "train", axllm::Value::array());
    std::string instruction = axllm::stringify(axllm::Core::get(candidate_map, "qa::instruction"));
    for (const auto& example : axllm::Core::iter(examples)) {
      double quality = instruction.find("concise") != std::string::npos ? 0.9 : 0.65;
      double brevity = 0.8;
      double scalar = (quality + brevity) / 2.0;
      total += scalar;
      axllm::Core::append(
          rows,
          axllm::object({
              {"input", example},
              {"prediction", axllm::object({{"answer", "Ax composes typed LLM programs."}})},
              {"scores", axllm::object({{"quality", quality}, {"brevity", brevity}})},
              {"scalar", scalar},
          }));
    }
    double count = axllm::Core::iter(rows).size();
    return axllm::object({{"rows", rows}, {"avg", total / count}, {"sum", total}, {"count", count}});
  }
};

int main() {
  axllm::Value request = axllm::object({
      {"programKind", "axgen"},
      {"components",
       axllm::array({
           axllm::object({
               {"id", "qa::instruction"},
               {"owner", "qa"},
               {"kind", "instruction"},
               {"current", "Answer clearly and concisely."},
           }),
       })},
      {"dataset",
       axllm::object({
           {"train",
            axllm::array({
                axllm::object({{"question", "What is Ax?"}}),
                axllm::object({{"question", "Why use typed signatures?"}}),
            })},
           {"validation", axllm::array({axllm::object({{"question", "Summarize Ax."}})})},
       })},
      {"options", axllm::object({{"numTrials", 0}, {"maxMetricCalls", 8}, {"seed", 7}})},
  });

  LocalEvaluator evaluator;
  axllm::AxGEPA gepa(nullptr, axllm::object({{"seed", 7}}));
  axllm::Value artifact = gepa.optimize(request, &evaluator);
  std::cout << axllm::stringify(axllm::object({
                   {"componentMap", axllm::Core::get(artifact, "componentMap")},
                   {"metadata", axllm::Core::get(artifact, "metadata")},
               }))
            << "\n";
}
