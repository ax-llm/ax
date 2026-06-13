# AxIR Verification Instruments

The IR+compiler story is enforced by three independent instruments, each
catching a failure mode the others cannot see. All three run against the
same 364 fixtures under `ir/conformance/` across the five generated targets
(python, go, rust, java, cpp).

## 1. Provenance — are the functions *defined* from the IR?

```
npm run axir -- audit provenance ir/axcore/root.axir
```

Proves every core-function registry entry is defined exactly once inside the
generated `BEGIN/END AXIR CORE EMITTED FUNCTIONS` markers, with no shadow
definitions elsewhere in the package. Enforced for all targets at compile
time and in CI (`test:axir` phase); per-package metrics land in
`packages/<target>/axir-provenance.json`.

Catches: hand-written reimplementations masquerading as generated code,
dropped emissions, duplicate definitions.

Cannot catch: an emitted function nobody calls — wrappers can pass every
fixture while running hand orchestration beside the generated code.

## 2. Coverage — are the functions *executed* by conformance?

```
npm run axir:audit:coverage          # all five targets + asymmetry diff
npm run axir -- audit --targets rust coverage ir/axcore/root.axir
```

Every emitted function marks itself on first entry when
`AXIR_COVERAGE_FILE` is set (a single env-gated branch otherwise). The audit
compiles each target, runs its full conformance suite with tracing, and
diffs the traced names against the registry — reporting unexercised
functions per module and **cross-target asymmetries** (a function exercised
under python but not under go is a wiring or runner gap in go).

Catches: wrappers that bypass emitted orchestration, fixture runners that
exercise hand parallels, suites that never reach a module.

Cannot catch: a runner that executes the right code but asserts nothing.

## 3. Perturbation — do the runners actually *check* the results?

```
npm run axir:perturb:check           # all targets; or: ... go rust
```

Mutates one `expected_*` value in the alphabetically first fixture of every
suite and requires **every target to fail** that fixture (after a pristine
self-test pass). A target that accepts a perturbed expectation has a runner
that is not comparing behavior — the failure mode that lets shams survive
both provenance and coverage.

Catches: missing assertions, allowlist-gated comparisons, error paths that
fabricate the expected error from the fixture's own text.

## Working the gaps

The coverage asymmetry section is the work queue: drive every target to the
python reference set, then shrink the *global* unexercised list (functions
no target exercises) by adding fixtures. When changing any runner, rerun all
three instruments — each fix historically moves more than one needle, and
the instruments check each other (the python self-containment tripwire in
`tools/axir/internal/axir/axir_test.go` is the static fourth man).
