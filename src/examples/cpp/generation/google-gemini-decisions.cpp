// ax-example:start
// title: C++ Google Gemini Decision Evidence
// group: generation
// description: Classify a support ticket through signatures with native decision evidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
using namespace axllm;
int main() {
  const char* key = std::getenv("GEMINI_API_KEY");
  if (!key) key = std::getenv("GOOGLE_API_KEY");
  if (!key) key = std::getenv("GOOGLE_APIKEY");
  if (!key) throw std::runtime_error("Set a Google API key.");
  auto model = ai("google-gemini-decisions", object({{"api_key", key}}));
  auto triage = ax(R"(ticket:string -> urgent:boolean(evidence, threshold 0.9) "Does a core task fail for all customers?", team:class "support, billing, engineering"(evidence) "Which team should investigate?", severity:score "Minor inconvenience, Feature impaired, Core task blocked"(evidence) "How severe is the customer impact?")");
  auto result = triage.forward(*model, object({{"ticket", "Checkout is unavailable for all customers after the latest deployment."}}));
  std::cout << stringify(result) << "\n";
}
