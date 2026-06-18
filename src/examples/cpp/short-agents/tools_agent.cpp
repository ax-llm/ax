// ax-example:start
// title: C++ Incident Triage Agent
// group: short-agents
// description: Triages a noisy incident report held in contextFields, using a lean contextPolicy to keep the raw log out of the prompt while it reasons.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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

  // A raw, noisy incident report. It lives in `contextFields`, so the agent works
  // it inside the runtime; `contextPolicy: lean` keeps the prompt compact by
  // preferring live runtime state and summaries over replaying the raw text.
  std::string report =
      "[2026-03-02 14:01:22Z] INFO  gateway       deploy svc-checkout-edge v812 -> prod (channel: canary 10%)\n"
      "[2026-03-02 14:03:10Z] WARN  checkout-api  p95 latency 1180ms (baseline 240ms) region=eu-west-1\n"
      "[2026-03-02 14:04:55Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise\n"
      "[2026-03-02 14:05:01Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise\n"
      "[2026-03-02 14:05:40Z] WARN  payments-gw   circuit half-open, 3 retries exhausted for order=ord_99214\n"
      "[2026-03-02 14:06:12Z] INFO  gateway       canary widened 10% -> 50% for svc-checkout-edge v812\n"
      "[2026-03-02 14:07:33Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise\n"
      "[2026-03-02 14:08:02Z] ERROR checkout-api  user-visible: \"Payment could not be processed\" shown to 1,284 sessions\n"
      "[2026-03-02 14:09:48Z] WARN  payments-gw   connection pool exhausted (max=64) waiting=210\n"
      "[2026-03-02 14:11:20Z] INFO  on-call       paged: SEV-2 opened (eu-west-1 checkout error rate 38%)\n"
      "[2026-03-02 14:14:05Z] INFO  gateway       rollback svc-checkout-edge v812 -> v811 (channel: prod 100%)\n"
      "[2026-03-02 14:17:41Z] INFO  checkout-api  p95 latency 260ms, error rate 0.4% region=eu-west-1\n"
      "[2026-03-02 14:19:10Z] INFO  on-call       SEV-2 mitigated, monitoring for 30m";

  auto triage = axllm::agent(
      "report:string, question:string -> severity:class \"low, medium, high, critical\", rootCause:string, nextSteps:string[], evidence:string[] \"Quoted log lines that support the assessment\"",
      axllm::object({
          {"contextFields", axllm::array({"report"})},
          {"contextPolicy", axllm::object({{"preset", "lean"}, {"budget", "balanced"}})},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  axllm::Value result = triage.forward(
      client,
      axllm::object({
          {"report", report},
          {"question", "What happened, how bad was it, and what should the on-call do next? Cite the lines you relied on."},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 12}}));

  std::cout << axllm::stringify(result) << "\n";
}
