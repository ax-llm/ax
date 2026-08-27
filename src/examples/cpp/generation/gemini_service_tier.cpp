// ax-example:start
// title: C++ Gemini Flex Inference
// group: generation
// description: Sends latency-tolerant work through Gemini Flex and reports the applied tier.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 50
// ax-example:end
#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

int main() {
  const char* key = std::getenv("GOOGLE_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("GOOGLE_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_GEMINI_MODEL");
  axllm::GoogleGeminiClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gemini-3.7-flash" : model},
      {"service_tier", "flex"},
  }));
  axllm::Value out = client.chat(axllm::object({
      {"chat_prompt", axllm::array({axllm::object({
          {"role", "user"},
          {"content", "Explain in one sentence why batch evaluations save time."},
      })})},
  }));
  std::cout << axllm::stringify(out) << "\n";
}
