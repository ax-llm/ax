# Breaking changes planned for the next major

Each item keeps today's behavior until the next major version, 25.0.0, and flips
then.
The list sets out today's behavior, the flip, and the source PR. When a PR defers
a breaking change, it appends a line here. See [RELEASE.md](RELEASE.md) for the
release flow.

- Python `streaming_forward` yields TypeScript deltas by default. Today it yields raw events, `{"deltas": True}` opts in, and `stream_raw()` stays (#724).
- `add_field_processor` gets TypeScript's feedback semantics by default in Python and Java. Today it transforms, so use `add_field_transform` for that (#724, #730).
