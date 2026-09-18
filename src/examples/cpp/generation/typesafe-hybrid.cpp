// ax-example:start
// title: Cpp Jev Hybrid Reply
// group: generation
// description: Passes Jev decisions to a second Ax program to generate a customer reply.
// provider: typesafe, openai
// env: TYPESAFE_APIKEY, OPENAI_APIKEY, OPENAI_API_KEY
// level: intermediate
// order: 37
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
using namespace axllm;

static std::string key(const char* name) { const char* value = std::getenv(name); if (!value || !*value) throw std::runtime_error(std::string("Set ") + name); return value; }
int main() {
  auto model = ai("typesafe", object({{"api_key", key("TYPESAFE_APIKEY")}, {"trueThreshold", 0.9}}));
  auto triage = ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"");
  auto decision = triage.forward(*model, object({{"ticket", "Checkout is unavailable for all customers after the latest deployment."}}));
  if (!Core::get(decision, "urgent").is_bool()) throw std::runtime_error("Invalid boolean");
  const char* openai_key = std::getenv("OPENAI_API_KEY");
  auto writer = ai("openai", object({{"api_key", openai_key ? std::string(openai_key) : key("OPENAI_APIKEY")}, {"model", "gpt-5.6-luna"}, {"model_config", object({{"temperature", 1}})}}));
  auto inputs = object({{"ticket", "Checkout is unavailable for all customers after the latest deployment."}, {"urgent", Core::get(decision, "urgent")}, {"team", Core::get(decision, "team")}});
  auto reply = ax("ticket:string, urgent:boolean, team:string -> reply:string").forward(*writer, inputs);
  if (display(Core::get(reply, "reply")).empty()) throw std::runtime_error("Empty reply");
  std::cout << stringify(object({{"decision", decision}, {"reply", reply}})) << "\n";
}
