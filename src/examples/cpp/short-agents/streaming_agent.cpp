// ax-example:start
// title: C++ Streaming Agent
// group: short-agents
// description: Streams an agent's answer as field deltas while its evidence citations are checked against what the agent read from a handbook kept out of the prompt.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 15
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"

#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  auto client = axllm::ai("openai", axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));

  std::string handbook =
      "# Acme Cloud -- Support Handbook\n"
      "\n"
      "## Billing\n"
      "- Plan downgrades take effect at the END of the current billing cycle, not immediately.\n"
      "- Refunds are issued to the original payment method within 5 business days.\n"
      "\n"
      "## Data\n"
      "- Deleted workspaces are recoverable for 30 days, then permanently purged.";

  // The handbook stays in the agent's runtime, out of the prompt. With citations
  // on, the answer cites the evidence it used, and ids the run never gathered
  // are sent back to the model for a correction.
  auto assistant = axllm::agent(
      "question:string, handbook:string -> answer:string",
      axllm::object({
          {"contextFields", axllm::array({"handbook"})},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
          {"citations", axllm::Value::object()},
      }));
  assistant.set_citations_observer([](axllm::Value ids) { std::cout << "\ncited: " << axllm::stringify(ids) << "\n"; });

  // The distiller and the executor run first; then the responder's answer
  // streams. Merge each delta and start over when the version changes (a retry).
  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  int64_t version = 0;
  assistant.streaming_forward(
      *client,
      axllm::object({
          {"question", "I downgraded today. When does it take effect, and is my data safe if I delete the workspace?"},
          {"handbook", handbook},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 12}}),
      [&version](const axllm::AxGenDelta& delta) {
        if (delta.version != version) {
          version = delta.version;
          std::cout << "\n[retry: starting over]\n";
        }
        axllm::Value text = axllm::Core::get(delta.delta, "answer");
        if (text.is_string()) std::cout << axllm::display(text) << std::flush;
        return true;
      });
  std::cout << "\n";
}
