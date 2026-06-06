#include "axllm/axllm.hpp"
#include <iostream>
#include <string>
#include <vector>

struct ProfileAIClient : axllm::AIClient {
  std::vector<axllm::Value> responses;
  std::vector<axllm::Value> requests;
  std::size_t index = 0;

  explicit ProfileAIClient(std::initializer_list<axllm::Value> values) : responses(values) {}

  axllm::Value complete(axllm::Value request) override {
    requests.push_back(request);
    if (index >= responses.size()) throw axllm::AxError("runtime", "fake client exhausted");
    return responses[index++];
  }
};

struct PyodideProfileTransport : axllm::RuntimeTransport {
  int next_session = 0;
  bool closed = false;
  int counter = 0;

  axllm::Value call(axllm::Value message) override {
    axllm::Value id = axllm::Core::get(message, "id");
    axllm::Value op = axllm::Core::get(message, "op");
    if (axllm::equal(op, "capabilities")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"language", "Python"}, {"usage_instructions", "fake Pyodide protocol"}})}});
    }
    if (axllm::equal(op, "create_session")) {
      std::string session_id = "p" + std::to_string(++next_session);
      closed = false;
      return axllm::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", axllm::object({{"session_id", session_id}})}});
    }
    if (axllm::equal(op, "execute")) {
      axllm::Value session_id = axllm::Core::get(message, "session_id");
      if (closed) {
        return axllm::object({{"id", id}, {"ok", false}, {"session_id", session_id}, {"error", axllm::object({{"category", "session_closed"}, {"message", "session closed"}})}});
      }
      axllm::Value payload = axllm::Core::get(message, "payload", axllm::Value::object());
      std::string code = axllm::display(axllm::Core::get(payload, "code", ""));
      axllm::Value result = axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"answer", "pyodide"}})})}});
      if (code.find("counter") != std::string::npos) {
        counter++;
        result = axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"counter", counter}})})}});
      } else if (code.find("askClarification") != std::string::npos) {
        result = axllm::object({{"type", "askClarification"}, {"args", axllm::array({axllm::object({{"question", "Need detail?"}})})}});
      } else if (code.find("discover") != std::string::npos) {
        result = axllm::object({{"kind", "discover"}, {"discover", axllm::object({{"tools", axllm::array({"search"})}})}});
      } else if (code.find("recall") != std::string::npos) {
        result = axllm::object({{"kind", "recall"}, {"recall", "docs"}});
      } else if (code.find("used") != std::string::npos) {
        result = axllm::object({{"kind", "used"}, {"used", axllm::object({{"id", "mem1"}, {"reason", "helpful"}})}});
      } else if (code.find("reportSuccess") != std::string::npos) {
        result = axllm::object({{"kind", "status"}, {"status", axllm::object({{"type", "success"}, {"message", "ok"}})}});
      } else if (code.find("reportFailure") != std::string::npos) {
        result = axllm::object({{"kind", "status"}, {"status", axllm::object({{"type", "failed"}, {"message", "bad"}})}});
      } else if (code.find("guideAgent") != std::string::npos) {
        result = axllm::object({{"type", "guide_agent"}, {"guidance", "try this"}});
      } else if (code.find("search") != std::string::npos) {
        result = axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"title", "Docs"}})})}});
      } else if (code.find("badTool") != std::string::npos) {
        result = axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"error", "tool failed"}})})}});
      } else if (code.find("loadPackage") != std::string::npos) {
        result = axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"error", "Pyodide package loading is disabled by runtimePolicy"}})})}});
      } else if (code.find("raise") != std::string::npos) {
        result = axllm::RuntimeEnvelope::error("boom", "runtime");
      }
      return axllm::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", result}});
    }
    if (axllm::equal(op, "snapshot_globals")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"version", 1}, {"bindings", axllm::object({{"answer", "pyodide"}})}, {"globals", axllm::object({{"answer", "pyodide"}})}})}});
    }
    if (axllm::equal(op, "patch_globals")) {
      axllm::Value payload = axllm::Core::get(message, "payload", axllm::Value::object());
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::Core::get(payload, "globals", axllm::Value::object())}});
    }
    if (axllm::equal(op, "inspect_globals")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"answer", "pyodide"}})}});
    }
    if (axllm::equal(op, "close")) {
      closed = true;
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"closed", true}})}});
    }
    if (axllm::equal(op, "shutdown")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"shutdown", true}})}});
    }
    return axllm::object({{"id", id}, {"ok", false}, {"error", axllm::object({{"category", "protocol"}, {"message", "unknown op"}})}});
  }
};

