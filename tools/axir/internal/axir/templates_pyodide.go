package axir

const pyPythonPyodideProfileExample = `import os

from axllm import ProcessCodeRuntime, agent


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        if not self.responses:
            raise RuntimeError("fake client exhausted")
        return self.responses.pop(0)

server = os.environ.get("AXIR_PYODIDE_RUNTIME_SERVER")
if not server:
    raise RuntimeError("AXIR_PYODIDE_RUNTIME_SERVER is required for the python-pyodide profile example")

runtime = ProcessCodeRuntime(server, cwd=os.environ.get("AXIR_REPO_ROOT"))
try:
    qa = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    out = qa.test(runtime, "answer = inputs['question']\nfinal({'answer': answer})", {"question": "pyodide"})
    assert out["kind"] == "final", out
    first = out["completion_payload"]["args"][0]
    assert first["answer"] == "pyodide", out

    forward_agent = agent(
        "question:string -> answer:string",
        {
            "runtime": {"language": "Python"},
            "functionDiscovery": True,
            "memoriesMode": True,
            "functions": [{"name": "search", "description": "Search docs"}],
            "memory_search_results": {
                "prefs": [{"id": "mem1", "content": "likes concise docs"}]
            },
        },
    )
    forward_client = FakeClient(
        [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Run actor\",{}]}}"},
            {"content": "{\"pythonCode\":\"counter = 41\\ndiscover({'tools': ['search']})\"}"},
            {"content": "{\"pythonCode\":\"recall('prefs')\"}"},
            {
                "content": "{\"pythonCode\":\"hit = search({'query': inputs['question']})\\nfinal('Answer', {'answer': hit['title']})\"}"
            },
            {"content": "{\"answer\":\"Docs\"}"},
        ]
    )
    forward_out = forward_agent.forward(
        forward_client,
        {"question": "pyodide"},
        {"runtime": runtime, "max_actor_steps": 4},
    )
    assert forward_out["answer"] == "Docs", forward_out
    assert len(forward_client.requests) == 5, forward_client.requests
    action_log_text = str(forward_agent.get_action_log())
    assert "discover" in action_log_text and "recall" in action_log_text and "Docs" in action_log_text, action_log_text
    state_text = str(forward_agent.export_runtime_state())
    assert "likes concise docs" in state_text, state_text
    trace_kinds = [event.get("kind") for event in forward_agent.export_trace().get("events", [])]
    for kind in ["runtime_execute", "discover", "recall", "final"]:
        assert kind in trace_kinds, trace_kinds
    restored_agent = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    restored_agent.restore_runtime_state(forward_agent.export_runtime_state())
    assert "likes concise docs" in str(restored_agent.export_runtime_state()), restored_agent.export_runtime_state()

    guide_agent = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    guide_client = FakeClient(
        [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Guide\",{}]}}"},
            {"content": "{\"pythonCode\":\"guideAgent('Prefer concise final.')\"}"},
            {"content": "{\"pythonCode\":\"final('Answer', {'answer': 'Concise'})\"}"},
            {"content": "{\"answer\":\"Concise\"}"},
        ]
    )
    guide_out = guide_agent.forward(
        guide_client,
        {"question": "pyodide"},
        {"runtime": runtime, "max_actor_steps": 3},
    )
    assert guide_out["answer"] == "Concise", guide_out
    guide_text = str(guide_agent.get_action_log()) + str(guide_agent.export_trace()) + str(guide_client.requests)
    assert "guide_agent" in guide_text and "Prefer concise final." in guide_text, guide_text

    clarification_agent = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    clarification_client = FakeClient(
        [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Ask\",{}]}}"},
            {"content": "{\"pythonCode\":\"askClarification('Need detail?')\"}"},
        ]
    )
    try:
        clarification_agent.forward(
            clarification_client,
            {"question": "pyodide"},
            {"runtime": runtime, "max_actor_steps": 1},
        )
    except Exception as exc:
        assert "Need detail" in str(exc), exc
    else:
        raise AssertionError("expected runtime clarification")

    session = runtime.create_session(
        {
            "inputs": {"question": "pyodide"},
            "search": {"__ax_host_callable": True, "native": True},
            "badTool": {"__ax_host_callable": True, "native": True},
        },
        {"reservedNames": ["inputs"]},
    )
    try:
        step1 = session.execute("counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})")
        step2 = session.execute("counter = counter + 1\nfinal({'counter': counter})")
        assert step1["type"] == "final", step1
        assert step2["args"][0]["counter"] == 2, step2
        assert session.execute("askClarification({'question': 'Need detail?'})")["type"] == "askClarification"
        assert session.execute("discover({'tools': ['search']})")["kind"] == "discover"
        assert session.execute("recall({'query': 'docs'})")["kind"] == "recall"
        assert session.execute("used('mem1', 'helpful')")["kind"] == "used"
        assert session.execute("reportSuccess('ok')")["kind"] == "status"
        assert session.execute("reportFailure('bad')")["kind"] == "status"
        assert session.execute("guideAgent('try this')")["type"] == "guide_agent"
        bridged = session.execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})")
        assert bridged["type"] == "final", bridged
        assert bridged["args"][0]["title"] == "Docs", bridged
        failed = session.execute("err = badTool({})\nfinal({'error': err['error']})")
        assert failed["args"][0]["error"] == "tool failed", failed
        diagnostic = session.execute("print('hello from pyodide')\nfinal({'ok': True})")
        assert "hello from pyodide" in str(diagnostic), diagnostic
        package_denied = session.execute("pkg = loadPackage('numpy')\nfinal({'error': pkg['error']})")
        assert "package loading is disabled" in package_denied["args"][0]["error"], package_denied
        snapshot = session.snapshot_globals()
        assert "inputs" not in snapshot["bindings"], snapshot
        session.patch_globals({"bindings": {"safe": 9}})
        inspected = session.inspect_globals()
        assert inspected["safe"] == 9, inspected
        runtime_error = session.execute("raise Exception('boom')")
        assert runtime_error["error_category"] == "runtime", runtime_error
    finally:
        session.close()
    closed = session.execute("final({'answer': 'closed'})")
    assert closed["error_category"] == "session_closed", closed
finally:
    runtime.shutdown()

print("python-pyodide-profile-ok runtime-behavior-parity-ok")
`

