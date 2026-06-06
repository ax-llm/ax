# JavaScript QuickJS Runtime Profile

This optional profile compiles only when QuickJS headers and libraries are supplied.
On Homebrew systems, `axir verify` auto-detects the usual QuickJS prefix when
`AXIR_QUICKJS_CFLAGS` and `AXIR_QUICKJS_LDFLAGS` are not set.
Host callbacks are registered with `QuickJsCodeRuntime::register_callable`
and are exposed to actor JavaScript as ordinary functions returning
JSON-compatible values.

Runtime policy is explicit and deny-by-default. Pass a policy object to
`QuickJsCodeRuntime` to tune `timeoutMs`, `maxSnapshotBytes`, or
`memoryLimitBytes`. Filesystem, network, process, and arbitrary native host
access remain unavailable unless host code exposes an explicit callback.

Example verification:

```bash
AXIR_QUICKJS_CFLAGS="-I/opt/homebrew/opt/quickjs/include/quickjs" \
AXIR_QUICKJS_LDFLAGS="/opt/homebrew/opt/quickjs/lib/quickjs/libquickjs.a -lm -ldl -pthread" \
go run . verify --targets cpp --runtime-profiles javascript-quickjs ../../ir/axcore/root.axir
```


---

# Python Pyodide Runtime Profile

This optional profile runs Python actor code through a Pyodide JSONL protocol
server. It is not part of the base generated package compile path.

Resolve the runtime server command with:

```bash
AXIR_REPO_ROOT=/path/to/ax AXIR_PYODIDE_RUNTIME_SERVER="$(sh examples/runtime_profiles/resolve_pyodide_runtime_server.sh)"
```

The helper installs the npm `pyodide` package into a temp workdir and prints a
command suitable for `ProcessCodeRuntime`. `axir verify` also accepts
`AXIR_PYODIDE_RUNTIME_SERVER` directly, or `AXIR_PYODIDE_RESOLVE=1` to
run the generated helper.

Host callbacks are exposed to Python actor code as ordinary functions and must
use JSON-compatible arguments/results. Filesystem, network, package loading, and
process permissions remain adapter-owned and are not exposed by default.

Runtime productization policy is explicit and deny-by-default. Set
`AXIR_PYODIDE_RUNTIME_POLICY` to a JSON object before starting the server to
tune `timeoutMs`, `maxDiagnosticsChars`, `maxSnapshotBytes`, and
package allowlisting. The generated `pyodide-runtime-policy.json` shows the
supported keys. Package loading is disabled by default; when enabled, package
names must appear in `packageAllowlist`. `micropip` remains disabled unless
`allowMicropip` is set.

Profile examples check parity with the AxJS reference runtime for actor
primitive envelopes, host-call success/failure, persistent bindings,
inspect/snapshot/patch, diagnostics, runtime errors, and session-closed
normalization.
