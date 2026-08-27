#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({{"status", 200}, {"json", axllm::object({
      {"model", "gpt-5.4-mini"},
      {"choices", axllm::array({axllm::object({{"message", axllm::object({{"content", "ok"}})}, {"finish_reason", "stop"}})})}
    })}});
  }
};

int main() {
  int calls = 0;
  axllm::AxRateLimiter limiter = [&calls](axllm::AxRequestExecutor next, const axllm::AxRateLimitInfo& info) {
    if (info.operation != "chat" || info.provider.empty()) throw std::runtime_error("bad rate info");
    ++calls;
    return next();
  };
  ScriptedTransport transport;
  axllm::OpenAICompatibleClient service(axllm::object({{"model", "gpt-5.4-mini"}, {"api_key", "test"}}), &transport);
  axllm::set_rate_limiter(limiter);
  service.chat(axllm::object({{"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "hello"}})})}}));
  axllm::AxRuntimeHooks hooks{limiter, {}, {}};
  axllm::ax("input:string -> output:string", axllm::Value::object(), hooks).set_tracer({}).set_meter({});
  axllm::agent("input:string -> output:string", axllm::Value::object(), hooks).set_tracer({}).set_meter({});
  axllm::flow(axllm::object({{"id", "runtime-hooks"}}), hooks).set_tracer({}).set_meter({});
  axllm::set_rate_limiter({}); axllm::set_tracer({}); axllm::set_meter({});
  if (calls != 1) return 1;
  std::cout << "cpp-runtime-hooks-no-key-ok\n";
}
