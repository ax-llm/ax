# AxIR behavioral gates

These gates exist because a **non-functional `agent()` shipped in five languages** while every
existing safeguard stayed green. The orchestration was emitted from AxIR (so provenance passed),
conformance drove it with scripted clients + a `ScriptedCodeRuntime` (so coverage/conformance
passed), and the examples "demonstrated" it by hand-feeding canned `{"completion":{"type":"final"}}`
payloads (so `verify` exited 0). No gate ever required a real model's prose to flow through a real
engine and produce a real completion.

## Status — the port landed (all gates exercised)

The RLM-prompt port is complete: `agent()` now renders the executor/responder/distiller RLM
prompts from AxIR (byte-identical to the TypeScript reference) and injects them so they reach the
model's chat request, in **all five languages**. The gates have flipped accordingly:
- **G3 prompt-parity**: GREEN in all five (was RED before the port). Enforced in CI via the
  `runtime-forward-javascript-final` regression fixture's `expected_request_contains` check. A
  companion **source-sync** gate (`npm run axir:gate:prompt-sync`,
  `scripts/axir-prompt-sync-check.mjs`) additionally asserts the two prompt copies are
  byte-identical — `src/ax/agent/templates/rlm/{executor,distiller,responder}.md` (the TS source of
  truth) vs the `*_template` fields of `ir/axcore/data/rlm-prompts.json` — catching silent drift at
  edit time, before any regen or conformance run. (G3 only substring-checks the rendered IR side.)
- **G1 real-engine antidote**: GREEN in **all five** -- Go (goja), Rust/C++/Python (quickjs),
  Java (quickjs4j/Chicory) -- each runs the full `forward()` loop through a real engine that
  executes the model's `final()` code. Engines are optional deps, so these run in engine-enabled
  build lanes (cargo `--features runtime-quickjs`, cpp `-DAX_CONFORMANCE_QUICKJS`, the python
  quickjs wheel, the java quickjs4j classpath), not the default conformance suite.
- **G2 anti-facade**: GREEN, wired into CI, and hardened. The `agent_openai_api.*` **and the
  `axagent_pipeline.*`** facades are deleted. The lint now normalizes backslash-escaped quotes
  before matching (an escaped-JSON payload `\"completion\":{\"type\":\"final\"}` embedded in a
  scripted client previously slipped straight past it) and exempts examples that pair a scripted
  turn with a real engine executing model-authored code (the `runtime_profiles` examples).
- **G4 capability-backed-by-real-run**: GREEN, wired into CI (`axir-go-fast`). The
  build-gating test `TestG4AgentCapabilityBackedByRealRunner` ties the `axagent` capability claim to
  the presence of the real-execution handlers (`agent_runtime_real` + `agent_prompt`) in every
  language's runner, the real fixtures on disk, and the ledger's verified targets. Teeth verified.
- **G5 ledger**: GREEN, wired into CI; tracks real-execution verified targets.
- **G9 public-API parity**: GREEN, wired into CI (`go test -C tools/axir`). Asserts every language's
  `AxAgent` exposes the same required public methods (`optimize`, `playbook`). Added after the Rust
  agent shipped without `optimize()`/`playbook()` and Go without `optimize()` — drift the prior
  (behavioral-only) gates could not see.
- **G7 CI wiring**: GREEN. G3's `agent_prompt` is folded into the default `axagent` suite via
  the `axir-verify` matrix. The `axir-agent-antidote` job runs the full `axagent-real` suite for
  each affected target (all five for shared changes): Go (goja), Python (quickjs wheel), Rust
  (rquickjs), Java (quickjs4j/Chicory), and C++ (native QuickJS). G2/G5 run in `repo-checks`;
  G4 runs in `axir-go-fast`. See G7 below for the C++ reproduction command.

## Why the prior gates were blind

| Gate | What it actually checks | Why a hollow agent passed |
|------|-------------------------|---------------------------|
| Provenance (`provenance.go`) | emitted symbol ⇐ an IR op (origin) | the orchestration *was* emitted; the missing RLM prompt/primitives existed in neither IR nor packages, so there was nothing un-emitted to flag |
| Coverage (`coverage.go`) | function name appears in the trace | counts *invocation*, not *computation*; canned inputs still "exercise" it |
| Perturbation (`axir-perturb-check.mjs`) | mutate one `expected_*` → runner must fail | hardens the *scripted contract*; never introduces real prose or a real engine |
| Verify (`verify.go`) | example/conformance process exits 0 | the facade example exits 0; replaying `responses` is indistinguishable from a real run |
| Capabilities (`codegen.go`) | a coverage *entry exists* for the claimed suite | checks an entry exists, not that a real run passed |
| Package hygiene | bans a fixed list of disallowed words in shipped text | token-level only — matches words, not behavior |

**The unifying gap:** every gate was satisfiable by a hollow implementation. None required a real
`model-prose → real-engine → real final() → completion` loop. The new gates add that requirement.

## The gates

