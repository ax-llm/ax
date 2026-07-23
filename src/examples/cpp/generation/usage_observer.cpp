// ax-example:start
// title: Centralized Usage Observer
// group: generation
// description: Attributes every completed model call to a tenant, user, and request from one global observer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
#include "axllm/axllm.hpp"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

int main() {
  const char* api_key = std::getenv("OPENAI_API_KEY");
  if (api_key == nullptr || std::string(api_key).empty()) api_key = std::getenv("OPENAI_APIKEY");
  if (api_key == nullptr || std::string(api_key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* configured_model = std::getenv("AX_OPENAI_MODEL");
  std::string model =
      configured_model == nullptr || std::string(configured_model).empty()
          ? "gpt-5.4-mini"
          : configured_model;

  std::vector<axllm::AxUsageEvent> events;
  axllm::set_usage_observer(
      [&events](axllm::AxUsageEvent event) { events.push_back(std::move(event)); });
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", api_key},
      {"model", model},
      {"usageContext",
       axllm::object({
           {"tenantId", "tenant-42"},
           {"feature", "support-chat"},
           {"attributes", axllm::object({{"environment", "example"}})},
       })},
  }));
  client.chat(
      axllm::object({
          {"chat_prompt",
           axllm::array({
               axllm::object({{"role", "user"}, {"content", "Reply with one short greeting."}}),
           })},
      }),
      axllm::object({
          {"usageContext",
           axllm::object({
               {"userId", "user-7"},
               {"requestId",
                "request-" +
                    std::to_string(
                        std::chrono::steady_clock::now().time_since_epoch().count())},
           })},
      }));
  axllm::set_usage_observer({});
  std::cout << axllm::stringify(axllm::Value(axllm::Array(events.begin(), events.end())))
            << "\n";
}