int main() {
  PyodideProfileTransport transport;
  axllm::RuntimeProtocolClient runtime(transport);
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  axllm::Value out = qa.test(runtime, "final({'answer': 'pyodide'})", axllm::object({{"question", "pyodide"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  axllm::Value payload = axllm::Core::get(out, "completion_payload", axllm::Value::object());
  axllm::Value args = axllm::Core::get(payload, "args", axllm::Value::array());
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(args, 0), "answer"), "pyodide")) return 2;

  auto forward_agent = axllm::agent(
    "question:string -> answer:string",
    axllm::object({
      {"runtime", axllm::object({{"language", "Python"}})},
      {"functionDiscovery", true},
      {"memoriesMode", true},
      {"memory_search_results", axllm::object({{"docs", axllm::array({axllm::object({{"id", "mem1"}, {"content", "likes concise docs"}})})}})},
      {"functions", axllm::array({axllm::object({{"name", "search"}, {"description", "Search docs"}})})},
    })
  );
  ProfileAIClient forward_client({
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Run actor\",{}]}}"}}),
    axllm::object({{"content", "{\"pythonCode\":\"discover({'tools': ['search']})\"}"}}),
    axllm::object({{"content", "{\"pythonCode\":\"recall('docs')\"}"}}),
    axllm::object({{"content", "{\"pythonCode\":\"hit = search({'query': inputs['question']})\\nfinal('Answer', {'answer': hit['title']})\"}"}}),
    axllm::object({{"content", "{\"answer\":\"Docs\"}"}}),
  });
  axllm::Value forward_out = forward_agent.forward(
    forward_client,
    axllm::object({{"question", "pyodide"}}),
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
  auto restored_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  restored_agent.restore_runtime_state(forward_agent.export_runtime_state());
  if (axllm::stringify(restored_agent.export_runtime_state()).find("likes concise docs") == std::string::npos) return 22;

  auto guide_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  ProfileAIClient guide_client({
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Guide\",{}]}}"}}),
    axllm::object({{"content", "{\"pythonCode\":\"guideAgent('Prefer concise final.')\"}"}}),
    axllm::object({{"content", "{\"pythonCode\":\"final('Answer', {'answer': 'Concise'})\"}"}}),
    axllm::object({{"content", "{\"answer\":\"Concise\"}"}}),
  });
  axllm::Value guide_out = guide_agent.forward(
    guide_client,
    axllm::object({{"question", "pyodide"}}),
    axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 3}})
  );
  if (!axllm::equal(axllm::Core::get(guide_out, "answer"), "Concise")) return 23;
  std::string guide_text = axllm::stringify(guide_agent.get_action_log()) + axllm::stringify(guide_agent.export_trace());
  if (guide_text.find("guide_agent") == std::string::npos || guide_text.find("try this") == std::string::npos) return 24;

  auto clarification_agent = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  ProfileAIClient clarification_client({
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Ask\",{}]}}"}}),
    axllm::object({{"content", "{\"pythonCode\":\"askClarification('Need detail?')\"}"}}),
  });
  bool saw_clarification = false;
  try {
    clarification_agent.forward(
      clarification_client,
      axllm::object({{"question", "pyodide"}}),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 1}})
    );
  } catch (const axllm::AxError& error) {
    saw_clarification = std::string(error.what()).find("Need detail") != std::string::npos;
  }
  if (!saw_clarification) return 19;

  axllm::AxCodeSession* session = runtime.create_session(
    axllm::object({{"inputs", axllm::object({{"question", "pyodide"}})}, {"search", axllm::object({{"__ax_host_callable", true}, {"native", true}})}, {"badTool", axllm::object({{"__ax_host_callable", true}, {"native", true}})}}),
    axllm::object({{"reservedNames", axllm::array({"inputs"})}})
  );
  axllm::Value step1 = session->execute("counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})");
  axllm::Value step2 = session->execute("counter = counter + 1\nfinal({'counter': counter})");
  if (!axllm::equal(axllm::Core::get(step1, "type"), "final") || !axllm::equal(axllm::Core::get(step2, "type"), "final")) return 3;
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(step2, "args", axllm::Value::array()), 0), "counter"), 2)) return 4;
  if (!axllm::equal(axllm::Core::get(session->execute("askClarification({'question': 'Need detail?'})"), "type"), "askClarification")) return 5;
  if (!axllm::equal(axllm::Core::get(session->execute("discover({'tools': ['search']})"), "kind"), "discover")) return 6;
  if (!axllm::equal(axllm::Core::get(session->execute("recall({'query': 'docs'})"), "kind"), "recall")) return 7;
  if (!axllm::equal(axllm::Core::get(session->execute("used('mem1', 'helpful')"), "kind"), "used")) return 8;
  if (!axllm::equal(axllm::Core::get(session->execute("reportSuccess('ok')"), "kind"), "status")) return 9;
  if (!axllm::equal(axllm::Core::get(session->execute("reportFailure('bad')"), "kind"), "status")) return 25;
  if (!axllm::equal(axllm::Core::get(session->execute("guideAgent('try this')"), "type"), "guide_agent")) return 10;
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(session->execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})"), "args", axllm::Value::array()), 0), "title"), "Docs")) return 11;
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(session->execute("err = badTool({})\nfinal({'error': err['error']})"), "args", axllm::Value::array()), 0), "error"), "tool failed")) return 12;
  if (axllm::stringify(session->execute("pkg = loadPackage('numpy')\nfinal({'error': pkg['error']})")).find("package loading is disabled") == std::string::npos) return 26;
  axllm::Value snapshot = session->snapshot_globals();
  if (!axllm::Core::get(axllm::Core::get(snapshot, "bindings", axllm::Value::object()), "inputs").is_null()) return 13;
  session->patch_globals(axllm::object({{"bindings", axllm::object({{"safe", 9}})}}));
  if (!axllm::equal(axllm::Core::get(session->inspect(), "answer"), "pyodide")) return 14;
  if (!axllm::equal(axllm::Core::get(session->execute("raise Exception('boom')"), "error_category"), "runtime")) return 15;
  session->close();
  if (!axllm::equal(axllm::Core::get(session->execute("final({'answer': 'closed'})"), "error_category"), "session_closed")) return 16;
  runtime.shutdown();
  std::cout << "cpp-python-pyodide-profile-ok runtime-behavior-parity-ok\n";
}
