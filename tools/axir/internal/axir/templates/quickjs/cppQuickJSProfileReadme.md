# JavaScript QuickJS Runtime Profile

This optional profile is a C++ adapter for the AxAgent RLM actor-code REPL.
The agent's executor loop sends one actor-code step at a time into an
`AxCodeRuntime` session, observes envelopes such as `final(...)`,
`discover(...)`, and `recall(...)`, then continues from the result.

It runs JavaScript actor code through the QuickJS C API. It is not a TypeScript
transpiler and not a way to run your original Ax TypeScript application in C++.
This profile compiles only when QuickJS headers and libraries are supplied. On
Homebrew systems, `axir verify` auto-detects the usual QuickJS prefix when
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
