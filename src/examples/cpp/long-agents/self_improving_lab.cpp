// ax-example:start
// title: C++ Self-Improving Lab Agent
// group: long-agents
// description: A many-tool agent that runs experiments, grades them against a rubric with an independent verifier, and distills verified rules into memory -- iterating until the rubric passes.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 40
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <map>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// The "lab": a deterministic black-box experiment. It scores an ETL config plan
// against a hidden ideal and returns, for any failing check, the exact fix --
// so the agent can converge by following the feedback, not by being told.
// ---------------------------------------------------------------------------
static const std::vector<std::string> CHECKS = {
    "no-nulls", "no-duplicates", "numeric-types", "trimmed-strings", "outliers-handled"};

static std::string remedy_for(const std::string& check) {
  if (check == "no-nulls") return "set nullPolicy=impute (or nullPolicy=drop)";
  if (check == "no-duplicates") return "set dedup=on";
  if (check == "numeric-types") return "set coerceTypes=on";
  if (check == "trimmed-strings") return "set trim=on";
  if (check == "outliers-handled") return "set outlier=clip (or outlier=winsorize)";
  return "";
}

static std::string to_lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
  return s;
}

static axllm::Value run_in_sandbox(const std::string& plan) {
  std::string lowered = to_lower(plan);
  std::map<std::string, std::string> flags;
  std::regex re("([a-z]+)\\s*=\\s*([a-z0-9]+)");
  for (std::sregex_iterator it(lowered.begin(), lowered.end(), re), end; it != end; ++it) {
    flags[(*it)[1].str()] = (*it)[2].str();
  }
  auto flag = [&](const std::string& key) -> std::string {
    auto found = flags.find(key);
    return found == flags.end() ? "" : found->second;
  };

  std::map<std::string, bool> ok = {
      {"no-nulls", flag("nullpolicy") == "impute" || flag("nullpolicy") == "drop"},
      {"no-duplicates", flag("dedup") == "on"},
      {"numeric-types", flag("coercetypes") == "on"},
      {"trimmed-strings", flag("trim") == "on"},
      {"outliers-handled", flag("outlier") == "clip" || flag("outlier") == "winsorize"},
  };

  axllm::Value passed = axllm::Value::array();
  axllm::Value failed = axllm::Value::array();
  int passed_count = 0;
  for (const auto& c : CHECKS) {
    if (ok[c]) {
      axllm::Core::append(passed, c);
      ++passed_count;
    } else {
      axllm::Core::append(failed, axllm::object({{"check", c}, {"fix", remedy_for(c)}}));
    }
  }
  double score = std::round((static_cast<double>(passed_count) / CHECKS.size()) * 100.0) / 100.0;
  std::ostringstream logs;
  logs << passed_count << "/" << CHECKS.size() << " checks passed";
  return axllm::object({
      {"score", score},
      {"solved", passed_count == static_cast<int>(CHECKS.size())},
      {"passed", passed},
      {"failed", failed},
      {"logs", logs.str()},
  });
}

