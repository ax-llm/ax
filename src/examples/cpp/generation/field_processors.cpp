// ax-example:start
// title: C++ Field Processor Feedback
// group: generation
// description: Sends a field processor's note back to the model for another step, as TypeScript does, and trims the final answer with a field transform.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>

int main() {
  const char* api_key = std::getenv("OPENAI_API_KEY");
  if (api_key == nullptr || std::string(api_key).empty()) api_key = std::getenv("OPENAI_APIKEY");
  if (api_key == nullptr || std::string(api_key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* selected = std::getenv("AX_OPENAI_MODEL");
  std::string model = selected == nullptr || std::string(selected).empty() ? "gpt-5.4-mini" : selected;
  auto client = axllm::ai("openai", axllm::object({{"api_key", api_key}, {"model", model}}));
  auto summarize = axllm::ax("text:string -> summary:string");

  // A non-null result goes back to the model as a user message, and the next
  // step's answer replaces this one.
  summarize.add_field_processor(
      "summary",
      [](const axllm::Value& value, const axllm::AxFieldProcessorContext&) -> axllm::Value {
        std::istringstream words(axllm::display(value));
        int count = 0;
        for (std::string word; words >> word;) ++count;
        if (count <= 12) return nullptr;
        return "That summary has " + std::to_string(count) + " words; answer again in at most 12 words.";
      },
      axllm::AxFieldProcessorMode::Feedback);
  summarize.add_field_transform("summary", "trim");

  std::string text =
      "The committee met on Tuesday to review the budget. After a long debate about "
      "the new library wing, they approved the plan and asked staff to find a builder "
      "who can start in spring, while keeping the reading room open during the work.";
  axllm::Value output = summarize.forward(*client, axllm::object({{"text", text}}));
  std::cout << axllm::display(axllm::Core::get(output, "summary")) << "\n";
}
