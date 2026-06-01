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
        bridged = session.execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})")
        assert bridged["type"] == "final", bridged
        assert bridged["args"][0]["title"] == "Docs", bridged
        failed = session.execute("err = badTool({})\nfinal({'error': err['error']})")
        assert failed["args"][0]["error"] == "tool failed", failed
        snapshot = session.snapshot_globals()
        assert "inputs" not in snapshot["bindings"], snapshot
        session.patch_globals({"bindings": {"safe": 9}})
        inspected = session.inspect_globals()
        assert inspected["safe"] == 9, inspected
    finally:
        session.close()
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
      Map<String, Object> bridged = asMap(session.execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})", Map.of()));
      if (!"Docs".equals(asMap(((List<?>) bridged.get("args")).get(0)).get("title"))) throw new RuntimeException("host bridge failed: " + bridged);
      Map<String, Object> failed = asMap(session.execute("err = badTool({})\nfinal({'error': err['error']})", Map.of()));
      if (!"tool failed".equals(asMap(((List<?>) failed.get("args")).get(0)).get("error"))) throw new RuntimeException("host error failed: " + failed);
      session.close();
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
`

const javaRuntimeProfilesReadme = javaQuickJSProfileReadme + `

---

` + pyodideProfileReadme

const cppRuntimeProfilesReadme = cppQuickJSProfileReadme + `

---

` + pyodideProfileReadme

const cppPythonPyodideProfileExample = `#include "ax/ax.hpp"
#include <iostream>

struct PyodideProfileTransport : ax::RuntimeTransport {
  int next_session = 0;

  ax::Value call(ax::Value message) override {
    ax::Value id = ax::Core::get(message, "id");
    ax::Value op = ax::Core::get(message, "op");
    if (ax::equal(op, "capabilities")) {
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"language", "Python"}, {"usage_instructions", "fake Pyodide protocol"}})}});
    }
    if (ax::equal(op, "create_session")) {
      std::string session_id = "p" + std::to_string(++next_session);
      return ax::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", ax::object({{"session_id", session_id}})}});
    }
    if (ax::equal(op, "execute")) {
      return ax::object({{"id", id}, {"ok", true}, {"result", ax::object({{"type", "final"}, {"args", ax::array({ax::object({{"answer", "pyodide"}})})}})}});
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
  runtime.shutdown();
  std::cout << "cpp-python-pyodide-profile-ok\n";
}
`
