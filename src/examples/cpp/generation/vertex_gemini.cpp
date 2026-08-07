// ax-example:start
// title: C++ Vertex Gemini Routing
// group: generation
// description: Calls Gemini through Vertex with project and multi-region routing.
// provider: google-gemini
// env: GOOGLE_VERTEX_ACCESS_TOKEN, GOOGLE_PROJECT_ID, GOOGLE_REGION
// level: intermediate
// order: 35
// ax-example:end
#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

const char* required(const char* name) {
  const char* value = std::getenv(name);
  if (value == nullptr || std::string(value).empty()) {
    std::cerr << "Set " << name << " to run this example.\n";
    std::exit(2);
  }
  return value;
}

int main() {
  const char* model = std::getenv("AX_VERTEX_MODEL");
  axllm::GoogleGeminiClient client(axllm::object({
      {"api_key", required("GOOGLE_VERTEX_ACCESS_TOKEN")},
      {"project_id", required("GOOGLE_PROJECT_ID")},
      {"region", required("GOOGLE_REGION")},
      {"model", model == nullptr || std::string(model).empty() ? "gemini-3.5-flash" : model},
  }));
  auto out = client.chat(axllm::object({
      {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "Reply with the word ready."}})})},
  }));
  std::cout << axllm::stringify(out) << "\n";
}
