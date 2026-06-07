#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedService : axllm::AIClient {
  axllm::Array responses = {
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}}),
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}}),
    axllm::object({{"content", "{\"answer\":\"Paris\"}"}})
  };

  axllm::Value complete(axllm::Value) override {
    if (responses.empty()) throw axllm::AxError("fixture", "scripted service exhausted");
    axllm::Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

struct ScriptedSession : axllm::AxCodeSession {
  axllm::Value execute(axllm::Value, axllm::Value = axllm::Value::object()) override {
    return axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"answer", "runtime"}})})}});
  }
  axllm::Value inspect(axllm::Value = axllm::Value::object()) override { return axllm::Value::object(); }
  axllm::Value export_state(axllm::Value = axllm::Value::object()) override { return axllm::object({{"globals", axllm::Value::object()}}); }
  axllm::Value restore_state(axllm::Value snapshot, axllm::Value = axllm::Value::object()) override { return snapshot; }
  axllm::Value close() override { return axllm::object({{"closed", true}}); }
};

struct ScriptedRuntime : axllm::AxCodeRuntime {
  ScriptedSession session;
  axllm::AxCodeSession* create_session(axllm::Value, axllm::Value = axllm::Value::object()) override { return &session; }
};

int main() {
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"contextFields", axllm::array({})}}));
  ScriptedService service;
  axllm::Value out = qa.forward(service, axllm::object({{"question", "Capital of France?"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Paris")) return 1;
  axllm::Value last = axllm::Core::get(qa.get_chat_log(), 2);
  if (!axllm::equal(axllm::Core::get(last, "name"), "responder")) return 2;
  ScriptedRuntime runtime;
  axllm::Value runtime_out = qa.test(runtime, "final({answer:'runtime'})");
  if (!axllm::equal(axllm::Core::get(runtime_out, "kind"), "final")) return 3;
  std::cout << "cpp-axagent-ok\n";
}
