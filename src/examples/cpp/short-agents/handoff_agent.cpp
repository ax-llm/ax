// ax-example:start
// title: C++ Specialist Planner Agent
// group: short-agents
// description: A specialist that plans a migration from a long brief held in contextFields, using a checkpointed contextPolicy and a runtime-output cap to stay compact.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
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
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4o-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));

  // A long, messy brief -- exactly the kind of input you do not want replayed into
  // the prompt on every turn. `contextFields` holds it in the runtime, the
  // `checkpointed` policy compacts older turns once the prompt grows, and
  // `maxRuntimeChars` caps how much runtime output is echoed back.
  std::string brief =
      "# Migration brief: monolith -> services (draft, unordered notes)\n"
      "\n"
      "Current: single Rails monolith, Postgres primary + 1 replica, Sidekiq for jobs.\n"
      "Pain: deploys take 40m, one bad migration locks the orders table, on-call burnout.\n"
      "Constraints: no downtime windows > 5m, PCI scope must shrink, team of 6, 2 quarters.\n"
      "Hot paths: checkout (writes orders, payments), search (read-heavy), notifications (async).\n"
      "Known landmines: payments code has no tests; search shares the orders DB; a nightly\n"
      "cron rebuilds the catalog and pins CPU for ~20m; the replica lags up to 90s under load.\n"
      "Org wants: independent deploys for checkout, smaller blast radius, an audit trail.\n"
      "Nice to have: event log for orders, read-model for search, feature flags.\n"
      "Hard no: a big-bang rewrite; introducing Kubernetes this year.";

  auto specialist = axllm::agent(
      "brief:string, goal:string -> plan:string[] \"Ordered, concrete steps\", answer:string, risks:string[]",
      axllm::object({
          {"contextFields", axllm::array({"brief"})},
          {"contextPolicy", axllm::object({{"preset", "checkpointed"}, {"budget", "balanced"}})},
          {"maxRuntimeChars", 3000},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  axllm::Value result = specialist.forward(
      client,
      axllm::object({
          {"brief", brief},
          {"goal", "Propose a safe, incremental 2-quarter plan to split checkout out first, respecting the hard constraints."},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 12}}));

  std::cout << axllm::stringify(result) << "\n";
}
