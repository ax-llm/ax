#include "axllm/axllm.hpp"

#include <iostream>
#include <string>

class CountingTransport final : public axllm::Transport {
 public:
  axllm::Value call(axllm::Value) override {
    ++calls;
    return axllm::object({{"status", 200}, {"json", axllm::Value::object()}});
  }

  int calls = 0;
};

int main() {
  CountingTransport transport;
  axllm::OpenAICompatibleClient client(
      axllm::object({{"api_key", "test-key"}, {"model", "gpt-5.6-luna"}}),
      &transport);
  axllm::AxCancellationToken token;
  if (!token.cancel("user stopped") || token.cancel("later reason")) return 2;

  try {
    client.chat(
        axllm::object({{"chat_prompt", axllm::array({axllm::object({
            {"role", "user"}, {"content", "This must not be sent."}})})}}),
        axllm::Value::object(), &token);
    return 3;
  } catch (const axllm::AxAIServiceAbortedError& error) {
    if (error.retryable || std::string(error.what()).find("user stopped") == std::string::npos) return 4;
  }

  if (transport.calls != 0) return 5;
  std::cout << "cpp-cancellation-no-key user stopped\n";
}
