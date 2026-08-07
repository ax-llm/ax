#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <string>

const char* required(const char* name) {
  const char* value = std::getenv(name);
  if (value == nullptr || std::string(value).empty()) {
    std::cerr << "Set " << name << " to run this Vertex provider API example.\n";
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
    {"model", model == nullptr || std::string(model).empty() ? "gemini-3.5-flash" : model}
  }));
  axllm::Value out = client.chat(axllm::object({
    {"chat_prompt", axllm::array({
      axllm::object({{"role", "user"}, {"content", "Reply with the word ready."}})
    })}
  }));
  std::cout << axllm::stringify(out) << "\n";
}
