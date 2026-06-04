#include "axllm/axllm.hpp"

#include <iostream>

struct FakeOptimizer : axllm::OptimizerEngine {
  std::string name() const override { return "fixture"; }
  std::string version() const override { return "1"; }

  axllm::Value optimize(axllm::Value) override {
    return axllm::object({
        {"componentMap", axllm::object({{"qa::instruction", "Prefer artifact-backed answers."}})},
        {"metadata",
         axllm::object({
             {"evidence", axllm::object({{"avg", 1}})},
             {"provenance", axllm::object({{"sourceProgramKind", "axgen"}})},
         })},
    });
  }
};

int main() {
  axllm::AxGen program = axllm::ax(
      "question:string -> answer:string",
      axllm::object({{"id", "qa"}, {"instruction", "Base."}}));
  FakeOptimizer optimizer;
  axllm::Value artifact =
      program.optimize_with(optimizer, axllm::Value::array(), axllm::object({{"apply", false}}));
  axllm::Value before = program.get_optimizable_components();
  program.apply_optimization(axllm::Value(axllm::stringify(artifact)));
  axllm::Value after = program.get_optimizable_components();

  std::cout << axllm::stringify(axllm::object({{"artifact", artifact}, {"before", before}, {"after", after}}))
            << "\n";
}
