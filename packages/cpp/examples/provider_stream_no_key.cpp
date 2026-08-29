#include "axllm/axllm.hpp"
#include <iostream>
#include <string>

struct LegacyTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({
      {"status", 200},
      {"body",
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n"
       "data: [DONE]\n\n"}
    });
  }

};

struct IncrementalTransport : axllm::Transport {
  bool cancelled = false;
  axllm::Value call(axllm::Value) override { return axllm::Value::object(); }
  void stream(axllm::Value, axllm::AxTransportStreamHandler handler) override {
    const std::string body =
      "data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel 🌍\"}}]}\r\n\r\n"
      "data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"}}]}\r\n\r\n";
    for (char byte : body) {
      if (!handler(std::string(1, byte))) {
        cancelled = true;
        return;
      }
    }
  }
};

struct FailingTransport : axllm::Transport {
  int attempts = 0;
  axllm::Value call(axllm::Value) override { return axllm::Value::object(); }
  void stream(axllm::Value, axllm::AxTransportStreamHandler handler) override {
    ++attempts;
    handler("data: {\"id\":\"chatcmpl_failure\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"delivered\"}}]}\n\n");
    throw axllm::AxError("network", "upstream closed", "AxAIServiceNetworkError", 0, "", true);
  }
};

int main() {
  LegacyTransport legacy;
  axllm::OpenAICompatibleClient client(axllm::object({{"api_key", "test-key"}, {"model", "gpt-5.4-mini"}}), &legacy);
  std::string text;
  std::vector<axllm::AxUsageEvent> usage_events;
  axllm::set_usage_observer([&](axllm::AxUsageEvent event) { usage_events.push_back(event); });
  for (const auto& event : client.stream(axllm::object({
         {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "stream"}})})}
       }))) {
    text += axllm::display(axllm::Core::get(axllm::Core::get(axllm::Core::get(event, "results"), 0), "content", ""));
  }
  axllm::set_usage_observer({});
  if (text != "hello") return 1;
  if (usage_events.size() != 1) return 4;
  IncrementalTransport incremental;
  axllm::OpenAICompatibleClient cancel_client(axllm::object({{"api_key", "test-key"}, {"model", "gpt-5.4-mini"}}), &incremental);
  cancel_client.stream_each(axllm::object({
      {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "cancel"}})})}
    }), [](const axllm::Value&) { return false; });
  if (!incremental.cancelled) return 2;
  FailingTransport failing;
  axllm::OpenAICompatibleClient failure_client(axllm::object({{"api_key", "test-key"}, {"model", "gpt-5.4-mini"}}), &failing);
  bool delivered = false;
  bool failed = false;
  try {
    failure_client.stream_each(axllm::object({
        {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "fail"}})})}
      }), [&](const axllm::Value&) { delivered = true; return true; });
  } catch (const axllm::AxError&) {
    failed = true;
  }
  if (!delivered || !failed || failing.attempts != 1) return 3;
  std::cout << "cpp-provider-stream-no-key " << text << "\n";
}
