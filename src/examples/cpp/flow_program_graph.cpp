#include "axllm/axllm.hpp"

#include <iostream>

struct FakeClient : axllm::AIClient {
  axllm::Array responses = {
      axllm::object({{"content", "{\"outline\":\"1. Define Ax. 2. Show one concrete use.\"}"}}),
      axllm::object({{"content", "{\"title\":\"Ax in two steps\"}"}}),
  };

  axllm::Value complete(axllm::Value) override {
    if (responses.empty()) throw axllm::AxError("fixture", "fake service exhausted");
    axllm::Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

int main() {
  axllm::AxGen outline = axllm::ax("topic:string -> outline:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.flow"}}))
      .execute("outline", outline)
      .map("title",
           [](axllm::Value state) {
             return axllm::object({
                 {"title", "Ax in two steps"},
                 {"outlineLength", static_cast<int>(axllm::stringify(axllm::Core::get(state, "outline")).size())},
             });
           })
      .returns(axllm::object({{"outline", "outline"}, {"title", "title"}}));
  FakeClient client;
  axllm::Value output = program.forward(client, axllm::object({{"topic", "Ax"}}));

  std::cout << "flow output:\n" << axllm::stringify(output) << "\n";
  std::cout << "flow plan:\n" << axllm::stringify(program.get_plan()) << "\n";
}
