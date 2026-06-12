# JavaScript QuickJS Runtime Profile

This optional profile is a Java adapter for the AxAgent RLM actor-code REPL.
The agent's executor loop sends one actor-code step at a time into an
`AxCodeRuntime` session, observes envelopes such as `final(...)`,
`discover(...)`, and `recall(...)`, then continues from the result.

It runs JavaScript actor code in QuickJS4J. It is not a TypeScript transpiler,
not a way to run your original Ax TypeScript application in Java, and not part
of the base generated Java compile path. Compile it only when you want the
`javascript-quickjs` runtime profile for RLM agent sessions.

QuickJS4J dependency metadata is provided in both `quickjs4j-pom.xml` and
`quickjs4j-build.gradle`. To resolve the classpath with Maven:

```bash
AXIR_QUICKJS4J_WORKDIR=/private/tmp/axir-quickjs4j-cp \
AXIR_QUICKJS4J_CP="$(sh examples/runtime_profiles/resolve_quickjs4j_cp.sh)"
```

`axir verify --runtime-profiles javascript-quickjs` also accepts
`AXIR_QUICKJS4J_CP_FILE`, or `AXIR_QUICKJS4J_RESOLVE=1` to run the same
generated Maven helper during verification. The helper keeps Maven's local
repository under `AXIR_QUICKJS4J_WORKDIR` by default; set
`AXIR_QUICKJS4J_M2_REPO` to override it.

Python profile verification can point `AXIR_QUICKJS_RUNTIME_SERVER` at
`java -cp ... dev.axllm.ax.runtime.quickjs.AxQuickJsProtocolServer` explicitly. When
that variable is not set, `axir verify --runtime-profiles javascript-quickjs`
auto-compiles and runs this generated Java protocol server whenever the
QuickJS4J classpath is available.

Host callbacks are registered with `AxQuickJsCodeRuntime.registerCallable` and
are exposed to actor JavaScript as ordinary functions. Arguments and results must
be JSON-compatible. Callback failures are normalized to runtime error objects;
filesystem, network, process, and arbitrary host object access are not exposed by
default.

Runtime productization policy is explicit and deny-by-default. Java accepts a
JSON-compatible `runtimePolicy` map in `AxQuickJsCodeRuntime` and per-session
options. C++ accepts the same policy object in `QuickJsCodeRuntime`. The
generated `quickjs-runtime-policy.json` shows the supported keys. Java reports
`memoryLimitBytes` as unsupported capability metadata because QuickJS4J does not
expose that limit through the profile surface; C++ applies it through the
QuickJS C API.

Profile examples check the same observable runtime/session contract as the
TypeScript `AxJSRuntime` reference: actor primitive envelopes, host-call
success/failure, persistent bindings, reserved-name-safe snapshots,
inspect/snapshot/patch, runtime errors, and session-closed normalization.
