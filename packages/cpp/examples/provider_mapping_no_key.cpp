#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({
      {"status", 200},
      {"json", axllm::object({
        {"id", "chatcmpl_example"},
        {"model", "gpt-5.4-mini"},
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
  std::vector<axllm::AxUsageEvent> events;
  axllm::set_usage_observer([&events](axllm::AxUsageEvent event) {
    events.push_back(std::move(event));
  });
  axllm::OpenAICompatibleClient service(axllm::object({
    {"model", "gpt-5.4-mini"},
    {"api_key", "test-key"},
    {"usageContext", axllm::object({{"tenantId", "tenant-1"}, {"feature", "no-key-example"}})}
  }), &transport);
  axllm::Value response = service.chat(axllm::object({
    {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "hello"}})})}
  }), axllm::object({
    {"usageContext", axllm::object({{"userId", "user-1"}, {"requestId", "request-1"}})}
  }));
  axllm::set_usage_observer({});
  axllm::Value first = axllm::Core::get(axllm::Core::get(response, "results"), 0);
  if (!axllm::equal(axllm::Core::get(first, "content"), "hello from scripted transport")) return 1;
  if (events.size() != 1 || !axllm::equal(
      axllm::Core::get(axllm::Core::get(events[0], "context"), "tenantId"), "tenant-1")) return 2;
  std::cout << "cpp-axai-ok\n";
}
