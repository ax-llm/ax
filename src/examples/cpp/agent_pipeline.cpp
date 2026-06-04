#include "axllm/axllm.hpp"

#include <iostream>

struct FakeService : axllm::AIClient {
  axllm::Array responses = {
      axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}}),
      axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}}),
      axllm::object({{"content", "{\"answer\":\"Paris\"}"}}),
  };

  axllm::Value complete(axllm::Value) override {
    if (responses.empty()) throw axllm::AxError("fixture", "fake service exhausted");
    axllm::Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

int main() {
  auto qa = axllm::agent(
      "question:string -> answer:string",
      axllm::object({{"contextFields", axllm::array({})}}));
  FakeService service;
  axllm::Value output = qa.forward(service, axllm::object({{"question", "Capital of France?"}}));

  std::cout << "final output:\n" << axllm::stringify(output) << "\n";
  axllm::Value chat_names = axllm::Value::array();
  for (int i = 0;; ++i) {
    axllm::Value entry = axllm::Core::get(qa.get_chat_log(), i);
    if (axllm::Core::truthy(axllm::Core::is_none(entry))) break;
    axllm::Core::append(chat_names, axllm::Core::get(entry, "name"));
  }
  axllm::Value action_types = axllm::Value::array();
  for (int i = 0;; ++i) {
    axllm::Value entry = axllm::Core::get(qa.get_action_log(), i);
    if (axllm::Core::truthy(axllm::Core::is_none(entry))) break;
    axllm::Core::append(action_types, axllm::Core::get(entry, "type"));
  }
  std::cout << "chat log evidence:\n" << axllm::stringify(chat_names) << "\n";
  std::cout << "action log evidence:\n" << axllm::stringify(action_types) << "\n";
}