const javaPythonPyodideProfileExample = `import dev.axllm.ax.*;
import java.io.File;
import java.util.*;

public final class PythonPyodideExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  static final class ScriptedAI implements AiClient {
    final List<Map<String, Object>> responses = new ArrayList<>();
    final List<Map<String, Object>> requests = new ArrayList<>();

    ScriptedAI(List<Map<String, Object>> responses) {
      this.responses.addAll(responses);
    }

    public Map<String, Object> complete(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("fake client exhausted");
      return responses.remove(0);
    }
  }

  static List<String> command(String raw) {
    if (raw == null || raw.isBlank()) throw new RuntimeException("AXIR_PYODIDE_RUNTIME_SERVER is required");
    return Arrays.asList(raw.trim().split("\\s+"));
  }

  static boolean numberEquals(Object value, int expected) {
    if (value instanceof Number n) return n.intValue() == expected;
    return String.valueOf(expected).equals(String.valueOf(value));
  }

  public static void main(String[] args) throws Exception {
    String server = System.getenv("AXIR_PYODIDE_RUNTIME_SERVER");
    String repoRoot = System.getenv("AXIR_REPO_ROOT");
    File cwd = repoRoot == null || repoRoot.isBlank() ? new File(".") : new File(repoRoot);
    try (AxProcessCodeRuntime runtime = new AxProcessCodeRuntime(command(server), cwd, Map.of())) {
      AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      Map<String, Object> out = qa.test(runtime, "answer = inputs['question']\nfinal({'answer': answer})", Map.of("question", "pyodide"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad output: " + out);
      Map<String, Object> payload = asMap(out.get("completion_payload"));
      Map<String, Object> first = asMap(((List<?>) payload.get("args")).get(0));
      if (!"pyodide".equals(first.get("answer"))) throw new RuntimeException("bad payload: " + out);

      AxAgent forwardAgent = Ax.agent("question:string -> answer:string", Map.of(
        "runtime", Map.of("language", "Python"),
        "functionDiscovery", true,
        "memoriesMode", true,
        "memory_search_results", Map.of("prefs", List.of(Map.of("id", "mem1", "content", "likes concise docs"))),
        "functions", List.of(Map.of("name", "search", "description", "Search docs"))
      ));
      ScriptedAI forwardClient = new ScriptedAI(List.of(
        Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Run actor\",{}]}}"),
        Map.of("content", "{\"pythonCode\":\"counter = 41\\ndiscover({'tools': ['search']})\"}"),
        Map.of("content", "{\"pythonCode\":\"recall('prefs')\"}"),
        Map.of("content", "{\"pythonCode\":\"hit = search({'query': inputs['question']})\\nfinal('Answer', {'answer': hit['title']})\"}"),
        Map.of("content", "{\"answer\":\"Docs\"}")
      ));
      Map<String, Object> forwardOut = forwardAgent.forward(
        forwardClient,
        Map.of("question", "pyodide"),
        Map.of("runtime", runtime, "max_actor_steps", 4)
      );
      if (!"Docs".equals(forwardOut.get("answer"))) throw new RuntimeException("bad forward output: " + forwardOut);
      String actionLogText = String.valueOf(forwardAgent.getActionLog());
      if (!actionLogText.contains("discover") || !actionLogText.contains("recall") || !actionLogText.contains("Docs")) {
        throw new RuntimeException("runtime actor loop did not record expected actions: " + actionLogText);
      }
      String forwardState = String.valueOf(forwardAgent.exportRuntimeState());
      if (!forwardState.contains("likes concise docs")) throw new RuntimeException("runtime actor loop did not preserve recalled memory: " + forwardState);
      String forwardTrace = String.valueOf(forwardAgent.exportTrace());
      for (String kind : List.of("runtime_execute", "discover", "recall", "final")) {
        if (!forwardTrace.contains(kind)) throw new RuntimeException("runtime actor trace missing " + kind + ": " + forwardTrace);
      }
      AxAgent restoredAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      restoredAgent.restoreRuntimeState(forwardAgent.exportRuntimeState());
      if (!String.valueOf(restoredAgent.exportRuntimeState()).contains("likes concise docs")) throw new RuntimeException("state restore lost recalled memory");

      AxAgent guideAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      ScriptedAI guideClient = new ScriptedAI(List.of(
        Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Guide\",{}]}}"),
        Map.of("content", "{\"pythonCode\":\"guideAgent('Prefer concise final.')\"}"),
        Map.of("content", "{\"pythonCode\":\"final('Answer', {'answer': 'Concise'})\"}"),
        Map.of("content", "{\"answer\":\"Concise\"}")
      ));
      Map<String, Object> guideOut = guideAgent.forward(
        guideClient,
        Map.of("question", "pyodide"),
        Map.of("runtime", runtime, "max_actor_steps", 3)
      );
      if (!"Concise".equals(guideOut.get("answer"))) throw new RuntimeException("bad guide output: " + guideOut);
      String guideText = String.valueOf(guideAgent.getActionLog()) + String.valueOf(guideAgent.exportTrace()) + String.valueOf(guideClient.requests);
      if (!guideText.contains("guide_agent") || !guideText.contains("Prefer concise final.")) throw new RuntimeException("guideAgent parity failed: " + guideText);

      AxAgent clarificationAgent = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
      ScriptedAI clarificationClient = new ScriptedAI(List.of(
        Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Ask\",{}]}}"),
        Map.of("content", "{\"pythonCode\":\"askClarification('Need detail?')\"}")
      ));
      try {
        clarificationAgent.forward(
          clarificationClient,
          Map.of("question", "pyodide"),
          Map.of("runtime", runtime, "max_actor_steps", 1)
        );
        throw new RuntimeException("expected runtime clarification");
      } catch (AxAgentClarificationException expected) {
        if (!String.valueOf(expected.getMessage()).contains("Need detail")) throw expected;
      }

      AxCodeSession session = runtime.createSession(
        Map.of(
          "inputs", Map.of("question", "pyodide"),
          "search", Map.of("__ax_host_callable", true, "native", true),
          "badTool", Map.of("__ax_host_callable", true, "native", true)
        ),
        Map.of("reservedNames", List.of("inputs"))
      );
      Map<String, Object> step = asMap(session.execute("counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})", Map.of()));
      if (!"final".equals(step.get("type"))) throw new RuntimeException("bad step: " + step);
      Map<String, Object> step2 = asMap(session.execute("counter = counter + 1\nfinal({'counter': counter})", Map.of()));
      if (!numberEquals(asMap(((List<?>) step2.get("args")).get(0)).get("counter"), 2)) throw new RuntimeException("binding did not persist: " + step2);
      if (!"askClarification".equals(asMap(session.execute("askClarification({'question': 'Need detail?'})", Map.of())).get("type"))) throw new RuntimeException("askClarification failed");
      if (!"discover".equals(asMap(session.execute("discover({'tools': ['search']})", Map.of())).get("kind"))) throw new RuntimeException("discover failed");
      if (!"recall".equals(asMap(session.execute("recall({'query': 'docs'})", Map.of())).get("kind"))) throw new RuntimeException("recall failed");
      if (!"used".equals(asMap(session.execute("used('mem1', 'helpful')", Map.of())).get("kind"))) throw new RuntimeException("used failed");
      if (!"status".equals(asMap(session.execute("reportSuccess('ok')", Map.of())).get("kind"))) throw new RuntimeException("status failed");
      if (!"status".equals(asMap(session.execute("reportFailure('bad')", Map.of())).get("kind"))) throw new RuntimeException("failure status failed");
      if (!"guide_agent".equals(asMap(session.execute("guideAgent('try this')", Map.of())).get("type"))) throw new RuntimeException("guideAgent failed");
      Map<String, Object> bridged = asMap(session.execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})", Map.of()));
      if (!"Docs".equals(asMap(((List<?>) bridged.get("args")).get(0)).get("title"))) throw new RuntimeException("host bridge failed: " + bridged);
      Map<String, Object> failed = asMap(session.execute("err = badTool({})\nfinal({'error': err['error']})", Map.of()));
      if (!"tool failed".equals(asMap(((List<?>) failed.get("args")).get(0)).get("error"))) throw new RuntimeException("host error failed: " + failed);
      Map<String, Object> diagnostic = asMap(session.execute("print('hello from pyodide')\nfinal({'ok': True})", Map.of()));
      if (!String.valueOf(diagnostic).contains("hello from pyodide")) throw new RuntimeException("diagnostics failed: " + diagnostic);
      Map<String, Object> packageDenied = asMap(session.execute("pkg = loadPackage('numpy')\nfinal({'error': pkg['error']})", Map.of()));
      if (!String.valueOf(packageDenied).contains("package loading is disabled")) throw new RuntimeException("package policy denial failed: " + packageDenied);
      Map<String, Object> snapshot = asMap(session.snapshotGlobals(Map.of()));
      if (asMap(snapshot.get("bindings")).containsKey("inputs")) throw new RuntimeException("reserved input leaked into snapshot: " + snapshot);
      session.patchGlobals(Map.of("bindings", Map.of("safe", 9)), Map.of());
      Map<String, Object> inspected = asMap(session.inspectGlobals(Map.of()));
      if (!numberEquals(inspected.get("safe"), 9)) throw new RuntimeException("patch/inspect failed: " + inspected);
      if (!"runtime".equals(asMap(session.execute("raise Exception('boom')", Map.of())).get("error_category"))) throw new RuntimeException("runtime error normalization failed");
      session.close();
      if (!"session_closed".equals(asMap(session.execute("final({'answer': 'closed'})", Map.of())).get("error_category"))) throw new RuntimeException("closed session behavior failed");
    }
    System.out.println("java-python-pyodide-profile-ok runtime-behavior-parity-ok");
  }
}
`

