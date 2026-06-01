# AxIR Backend Contract

Backends emit Ax runtime libraries, not one-off user programs.

The shared rules for source of truth, fixture-first semantics, Core-owned
behavior, target-owned boundaries, and syntax direction live in
`ir/spec/rules.md`.

Every generated package must include:

- `axir-capabilities.json`, the machine-readable target contract
- `README.md`, the human-readable package contract
- runnable examples for signature/schema, AxGen with a fake client/tool, and
  AxAI with a fake OpenAI-compatible transport
- a conformance runner when the target is executable in V1

Python target:

- emits an `ax/` package
- Python 3.10+
- standard library only
- idiomatic Python is primary: `snake_case`, sync-first methods, dict/list
  request boundaries, and standard exception classes
- public API: `ai`, `s`, `f`, `fn`, `ax`, `AxAIService`, `AxBaseAI`,
  `AxSignature`, `AxGen`, `AIClient`, `OpenAICompatibleClient`,
  `OptimizerEngine`, `OptimizerEvaluator`
- includes a generated `ax.conformance` module that can run backend-neutral
  fixture JSON from all current `ir/conformance/*` suites
- real OpenAI-compatible HTTP transport is implemented with the Python standard
  library; default verification uses fake transport fixtures

Java target:

- emits `dev.ax` sources
- Java 17
- standard library only
- public API: `Ax.s`, `Ax.f`, `Ax.fn`, `Ax.ax`, `AxSignature`, `AxGen`,
  `OpenAICompatibleClient`, `OptimizerEngine`, `OptimizerEvaluator`
- executable conformance target for signatures, schema, validation, prompt,
  AxGen, AxAI/OpenAI-compatible mapping, and the prompt optimizer contract
- real OpenAI-compatible HTTP transport is implemented with `java.net.http`;
  default verification uses fake transport fixtures
- idiom contract: classes/builders for static shapes and `Map<String,Object>`
  only at dynamic JSON/tool boundaries

C++ target:

- emits `ax/ax.hpp`, `ax/ax.cpp`, and a fixture conformance executable source
- C++17
- standard library only
- executable conformance target for signatures, schema, validation, prompt,
  AxGen, AxAI/OpenAI-compatible mapping, and the prompt optimizer contract
- idiom contract: value types, `namespace ax`, standard containers, and
  explicit exceptions rather than TypeScript-shaped dynamic objects
- OpenAI-compatible request/response mapping is Core-owned and executable
  through fake transport; real C++ HTTP transport is deferred

All executable targets expose the same optimizer-ready boundary: component
inventory, optimized artifact validation/serialization, component-map apply,
candidate rollout evaluation, metric/judge payload shaping, and
`OptimizerEngine.optimize(request, evaluator?)` host integration. This is a
prompt/component optimization contract, not a GEPA runtime; optimizer algorithms
remain engine-owned and may call back through the evaluator to score proposals.

All executable targets also expose the same AxAgent runtime host boundary:
`AxCodeRuntime` creates persistent `AxCodeSession` objects, and sessions execute
opaque code, inspect globals when supported, snapshot safe user bindings, patch
restored bindings, and close. AxIR owns reserved-name filtering, snapshot shape,
restart/error envelopes, action-log records, and trace events. Targets own the
actual interpreter, sandbox permissions, native cancellation, filesystem/network
access, and callback invocation.

Generated targets also expose small runtime adapter helpers so host runtimes can
produce Core-compatible envelopes without copying fixture shapes by hand. These
helpers are not interpreters or sandboxes; they only describe capabilities and
construct normalized result/error/protocol payloads for the existing
`AxCodeRuntime`/`AxCodeSession` boundary.

Generated targets may also use the AxIR runtime protocol when the interpreter
lives in a separate host process. The protocol is line-delimited JSON. Requests
use `{ "id", "op", "session_id"?, "payload"? }`; responses use `{ "id",
"ok", "result"?, "session_id"?, "error"? }`. Required operations are
`capabilities`, `create_session`, `execute`, `inspect_globals`,
`snapshot_globals`, `patch_globals`, `close`, and `shutdown`. Python and Java
ship process-backed helpers for this protocol. C++ ships a standard-library
`RuntimeTransport`/`RuntimeProtocolClient` boundary and leaves process launching
to host code. Backends must treat malformed responses, response id mismatches,
session id mismatches, unavailable optional capabilities, and host error
envelopes as part of the conformance contract rather than adapter-specific
details.

