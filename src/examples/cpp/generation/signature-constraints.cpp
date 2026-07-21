// ax-example:start
// title: C++ Signature Constraints
// group: generation
// description: Builds native constrained fields and runs the signature with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

axllm::Value field(const char* name, const char* title, axllm::Value type) {
  return axllm::Core::record_new(
      "Field", axllm::object({{"name", name}, {"title", title}, {"type", type}}));
}

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));

  axllm::Value signature = axllm::Core::record_new(
      "AxSignature",
      axllm::object({
          {"description", "Extract a constrained restaurant booking"},
          {"inputs",
           axllm::array({
               field("requestText", "Request Text",
                     axllm::Core::record_new(
                         "FieldType",
                         axllm::object({{"name", "string"}, {"minLength", 10}, {"maxLength", 500}}))),
               field("contactEmail", "Contact Email",
                     axllm::Core::record_new(
                         "FieldType", axllm::object({{"name", "string"}, {"format", "email"}}))),
           })},
          {"outputs",
           axllm::array({
               field("partySize", "Party Size",
                     axllm::Core::record_new(
                         "FieldType",
                         axllm::object({{"name", "number"}, {"minimum", 1}, {"maximum", 12}}))),
               field("bookingCode", "Booking Code",
                     axllm::Core::record_new(
                         "FieldType",
                         axllm::object({
                             {"name", "string"},
                             {"pattern", "^[A-Z]{3}-\\d{4}$"},
                             {"patternDescription", "Must look like ABC-1234"},
                         }))),
           })},
      }));
  axllm::Core::validate_signature(signature);
  axllm::AxGen program = axllm::ax(signature);
  axllm::Value output = program.forward(
      client,
      axllm::object({
          {"requestText", "Book dinner for four people under the name Ada Lovelace."},
          {"contactEmail", "ada@example.com"},
      }));
  std::cout << axllm::stringify(output) << "\n";
}
