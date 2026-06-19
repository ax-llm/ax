// ax-example:start
// title: C++ Speech To Text
// group: audio
// description: Transcribes a checked-in WAV file through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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
  std::cout << axllm::stringify(transcript) << "\n";
}
