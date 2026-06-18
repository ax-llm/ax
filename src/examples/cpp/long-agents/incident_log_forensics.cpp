// ax-example:start
// title: C++ Incident Log Forensics (RLM)
// group: long-agents
// description: Infers service architecture and root-cause findings from a huge CloudWatch export that never enters the prompt -- held in contextFields and worked through the runtime under a lean contextPolicy.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 10
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <iostream>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Synthetic CloudWatch-style export -- generated large on purpose. Dumping these
// raw events into a prompt would blow the context window. The agent keeps them
// in its runtime (contextFields) and only the *evidence it extracts* ever
// reaches the model. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
static std::vector<axllm::Value> build_log_dump() {
  std::time_t start = 1772456400;  // 2026-03-02T13:00:00Z
  std::vector<axllm::Value> events;

  auto push = [&](int i, axllm::Value event) {
    std::time_t ts = start + static_cast<std::time_t>(i) * 2;
    std::tm tm_utc{};
    gmtime_r(&ts, &tm_utc);
    char buffer[32];
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
    axllm::Core::set(event, "timestamp", std::string(buffer));
    axllm::Core::set(event, "requestId", "req-" + std::to_string(100000 + i));
    events.push_back(event);
  };

  for (int i = 0; i < 1600; ++i) {
    // Routine, healthy traffic across the fleet.
    push(i, axllm::object({{"level", "INFO"}, {"service", "gateway"}, {"statusCode", 200}, {"latencyMs", 40 + (i % 30)}, {"message", "route ok GET /checkout"}}));
    push(i, axllm::object({{"level", "INFO"}, {"service", "search-api"}, {"statusCode", 200}, {"latencyMs", 70 + (i % 50)}, {"message", "query ok q=shoes"}}));

    // Window A: payments-gw upstream timeouts spill into checkout-api 502s for
    // enterprise tenants, with retry storms + pool exhaustion.
    if (i >= 300 && i < 520) {
      push(i, axllm::object({{"level", "ERROR"}, {"service", "payments-gw"}, {"statusCode", 504}, {"latencyMs", 10000}, {"tenantTier", "enterprise"}, {"message", "upstream timeout calling acquirer (10s)"}}));
      push(i, axllm::object({{"level", "ERROR"}, {"service", "checkout-api"}, {"statusCode", 502}, {"tenantTier", "enterprise"}, {"message", "bad gateway from svc-payments-gw"}}));
      if (i % 3 == 0) {
        push(i, axllm::object({{"level", "WARN"}, {"service", "payments-gw"}, {"message", "connection pool exhausted (max=64) waiting=200+"}}));
        push(i, axllm::object({{"level", "WARN"}, {"service", "checkout-api"}, {"tenantTier", "enterprise"}, {"message", "user-visible: \"Payment could not be processed\""}}));
      }
    }

    // Window B: the nightly catalog-cron pins CPU and search-api returns 429s.
    if (i >= 1000 && i < 1120) {
      push(i, axllm::object({{"level", "WARN"}, {"service", "catalog-cron"}, {"latencyMs", 0}, {"message", "rebuild step pinning CPU at 95% on shared node"}}));
      push(i, axllm::object({{"level", "ERROR"}, {"service", "search-api"}, {"statusCode", 429}, {"message", "rate limited: downstream catalog unavailable"}}));
    }
  }

  return events;
}

int main() {
  const char* key = std::getenv("GOOGLE_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set GOOGLE_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_GEMINI_MODEL");
  axllm::GoogleGeminiClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gemini-3-flash-preview" : model},
  }));

  std::vector<axllm::Value> log_events = build_log_dump();
  axllm::Value logs = axllm::Value::array();
  for (const auto& event : log_events) axllm::Core::append(logs, event);
  std::cout << "Generated " << log_events.size() << " log events (kept out of the prompt).\n";

  auto log_rlm = axllm::agent(
      "task:string, logs:json \"Raw CloudWatch export; keep this out of the prompt\" -> architecture:string[] \"Services and how they call each other\", findings:json[] \"Each: issue, count, window, evidence, impact\", overallHealth:string, nextActions:string[]",
      axllm::object({
          // The export stays in the runtime; only extracted evidence reaches the model.
          {"contextFields", axllm::array({"logs"})},
          {"contextPolicy", axllm::object({{"preset", "lean"}, {"budget", "balanced"}})},
          {"maxRuntimeChars", 12000},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  axllm::Value report = log_rlm.forward(
      client,
      axllm::object({
          {"logs", logs},
          {"task", "Infer the service architecture from the logs alone. Then find repeated errors, throttles, retries, and bad user states -- with the affected time window, an occurrence count, and concrete log evidence for each."},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 40}}));

  std::cout << "\n=== Report ===\n";
  std::cout << axllm::stringify(report) << "\n";
  std::cout << "\n=== Usage ===\n";
  std::cout << axllm::stringify(log_rlm.get_usage()) << "\n";
}
