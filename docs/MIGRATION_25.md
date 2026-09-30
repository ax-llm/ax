# Migrating to Ax 25.0.0

Ax 25 adopts the queued TypeScript-compatible defaults in the generated Python,
Java, C++, Go, and Rust packages. Review the changes below before upgrading from
24.x. Language runtime engines remain optional dependencies.

## Queued breaking changes

| Change | Migration guidance |
| --- | --- |
| Python streaming yields deltas by default | [Python streaming and transport errors](MIGRATION_25_PYTHON.md) |
| Field processors provide feedback by default; Rust's deprecated alias is removed | [Python](MIGRATION_25_PYTHON.md), [Java](MIGRATION_25_JAVA.md), [C++](MIGRATION_25_CPP.md), [Rust](MIGRATION_25_RUST.md) |
| JSON-looking text is no longer parsed as an output object | [Text output contracts](MIGRATION_25_TEXT.md) |
| Generation failures expose a typed `AxGenerateError` and their cause | [Generation errors](MIGRATION_25_ERRORS.md) |
| Rust errors retain causes and request context and are non-exhaustive | [Rust error handling](MIGRATION_25_RUST.md) |
| Rust caching callbacks move to `AxForwardOptions` | [Rust forward options](MIGRATION_25_RUST.md) |
| Date parsing defaults to enabled | [Dates and audio](MIGRATION_25_OUTPUTS.md) |
| Audio rendering defaults to enabled | [Dates and audio](MIGRATION_25_OUTPUTS.md) |
| Speak results use `data`, `mimeType`, and `sampleRate`; old audio aliases are removed | [Dates and audio](MIGRATION_25_OUTPUTS.md) |
| Playbook `seed` is numeric; snapshots belong in `playbook` | [Playbook configuration](MIGRATION_25_PLAYBOOK.md) |
| TypeScript's ignored `responseFormatWithFunctions` option is removed | [TypeScript API removals](MIGRATION_25_TYPESCRIPT.md) |
| Agents build JavaScript runtime stages by default; completion mode is explicit | [Agent runtime configuration](MIGRATION_25_AGENT.md) |
| TypeScript's unsupported `api-key-query` authentication type is removed | [TypeScript API removals](MIGRATION_25_TYPESCRIPT.md) |
| Invalid model function calls fail by default | [Function-call validation](MIGRATION_25_FUNCTION_CALLS.md) |
| Malformed user content raises `AxAIServiceResponseError` | [Output and response validation](MIGRATION_25_OUTPUTS.md) |
| Per-call timeouts use milliseconds | [Timeout configuration](MIGRATION_25_TIMEOUTS.md) |
| Forward timeouts no longer configure runtime execution deadlines | [Timeout configuration](MIGRATION_25_TIMEOUTS.md) |
| Java transport errors use typed Ax errors by default | [Java transport errors](MIGRATION_25_JAVA.md) |
| Python transport errors drop compatibility exception bases | [Python transport errors](MIGRATION_25_PYTHON.md) |

## Additional agent changes

[Agent migration guidance](MIGRATION_25_AGENT.md) covers the default `utils`
namespace, structured clarification requests, required-context validation,
context-map rendering, evaluation errors, and cached actor-message splitting.
The release also carries the held parity fixes for stage budgets, runtime state,
retry memory, session response budgets, provider retries, and embedding routing.

## Tool result formatting and memory

Generated Python, Go, Java, C++, and Rust programs format tool results as
TypeScript does: strings stay text, null results become `done`, and other values
use indented JSON. This applies to ordinary and native-session tool calls.
A call's formatter takes precedence over the program's, followed by the global
formatter. A formatter that throws fails the run without a correction retry.

A function-result memory item's `result` now contains the text sent to the model.
`result_text` remains an alias of that text. Go's memory results are
`[call, result, ok, result_text]`. Code that needs the original tool value should
read the function-call trace, which continues to keep the raw value.
