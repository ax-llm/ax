#include "axllm/axllm.hpp"
#include <iostream>
#include <string>

struct ScriptedTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({
      {"status", 200},
      {"body",
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"
       "data: [DONE]\n\n"}
    });
  }
};

int main() {
  ScriptedTransport transport;
  axllm::OpenAICompatibleClient client(axllm::object({{"api_key", "test-key"}, {"model", "gpt-4.1-mini"}}), &transport);
  std::string text;
  for (const auto& event : client.stream(axllm::object({
         {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "stream"}})})}
       }))) {
    text += axllm::display(axllm::Core::get(axllm::Core::get(axllm::Core::get(event, "results"), 0), "content", ""));
  }
  if (text != "hello") return 1;
  std::cout << "cpp-provider-stream-no-key " << text << "\n";
}
