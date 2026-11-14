// ax-example:start
// title: C++ Anthropic Document Citations
// group: generation
// description: Preserve source locations and output passages through ordinary and streaming generation.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 48
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("ANTHROPIC_API_KEY");
  if (!key || !*key) key = std::getenv("ANTHROPIC_APIKEY");
  if (!key || !*key) throw std::runtime_error("Set ANTHROPIC_API_KEY.");
  auto client = axllm::ai("anthropic", axllm::object({{"api_key", key}, {"model", "claude-haiku-5-5"}}));
  for (bool stream : {false, true}) {
    auto program = axllm::ax(R"(doc:file -> answer:string "State the opening year and closed day, citing the supplied document.")");
    auto answer = program.forward(*client, axllm::object({{"doc", axllm::object({
        {"source", axllm::object({{"type", "text"}, {"data", "The museum opened in 1984. It is closed on Mondays."}})},
        {"title", "Museum notes"}, {"citations", axllm::object({{"enabled", true}})}
    })}}), axllm::object({{"stream", stream}}));
    // Each log entry keeps text_blocks and usage.citations for this request.
    std::cout << axllm::stringify(axllm::object({{"stream", stream}, {"answer", answer},
        {"chat_log", program.get_chat_log()}})) << "\n";
  }
}
