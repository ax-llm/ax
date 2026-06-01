package axir

const pyPythonPyodideProfileExample = `import os

from ax import ProcessCodeRuntime, agent

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

print("python-pyodide-profile-ok")
`

const javaPythonPyodideProfileExample = `import dev.ax.*;
import java.io.File;
import java.util.*;

public final class PythonPyodideExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
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
      Map<String, Object> snapshot = asMap(session.snapshotGlobals(Map.of()));
      if (asMap(snapshot.get("bindings")).containsKey("inputs")) throw new RuntimeException("reserved input leaked into snapshot: " + snapshot);
      session.patchGlobals(Map.of("bindings", Map.of("safe", 9)), Map.of());
      Map<String, Object> inspected = asMap(session.inspectGlobals(Map.of()));
      if (!numberEquals(inspected.get("safe"), 9)) throw new RuntimeException("patch/inspect failed: " + inspected);
      if (!"runtime".equals(asMap(session.execute("raise Exception('boom')", Map.of())).get("error_category"))) throw new RuntimeException("runtime error normalization failed");
      session.close();
      if (!"session_closed".equals(asMap(session.execute("final({'answer': 'closed'})", Map.of())).get("error_category"))) throw new RuntimeException("closed session behavior failed");
    }
    System.out.println("java-python-pyodide-profile-ok");
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

printf 'env AXIR_PYODIDE_MODULE_ROOT=%s node --env-file=.env --import=tsx %s/tools/axir/adapters/pyodide-runtime-server.ts\n' "$WORK_DIR" "$REPO_ROOT"
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

const cppPythonPyodideProfileExample = `#include "ax/ax.hpp"
#include <iostream>
#include <string>

struct PyodideProfileTransport : ax::RuntimeTransport {
  int next_session = 0;
  bool closed = false;
  int counter = 0;

  ax::Value call(ax::Value message) override {
    ax::Value id = ax::Core::get(message, "id");
    ax::Value op = ax::Core::get(message, "op");
    if (ax::equal(op, "capabilities")) {
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"language", "Python"}, {"usage_instructions", "fake Pyodide protocol"}})}});
    }
    if (ax::equal(op, "create_session")) {
      std::string session_id = "p" + std::to_string(++next_session);
      closed = false;
      return ax::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", ax::object({{"session_id", session_id}})}});
    }
    if (ax::equal(op, "execute")) {
      ax::Value session_id = ax::Core::get(message, "session_id");
      if (closed) {
        return ax::object({{"id", id}, {"ok", false}, {"session_id", session_id}, {"error", ax::object({{"category", "session_closed"}, {"message", "session closed"}})}});
      }
      ax::Value payload = ax::Core::get(message, "payload", ax::Value::object());
      std::string code = ax::display(ax::Core::get(payload, "code", ""));
      ax::Value result = ax::object({{"type", "final"}, {"args", ax::array({ax::object({{"answer", "pyodide"}})})}});
      if (code.find("counter") != std::string::npos) {
        counter++;
        result = ax::object({{"type", "final"}, {"args", ax::array({ax::object({{"counter", counter}})})}});
      } else if (code.find("askClarification") != std::string::npos) {
        result = ax::object({{"type", "askClarification"}, {"args", ax::array({ax::object({{"question", "Need detail?"}})})}});
      } else if (code.find("discover") != std::string::npos) {
        result = ax::object({{"kind", "discover"}, {"discover", ax::object({{"tools", ax::array({"search"})}})}});
      } else if (code.find("recall") != std::string::npos) {
        result = ax::object({{"kind", "recall"}, {"recall", ax::object({{"query", "docs"}})}});
      } else if (code.find("used") != std::string::npos) {
        result = ax::object({{"kind", "used"}, {"used", ax::object({{"id", "mem1"}, {"reason", "helpful"}})}});
      } else if (code.find("reportSuccess") != std::string::npos) {
        result = ax::object({{"kind", "status"}, {"status", ax::object({{"type", "success"}, {"message", "ok"}})}});
      } else if (code.find("guideAgent") != std::string::npos) {
        result = ax::object({{"type", "guide_agent"}, {"guidance", "try this"}});
      } else if (code.find("search") != std::string::npos) {
        result = ax::object({{"type", "final"}, {"args", ax::array({ax::object({{"title", "Docs"}})})}});
      } else if (code.find("badTool") != std::string::npos) {
        result = ax::object({{"type", "final"}, {"args", ax::array({ax::object({{"error", "tool failed"}})})}});
      } else if (code.find("raise") != std::string::npos) {
        result = ax::RuntimeEnvelope::error("boom", "runtime");
      }
      return ax::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", result}});
    }
    if (ax::equal(op, "snapshot_globals")) {
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"version", 1}, {"bindings", ax::object({{"answer", "pyodide"}})}, {"globals", ax::object({{"answer", "pyodide"}})}})}});
    }
    if (ax::equal(op, "patch_globals")) {
      ax::Value payload = ax::Core::get(message, "payload", ax::Value::object());
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::Core::get(payload, "globals", ax::Value::object())}});
    }
    if (ax::equal(op, "inspect_globals")) {
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"answer", "pyodide"}})}});
    }
    if (ax::equal(op, "close")) {
      closed = true;
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"closed", true}})}});
    }
    if (ax::equal(op, "shutdown")) {
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"shutdown", true}})}});
    }
    return ax::object({{"id", id}, {"ok", false}, {"error", ax::object({{"category", "protocol"}, {"message", "unknown op"}})}});
  }
};

