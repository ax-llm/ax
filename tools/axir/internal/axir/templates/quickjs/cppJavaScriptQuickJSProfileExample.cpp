#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <iostream>
#include <vector>

static bool is_number(const axllm::Value& value, const std::string& expected) {
  return axllm::display(value) == expected;
}

struct ProfileAIClient : axllm::AIClient {
  std::vector<axllm::Value> responses;
  std::vector<axllm::Value> requests;
  std::size_t index = 0;

  explicit ProfileAIClient(std::initializer_list<axllm::Value> values) : responses(values) {}

  axllm::Value complete(axllm::Value request) override {
    requests.push_back(request);
    if (index >= responses.size()) throw axllm::AxError("runtime", "scripted client exhausted");
    return responses[index++];
  }
};

int main() {
  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  runtime
    .register_callable("search", [](axllm::Value params) {
      return axllm::object({{"title", "Docs"}, {"query", axllm::Core::get(params, "query", "")}});
    })
    .register_callable("badTool", [](axllm::Value) -> axllm::Value {
      throw axllm::AxError("runtime", "tool failed");
    });
  axllm::Value policy = runtime.runtime_policy();
  if (!axllm::equal(axllm::Core::get(policy, "allowFilesystem"), false) || !axllm::equal(axllm::Core::get(policy, "allowNetwork"), false)) return 28;

  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  axllm::Value out = qa.test(runtime, "answer = inputs.question; final({answer})", axllm::object({{"question", "quickjs"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  axllm::Value payload = axllm::Core::get(out, "completion_payload", axllm::Value::object());
  axllm::Value args = axllm::Core::get(payload, "args", axllm::Value::array());
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(args, 0), "answer"), "quickjs")) return 2;

  auto forward_agent = axllm::agent(
    "question:string -> answer:string",
    axllm::object({
      {"runtime", axllm::object({{"language", "JavaScript"}})},
      {"functionDiscovery", true},
      {"memoriesMode", true},
      {"memory_search_results", axllm::object({{"prefs", axllm::array({axllm::object({{"id", "mem1"}, {"content", "likes concise docs"}})})}})},
      {"functions", axllm::array({axllm::object({{"name", "search"}, {"description", "Search docs"}})})},
    })
  );
  ProfileAIClient forward_client({
    axllm::object({{"content", "{\"javascriptCode\":\"final('Run actor', {})\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"counter = 41; discover({tools:['search']})\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"recall('prefs')\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"const hit = search({query: inputs.question}); final('Answer', {answer: hit.title})\"}"}}),
    axllm::object({{"content", "{\"answer\":\"Docs\"}"}}),
  });
  axllm::Value forward_out = forward_agent.forward(
    forward_client,
    axllm::object({{"question", "quickjs"}}),
    axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 4}})
  );
  if (!axllm::equal(axllm::Core::get(forward_out, "answer"), "Docs")) return 17;
  std::string action_log_text = axllm::stringify(forward_agent.get_action_log());
  if (action_log_text.find("discover") == std::string::npos || action_log_text.find("recall") == std::string::npos || action_log_text.find("Docs") == std::string::npos) return 18;
  if (axllm::stringify(forward_agent.export_runtime_state()).find("likes concise docs") == std::string::npos) return 20;
  std::string forward_trace = axllm::stringify(forward_agent.export_trace());
  for (const auto& kind : {"runtime_execute", "discover", "recall", "final"}) {
    if (forward_trace.find(kind) == std::string::npos) return 21;
  }
  auto restored_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  restored_agent.restore_runtime_state(forward_agent.export_runtime_state());
  if (axllm::stringify(restored_agent.export_runtime_state()).find("likes concise docs") == std::string::npos) return 22;

  auto guide_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  ProfileAIClient guide_client({
    axllm::object({{"content", "{\"javascriptCode\":\"final('Guide', {})\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"guideAgent('Prefer concise final.')\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"final('Answer', {answer: 'Concise'})\"}"}}),
    axllm::object({{"content", "{\"answer\":\"Concise\"}"}}),
  });
  axllm::Value guide_out = guide_agent.forward(
    guide_client,
    axllm::object({{"question", "quickjs"}}),
    axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 3}})
  );
  if (!axllm::equal(axllm::Core::get(guide_out, "answer"), "Concise")) return 23;
  std::string guide_text = axllm::stringify(guide_agent.get_action_log()) + axllm::stringify(guide_agent.export_trace());
  if (guide_text.find("guide_agent") == std::string::npos || guide_text.find("Prefer concise final.") == std::string::npos) return 24;

  auto clarification_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  ProfileAIClient clarification_client({
    axllm::object({{"content", "{\"javascriptCode\":\"final('Ask', {})\"}"}}),
    axllm::object({{"content", "{\"javascriptCode\":\"askClarification('Need detail?')\"}"}}),
  });
  bool saw_clarification = false;
  try {
    clarification_agent.forward(
      clarification_client,
      axllm::object({{"question", "quickjs"}}),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 1}})
    );
  } catch (const axllm::AxError& error) {
    saw_clarification = std::string(error.what()).find("Need detail") != std::string::npos;
  }
  if (!saw_clarification) return 19;

  axllm::AxCodeSession* session = runtime.create_session(
    axllm::object({{"inputs", axllm::object({{"question", "quickjs"}})}}),
    axllm::object({{"reservedNames", axllm::array({"inputs"})}})
  );
  axllm::Value step1 = session->execute("counter = (typeof counter === 'undefined' ? 0 : counter) + 1; final({counter})");
  axllm::Value step2 = session->execute("counter = counter + 1; final({counter})");
  if (!axllm::equal(axllm::Core::get(step1, "type"), "final") || !axllm::equal(axllm::Core::get(step2, "type"), "final")) return 3;
  axllm::Value step2_args = axllm::Core::get(step2, "args", axllm::Value::array());
  if (!is_number(axllm::Core::get(axllm::Core::get(step2_args, 0), "counter"), "2")) return 4;
  axllm::Value step3 = session->execute("final({answer: inputs.question, counter})");
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(step3, "args", axllm::Value::array()), 0), "answer"), "quickjs")) return 5;
  if (!axllm::equal(axllm::Core::get(session->execute("askClarification('more?')"), "type"), "askClarification")) return 6;
  if (!axllm::equal(axllm::Core::get(session->execute("discover({tools:['search']})"), "kind"), "discover")) return 7;
  if (!axllm::equal(axllm::Core::get(session->execute("recall({query:'docs'})"), "kind"), "recall")) return 8;
  if (!axllm::equal(axllm::Core::get(session->execute("used('mem1', 'helpful')"), "kind"), "used")) return 9;
  if (!axllm::equal(axllm::Core::get(session->execute("reportSuccess('ok')"), "kind"), "status")) return 10;
  axllm::AxCodeSession* host_session = runtime.create_session(
    axllm::object({{"inputs", axllm::object({{"question", "quickjs"}})}}),
    axllm::object({{"reservedNames", axllm::array({"inputs"})}})
  );
  axllm::Value bridged = host_session->execute("const hit = search({query: inputs.question}); final({title: hit.title})");
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(bridged, "args", axllm::Value::array()), 0), "title"), "Docs")) return 15;
  axllm::Value failed_call = host_session->execute("final({error: badTool({}).error})");
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(failed_call, "args", axllm::Value::array()), 0), "error"), "tool failed")) return 16;
  host_session->close();
  delete host_session;
  axllm::Value ambient = session->execute("final({fetchType: typeof fetch, requireType: typeof require, processType: typeof process})");
  axllm::Value ambient_payload = axllm::Core::get(axllm::Core::get(axllm::Core::get(ambient, "args", axllm::Value::array()), 0), "fetchType");
  if (!axllm::equal(ambient_payload, "undefined")) return 29;
  axllm::runtime::quickjs::QuickJsCodeRuntime capped_runtime(axllm::object({{"maxSnapshotBytes", 64}}));
  axllm::AxCodeSession* capped_session = capped_runtime.create_session(axllm::Value::object(), axllm::Value::object());
  capped_session->execute("big = 'x'.repeat(1000); final({ok:true})");
  axllm::Value capped_snapshot = capped_session->snapshot_globals();
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(capped_snapshot, "bindings", axllm::Value::object()), "__ax_snapshot_truncated"), true)) return 30;
  capped_session->close();
  delete capped_session;
  session->execute("safe = 7; final({safe})");
  axllm::Value snapshot = session->snapshot_globals();
  if (!axllm::Core::get(axllm::Core::get(snapshot, "bindings", axllm::Value::object()), "inputs").is_null()) return 11;
  session->patch_globals(axllm::object({{"bindings", axllm::object({{"safe", 9}})}}));
  if (!is_number(axllm::Core::get(session->inspect(), "safe"), "9")) return 12;
  if (!axllm::equal(axllm::Core::get(session->execute("throw new Error('boom')"), "error_category"), "runtime")) return 13;
  session->close();
  if (!axllm::equal(axllm::Core::get(session->execute("final({})"), "error_category"), "session_closed")) return 14;
  delete session;

  std::cout << "cpp-javascript-quickjs-profile-ok runtime-behavior-parity-ok\n";
}
