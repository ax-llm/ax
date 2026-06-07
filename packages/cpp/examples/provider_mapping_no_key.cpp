#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({
      {"status", 200},
      {"json", axllm::object({
        {"id", "chatcmpl_example"},
        {"model", "gpt-4.1-mini"},
        {"choices", axllm::array({
          axllm::object({
            {"index", 0},
            {"finish_reason", "stop"},
            {"message", axllm::object({{"content", "hello from scripted transport"}})}
          })
        })},
        {"usage", axllm::object({{"prompt_tokens", 1}, {"completion_tokens", 2}, {"total_tokens", 3}})}
      })}
    });
  }
};

int main() {
  ScriptedTransport transport;
  axllm::OpenAICompatibleClient service(axllm::object({{"model", "gpt-4.1-mini"}, {"api_key", "test-key"}}), &transport);
  axllm::Value response = service.chat(axllm::object({
    {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "hello"}})})}
  }));
  axllm::Value first = axllm::Core::get(axllm::Core::get(response, "results"), 0);
  if (!axllm::equal(axllm::Core::get(first, "content"), "hello from scripted transport")) return 1;
  std::cout << "cpp-axai-ok\n";
}
