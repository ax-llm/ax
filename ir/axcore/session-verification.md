# Astra session parity verification

Verification date: 2026-09-08. TypeScript reference:
`8c138f108c02d3f000d4ac9c03e078770b0c813c`. Implementation:
`1771913118be0ea8a6be950ba4a011a7648e3c2a` in [PR #657](https://github.com/ax-llm/ax/pull/657), following
PRs #653, #655, and #656. Native file routing was delivered in PR #652.

## Deterministic and package acceptance

- `npm run test:axir`: compiler tests, Core checks/lint/lowering, enforced
  provenance (702 Core functions and zero violations in each target), all-five
  release conformance, runtime examples, and package consumers passed.
- The final C++ map-order optimization passed a further complete C++ release run.
  Its conformance run took 2m31.5s, compared with 5m26.1s before that optimization
  in these local runs; these timings are observations, not a controlled benchmark.
- The shared raw validator fixture and 1,164 TypeScript-derived ECMAScript cases
  passed. Native MCP agent tests additionally assert provider schemas, invalid-call
  correction, one valid invocation, incorporated results, authorization, action
  logs, and duplicate prevention. Delegated tests cancel after a child's imported
  MCP tool starts and assert settlement, retained usage, closed parent runtimes,
  and rejection of late callbacks.
- `go test -race ./...` passed in the Go package. The full C++ session suite passed
  with `-fsanitize=thread -DAXLLM_ENABLE_CURL=1`, including actual HTTP cleanup.
- Build, public type checks, 42 focused TypeScript tests, 107 tooling tests,
  generated examples, conformance synchronization, package freshness, provider
  profiles, anti-facade/ledger/response-perturb/agent-semantic gates, skills,
  formatting, lint, spelling, and website checks passed (1,923 HTML pages).

## Live provider acceptance

Each scenario ran through the public language entrypoint with a configured live
API key, `gpt-6-astra`, initial low reasoning, and standard processing.

| Scenario | Python | Go | Java | C++ | Rust |
| --- | --- | --- | --- | --- | --- |
| Generation: background overlap, final results, steering and reasoning updates | Pass | Pass | Pass | Pass | Pass |
| Cooperative cancellation with unresolved call reporting | Pass | Pass | Pass | Pass | Pass |
| Agent: native background tools and final responder results | Pass | Pass | Pass | Pass | Pass |
| Actual child actor execution with scoped updates and parent continuation | Pass | Pass | Pass | Pass | Pass |
| Flow: background overlap and incorporated results | Pass | Pass | Pass | Pass | Pass |
| Parallel flow: coordinated overlap, root and targeted controls | Pass | Pass | Pass | Pass | Pass |

Run these with `npm run example -- LANGUAGE PATH`. For Python, Go, C++, and Rust,
the paths are `generation/astra_async`, `generation/astra_cancellation`,
`short-agents/astra_async_agent`, `short-agents/astra_child_agent`,
`flows/astra_async`, and `flows/astra_parallel`. Java uses the corresponding
`AstraAsyncExample`, `AstraCancellationExample`, `AstraAsyncAgentExample`,
`AstraChildAgentExample`, `AstraAsyncFlowExample`, and `AstraParallelFlowExample`
under those groups.

Rust's optional `generation/astra_native_steering` example also passed: the
high-level controller received native application timing and the final answer
was exactly `VERIFIED`. No account or transport restriction blocked these runs.

## Issues exposed and resolved

- CI uses Node 22, which rejects disjoint duplicate capture names accepted by
  the local Node 26 reference. Two exact equivalent patterns supply the older
  runtime oracle; newer runtimes also assert agreement with the original syntax.
  All 1,164 fixture cases remain unchanged, and extraction passes on both runtimes.
- Java boxed numeric equality rejected otherwise valid regex parser positions;
  numeric values now compare numerically, with other equality behavior retained.
- C++ collection reads and repeated ordering-list copies made long successful
  patterns unnecessarily expensive. Reads avoid whole-collection copies; map
  insertion preserves independent copied-map order and grows unique storage
  in place. A regression exercises the order of both copies.
- The C++ core-only session binary omitted actual HTTP tests. Release verification
  now builds an additional libcurl-enabled binary. It exposed dropped configured
  MCP headers; the constructor now preserves them. HTTP fixture failures close
  sockets and report the original assertion instead of an opaque startup timeout.
- C++ cancellation timing included model setup. It now starts at the actual
  interruption request and retains the same two-second bound.
- A live Go agent requested a lookup twice. The example's repeated signal close
  produced a tool error even though final output validation passed. The two
  affected Go examples now signal through `sync.Once` and passed fresh live runs.
- An earlier Java child run omitted its child result; a diagnostic rerun passed.
  The final all-five child runs passed and recorded actual delegation.

All six C++ live scenarios were rerun after its final runtime changes. No backlog
entry was deleted, reduced in scope, or replaced by a non-portable exemption.
Package release and publication are outside this work.
