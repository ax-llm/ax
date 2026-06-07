#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedRuntimeTransport : axllm::RuntimeTransport {
  int next_session = 0;

  axllm::Value call(axllm::Value message) override {
    axllm::Value id = axllm::Core::get(message, "id");
    axllm::Value op = axllm::Core::get(message, "op");
    if (axllm::equal(op, "capabilities")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"language", "JavaScript"}, {"usage_instructions", "scripted protocol"}})}});
    }
    if (axllm::equal(op, "create_session")) {
      std::string session_id = "s" + std::to_string(++next_session);
      return axllm::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", axllm::object({{"session_id", session_id}})}});
    }
    if (axllm::equal(op, "execute")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"answer", "protocol"}})})}})}});
    }
    if (axllm::equal(op, "snapshot_globals")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"version", 1}, {"bindings", axllm::object({{"answer", "protocol"}})}, {"globals", axllm::object({{"answer", "protocol"}})}})}});
    }
    if (axllm::equal(op, "patch_globals")) {
      axllm::Value payload = axllm::Core::get(message, "payload", axllm::Value::object());
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::Core::get(payload, "globals", axllm::Value::object())}});
    }
    if (axllm::equal(op, "inspect_globals")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"answer", "protocol"}})}});
    }
    if (axllm::equal(op, "close")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"closed", true}})}});
    }
    if (axllm::equal(op, "shutdown")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"shutdown", true}})}});
    }
    return axllm::object({{"id", id}, {"ok", false}, {"error", axllm::object({{"category", "protocol"}, {"message", "unknown op"}})}});
  }
};

int main() {
  ScriptedRuntimeTransport transport;
  axllm::RuntimeProtocolClient runtime(transport);
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  axllm::Value out = qa.test(runtime, "final()", axllm::object({{"question", "protocol"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  auto runner = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  axllm::Value step = runner.execute_actor_step(runtime, "final()", axllm::object({{"question", "protocol"}}));
  if (!axllm::equal(axllm::Core::get(step, "kind"), "final")) return 2;
  axllm::Value snapshot = runner.export_session_state();
  runner.restore_session_state(snapshot);
  axllm::Value inspected = runner.inspect_runtime();
  if (!axllm::equal(axllm::Core::get(inspected, "answer"), "protocol")) return 3;
  axllm::Value closed = runner.close_runtime_session();
  if (!axllm::equal(axllm::Core::get(closed, "closed"), true)) return 4;
  runtime.shutdown();
  std::cout << "cpp-runtime-protocol-ok\n";
}
