# AxIR Compiler Rules

These rules keep AxIR pointed at the original goal: generate idiomatic native Ax
libraries from a shared compiler-owned runtime description.

## Product Rule

AxIR generates Ax itself, not one-off user programs.

The source of truth is the curated Ax runtime bundle in `ir/axcore/`. A generated
target package should feel like a native Ax implementation for that language,
while preserving the same semantic contract through shared fixtures.

## Source Of Truth

- TypeScript remains the behavioral reference implementation.
- TypeScript is not transpiled and does not expose public AxIR APIs.
- Extractors may read TypeScript behavior and write fixtures, but they must not
  add runtime APIs such as `toIR()` or `parseAxIR()`.
- `.axir` modules, specs, and conformance fixtures are the compiler source of
  truth for generated packages.
- Generated Python, Java, C++, or future target files are artifacts. Do not edit
  generated output as source.

## Fixture-First Semantics

New Ax behavior must be pinned by a TS-derived fixture before it is encoded in
Core or a backend.

This keeps portability honest. If the behavior cannot be represented as a
backend-neutral fixture, it should usually be modeled as a host boundary rather
than silently embedded in one target.

## Core-Owned Versus Target-Owned

Core owns deterministic Ax semantics:

- signature parsing and validation
- JSON schema generation
- output validation and internal-field stripping
- prompt/template rendering
- stream folding
- AxGen request/retry/tool/output orchestration
- AxAI request validation, model config shaping, provider JSON mapping, response
  normalization, usage mapping, and provider error normalization
- memory, trace, chat-log, example/demo ordering, retry/correction ordering, and
  callback scheduling
- AxAgent policy selection: actor primitives, protocol actions, runtime
  globals, reserved-name rules, host-boundary availability, prompt guidance,
  and policy trace events

Targets own runtime integration:

- idiomatic public wrappers, constructors, builders, protocols, and exceptions
- HTTP, SSE byte/line parsing, process APIs, clocks, sleeping, and environment
  access
- native callback invocation for assertions, field processors, tool handlers,
  hooks, and host-provided clients
- language-specific packaging, examples, manifests, and conformance runners

If a rule affects observable Ax behavior across languages, prefer Core. If it
touches the host language runtime or external IO, prefer a target-owned boundary
with Core deciding when and why the boundary is called.

AxAgent changes often. New discovery, delegation, memory, skill, status, or
runtime primitives should first be expressed as policy-registry data and
TS-derived fixtures, then lowered through Core. Do not bake volatile agent
decisions directly into Python, Java, or C++ templates.

Agent discovery and memory primitives are effect-only in this contract:
`discover(...)` and `recall(...)` return `void` and mutate next-turn prompt
state. `used(...)` records usage only for already-loaded memory or skill IDs.
`guideAgent(...)` is protocol-only guidance from trusted host boundaries and
must not be rendered as a normal actor-visible primitive unless the policy
registry says so.

AxAgent traces are the portable replay and optimization boundary. Core owns the
event ordering, host-boundary envelopes, component IDs, status/final/error
records, and deterministic replay matching. Targets may add ergonomic accessors
such as `get_trace()` or `exportTrace()`, but they must not invent target-local
trace schemas or replay semantics.

## Dialect And Lowering Boundaries

- Ax dialects preserve high-level Ax meaning.
- Backends consume lowered Core IR or an `AxRuntimeModel` produced from Core.
- Backends must not interpret Ax dialects directly except for target annotations
  already lowered into the runtime model.
- The Core layer must stay Ax-neutral: records, functions, effects, values,
  blocks, control flow, and low-level intrinsics.
- High-level Ax terms belong in `ax.*` dialects and lower into Core symbols.

## No Semantic Escapes

Target-only semantic helpers are not allowed for Core-owned behavior.

Forbidden patterns include helpers such as `_axir_*`, `_core_*_impl`, and
backend-owned provider or generator algorithms. Low-level intrinsics are allowed
only when they are language-neutral primitives, for example:

- JSON parse/stringify
- regex match/replace
- URL/email validity checks
- map/list/object field access
- string trim/split/join/replace/indexing
- dynamic method dispatch at host boundaries
- exception construction and message extraction

An intrinsic should do the smallest portable primitive job possible. If it
starts knowing about Ax signatures, tools, prompts, providers, retries, or trace
events, it should become Core-owned IR instead.

## Target Idiom Rule

Semantic parity does not mean TypeScript-shaped APIs everywhere.

- Python should expose sync-first, `snake_case`, standard-library APIs with
  simple dict/list boundaries where dynamic data is natural.
- Java should use packages, classes, records/builders, functional interfaces at
  callback boundaries, and `Map<String,Object>` only where the data is genuinely
  dynamic.
- C++ should use `namespace ax`, value types, RAII-friendly ownership, standard
  containers, `std::function` callback boundaries, and explicit exceptions.
- Future Go should use packages, interfaces, structs, `context.Context` at IO
  boundaries, and explicit error returns.

Ax-compatible aliases are fine, but the primary API should feel native to the
target language.

## Verification Rule

`axir verify` is the product gate.

For an installed toolchain, verification must compile the target, run examples,
validate manifests, and execute all conformance suites supported by the current
milestone. Local missing toolchains may be reported as explicit skips; CI jobs
that install a toolchain should treat that target as required.

Every generated package must include:

- an `axir-capabilities.json` manifest
- a target README
- runnable examples
- a conformance runner when the target is executable

## Traceability Rule

Each Ax runtime module should have a paired note explaining the TypeScript
reference behavior that informed it. When fixtures are added, keep them small,
named after the behavior they pin, and sorted for deterministic diffs.

## LLM Authoring Profile

Most AxIR maintenance is expected to be done by coding agents. Optimize syntax
in this order:

1. validation quality
2. context density
3. hallucination resistance

Do not add syntax only because it looks familiar to humans. A syntax improvement
must improve checker precision, remove repetitive Core-body boilerplate, or make
unsupported forms harder to invent.

The preferred profile is `llm-core`:

- top-level declarations stay in generic `op` form
- Core bodies use compact assembly-like statements
- symbol refs stay explicit with `@`
- value refs stay explicit with `%`
- host-boundary intrinsics stay explicit
- one common operation has one canonical spelling

Compact Core syntax is allowed only as a one-to-one shorthand for existing Core
body operations:

```axir
body @entry(%events: list<json>) {
  %chunks = core.list
  %parts = core.call @stream_event_content_parts_impl(%event)
  core.for %part in %parts {
    core.append %chunks, %part
  }
  %folded = core.string_join %chunks sep ""
  core.return %folded
}
```

The parser desugars compact statements directly to `core.*` operations and the
typed Core body model. The formatter emits this compact form for common Core
body statements; `lower --to core` remains the expanded debug view.

Avoid for now:

- record/interface/function declaration DSLs
- nested expressions
- operator precedence
- closures
- implicit symbol lookup
- backend-specific syntax
- TypeScript-shaped object shorthand as semantic truth

Use `axir lint --profile llm-core` for style guidance and `axir explain` when a
coding agent needs a low-token view of a symbol, its calls, intrinsics, source
tags, and normalized Core body.
