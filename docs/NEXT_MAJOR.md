# Breaking changes planned for the next major

Each item keeps today's behavior until the next major version, 25.0.0, and flips
then.
The list sets out today's behavior, the flip, and the source PR. When a PR defers
a breaking change, it appends a line here. See [RELEASE.md](RELEASE.md) for the
release flow.

- Python `streaming_forward` yields TypeScript deltas by default. Today it yields raw events, `{"deltas": True}` opts in, and `stream_raw()` stays (#724).
- `add_field_processor` gets TypeScript's feedback semantics by default in Python, Java and C++. Today it transforms, so use `add_field_transform` for that. (#724, #730).
- The text-contract JSON-object fallback is removed: an answer that is one JSON object is read as text, as in TypeScript (#724).
- `parseDates` / `parse_dates` defaults to true in the ports (#734).
- `renderAudio` / `render_audio` defaults to true in the ports (#736).
- Speak results drop the older keys (`audio`, `mime_type`, `sample_rate`) in favor of TypeScript's `data`, `mimeType` and `sampleRate` (#736). The deprecated JSON `audio` key fallback in speak responses is removed (#743).
- `playbook.seed` means TypeScript's numeric seed, and snapshot seeds go in `playbook.playbook` (#739).
- An agent without runtime config builds TypeScript's JavaScript actor stages by default, and the runtime-less completion mode becomes opt-in (pending PR).
- A user content item that is not an object or has no type raises `AxAIServiceResponseError` in the ports, like the other chat-message checks. Today it raises `AxUnsupportedCapabilityError` with TypeScript's message (#754).
- Per-call `timeout` is read in milliseconds, as in TypeScript. Today Python, Go, Java and C++ ignore it and Rust reads it in seconds, and each warns once when a call gives it without `timeoutMs`, which works now. Python's and Go's Typesafe native calls also read it in seconds today (#761).
- The ports' agent stops passing a forward `timeout` / `timeout_ms` into the runtime's options. As in TypeScript, the runtime timeout is set on the runtime, and a forward `timeout` is the per-call AI timeout (#761).
- Java chat and embed throw `AxAIServiceNetworkError` / `AxAIServiceTimeoutError` for a failed connection or the client's timeout, with the JDK exception as the cause, as `typedTransportErrors: true` does today. Today they throw the JDK's `ConnectException`, `IOException` or `HttpTimeoutException` and warn once; AxGen retries either kind (#767).
- Python's transport errors drop their compatibility bases: a connect that runs out of the client's timeout is only an `AxAIServiceTimeoutError` (today also an `AxAIServiceNetworkError`), and a connection dropped mid-stream only an `AxAIServiceNetworkError` (today also an `http.client.IncompleteRead`) (#767).