### G1 — Real-engine end-to-end conformance (the antidote)
Fixture kind `agent_runtime_real` runs the **full `forward()` loop against a real embedded
engine in all five targets**: Go (goja), Rust (rquickjs), C++/Python (QuickJS), and Java
(quickjs4j/Chicory). The recorded transcript supplies the model turns, but the actor's
`javascriptCode` is genuinely executed and the completion must be **produced by that execution**.
The suite exercises both distiller and executor code, console output, and child delegation.

The Go `package main` conformance binary injects its engine via
`RegisterConformanceRealRuntime(id, factory)` so package `axllm` need not import its concrete
runtime and create an import cycle.

- Source: `tools/axir/internal/axir/templates/` — `go/goRuntime.go.txt` and
  `go/goConformance.go.txt`, `rust/rustLib.rs`, `cpp/cppConformance.cpp`,
  `python/pyConformance.py`, and `java/javaConformance.java`.
- Fixtures: `ir/conformance/axagent-real/`, including
  `agent-runtime-real-javascript-final.json` and `agent-runtime-real-distiller-code.json`.
- **State: GREEN in all five targets.** The `agent.rlm.real_execution` ledger entry lists all
  five as verified, with no pending targets. Teeth verified: an unregistered engine or a wrong
  `expected_output` fails because the engine, not the fixture, produces the value.
- CI: `axir-agent-antidote` runs the whole real-engine suite for each affected target. Rust uses
  `--features runtime-quickjs`, C++ uses `-DAX_CONFORMANCE_QUICKJS`, Python installs the quickjs
  extra, and Java loads quickjs4j on its classpath. These engine-enabled checks are separate from
  the default scripted conformance suite.
- Run (Go): `go -C packages/go run ./conformance ../../ir/conformance/axagent-real`.

### G2 — Anti-facade lint
Bans any **shipped example** that hand-constructs an agent completion payload
(`"completion"` envelope + `type:"final"|"askClarification"`) **as the agent's result**. A real
example must run a real runtime so the model + engine produce the completion. Two hardenings, both
motivated by a payload that evaded the first version of this lint:
- **Escaping-aware.** The payload usually hides as an escaped JSON string literal inside a scripted
  client (`"{\"completion\":{\"type\":\"final\"}}"`); the raw bytes are `\"completion\"` (a
  backslash where the closing quote should be), so a regex looking for `"completion"` never
  matched. The lint now collapses one level of backslash-escaped quotes before testing. This is the
  exact hole that let the `axagent_pipeline.*` facade ship green in five languages.
- **Real-engine exemption.** A scripted completion turn is legitimate when the same file also feeds
  model-authored executable code (`javascriptCode`/`pythonCode`/`actorCode`) to a real runtime --
  there the engine produces the genuine completion and the turn is scaffolding (the
  `runtime_profiles` examples). A pure facade has the completion shape but no such code.
- Source: `scripts/axir-anti-facade-check.mjs`; run via `npm run axir:gate:anti-facade`.
- **State: GREEN.** The `agent_openai_api.*` and `axagent_pipeline.*` facades are deleted; the
  surviving `runtime_profiles` examples drive a real engine and are correctly exempt.

### G3 — Prompt-parity gate
Conformance kind `agent_prompt` builds a real agent and asserts the RLM stage instructions were
actually rendered into `agent.State` (executor description contains `final(` / `askClarification(`).
The exact defect that shipped (empty executor instruction) fails this.
- Source: handler added to **all five** runners (`goRuntime.go.txt`, `pyConformance.py`,
  `rustLib.rs`, `javaConformance.java`, `cppConformance.cpp`).
- Fixture: `ir/conformance/axagent/agent-prompt-executor-rlm-protocol.json` (in the **default**
  conformance suite, so it runs for all five targets in `axir:verify:release` -- no engine needed).
- **State: GREEN in all five** -- the RLM prompt is now rendered from IR and injected as the stage
  instruction (Phases 1/2 landed), so the executor description carries `final(`/`askClarification(`.
  Enforced in CI via this fixture and the `runtime-forward-javascript-final`
  `expected_request_contains` check.

### G4 — Capability-backed-by-real-run (IMPLEMENTED)
Every generated package claims the `axagent` capability (`axagent` is in `supported_suites` for all
targets), so the build-gating test `TestG4AgentCapabilityBackedByRealRunner`
(`tools/axir/internal/axir/axir_test.go`) requires every language's conformance runner to carry the
real-execution proof: the `agent_runtime_real` handler (G1), the `agent_prompt` handler (G3), and --
for Go -- the `RegisterConformanceRealRuntime` engine-injection hook. It also asserts the real
fixtures exist on disk and that the behavioral-parity ledger lists all five languages as
`verified_targets`. This fuses "claims agent" with "really runs an agent": gut the real path and the
claim is no longer backed, so the gate fails. Teeth verified -- hiding the real fixture turns it red.
Runs in CI via `npm run test:axir:go-fast` in the `axir-go-fast` job.

### G5 — Behavioral-parity ledger (IMPLEMENTED)
`ir/behavioral-parity-ledger.json` maps claimed behavioral capabilities to the IR operations
implementing them and conformance fixtures exercising them. The gate in
`scripts/axir-ledger-check.mjs` checks that referenced operations and fixtures exist, rejects
entries without fixtures, and requires model-output assertions for claims about model-derived
output. This adds a completeness check alongside provenance's origin check.

