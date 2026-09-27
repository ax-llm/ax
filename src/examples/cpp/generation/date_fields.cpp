// ax-example:start
// title: C++ Date Fields
// group: generation
// description: Parses date, datetime and range outputs into ISO 8601 as TypeScript does with parse_dates; named zones read the platform tz database.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
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

  // parse_dates reads the date-typed outputs as TypeScript does: an IANA zone
  // (from $TZDIR or /usr/share/zoneinfo), an offset or an abbreviation at its
  // literal offset, then toISOString text. Without it (the default until the
  // next major version) they keep the model's text.
  auto planner = axllm::ax(
      R"(emailText:string, sentAt:datetime -> meetingStartsAt:datetime "Start time with its time zone", meetingDay:date, travelWindow:dateRange "First and last day away")",
      axllm::object({{"parse_dates", true}}));
  axllm::Value out = planner.forward(
      *client,
      axllm::object({{"emailText", "Can we meet next Tuesday at 3pm New York time? I'm travelling from the 8th to the 12th."},
                     {"sentAt", "2024-05-02T16:30:00Z"}}));
  std::cout << axllm::display(axllm::Core::get(out, "meetingStartsAt")) << "\n";  // e.g. 2024-05-07T19:00:00.000Z
  std::cout << axllm::display(axllm::Core::get(out, "meetingDay")) << "\n";       // e.g. 2024-05-07T00:00:00.000Z
  std::cout << axllm::stringify(axllm::Core::get(out, "travelWindow")) << "\n";    // {"start":...,"end":...}
}
