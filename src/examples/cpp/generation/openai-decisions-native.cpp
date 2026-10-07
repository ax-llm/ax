// ax-example:start
// title: Cpp OpenAI Native Decisions
// group: generation
// description: Uses ordered predicate, choice, and score questions with explicit rubrics and raw probabilities.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
int main() {
 const char* key = std::getenv("OPENAI_API_KEY");
 if (!key || !*key) key = std::getenv("OPENAI_APIKEY");
 if (!key || !*key) throw std::runtime_error("Set OPENAI_API_KEY");
 auto client = axllm::openai_decisions(axllm::object({{"api_key", key}}));
 auto response = client.create(axllm::parse_json(R"({"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": [{"type": "predicate", "name": "urgent", "instructions": "Are customers unable to complete a core task?"}, {"type": "choice", "name": "team", "instructions": "Who should handle the ticket?", "choices": [{"value": "support", "description": "Usage guidance"}, {"value": "billing", "description": "Invoices and payments"}, {"value": "engineering", "description": "Product failures"}]}, {"type": "score", "name": "severity", "instructions": "Rate customer impact", "levels": [{"label": "Minor inconvenience"}, {"label": "One task blocked"}, {"label": "Core task unavailable"}, {"label": "Widespread outage"}]}]})"));
 // Handle per-question refusals before using probability, choice, or score.
 std::cout << axllm::stringify(response) << "\n";
}
