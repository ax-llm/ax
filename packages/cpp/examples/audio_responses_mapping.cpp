#include "axllm/axllm.hpp"

#include <iostream>
#include <string>

struct ScriptedTransport : axllm::Transport {
  axllm::Array requests;

  axllm::Value call(axllm::Value request) override {
    requests.push_back(request);
    std::string url = axllm::stringify(axllm::Core::get(request, "url"));
    if (url.find("/audio/speech") != std::string::npos) {
      return axllm::object({{"status", 200}, {"json", axllm::object({{"audio", "base64-speech"}})}});
    }
    if (url.find("/audio/transcriptions") != std::string::npos) {
      return axllm::object({
          {"status", 200},
          {"json", axllm::object({{"text", "hello world"}, {"language", "en"}, {"duration", 1.25}})},
      });
    }
    throw axllm::AxError("fixture", "unexpected audio request");
  }
};

int main() {
  ScriptedTransport transport;
  axllm::OpenAIResponsesClient client(axllm::object({{"api_key", "test-key"}}), &transport);
  axllm::Value speech =
      client.speak(axllm::object({{"text", "hello"}, {"voice", "alloy"}, {"format", "mp3"}}));
  axllm::Value transcript = client.transcribe(axllm::object({
      {"audio", "base64-audio"},
      {"language", "en"},
      {"model", "whisper-1"},
      {"format", "json"},
  }));
  if (!axllm::equal(axllm::Core::get(speech, "audio"), "base64-speech")) return 1;
  if (!axllm::equal(axllm::Core::get(transcript, "text"), "hello world")) return 2;

  std::cout << "normalized output:\n"
            << axllm::stringify(axllm::object({{"speak", speech}, {"transcribe", transcript}})) << "\n";
  std::cout << "transport requests:\n" << axllm::stringify(axllm::Value(transport.requests)) << "\n";
}
