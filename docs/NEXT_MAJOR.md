# Breaking changes planned for the next major

Each item keeps today's behavior until the next major version, 25.0.0, and flips
then.
The list sets out today's behavior, the flip, and the source PR. When a PR defers
a breaking change, it appends a line here. See [RELEASE.md](RELEASE.md) for the
release flow.

- The text-contract JSON-object fallback is removed: an answer that is one JSON object is read as text, as in TypeScript (#724).
- The ports raise a real `AxGenerateError` type. Today only the message matches TypeScript (#729).
- An agent without runtime config builds TypeScript's JavaScript actor stages by default, and the runtime-less completion mode becomes opt-in (pending PR).
