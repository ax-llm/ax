// ax-example:start
// title: C++ Text To Speech
// group: audio
// description: Generates speech audio through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 40
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <variant>


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
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::Value speech = client.speak(axllm::object({{"text", "Ax turns LLM prompts into typed programs."}, {"voice", "alloy"}, {"format", "mp3"}}));
  axllm::Value audio_value = axllm::Core::get(speech, "audio");
  double audio_len = audio_value.is_string() ? static_cast<double>(std::get<std::string>(audio_value.data).size()) : 0.0;
  std::cout << axllm::stringify(axllm::object({{"format", axllm::Core::get(speech, "format")}, {"audioBytesBase64", audio_len}})) << "\n";
}
