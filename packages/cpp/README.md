# Generated Ax CPP Library

Generated from shared Ax compiler modules.

## Contract

- Compiler contract version: 0.1
- Package: axllm
- Supported conformance suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, axflow
- Provider mode: provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic
- Fake transport support: true
- Real network support: available through the built-in libcurl HttpTransport when the CMake package finds CURL; custom Transport remains supported

The deterministic Ax runtime semantics are Core-owned. Target-owned code is
limited to idiomatic wrappers, transport boundaries, and language primitives.

## Packaging

- Python emits `pyproject.toml`, `MANIFEST.in`, package import `axllm`, and
  `axllm/py.typed`. The default distribution metadata name is
  `axllm`.
- Java emits package `dev.axllm.ax`, base Maven/Gradle metadata for
  `dev.axllm:ax`, and keeps QuickJS4J metadata isolated under
  `examples/runtime_profiles/`.
- C++ emits `axllm/axllm.hpp`, `axllm/axllm.cpp`, and `CMakeLists.txt` with target
  `axllm::axllm`. The generated CMake package enables a built-in libcurl
  HTTP transport when CURL is available. Optional QuickJS sources are not part of
  the default CMake build.
- Go emits module `github.com/ax-llm/ax/go` and package `axllm`, using
  the standard library for HTTP/process boundaries and an optional generated
  `runtime/goja` package for built-in JavaScript actor execution.

## Examples

See the files in `examples/` for:

- signature parsing and JSON schema generation
- AxGen forward with a fake client and tool
- AxGen forward with a real OpenAI-compatible provider API when `OPENAI_API_KEY` is set
- AxAI/OpenAI-compatible mapping with a fake transport
- AxAgent pipeline alpha with a fake service
- Runtime adapter helpers and custom `AxCodeRuntime` implementation
- Runtime protocol client against the AxJS reference adapter
- Optional JavaScript QuickJS runtime profile files
- Optional Python Pyodide runtime profile files
- AxFlow program graph with child Ax programs
- Optimizer artifact save/load/apply lifecycle

## Optional Runtime Profiles

The TypeScript `AxJSRuntime` remains the canonical JavaScript host runtime
reference for AxAgent actor sessions. Generated runtime profiles are portability
proofs against that same contract; the compiler does not emit separate Node, Deno, or
Bun profiles because those are the existing TypeScript implementation surface.

- `javascript-quickjs`: JavaScript actor code through QuickJS. Java uses
  QuickJS4J (`io.roastedroot:quickjs4j`); C++ uses the QuickJS C API; Python
  drives a QuickJS protocol server through `ProcessCodeRuntime`. This profile
  is dependency-bearing and is verified only when its toolchain environment
  variables are supplied. Java profile verification accepts
  `AXIR_QUICKJS4J_CP`, `AXIR_QUICKJS4J_CP_FILE`, or
  `AXIR_QUICKJS4J_RESOLVE=1` to resolve the classpath with the generated
  Maven helper. Python profile verification accepts `AXIR_QUICKJS_RUNTIME_SERVER`
  directly, or auto-starts the generated Java QuickJS4J protocol server when the
  QuickJS4J classpath is available.
- `python-pyodide`: Python actor code through a Pyodide JSONL protocol
  server. Python, Java, and C++ generated runtimes all use the existing runtime
  protocol boundary for this alpha; no host-native Python interpreter is
  embedded in the generated packages. Verification accepts
  `AXIR_PYODIDE_RUNTIME_SERVER` directly, or `AXIR_PYODIDE_RESOLVE=1`
  to install/resolve Pyodide with the generated npm helper.
- `javascript-goja`: Go-native JavaScript actor code through the generated
  `runtime/goja` package. It is pure Go, dependency-bearing, opt-in by
  import, and verified with `axir verify --targets go --runtime-profiles javascript-goja`.
  The root `axllm` package stays free of vendor-specific constructors.

Both optional profiles expose a JSON-compatible runtime policy surface. The
generated `quickjs-runtime-policy.json` and `pyodide-runtime-policy.json`
files document conservative defaults: filesystem, network, process/native host
access, and package loading are disabled unless profile adapter code explicitly
supports and enables them. The shared Ax compiler contract still owns envelopes,
state, logs, and traces; adapter policy owns sandboxing, dependency loading,
hard cancellation, and process security.
