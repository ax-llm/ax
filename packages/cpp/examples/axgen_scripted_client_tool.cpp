#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedClient : axllm::AIClient {
  int calls = 0;

  axllm::Value complete(axllm::Value) override {
    calls += 1;
    if (calls == 1) {
      return axllm::object({
        {"content", ""},
        {"function_calls", axllm::array({
          axllm::object({{"id", "call_1"}, {"name", "search"}, {"params", axllm::object({{"query", "ax docs"}})}})
        })}
      });
    }
    return axllm::object({{"content", "{\"answer\":\"Found Ax docs\"}"}});
  }
};

int main() {
  axllm::Value parameters = axllm::object({
    {"type", "object"},
    {"properties", axllm::object({{"query", axllm::object({{"type", "string"}})}})},
    {"required", axllm::array({"query"})}
  });
  axllm::Tool search("search", "Search docs", parameters, [](axllm::Value) {
    return axllm::object({{"title", "Ax docs"}});
  });
  auto qa = axllm::ax("query:string -> answer:string")
      .add_tool(search)
      .add_assert(axllm::object({{"field", "answer"}, {"contains", "Ax"}, {"message", "answer should mention Ax"}}))
      .add_field_processor("answer", "trim");
  ScriptedClient client;
  axllm::Value out = qa.forward(client, axllm::object({{"query", "ax docs"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Found Ax docs")) return 1;
  if (axllm::Core::truthy(axllm::Core::is_none(axllm::Core::get(qa.get_traces(), 0)))) return 1;
  std::cout << "cpp-axgen-ok\n";
}
