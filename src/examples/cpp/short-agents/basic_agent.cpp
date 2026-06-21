// ax-example:start
// title: C++ Grounded Support Agent
// group: short-agents
// description: Answers a support question grounded in a handbook that is kept out of the model prompt via contextFields.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 20
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
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));

  // The handbook can be arbitrarily large. Listing it in `contextFields` keeps it
  // in the agent's runtime so it never inflates the model prompt -- the agent reads
  // it through code, not through tokens. That is the whole point of an Ax agent
  // over a plain gen() call: the source material stays out of the context window.
  std::string handbook =
      "# Acme Cloud -- Support Handbook\n"
      "\n"
      "## Billing\n"
      "- Invoices are issued on the 1st of each month and are due net-15.\n"
      "- Plan downgrades take effect at the END of the current billing cycle, not immediately.\n"
      "- Refunds are issued to the original payment method within 5 business days.\n"
      "\n"
      "## Access\n"
      "- Seats can be added by any workspace Owner under Settings -> Members.\n"
      "- SSO (SAML) is available on Enterprise; SCIM provisioning is Owner-only.\n"
      "\n"
      "## Incidents\n"
      "- Status and uptime are published at status.acme.example.\n"
      "- Sev-1 incidents page the on-call within 5 minutes; updates post every 30 minutes.\n"
      "\n"
      "## Data\n"
      "- Exports are available in CSV and JSON from Settings -> Data.\n"
      "- Deleted workspaces are recoverable for 30 days, then permanently purged.";

  auto assistant = axllm::agent(
      "question:string, handbook:string -> answer:string, citations:string[] \"Handbook sections the answer relies on\"",
      // Keep the handbook in the runtime, out of the prompt.
      axllm::object({
          {"contextFields", axllm::array({"handbook"})},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  axllm::Value result = assistant.forward(
      client,
      axllm::object({
          {"question", "A customer downgraded their plan today. When does it take effect, and can they get a refund for the current cycle?"},
          {"handbook", handbook},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 12}}));

  std::cout << axllm::stringify(result) << "\n";
}
