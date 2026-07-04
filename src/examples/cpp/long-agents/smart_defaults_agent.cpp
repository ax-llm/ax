// ax-example:start
// title: C++ Smart Defaults Agent
// group: long-agents
// description: Shows AxAgent smart defaults: oversized undeclared context stays out of the prompt while relevance hints and runtime tools guide the agent.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 60
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

static const std::vector<std::string> TIMELINE = {
    "09:12 checkout-edge v812 deployed behind 25% of traffic",
    "09:18 payments gateway p95 rose from 420ms to 4.8s",
    "09:22 cart completion dropped 31% for enterprise accounts",
    "09:27 retries saturated the checkout-edge connection pool",
    "09:31 rollback to v811 started",
    "09:36 p95 returned below 700ms after pool reset",
};

static std::string build_incident_log() {
  std::string out;
  for (int i = 0; i < 28; ++i) {
    if (!out.empty()) out += "\n\n";
    out += "# log shard " + std::to_string(i + 1) + "\n";
    for (std::size_t j = 0; j < TIMELINE.size(); ++j) {
      if (j > 0) out += "\n";
      out += TIMELINE[j];
    }
  }
  return out;
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
      {"model", model == nullptr || std::string(model).empty() ? "gemini-3.5-flash" : model},
  }));

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  runtime
      .register_callable("summarizeIncident", [](axllm::Value p) -> axllm::Value {
        std::string service = axllm::display(axllm::Core::get(p, "service", "checkout"));
        if (service.empty()) service = "checkout";
        return axllm::object({
            {"service", service},
            {"severity", "sev-1"},
            {"rootCause",
             "checkout-edge v812 retried payment gateway calls without bounded concurrency, saturating the shared connection pool."},
            {"errorRate", "38%"},
            {"affectedSessions", 1284.0},
            {"candidateRunbook", "payments-timeout-runbook"},
            {"relevantMemory", "decision-enterprise-comms"},
        });
      })
      .register_callable("getTimeline", [](axllm::Value p) -> axllm::Value {
        std::string service = axllm::display(axllm::Core::get(p, "service", "checkout"));
        if (service.empty()) service = "checkout";
        axllm::Value out = axllm::Value::array();
        for (const auto& event : TIMELINE) {
          axllm::Core::append(out, axllm::object({{"service", service}, {"event", event}}));
        }
        return out;
      })
      .register_callable("getRunbook", [](axllm::Value p) -> axllm::Value {
        std::string id = axllm::display(axllm::Core::get(p, "id", "payments-timeout-runbook"));
        if (id.empty()) id = "payments-timeout-runbook";
        return axllm::object({
            {"id", id},
            {"steps", axllm::array({
                          "Freeze checkout deploys and page the payments owner.",
                          "Rollback checkout-edge to v811 and reset saturated pools.",
                          "Post enterprise status update after error rate stays below 2%.",
                      })},
        });
      });

  auto analyst = axllm::agent(
      "incidentLog:string, question:string -> rootCause:string, actions:string[] \"Recommended remediation actions from the runbook\", evidence:string[]",
      axllm::object({
          {"name", "SmartDefaultsIncidentAgent"},
          {"description", "Investigate checkout incidents using runtime tools, relevance hints, and compact evidence."},
          // No contextFields and no autoUpgrade option: oversized incidentLog is promoted by default.
          {"functions", axllm::array({
              axllm::object({
                  {"name", "summarizeIncident"},
                  {"description", "Summarize the current checkout incident and name the strongest runbook and memory matches."},
                  {"parameters", axllm::object({
                      {"type", "object"},
                      {"properties", axllm::object({{"service", axllm::object({{"type", "string"}})}})},
                      {"required", axllm::array({"service"})},
                  })},
              }),
              axllm::object({
                  {"name", "getTimeline"},
                  {"description", "Return concrete timestamped evidence for the checkout incident."},
                  {"parameters", axllm::object({
                      {"type", "object"},
                      {"properties", axllm::object({{"service", axllm::object({{"type", "string"}})}})},
                      {"required", axllm::array({"service"})},
                  })},
              }),
              axllm::object({
                  {"name", "getRunbook"},
                  {"description", "Fetch the operational runbook steps for a relevant incident pattern."},
                  {"parameters", axllm::object({
                      {"type", "object"},
                      {"properties", axllm::object({{"id", axllm::object({{"type", "string"}})}})},
                      {"required", axllm::array({"id"})},
                  })},
              }),
          })},
          {"skillsCatalog", axllm::array({
              axllm::object({
                  {"id", "payments-timeout-runbook"},
                  {"name", "Payments timeout runbook"},
                  {"content", "Use when checkout latency follows payment gateway retry amplification."},
              }),
              axllm::object({
                  {"id", "status-comms-runbook"},
                  {"name", "Status communications"},
                  {"content", "Use when customer-facing enterprise account updates are required."},
              }),
          })},
          {"memoriesCatalog", axllm::array({
              axllm::object({
                  {"id", "decision-enterprise-comms"},
                  {"content",
                   "For sev-1 checkout incidents, send an enterprise status update only after rollback is complete and error rate is below 2%."},
              }),
              axllm::object({
                  {"id", "checkout-v812-rollback"},
                  {"content", "checkout-edge v812 rollback completed cleanly once saturated payment pools were reset."},
              }),
          })},
          {"executorOptions", axllm::object({
              {"description",
               "Call the bare async runtime functions summarizeIncident, getTimeline, and getRunbook before answering.\n"
               "Use top-level await, for example: const s = await summarizeIncident({service:'checkout'});\n"
               "The large incidentLog input is intentionally not declared as a context field; smart defaults keep it available at runtime without flooding the prompt.\n"
               "Return the root cause, the first three remediation actions, and concrete evidence."},
          })},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::Value result = analyst.forward(
      client,
      axllm::object({
          {"incidentLog", build_incident_log()},
          {"question", "Find the root cause, first three remediation actions, and concrete evidence for the checkout payment incident."},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 30}}));

  std::cout << axllm::stringify(result) << "\n";
}
