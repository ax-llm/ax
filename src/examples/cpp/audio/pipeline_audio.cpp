// ax-example:start
// title: C++ Audio Summary Pipeline
// group: audio
// description: Transcribes audio and summarizes the transcript with an OpenAI-backed generator.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>


int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAIResponsesClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  std::ifstream file("src/examples/assets/presentation.wav", std::ios::binary);
  std::ostringstream buffer;
  buffer << file.rdbuf();
  axllm::Value transcript = client.transcribe(axllm::object({{"audio", buffer.str()}, {"language", "en"}, {"model", "gpt-4o-mini-transcribe"}, {"format", "json"}}));
  axllm::OpenAICompatibleClient text_client(axllm::object({{"api_key", key}, {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model}, {"model_config", axllm::object({{"temperature", 0}})}}));
  axllm::AxGen summarize = axllm::ax("transcript:string -> summary:string, followUps:string[]");
  axllm::Value result = summarize.forward(text_client, axllm::object({{"transcript", axllm::Core::get(transcript, "text")}}));
  std::cout << axllm::stringify(axllm::object({{"transcript", axllm::Core::get(transcript, "text")}, {"result", result}})) << "\n";
}
