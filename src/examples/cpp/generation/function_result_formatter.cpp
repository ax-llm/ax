// ax-example:start
// title: C++ Tool Result Formatting
// group: generation
// description: Formats a structured inventory tool result as concise text for the model.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 48
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (!key || !*key) key = std::getenv("OPENAI_APIKEY");
  if (!key || !*key) throw std::runtime_error("Set OPENAI_API_KEY or OPENAI_APIKEY.");
  const char* model = std::getenv("AX_OPENAI_MODEL");
  auto client = axllm::ai("openai", axllm::object({{"api_key", key}, {"model", model && *model ? model : "gpt-6-luna"}}));
  auto schema = axllm::object({{"type", "object"}, {"properties", axllm::Value::object()}, {"additionalProperties", false}});
  axllm::Tool inventory("inventory", "Read the current stock count.", schema, [](axllm::Value) {
    return axllm::object({{"available", 12}, {"warehouse", "A"}});
  });
  auto program = axllm::ax("question:string -> answer:string");
  program.add_tool(inventory);
  // The model receives this text; tool traces retain the original object.
  program.set_function_result_formatter([](const axllm::Value& result) {
    return axllm::display(axllm::Core::get(result, "available")) + " units available";
  });
  auto result = program.forward(*client, axllm::object({{"question", "Call inventory and report how many units are available."}}));
  std::cout << axllm::display(axllm::Core::get(result, "answer")) << "\n";
}
