// ax-example:start
// title: Cpp Native Google Gemini Decisions
// group: generation
// description: Evaluate named yes/no, choice and score questions with native probabilities and confidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 48
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
  auto client = google_gemini_decisions(object({{"api_key", key}}));
  auto result = client.create(parse_json(R"({"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": {"urgent": {"type": "noul", "instructions": "Are customers unable to complete a core task?"}, "team": {"type": "choice", "instructions": "Which team should investigate?", "criteria": {"support": "Usage guidance", "billing": "Individual invoice disputes", "engineering": "Broken functionality or service outages"}}, "severity": {"type": "score", "instructions": "How severe is the customer impact?", "criteria": ["Minor inconvenience", "Feature impaired", "Core task blocked"]}}})"));
  std::cout << stringify(result) << "\n";
}