- **State: GREEN, wired into CI.** `repo-checks` runs `npm run axir:gate:ledger`.
- The `agent.rlm.real_execution` entry records all five `verified_targets` and no pending targets;
  G4 additionally checks that all five remain listed and their real-execution handlers exist.

### G6 — Perturbation extended to the real loop
The existing `axir-perturb-check.mjs` already mutates `expected_*` values and asserts the runner
fails (verified manually against `agent_runtime_real`: a wrong `expected_output` is caught because
the engine, not the fixture, produced the value). Once the agent gates are green it auto-covers
them; agent-specific perturbations (remove the engine, prose-without-`final()`) are added then.

### G9 — Cross-language public-API parity (IMPLEMENTED)

**The blind spot.** G1–G6 verify *behavior* (the real `forward()` loop, prompts, the capability
ledger) and intrinsic/dispatch wiring, but nothing asserted that each language's `AxAgent` exposes
the **same public method surface**. `runtime_model.go` merely *appends* claimed public symbols
(`optimize`, `playbook`, `AxPlaybook`) to a manifest without verifying each emitted package actually
exposes them. So the Rust agent shipped without `optimize()`/`playbook()`, and Go without
`optimize()`, while every behavioral gate stayed green.

**The gate.** `TestAgentPublicAPIParity` (`tools/axir/internal/axir/axir_test.go`) greps each
language's `AxAgent` surface from the embedded templates (`goRuntime`, `rustLib`, `javaAxAgent`,
`pyAgent`, `cppHeader`) with declaration-anchored, lookalike-excluding patterns, and fails the build
if a required method (`optimize`, `playbook`) is missing in any language. Runs in the default
`go test -C tools/axir` (hence `npm run test:axir`). Extend coverage by adding names to the
`patterns` map. Negative-tested: renaming any one method's declaration fails the gate.

### G7 — CI wiring (`.github/workflows/ci.yml`)
The `ci-summary` job aggregates these gates. `repo-checks` and `axir-go-fast` run on every
change; the targeted AxIR jobs run for affected targets (all five for shared changes).
- **G2 / G4 / G5** — `repo-checks` runs `axir:gate:anti-facade` (G2) and `axir:gate:ledger` (G5);
  `axir-go-fast` runs `test:axir:go-fast`, including `TestG4AgentCapabilityBackedByRealRunner` (G4).
- **G3** — the engine-less `agent_prompt` fixture now lives in the default `axagent/` conformance
  suite, so the `axir-verify` matrix runs it for each affected target (no engine needed). This is the
  "folded in" step: it was held out of the default enumeration until the port landed, and now that
  the prompt renders green everywhere it runs by default.
- **G1** — the `axir-agent-antidote` job runs the real-engine antidote in-process for **Go** (goja),
  **Python** (quickjs wheel), **Rust** (rquickjs), **Java** (quickjs4j/Chicory from Maven
  Central), and **C++** (native QuickJS). The suite includes owned child delegation
  through actual parent and child actor code. Reproduce the C++ checks with:

```
QJS=$(brew --prefix quickjs)   # any quickjs install exposing quickjs.h + libquickjs.a
g++ -std=c++17 -DAX_CONFORMANCE_QUICKJS -I packages/cpp \
  -I "$(dirname "$(find "$QJS" -name quickjs.h)")" \
  packages/cpp/conformance.cpp packages/cpp/axllm/axllm.cpp packages/cpp/axllm/mcp.cpp \
  packages/cpp/axllm/runtime/quickjs/quickjs_runtime.cpp \
  "$(find "$QJS" -name libquickjs.a)" -o /tmp/cpp-conformance-qjs
/tmp/cpp-conformance-qjs ir/conformance/axagent-real
```

## Principle to preserve
Every claimed capability needs at least one **"real water through real pipes"** proof — a fixture
whose passing requires the real runtime to actually do the work — plus a completeness-ledger entry.
Origin-tracking (provenance) and script-faithfulness (coverage/conformance/perturbation/verify) are
all satisfiable by a hollow implementation; only a real-execution gate is not.

## CI execution

CI runs the complete scripted conformance corpus with four independent worker
processes per target (`AXIR_CONFORMANCE_WORKERS=4`). Fixtures are assigned once
across balanced shards; each shard must report every assigned fixture as passed
or explicitly skipped for a documented capability. A failed shard fails the
required verification job. Local commands default to one worker; values from
1 through 32 are accepted.

Expected-value mutation checks run the sampled fixture in isolation before and
after mutation. Full pristine-suite coverage remains in the separate required
AxIR verification job. Model-response mutation checks keep every detected
response mutation and the existing requirement that at least one mutation per
fixture must fail. Workers use separate fixture directories, and crashes or
timeouts fail the gate rather than counting as successful mutation rejection.

C++ CI jobs restore a compiler cache and report its hit statistics. Verification
uses a stable output directory to permit reuse; compilation still checks the
current generated sources. Superseded pull-request runs are cancelled while
main-branch pushes retain independent runs.
