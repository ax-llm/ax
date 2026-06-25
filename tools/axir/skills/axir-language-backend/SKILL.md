---
name: axir-language-backend
description: Use when adding or changing generated AxIR language backends in this repo, including target registration, codegen templates, package metadata, examples, conformance, and verification. This is a repo-maintainer skill and must not be emitted into generated Ax packages.
---

# AxIR Language Backend

Use this for work on generated Ax libraries such as Python, Java, C++, Go, or future Rust. This is not an Ax product skill from `src/ax/skills/`; it is repo-local guidance for compiler/backend implementation.

## First Checks

- Confirm the target is a generated Ax user library, not a public AxIR API.
- Inspect current target seams before editing: `tools/axir/internal/axir/codegen.go`, `verify.go`, `runtime_model.go`, the existing `*_core_emit.go` files, and target templates.
- Check user-facing package names in docs before choosing names. Do not expose `axir`, `ax-go`, or compiler-internal branding in generated library metadata.

## Backend Implementation Rules

- Keep semantics Core-owned. Provider mapping, Agent context/runtime behavior, Flow graph semantics, optimizer/GEPA behavior, envelopes, state, logs, and traces should come from Core helpers/descriptors.
- Keep target code idiomatic but thin. Target templates own language wrappers, dynamic value representation, transports, error boundary shape, package metadata, and examples.
- Prefer standard-library dependencies for base packages. Optional runtime profiles may remain dependency-bearing and opt-in.
- Use deterministic ordering for generated output, JSON/string rendering, prompt fields, snapshots, catalogs, action logs, and conformance output.
- Public APIs should feel native in the target language while preserving Ax concepts. Document unavoidable naming differences in generated README/examples.
- Capability manifests must be truthful. Do not list `unsupported_capabilities` for a generated package that is included in default verification; either implement the surface or remove the public/manifest claim.
- Concrete public generated methods must never be placeholder-only bodies such as `pass`, `return None`, `return null`, `return nil`, `Value::Null`, empty vectors, or generic "not implemented"/"unsupported" fallbacks. Validation errors remain acceptable for invalid inputs, unknown provider names, and unknown runtime protocol ops.
- Abstract/base interfaces may describe fallible boundaries, but every concrete generated class/struct that is advertised by the manifest must implement claimed provider, router, balancer, runtime session, AxGen, AxAgent, AxFlow, and optimizer operations.
- Conformance dispatch must be explicit for all claimed feature groups. Do not add a silent catch-all that makes unsupported fixture kinds pass without executing an implementation path.
- Conformance coverage must be semantic, not just dispatch-shaped. Every generated package must emit `conformance-coverage.json` with each claimed fixture kind/operation classified as `semantic`, `validation-error`, `transport-boundary`, or `explicitly-not-claimed`; default-verified targets must not use `presence-only`.
- Runner code must reject guard-only shortcuts: no broad expectation helpers, empty fixture arms, suite-name-only dispatch, self-comparisons, or checks that only prove an expected key exists. If a fixture expects a validation error, tie the generated error to the fixture expectation and keep the implementation path explicit.
- Provider API and no-key examples must cover every claimed public surface class: chat, stream, embeddings, audio/realtime mapping helpers when claimed, routers/balancers, runtime protocol, AxGen, AxAgent, AxFlow, and optimizer artifacts.

## Required Touchpoints

- Compiler target registration: `Compile`, CLI help, default verify target list, package name mapping, capability manifest, target idiom metadata.
- Code generation: target Core emitter, target templates, package metadata, README text, examples, conformance runner, runtime protocol/client support.
- Verification: target compile, manifest guard, no-key examples, conformance suites, package smoke/install or external-consumer smoke, and optional runtime-profile checks where applicable.
- Coverage gates: add target entries to generated-output audits in `tools/axir/internal/axir/axir_test.go`, including negative cases for placeholder runner patterns and positive markers for AxAgent, AxFlow, AxAI, runtime protocol, and optimizer coverage.
- Repo examples: `scripts/run-example.mjs`, `src/examples/<language>/`, `src/examples/README.md`, and root `package.json` convenience scripts if needed.
- User-facing example lists: update `npm run example -- list`, the root README "Run examples" block, examples README command blocks, package convenience scripts, and release/compiler docs so the new backend is discoverable without reading compiler internals.
- Docs: `README.md`, `docs/COMPILER.md`, `docs/RELEASE.md`, and `docs/ARCHITECTURE.md`. Edit canonical docs in `docs/`, not generated docs under `website/.generated/`.
- Website language docs: for any public backend feature or capability claim, update `src/examples/<language>/<group>/` with provider-backed `ax-example` headers and run the website-md language docs workflow so generated markdown stays aligned.

## Acceptance Bar

- `npm run test:axir` passes and includes the new target in default verification once the backend is claimed as current.
- `axir verify --targets python,java,cpp,<new-target>` passes for all default suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, and axflow.
- Generated package metadata is shippable for the ecosystem and uses the Ax product namespace.
- User-facing examples are honest: no-key examples are deterministic, provider API examples use real provider transport and require explicit environment keys.
- Public website examples are real provider-backed files under `src/examples/<language>/`; keep mock, no-key, scripted, debug, and conformance-only material under internal tests or `packages/<language>/examples`.
- Public example coverage stays in sync with language claims: `generation`, `short-agents`, `flows`, `optimization`, and `audio` each need beginner, intermediate, and advanced examples when the language is listed on the website.
- Generated-output audits pass for the target: no unsupported manifest entries, no placeholder concrete public methods, no dead Core helper stubs, and explicit conformance/example guards for every claimed Core-owned feature group.
- The conformance runner proves claimed behavior with fixture-level assertions over outputs, requests, state, traces, artifacts, runtime envelopes, and expected errors. Placeholder-free code is necessary but not sufficient for default `test:axir` inclusion.

## Avoid

- Do not put repo-maintainer backend guidance in `src/ax/skills/`; those files are Ax product subsystem docs.
- Do not implement provider or Agent semantics directly in target templates when a Core descriptor/helper exists.
- Do not present scripted/no-key examples as provider API examples or claim registry publishing before workflows and credentials exist.
- Do not widen runtime profile semantics while adding a language backend unless a concrete conformance gap proves it is necessary.
- Do not ship a thinner v1 target by leaving stream/audio/realtime/router/runtime/optimizer methods as placeholders while the manifest or README claims full AxIR support.