const pyodidePackageJSON = `{
  "private": true,
  "type": "module",
  "dependencies": {
    "pyodide": "0.29.4"
  },
  "devDependencies": {
    "tsx": "^4.22.3"
  }
}
`

const pyodideRuntimePolicyJSON = `{
  "allowFilesystem": false,
  "allowNetwork": false,
  "allowPackageLoading": false,
  "allowMicropip": false,
  "packageAllowlist": [],
  "timeoutMs": 5000,
  "maxDiagnosticsChars": 8192,
  "maxSnapshotBytes": 262144
}
`

const pyodideRuntimeHelper = `#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "${AXIR_REPO_ROOT:-}" ]; then
  echo "AXIR_REPO_ROOT is required so the generated package can find tools/axir/adapters/pyodide-runtime-server.ts" >&2
  exit 1
fi
REPO_ROOT="$AXIR_REPO_ROOT"
WORK_DIR="${AXIR_PYODIDE_WORKDIR:-"${TMPDIR:-/tmp}/axir-pyodide-runtime"}"

mkdir -p "$WORK_DIR"
if [ ! -d "$WORK_DIR/node_modules/pyodide" ]; then
  cp "$SCRIPT_DIR/pyodide-package.json" "$WORK_DIR/package.json"
  npm install --prefix "$WORK_DIR" --no-audit --no-fund >/dev/null
fi

printf 'env AXIR_PYODIDE_MODULE_ROOT=%s node --import=tsx %s/tools/axir/adapters/pyodide-runtime-server.ts\n' "$WORK_DIR" "$REPO_ROOT"
`

