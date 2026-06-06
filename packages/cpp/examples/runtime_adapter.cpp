#include "axllm/axllm.hpp"
#include <iostream>

struct DemoSession : axllm::AxCodeSession {
  axllm::Value globals;
  axllm::Value create_options;
  bool closed = false;

  DemoSession(axllm::Value globals_, axllm::Value options_) : globals(std::move(globals_)), create_options(std::move(options_)) {}

  axllm::Value execute(axllm::Value code, axllm::Value options = axllm::Value::object()) override {
    if (!axllm::Core::truthy(axllm::Core::map_contains(options, "reservedNames"))) throw axllm::AxError("fixture", "missing reservedNames");
    if (axllm::equal(code, "timeout()")) return axllm::RuntimeEnvelope::timeout("demo timeout");
    axllm::Core::set(globals, "answer", "runtime");
    return axllm::RuntimeEnvelope::final_payload({axllm::object({{"answer", axllm::Core::get(globals, "answer")}})});
  }

  axllm::Value inspect(axllm::Value = axllm::Value::object()) override { return globals; }
  axllm::Value snapshot_globals(axllm::Value = axllm::Value::object()) override {
    return axllm::object({{"version", 1}, {"bindings", globals}, {"globals", globals}, {"closed", closed}});
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
  axllm::RuntimeCapabilities capabilities;
  std::vector<std::unique_ptr<DemoSession>> sessions;

  DemoRuntime() {
    capabilities.language = "Python";
    capabilities.snapshot = true;
    capabilities.patch = true;
  }

  std::string language() const override { return "Python"; }
  axllm::AxCodeSession* create_session(axllm::Value globals, axllm::Value options = axllm::Value::object()) override {
    sessions.push_back(std::make_unique<DemoSession>(std::move(globals), std::move(options)));
    return sessions.back().get();
  }
};

int main() {
  DemoRuntime runtime;
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  axllm::Value out = qa.test(runtime, "final()", axllm::object({{"question", "adapter"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  if (!runtime.sessions.back()->closed) return 2;

  auto runner = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  axllm::Value step = runner.execute_actor_step(runtime, "final()", axllm::object({{"question", "adapter"}}));
  if (!axllm::equal(axllm::Core::get(step, "kind"), "final")) return 3;
  axllm::Value snapshot = runner.export_session_state();
  runner.restore_session_state(snapshot);
  axllm::Value timeout = runner.execute_actor_step(runtime, "timeout()", axllm::object({{"question", "adapter"}}));
  if (!axllm::equal(axllm::Core::get(timeout, "error_category"), "timeout")) return 4;
  std::cout << "cpp-runtime-adapter-ok\n";
}