static axllm::Value fn_spec(const std::string& name, const std::string& description,
                           axllm::Value props, axllm::Value required = axllm::Value()) {
  axllm::Value parameters = axllm::object({{"type", "object"}, {"properties", props}});
  if (!required.is_null()) axllm::Core::set(parameters, "required", required);
  return axllm::object({{"name", name}, {"description", description}, {"parameters", parameters}});
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

  // An independent verifier -- a separate ax() program, not the agent grading itself.
  auto verifier = axllm::ax("rubric:string, evidence:json -> passed:boolean, feedback:string, missing:string[]");
  verifier.set_instruction(
      "You are an independent rubric grader, not a self-critique. Pass only when the evidence clearly satisfies every part of the rubric.");

  // In-memory rule store. Verified, reusable rules go here -- not raw failure notes.
  std::map<std::string, std::string> memory_store;

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  runtime
      .register_callable("runExperiment", [](axllm::Value p) -> axllm::Value {
        return run_in_sandbox(axllm::display(axllm::Core::get(p, "plan", "")));
      })
      .register_callable("listChecks", [](axllm::Value) -> axllm::Value {
        axllm::Value out = axllm::Value::array();
        for (const auto& c : CHECKS) axllm::Core::append(out, c);
        return out;
      })
      .register_callable("grade", [&client, &verifier](axllm::Value p) -> axllm::Value {
        return verifier.forward(
            client,
            axllm::object({
                {"rubric", axllm::Core::get(p, "rubric", "")},
                {"evidence", axllm::Core::get(p, "evidence", axllm::Value::array())},
            }));
      })
      .register_callable("recall", [&memory_store](axllm::Value p) -> axllm::Value {
        std::string topic = to_lower(axllm::display(axllm::Core::get(p, "topic", "")));
        std::vector<std::string> words;
        std::istringstream ss(topic);
        std::string word;
        while (ss >> word) words.push_back(word);
        axllm::Value out = axllm::Value::array();
        for (const auto& entry : memory_store) {
          bool match = !topic.empty() && entry.first.find(topic) != std::string::npos;
          for (const auto& w : words) {
            if (!w.empty() && entry.first.find(w) != std::string::npos) match = true;
          }
          if (match) axllm::Core::append(out, entry.second);
        }
        return out;
      })
      .register_callable("remember", [&memory_store](axllm::Value p) -> axllm::Value {
        std::string rule = axllm::display(axllm::Core::get(p, "rule", ""));
        std::string evidence = axllm::display(axllm::Core::get(p, "evidence", ""));
        std::string key = to_lower(rule).substr(0, 48);
        memory_store[key] = rule + " :: " + evidence;
        return axllm::object({{"stored", true}, {"total", static_cast<double>(memory_store.size())}});
      });

  auto self_improving = axllm::agent(
      "goal:string, rubric:string -> answer:string, experiments:string[] \"Plans tried, in order\", learnedRules:string[]",
      axllm::object({
          {"contextFields", axllm::array({})},
          {"functions", axllm::array({
              fn_spec("runExperiment",
                      "Apply an ETL config plan; returns score, solved, passed[], failed[{check,fix}], logs. Pass an empty plan to discover the fixes.",
                      axllm::object({{"plan", axllm::object({{"type", "string"}})}}),
                      axllm::array({"plan"})),
              fn_spec("listChecks", "List the data-quality checks the experiment evaluates.", axllm::object({})),
              fn_spec("grade",
                      "Independent rubric grader. Pass only when the evidence meets the rubric.",
                      axllm::object({
                          {"rubric", axllm::object({{"type", "string"}})},
                          {"evidence", axllm::object({{"type", "array"}, {"items", axllm::object({{"type", "string"}})}})},
                      }),
                      axllm::array({"rubric", "evidence"})),
              fn_spec("recall", "Recall verified rules relevant to a topic.",
                      axllm::object({{"topic", axllm::object({{"type", "string"}})}}),
                      axllm::array({"topic"})),
              fn_spec("remember", "Store a verified, reusable rule (the rule, not raw notes).",
                      axllm::object({
                          {"rule", axllm::object({{"type", "string"}})},
                          {"evidence", axllm::object({{"type", "string"}})},
                      }),
                      axllm::array({"rule", "evidence"})),
          })},
          {"contextPolicy", axllm::object({{"preset", "adaptive"}, {"budget", "balanced"}})},
          {"executorOptions", axllm::object({
              {"description",
               std::string("Use the tools -- do not answer from your own knowledge.\n") +
                   "1. recall('etl data quality') to reuse anything already learned.\n" +
                   "2. runExperiment('') once to see every failing check and its fix.\n" +
                   "3. Build a plan applying all the fixes, then runExperiment again. Repeat until solved is true.\n" +
                   "4. grade the passing evidence against the rubric.\n" +
                   "5. For each check you fixed, remember(rule, evidence).\n" +
                   "6. Then return the answer, the plans you tried, and the learned rules."},
          })},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::Value result = self_improving.forward(
      client,
      axllm::object({
          {"goal", "Find an ETL config plan that cleans the dirty dataset so every data-quality check passes."},
          {"rubric", "All five checks (no-nulls, no-duplicates, numeric-types, trimmed-strings, outliers-handled) must pass, i.e. score 1.0."},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 18}}));

  std::cout << axllm::stringify(result) << "\n";

  // Persist the agent's verified rules so a future run's recall reuses them.
  axllm::Value learned = axllm::Core::get(result, "learnedRules", axllm::Value::array());
  for (const auto& rule : axllm::Core::iter(learned)) {
    std::string text = axllm::display(rule);
    memory_store[to_lower(text).substr(0, 48)] = text;
  }
  std::cout << "\nMemory now holds " << memory_store.size() << " rule(s) for next time.\n";
}
