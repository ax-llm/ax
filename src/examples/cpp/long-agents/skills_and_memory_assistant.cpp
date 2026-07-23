// ax-example:start
// title: C++ Skills + Memory Ops Assistant
// group: long-agents
// description: An on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand, using the agent skills and memories subsystems.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <cstdlib>
#include <iostream>
#include <string>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  // gpt-5.4 (not -mini): the recall/discover loop needs reasoning to proactively
  // pull memories + runbooks instead of stopping to ask for clarification.
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));

  // ---------------------------------------------------------------------------
  // Memory store -- remembered decisions and postmortems. In production this is a
  // vector DB / BM25 index; here it is served to the actor's `recall([...])` via
  // the host memory-search results below. The actor pulls relevant entries into
  // scope through recall.
  // ---------------------------------------------------------------------------
  axllm::Value memories = axllm::array({
      axllm::object({
          {"id", "decision/db-failover"},
          {"content", "Decision (2026-02): during a primary DB failover, freeze writes via the feature flag `writes.enabled=false` BEFORE promoting the replica. Promoting first caused split-brain in inc-118."},
      }),
      axllm::object({
          {"id", "postmortem/inc-118"},
          {"content", "inc-118 root cause: replica promoted while primary still accepted writes. Mitigation: write-freeze flag + 90s replication-lag gate."},
      }),
      axllm::object({
          {"id", "decision/customer-comms"},
          {"content", "Decision: for Sev-1s affecting enterprise tenants, post a status-page update within 15 minutes and notify named TAMs directly."},
      }),
  });

  // ---------------------------------------------------------------------------
  // Skill store -- runbooks loaded into the executor prompt on demand via
  // `discover({ skills: [...] })`. Loaded skills persist across calls.
  // ---------------------------------------------------------------------------
  axllm::Value skills = axllm::array({
      axllm::object({
          {"id", "runbook-db-failover"},
          {"name", "DB failover runbook"},
          {"content", "## DB failover\n1. Set `writes.enabled=false`.\n2. Wait for replication lag < 5s.\n3. Promote replica.\n4. Re-point app via service discovery.\n5. Re-enable writes. 6. File postmortem within 48h."},
      }),
      axllm::object({
          {"id", "runbook-status-comms"},
          {"name", "Status communications runbook"},
          {"content", "## Status comms\n- Sev-1: status-page update within 15m, every 30m thereafter.\n- Enterprise impact: notify named TAMs directly.\n- Keep updates factual; no ETAs you cannot keep."},
      }),
  });

  // Token-based matching (a stand-in for BM25/vector): an entry matches if any word of any
  // search query (len >= 3) appears in it -- robust to phrase queries from the actor. These
  // native callbacks receive the actor's actual recall()/discover() queries.
  auto memories_search = [memories](axllm::Value searches, axllm::Value already_loaded) -> axllm::Value {
    axllm::Value out = axllm::array({});
    for (const auto& q : axllm::Core::iter(searches)) {
      for (const auto& w : axllm::Core::iter(axllm::Core::string_words(axllm::Core::string_lower(q)))) {
        if (!axllm::Core::truthy(axllm::Core::gte(axllm::Core::len(w), axllm::Value(3)))) continue;
        for (const auto& m : axllm::Core::iter(memories)) {
          if (axllm::Core::truthy(axllm::Core::contains(already_loaded, m))) continue;
          if (axllm::Core::truthy(axllm::Core::contains(out, m))) continue;
          axllm::Value id = axllm::Core::string_lower(axllm::Core::get(m, "id", axllm::Value("")));
          axllm::Value content = axllm::Core::string_lower(axllm::Core::get(m, "content", axllm::Value("")));
          if (axllm::Core::truthy(axllm::Core::contains(id, w)) || axllm::Core::truthy(axllm::Core::contains(content, w))) {
            axllm::Core::append(out, m);
          }
        }
      }
    }
    return out;
  };
  auto skills_search = [skills](axllm::Value searches) -> axllm::Value {
    axllm::Value out = axllm::array({});
    for (const auto& q : axllm::Core::iter(searches)) {
      for (const auto& w : axllm::Core::iter(axllm::Core::string_words(axllm::Core::string_lower(q)))) {
        if (!axllm::Core::truthy(axllm::Core::gte(axllm::Core::len(w), axllm::Value(3)))) continue;
        for (const auto& sk : axllm::Core::iter(skills)) {
          if (axllm::Core::truthy(axllm::Core::contains(out, sk))) continue;
          axllm::Value id = axllm::Core::string_lower(axllm::Core::get(sk, "id", axllm::Value("")));
          axllm::Value name = axllm::Core::string_lower(axllm::Core::get(sk, "name", axllm::Value("")));
          axllm::Value content = axllm::Core::string_lower(axllm::Core::get(sk, "content", axllm::Value("")));
          if (axllm::Core::truthy(axllm::Core::contains(id, w)) || axllm::Core::truthy(axllm::Core::contains(name, w)) || axllm::Core::truthy(axllm::Core::contains(content, w))) {
            axllm::Core::append(out, sk);
          }
        }
      }
    }
    return out;
  };

  auto assistant = axllm::agent(
      "situation:string -> guidance:string \"What to do, grounded in our decisions and runbooks\", steps:string[]",
      axllm::object({
          {"contextFields", axllm::array({})},
          // A base skill always loaded, independent of search.
          {"skills", axllm::array({
              axllm::object({
                  {"name", "house-style"},
                  {"content", "Be concise and operational. Prefer our remembered decisions over generic advice. Never invent flag names or steps -- cite the runbook."},
              }),
          })},
          // Native host search callbacks -- the actor's recall()/discover() reach these
          // (their presence auto-enables the memory + skill subsystems).
          {"onMemoriesSearch", axllm::register_memories_search(memories_search)},
          {"onSkillsSearch", axllm::register_skills_search(skills_search)},
          {"onLoadedMemories", axllm::register_agent_observer([](axllm::Value payload) { std::cout << "[memories loaded] " << axllm::stringify(payload) << "\n"; })},
          {"onLoadedSkills", axllm::register_agent_observer([](axllm::Value payload) { std::cout << "[skills loaded] " << axllm::stringify(payload) << "\n"; })},
          {"onUsedMemories", axllm::register_agent_observer([](axllm::Value payload) { std::cout << "[memories used] " << axllm::stringify(payload) << "\n"; })},
          {"onUsedSkills", axllm::register_agent_observer([](axllm::Value payload) { std::cout << "[skills used] " << axllm::stringify(payload) << "\n"; })},
          {"executorOptions", axllm::object({
              {"description",
               std::string("You do NOT know our internal flag names, incident history, or runbook steps from your own training.\n") +
                   "The only source of truth is our memory (past decisions/postmortems) and our runbook skills.\n" +
                   "1. recall the relevant past decisions and postmortems (e.g. the failover decision, inc-118).\n" +
                   "2. discover the matching runbook skill and read its exact steps and flag names.\n" +
                   "3. Answer with the precise ordered procedure, citing our exact flag names and runbook steps.\n" +
                   "Generic best-practice advice is WRONG here. Do NOT answer from general knowledge and do NOT ask for clarification -- recall and discover first."},
          })},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  axllm::Value result = assistant.forward(
      client,
      axllm::object({
          {"situation",
           std::string("Our primary database is unhealthy and we're about to fail over -- the same class of ") +
               "incident as inc-118, and enterprise checkout is affected. Per our remembered decisions " +
               "and runbooks: what is the exact ordered procedure, and which specific feature flag must " +
               "we set before promoting the replica?"},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 12}}));

  std::cout << "\n=== Response ===\n";
  std::cout << axllm::stringify(result) << "\n";
}
