# provider.axir Reference Notes

Reference files:

- `src/ax/ai/openai/*` for OpenAI request, response, streaming, embeddings,
  usage, and finish-reason shape.
- `src/ax/util/apicall.ts` for HTTP status/error normalization.
- `src/ax/ai/capabilities.ts` for provider capability checks.
- `src/ax/ai/validate.ts` for provider-neutral request validation.

## Native file routing

`provider_route_preprocess_request` applies file policy after provider/model
selection. Native-capable providers retain file data, names, MIME types, cache
flags, extraction metadata, and content ordering. Request history is copied;
preprocessing does not replace the original file in later turns.

For unsupported providers, existing extracted text takes precedence over a host
extractor. `provider_route_file_extractions` returns ordered extraction tasks;
the host invokes its configured callback and passes the resulting text slots
back to Core. Core then applies degradation, skip, or error policy. A successful
extractor may return empty text. Extractor failures retain their error context
and do not become placeholder text.

Language adapters use the requested model when reporting capabilities to the
router. Rust retains explicit provider selection and otherwise uses the same
Core recommendation as the other targets. Built-in OpenAI and Responses
profiles advertise their native file support.

Evidence: `provider-router-files-{native,extracted,degrade,skip}` conformance
fixtures derive expected content from TypeScript. Native runtime tests exercise
router/balancer transport bodies, ordering, unchanged history, and a subsequent
request. These checks run in the five-target verification suite.

### File-routing verification

The five native runtime suites cover provider request bodies, retained file
metadata, later turns, generator completion through a router, empty extraction
results, extraction errors, and explicit unsupported-file rejection. The shared
fixtures additionally compare native, extracted-text, degraded, and skipped
content with TypeScript.

| Target | Native regression suite | Live generator example |
| --- | --- | --- |
| Python | `packages/python/tests/astra_session_test.py` | `src/examples/python/generation/native_file_routing.py` |
| Go | `packages/go/session_test.go` | `src/examples/go/generation/native_file_routing.go` |
| Java | `packages/java/tests/AstraSessionTest.java` | `src/examples/java/generation/NativeFileRoutingExample.java` |
| C++ | `packages/cpp/tests/astra_session_test.cpp` | `src/examples/cpp/generation/native_file_routing.cpp` |
| Rust | `packages/rust/src/lib.rs` native-file tests | `src/examples/rust/generation/native_file_routing.rs` |

All five live examples passed on 2026-09-07 with `gpt-6-astra`, low reasoning,
and standard processing. Each read an inline PDF through the normal generator
and provider router and correctly reported revenue of $42,000, expenses of
$18,000, and profit of $24,000. They used the configured account's native HTTP
transport; there was no account-access restriction. Inline PDF examples include
a filename, as shown in the [OpenAI file-input guide](https://developers.openai.com/api/docs/guides/file-inputs).

The completion adapter unwraps the router's response envelope before recording
the final answer and usage. The generator regression tests require one model
response for the final structured answer, preventing an empty assistant history
and an unnecessary correction request. Completion commit and PR evidence are
recorded in the file-routing entry of `ir/axir-backlog.json`.