int main() {
  PyodideProfileTransport transport;
  ax::RuntimeProtocolClient runtime(transport);
  auto qa = ax::agent("question:string -> answer:string", ax::object({{"runtime", ax::object({{"language", "Python"}})}}));
  ax::Value out = qa.test(runtime, "final({'answer': 'pyodide'})", ax::object({{"question", "pyodide"}}));
  if (!ax::equal(ax::Core::get(out, "kind"), "final")) return 1;
  ax::Value payload = ax::Core::get(out, "completion_payload", ax::Value::object());
  ax::Value args = ax::Core::get(payload, "args", ax::Value::array());
  if (!ax::equal(ax::Core::get(ax::Core::get(args, 0), "answer"), "pyodide")) return 2;
  ax::AxCodeSession* session = runtime.create_session(
    ax::object({{"inputs", ax::object({{"question", "pyodide"}})}, {"search", ax::object({{"__ax_host_callable", true}, {"native", true}})}, {"badTool", ax::object({{"__ax_host_callable", true}, {"native", true}})}}),
    ax::object({{"reservedNames", ax::array({"inputs"})}})
  );
  ax::Value step1 = session->execute("counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})");
  ax::Value step2 = session->execute("counter = counter + 1\nfinal({'counter': counter})");
  if (!ax::equal(ax::Core::get(step1, "type"), "final") || !ax::equal(ax::Core::get(step2, "type"), "final")) return 3;
  if (!ax::equal(ax::Core::get(ax::Core::get(ax::Core::get(step2, "args", ax::Value::array()), 0), "counter"), 2)) return 4;
  if (!ax::equal(ax::Core::get(session->execute("askClarification({'question': 'Need detail?'})"), "type"), "askClarification")) return 5;
  if (!ax::equal(ax::Core::get(session->execute("discover({'tools': ['search']})"), "kind"), "discover")) return 6;
  if (!ax::equal(ax::Core::get(session->execute("recall({'query': 'docs'})"), "kind"), "recall")) return 7;
  if (!ax::equal(ax::Core::get(session->execute("used('mem1', 'helpful')"), "kind"), "used")) return 8;
  if (!ax::equal(ax::Core::get(session->execute("reportSuccess('ok')"), "kind"), "status")) return 9;
  if (!ax::equal(ax::Core::get(session->execute("guideAgent('try this')"), "type"), "guide_agent")) return 10;
  if (!ax::equal(ax::Core::get(ax::Core::get(ax::Core::get(session->execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})"), "args", ax::Value::array()), 0), "title"), "Docs")) return 11;
  if (!ax::equal(ax::Core::get(ax::Core::get(ax::Core::get(session->execute("err = badTool({})\nfinal({'error': err['error']})"), "args", ax::Value::array()), 0), "error"), "tool failed")) return 12;
  ax::Value snapshot = session->snapshot_globals();
  if (!ax::Core::get(ax::Core::get(snapshot, "bindings", ax::Value::object()), "inputs").is_null()) return 13;
  session->patch_globals(ax::object({{"bindings", ax::object({{"safe", 9}})}}));
  if (!ax::equal(ax::Core::get(session->inspect(), "answer"), "pyodide")) return 14;
  if (!ax::equal(ax::Core::get(session->execute("raise Exception('boom')"), "error_category"), "runtime")) return 15;
  session->close();
  if (!ax::equal(ax::Core::get(session->execute("final({'answer': 'closed'})"), "error_category"), "session_closed")) return 16;
  runtime.shutdown();
  std::cout << "cpp-python-pyodide-profile-ok\n";
}
`
