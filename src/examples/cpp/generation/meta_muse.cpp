// ax-example:start
// title: C++ Meta Muse Spark
// group: generation
// description: Selects any of Meta's three protocols through the existing chat API.
// provider: meta
// env: MODEL_API_KEY
// level: beginner
// order: 52
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("MODEL_API_KEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set MODEL_API_KEY to run this example.\n";
    return 2;
  }
  for (const auto* profile : {"meta", "meta-chat", "meta-messages"}) {
    auto client = axllm::ai(profile, axllm::object({{"api_key", key}, {"model", "muse-spark-1.3"}}));
    auto response = client->chat(axllm::parse_json(R"({"chat_prompt":[{"role":"user","content":"Name a solar-powered sailboat."}],"model_config":{"thinking_token_budget":"highest"}})"));
    std::cout << profile << " " << axllm::stringify(response) << "\n";
  }
}
