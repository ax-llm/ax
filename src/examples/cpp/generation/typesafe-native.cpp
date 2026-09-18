// ax-example:start
// title: Cpp Jev Native Questions
// group: generation
// description: Uses structured criteria, native scoring, model discovery, and probability-based decisions.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: advanced
// order: 36
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
using namespace axllm;

static std::string key(const char* name) { const char* value = std::getenv(name); if (!value || !*value) throw std::runtime_error(std::string("Set ") + name); return value; }
int main() {
  auto client = typesafe(object({{"api_key", key("TYPESAFE_APIKEY")}}));
  if (client.list_models().empty()) throw std::runtime_error("Empty catalog");
  TypesafeRequest request;
  request.state = object({
    {"ticket", "Checkout is unavailable for all customers after the latest deployment."},
    {"account", object({{"tier", "enterprise"}, {"notes", Value()}})}
  });
  request.questions = {
    {"urgent", {"noul", object({{"question", "Does this need immediate attention?"}}),
      object({{"true", "Customers cannot complete a core task"}, {"false", "Routine request"}})}},
    {"team", {"choice", "Who should handle the ticket?",
      object({{"support", "Usage guidance"}, {"billing", object({{"scope", "Invoices and payments"}})},
              {"engineering", "Product failures"}})}},
    {"severity", {"score", "Rate customer impact",
      array({"Minor inconvenience", "One task blocked", "Core task unavailable", "Widespread outage"})}}
  };
  auto response = client.system_one(request);
  double probability = std::get<TypesafeNoul>(response.answers.at("urgent")).noul;
  double score = std::get<TypesafeScore>(response.answers.at("severity")).score;
  if (probability < 0 || probability > 1 || score < 0 || score > 3) throw std::runtime_error("Invalid bounds");
  // Apply thresholds and custom score scales in application code.
  std::cout << stringify(object({{"page_on_call", probability >= 0.9}, {"severity_1_to_5", 1 + 4 * score / 3}, {"response", response.to_value()}})) << "\n";
}