const pyodideProfileReadme = `# Python Pyodide Runtime Profile

This optional profile runs Python actor code through a Pyodide JSONL protocol
server. It is not part of the base generated package compile path.

Resolve the runtime server command with:

` + "```bash" + `
AXIR_REPO_ROOT=/path/to/ax AXIR_PYODIDE_RUNTIME_SERVER="$(sh examples/runtime_profiles/resolve_pyodide_runtime_server.sh)"
` + "```" + `

The helper installs the npm ` + "`pyodide`" + ` package into a temp workdir and prints a
command suitable for ` + "`ProcessCodeRuntime`" + `. ` + "`axir verify`" + ` also accepts
` + "`AXIR_PYODIDE_RUNTIME_SERVER`" + ` directly, or ` + "`AXIR_PYODIDE_RESOLVE=1`" + ` to
run the generated helper.

Host callbacks are exposed to Python actor code as ordinary functions and must
use JSON-compatible arguments/results. Filesystem, network, package loading, and
process permissions remain adapter-owned and are not exposed by default.

Runtime productization policy is explicit and deny-by-default. Set
` + "`AXIR_PYODIDE_RUNTIME_POLICY`" + ` to a JSON object before starting the server to
tune ` + "`timeoutMs`" + `, ` + "`maxDiagnosticsChars`" + `, ` + "`maxSnapshotBytes`" + `, and
package allowlisting. The generated ` + "`pyodide-runtime-policy.json`" + ` shows the
supported keys. Package loading is disabled by default; when enabled, package
names must appear in ` + "`packageAllowlist`" + `. ` + "`micropip`" + ` remains disabled unless
` + "`allowMicropip`" + ` is set.

Profile examples check parity with the AxJS reference runtime for actor
primitive envelopes, host-call success/failure, persistent bindings,
inspect/snapshot/patch, diagnostics, runtime errors, and session-closed
normalization.
`

const javaRuntimeProfilesReadme = javaQuickJSProfileReadme + `

---

` + pyodideProfileReadme

const cppRuntimeProfilesReadme = cppQuickJSProfileReadme + `

---

` + pyodideProfileReadme

const cppPythonPyodideProfileExample = `#include "axllm/axllm.hpp"
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
`
