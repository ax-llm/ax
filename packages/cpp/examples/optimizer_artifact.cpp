#include "axllm/axllm.hpp"
#include <iostream>

struct FakeOptimizer : axllm::OptimizerEngine {
  std::string name() const override { return "fixture"; }
  std::string version() const override { return "1"; }
  axllm::Value optimize(axllm::Value) override {
    return axllm::object({
      {"componentMap", axllm::object({{"qa::instruction", "Prefer artifact-backed answers."}})},
      {"metadata", axllm::object({
        {"evidence", axllm::object({{"avg", 1}})},
        {"provenance", axllm::object({{"sourceProgramKind", "axgen"}})}
      })}
    });
  }
};

static bool has_instruction(const axllm::AxGen& gen, const std::string& value) {
  axllm::Value components = gen.get_optimizable_components();
  for (int i = 0; ; ++i) {
    axllm::Value item = axllm::Core::get(components, i);
    if (axllm::Core::truthy(axllm::Core::is_none(item))) break;
    if (axllm::equal(axllm::Core::get(item, "id"), "qa::instruction") &&
        axllm::equal(axllm::Core::get(item, "current"), value)) return true;
  }
  return false;
}

int main() {
  axllm::AxGen qa = axllm::ax("question:string -> answer:string", axllm::object({{"id", "qa"}, {"instruction", "Base."}}));
  FakeOptimizer engine;
  axllm::Value artifact = qa.optimize_with(engine, axllm::Value::array(), axllm::object({{"apply", false}}));
  if (!has_instruction(qa, "Base.")) return 1;
  qa.apply_optimization(axllm::Value(axllm::stringify(artifact)));
  if (!has_instruction(qa, "Prefer artifact-backed answers.")) return 2;
  std::cout << "cpp-optimizer-artifact-ok\n";
}
