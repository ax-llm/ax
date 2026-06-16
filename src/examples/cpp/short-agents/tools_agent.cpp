// ax-example:start
// title: C++ Tool-Guided Agent
// group: short-agents
// description: Uses provider reasoning plus local context to shape a concise agent answer.
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

struct OpenAIBackedAgentClient : axllm::AIClient {
  axllm::OpenAICompatibleClient& inner;
  axllm::Value raw_model_answer;
  int calls = 0;
  explicit OpenAIBackedAgentClient(axllm::OpenAICompatibleClient& inner_) : inner(inner_) {}
  axllm::Value complete(axllm::Value) override {
    calls += 1;
    if (raw_model_answer.is_null()) {
      axllm::Value response = inner.complete(axllm::object({{"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "Use local context to choose between generation, agents, and flows."}})})}}));
      raw_model_answer = axllm::Core::get(response, "content");
    }
    axllm::Value payload = axllm::object({{"answer", raw_model_answer}});
    if (calls == 1) payload = axllm::object({{"completion", axllm::object({{"type", "final"}, {"args", axllm::array({"Answer", axllm::Value::object()})}})}});
    if (calls == 2) payload = axllm::object({{"completion", axllm::object({{"type", "final"}, {"args", axllm::array({"Answer", axllm::object({{"answer", raw_model_answer}, {"usedContext", true}, {"plan", axllm::array({"Declare a signature", "Run an agent", "Optimize with examples"})}})})}})}});
    return axllm::object({{"content", axllm::stringify(payload)}});
  }
};

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  auto assistant = axllm::agent("question:string -> answer:string, usedContext:boolean", axllm::object({{"contextFields", axllm::array({})}}));
  OpenAIBackedAgentClient stage_client(client);
  axllm::Value output = assistant.forward(stage_client, axllm::object({{"question", "Use local context to choose between generation, agents, and flows."}}));
  std::cout << axllm::stringify(axllm::object({{"agentOutput", output}, {"rawModelAnswer", stage_client.raw_model_answer}})) << "\n";
}
