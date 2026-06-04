#include "axllm/axllm.hpp"

#include <iostream>
#include <memory>
#include <vector>

struct DemoSession : axllm::AxCodeSession {
  axllm::Value globals;
  bool closed = false;

  explicit DemoSession(axllm::Value globals_) : globals(std::move(globals_)) {}

  axllm::Value execute(axllm::Value code, axllm::Value options = axllm::Value::object()) override {
    if (!axllm::Core::truthy(axllm::Core::map_contains(options, "reservedNames"))) {
      throw axllm::AxError("fixture", "reservedNames were not passed to the runtime");
    }
    if (axllm::equal(code, "timeout()")) return axllm::RuntimeEnvelope::timeout("demo timeout");
    axllm::Core::set(globals, "answer", "runtime final");
    return axllm::RuntimeEnvelope::final_payload({axllm::object({{"answer", axllm::Core::get(globals, "answer")}})});
  }

  axllm::Value inspect(axllm::Value = axllm::Value::object()) override { return globals; }

  axllm::Value snapshot_globals(axllm::Value = axllm::Value::object()) override {
    return axllm::object({{"version", 1}, {"bindings", globals}, {"closed", closed}});
  }

  axllm::Value patch_globals(axllm::Value snapshot, axllm::Value options = axllm::Value::object()) override {
    globals = axllm::Core::get(snapshot, "bindings", axllm::Value::object());
    return snapshot_globals(options);
  }

  axllm::Value close() override {
    closed = true;
    return axllm::object({{"closed", true}});
  }
};

struct DemoRuntime : axllm::AxCodeRuntime {
  std::vector<std::unique_ptr<DemoSession>> sessions;

  std::string language() const override { return "Python"; }

  axllm::AxCodeSession* create_session(axllm::Value globals, axllm::Value = axllm::Value::object()) override {
    sessions.push_back(std::make_unique<DemoSession>(std::move(globals)));
    return sessions.back().get();
  }
};

int main() {
  DemoRuntime runtime;
  auto runner = axllm::agent(
      "question:string -> answer:string",
      axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  axllm::Value step = runner.execute_actor_step(runtime, "final()", axllm::object({{"question", "adapter"}}));
  axllm::Value snapshot = runner.export_session_state();
  runner.restore_session_state(snapshot);
  axllm::Value timeout = runner.execute_actor_step(runtime, "timeout()", axllm::object({{"question", "adapter"}}));
  axllm::Value closed = runner.close_runtime_session();
  axllm::Value bindings = axllm::Core::get(snapshot, "bindings", axllm::Value::object());

  std::cout << axllm::stringify(axllm::object({
                   {"stepKind", axllm::Core::get(step, "kind")},
                   {"finalArgs", axllm::Core::get(axllm::Core::get(step, "completion_payload"), "args")},
                   {"snapshotKeys", axllm::Core::map_keys(bindings)},
                   {"snapshotAnswer", axllm::Core::get(bindings, "answer")},
                   {"timeoutCategory", axllm::Core::get(timeout, "error_category")},
                   {"closed", closed},
               }))
            << "\n";
}
