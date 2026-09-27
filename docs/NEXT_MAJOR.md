# Breaking changes planned for the next major

Each item keeps today's behavior until the next major version and flips then.
The list sets out today's behavior, the flip, and the source PR. When a PR defers
a breaking change, it appends a line here. See [RELEASE.md](RELEASE.md) for the
release flow.

- Python `streaming_forward` yields TypeScript deltas by default. Today it yields raw events, `{"deltas": True}` opts in, and `stream_raw()` stays (#724).
- `add_field_processor` gets TypeScript's feedback semantics by default in Python, Java and C++. Today it transforms, so use `add_field_transform` for that. Rust's deprecated `with_field_processor` is removed (#724, #730).
- The text-contract JSON-object fallback is removed: an answer that is one JSON object is read as text, as in TypeScript (#724).
- The ports raise a real `AxGenerateError` type. Today only the message matches TypeScript (#729).
- Rust `AxError` gains `cause`, `source()`, request info (url and body, as TypeScript's `AxAIServiceError` keeps them) and `#[non_exhaustive]`. Adding fields to its public struct breaks callers that build it with a struct literal (#729, #747).
- The Rust caching function moves onto `AxForwardOptions` (#733).
- `parseDates` / `parse_dates` defaults to true in the ports (#734).
- `renderAudio` / `render_audio` defaults to true in the ports (#736).
- Speak results drop the older keys (`audio`, `mime_type`, `sample_rate`) in favor of TypeScript's `data`, `mimeType` and `sampleRate` (#736). The deprecated JSON `audio` key fallback in speak responses is removed (#743).
- `playbook.seed` means TypeScript's numeric seed, and snapshot seeds go in `playbook.playbook` (#739).
- TypeScript's deprecated, ignored `responseFormatWithFunctions` is removed (#721).
- An agent without runtime config builds TypeScript's JavaScript actor stages by default, and the runtime-less completion mode becomes opt-in (pending PR).
- TypeScript `AxAIProfileAuthentication.type` drops `'api-key-query'`. No profile uses it and TypeScript never implemented query-key auth (such a profile fell through to a Bearer header), so it is deprecated until then (#747).
- Per-call `timeout` is read in milliseconds, as in TypeScript. Today Python, Go, Java and C++ ignore it and Rust reads it in seconds, and each warns once when a call gives it without `timeoutMs`, which works now. Python's and Go's Typesafe native calls also read it in seconds today (#761).
- The ports' agent stops passing a forward `timeout` / `timeout_ms` into the runtime's options. As in TypeScript, the runtime timeout is set on the runtime, and a forward `timeout` is the per-call AI timeout (#761).