Runtime lifecycle semantics are Core-owned. Generated targets must pass
reserved names, timeout values, abort hints, session ids, and trace metadata
through `create_session`/`execute` option envelopes, but adapters decide how to
enforce cancellation. A `session_closed` execution result restarts the session
and retries the same actor step at most once; `abort` and user-bubble errors
escape instead of being turned into correction output. Process-backed helpers
must surface EOF, malformed JSON, response id/session mismatches, nonzero exits,
and stderr diagnostics as stable runtime protocol errors.

The first dependency-bearing runtime profile is `javascript-quickjs`.
Generated packages emit optional profile sources: Java uses QuickJS4J,
C++ uses the QuickJS C API, and Python drives a QuickJS protocol server through
`ProcessCodeRuntime`. The profile is not part of default package compilation;
`axir verify --runtime-profiles javascript-quickjs` runs it only when the
profile-specific dependency/toolchain environment is present. QuickJS profiles
must expose only explicit Ax runtime primitives and JSON-like globals by
default; filesystem, network, and native host access remain adapter-owned.
The beta profile also supports native host-call bridges for tool/child-agent
style callbacks. Java uses QuickJS4J builtins, C++ uses QuickJS C functions, and
Python reaches the same bridge through the JSONL protocol server. Callback
arguments and results stay JSON-compatible; runtime limits and diagnostics are
profile behavior rather than Core semantics. Java verification may use
`AXIR_QUICKJS4J_CP`, `AXIR_QUICKJS4J_CP_FILE`, or `AXIR_QUICKJS4J_RESOLVE=1`
to resolve the generated QuickJS4J Maven example classpath; default verification
still skips the dependency-bearing profile when those inputs are absent.

The second dependency-bearing runtime profile is `python-pyodide`. It is a
Python actor-language profile, not a generated-Python-host feature. Python,
Java, and C++ generated targets drive a Node-hosted Pyodide JSONL protocol
server through the existing runtime protocol boundary. The profile injects the
same actor primitives as callable Python globals, exposes only JSON-compatible
host callables, snapshots safe user bindings, and captures stdout/stderr as
diagnostics. Package loading, filesystem/network access, real cancellation,
and Pyodide process policy stay adapter-owned. Verification accepts
`AXIR_PYODIDE_RUNTIME_SERVER` directly, or `AXIR_PYODIDE_RESOLVE=1` to run the
generated npm helper that resolves the optional `pyodide` package. Default
verification still skips the dependency-bearing profile when those inputs are
absent.

The TypeScript `AxJSRuntime` is the reference JavaScript host runtime for the
runtime/session contract. `javascript-quickjs` and `python-pyodide` are checked
against the same observable behaviors where their languages overlap: actor
primitive envelopes, host-call success/failure envelopes, persistent bindings,
reserved-name protection, inspect/snapshot/patch/close, stdout/stderr
diagnostics, runtime errors, and session-closed normalization. Optional profile
verification also drives real `AxAgent.forward(...)` actor-loop runs where fake
AI responses produce runtime code, the profile executes that code, and the
responder consumes the normalized result. AxIR does not add generated Node,
Deno, or Bun runtime profiles; those are the existing TypeScript runtime
surface. Adapter-owned policy still covers filesystem, network, package
loading, native cancellation, and process security.

Backends must consume the lowered Core IR module or a target package model made
from Core IR. They must not use high-level Ax dialects as their primary input.
They must also avoid target-only semantic escapes for Core-owned behavior; see
`ir/spec/rules.md` for the allowed intrinsic boundary.

`axir verify --targets python,java,cpp ir/axcore/root.axir` is the portable
gate. It compiles each target, validates the manifest, runs generated examples,
and executes all conformance suites for each available local toolchain. Missing
toolchains are reported as explicit skips for local development; CI jobs that
install a toolchain should treat that target as required.
