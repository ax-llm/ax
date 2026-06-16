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
  `runtime-forward-javascript-final` regression fixture's `expected_request_contains` check.
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
- **G4 capability-backed-by-real-run**: GREEN, wired into CI (`go test -C tools/axir`). The
  build-gating test `TestG4AgentCapabilityBackedByRealRunner` ties the `axagent` capability claim to
  the presence of the real-execution handlers (`agent_runtime_real` + `agent_prompt`) in every
  language's runner, the real fixtures on disk, and the ledger's verified targets. Teeth verified.
- **G5 ledger**: GREEN, wired into CI; tracks real-execution verified targets.
- **G7 CI wiring**: GREEN. G3's `agent_prompt` is folded into the default `axagent` suite (runs for
  all five via the `axir-verify` matrix); the `axir-agent-antidote` job runs the G1 in-process engine
  antidote for Go (goja), Python (quickjs wheel), Rust (rquickjs), and Java (quickjs4j/Chicory);
  G2/G4/G5 already gate `axir-checks`/`go test`. All five in-process engines pass the antidote
  locally; cpp is the only one not wired to CI (native libquickjs) — the exact command is in G1 below.

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
Fixture kind `agent_runtime_real` runs the **full `forward()` loop against a real embedded engine**
(goja today): the recorded transcript supplies the model turns, but the executor's `javascriptCode`
is genuinely executed by the engine and the completion must be **produced by that execution**.
Because `RunConformanceFixture` lives in package `ax` and cannot import a concrete engine without an
import cycle, the `package main` conformance binary injects one via
`RegisterConformanceRealRuntime(id, factory)`.
- Source: `tools/axir/.../templates/go/goRuntime.go.txt` (runner + registry),
  `templates/go/goConformance.go.txt` (goja registration).
- Fixture: `ir/conformance/axagent-real/agent-runtime-real-javascript-final.json`.
- **State: GREEN on current core, Go** — proves the runtime substrate already works end-to-end with a
  real engine; the shipped defect was purely the un-rendered prompt (see G3). Teeth verified: fails
  on an unregistered engine and on a wrong `expected_output` (the engine, not the fixture, produces
  the value).
- Run: `cd packages/go && go run ./conformance ../../ir/conformance/axagent-real/agent-runtime-real-javascript-final.json`
- Remaining: rust/cpp/java (quickjs) + python (quickjs extra) register their engines in Phase 5.

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
Runs in CI via `go test -C tools/axir ./...`.

### G5 — Behavioral-parity ledger (planned)
A checked manifest mapping each TS behavioral capability → the IR op(s) implementing it → at least
one conformance fixture that exercises it for real. This is the structural answer to "provenance
proves origin, not completeness": it adds a completeness ledger that an audit gate enforces.

### G6 — Perturbation extended to the real loop
The existing `axir-perturb-check.mjs` already mutates `expected_*` values and asserts the runner
fails (verified manually against `agent_runtime_real`: a wrong `expected_output` is caught because
the engine, not the fixture, produced the value). Once the agent gates are green it auto-covers
them; agent-specific perturbations (remove the engine, prose-without-`final()`) are added then.

### G7 — CI wiring (`.github/workflows/ci.yml`)
Each gate runs as a required pipeline phase, aggregated by the `ci-summary` job:
- **G2 / G4 / G5** — `axir-checks` runs `axir:gate:anti-facade` (G2) and `axir:gate:ledger` (G5);
  `test:axir:tools` runs the Go suite, which includes `TestG4AgentCapabilityBackedByRealRunner` (G4).
- **G3** — the engine-less `agent_prompt` fixture now lives in the default `axagent/` conformance
  suite, so the `axir-verify` matrix runs it for **all five** targets (no engine needed). This is the
  "folded in" step: it was held out of the default enumeration until the port landed, and now that
  the prompt renders green everywhere it runs by default.
- **G1** — the `axir-agent-antidote` job runs the real-engine antidote in-process for **Go** (goja),
  **Python** (quickjs wheel), **Rust** (rquickjs), and **Java** (quickjs4j/Chicory from Maven
  Central). All five in-process engines pass the antidote locally; **cpp** is the only one not wired
  to CI (it needs a native libquickjs). Reproduce the cpp antidote with:

```
QJS=$(brew --prefix quickjs)   # any quickjs install exposing quickjs.h + libquickjs.a
g++ -std=c++17 -DAX_CONFORMANCE_QUICKJS -I packages/cpp \
  -I "$(dirname "$(find "$QJS" -name quickjs.h)")" \
  packages/cpp/conformance.cpp packages/cpp/axllm/axllm.cpp packages/cpp/axllm/mcp.cpp \
  packages/cpp/axllm/runtime/quickjs/quickjs_runtime.cpp \
  "$(find "$QJS" -name libquickjs.a)" -o /tmp/cpp-conformance-qjs
/tmp/cpp-conformance-qjs ir/conformance/axagent-real/agent-runtime-real-javascript-final.json
```

## Principle to preserve
Every claimed capability needs at least one **"real water through real pipes"** proof — a fixture
whose passing requires the real runtime to actually do the work — plus a completeness-ledger entry.
Origin-tracking (provenance) and script-faithfulness (coverage/conformance/perturbation/verify) are
all satisfiable by a hollow implementation; only a real-execution gate is not.
