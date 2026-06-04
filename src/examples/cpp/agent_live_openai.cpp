#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>

struct LiveAgentClient : axllm::AIClient {
  axllm::OpenAICompatibleClient& inner;
  axllm::Value raw_model_answer;
  int calls = 0;

  explicit LiveAgentClient(axllm::OpenAICompatibleClient& inner_) : inner(inner_) {}

  axllm::Value complete(axllm::Value) override {
    calls += 1;
    if (raw_model_answer.is_null()) {
      axllm::Value live = inner.complete(axllm::object({
          {"chat_prompt",
           axllm::array({
               axllm::object({
                   {"role", "user"},
                   {"content", "In one sentence, explain what Ax helps developers build."},
               }),
           })},
      }));
      raw_model_answer = axllm::Core::get(live, "content");
    }
    axllm::Value payload;
    if (calls == 1) {
      payload = axllm::object({
          {"completion", axllm::object({{"type", "final"}, {"args", axllm::array({"Answer", axllm::Value::object()})}})},
      });
    } else if (calls == 2) {
      payload = axllm::object({
          {"completion",
           axllm::object({
               {"type", "final"},
               {"args", axllm::array({"Answer", axllm::object({{"answer", raw_model_answer}})})},
           })},
      });
    } else {
      payload = axllm::object({{"answer", raw_model_answer}});
    }
    return axllm::object({{"content", axllm::stringify(payload)}});
  }
};

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this live example.\n";
    return 2;
  }

  const char* model = std::getenv("AX_LIVE_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  auto assistant = axllm::agent(
      "question:string -> answer:string",
      axllm::object({{"contextFields", axllm::array({})}}));
  LiveAgentClient stage_client(client);
  axllm::Value output = assistant.forward(
      stage_client,
      axllm::object({{"question", "In one sentence, explain what Ax helps developers build."}}));
  std::cout << axllm::stringify(axllm::object({{"agentOutput", output}, {"rawModelAnswer", stage_client.raw_model_answer}}))
            << "\n";
}
