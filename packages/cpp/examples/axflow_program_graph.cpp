#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedClient : axllm::AIClient {
  axllm::Value complete(axllm::Value) override {
    return axllm::object({{"content", "{\"answer\":\"Paris\"}"}});
  }
};

int main() {
  axllm::AxGen qa = axllm::ax("question:string -> answer:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "example.flow"}})).execute("qa", qa).returns(axllm::object({{"answer", "answer"}}));
  ScriptedClient client;
  axllm::Value out = program.forward(client, axllm::object({{"question", "Capital of France?"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Paris")) return 1;
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(program.get_plan(), "steps"), 0), "name"), "qa")) return 2;
  std::cout << "cpp-axflow-ok\n";
}
