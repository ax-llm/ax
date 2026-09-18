// ax-example:start
// title: Cpp Jev Signature Decisions
// group: generation
// description: Converts Jev probabilities into boolean and class outputs with a provider threshold.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: beginner
// order: 35
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
  std::cout << stringify(decision) << "\n";
}
