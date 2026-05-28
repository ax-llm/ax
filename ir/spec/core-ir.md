# AxIR Core IR

Core IR is the LLVM-like substrate used after Ax dialect lowering. It is small,
typed, and backend-oriented.

Core operations use the generic operation syntax:

```axir
op core.func @parse_signature {
  type signature = "(string) -> AxSignature throws"
  attr effect = "throws"
}
```

Source files may use compact Core body syntax for high-volume statement forms.
This is an authoring shorthand only; it desugars to the same generic operations:

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

Core concepts:

- `module`, `import`, `dialect`, `op`, `attr`, `type`, `ref`, `region`, `block`
- primitive types: `string`, `bool`, `i64`, `f64`, `json`, `bytes`, `void`
- aggregates: `record`, `enum`, `list<T>`, `map<K,V>`, `optional<T>`,
  `result<T,E>`
- callables: `func`, `method`, `interface`, `constructor`
- effects: `pure`, `throws`, `async`, `stream`
- control flow regions: `if`, `switch`, `loop`, `return`, `raise`, `yield`

Core IR must not know Ax-specific concepts such as signatures or tools. Ax
dialects lower into records, functions, interfaces, and operations here.

Core function bodies use a small backend-neutral operation set:

- values and calls: `core.const`, `core.let`, `core.call`, `core.return`,
  `core.raise`
- control flow: `core.if`, `core.switch`, `core.for`, `core.loop`,
  `core.break`, `core.continue`, `core.try`
- aggregates: `core.list`, `core.map`, `core.append`, `core.get`, `core.set`
- primitives: `core.regex_match`, `core.string_split`, `core.string_trim`,
  `core.string_join`, `core.type_is`

Every reachable `region @body` path must terminate with `core.return` or
`core.raise`, or leave through an explicit `core.break`/`core.continue` when the
region is inside a loop. The checker rejects unknown Core body operations,
invalid value references, invalid branch and loop scopes, and unreachable
statements after terminators.

`core.call` may target another Core symbol with `attr callee = @some_func` or a
registered language-neutral intrinsic such as `intrinsic.string.lower` or
`intrinsic.validate.value`. Calls to backend escape helpers prefixed `_axir_`
are invalid; algorithms must be represented by Core symbols and registered
intrinsics so another backend can implement the same contract.

Core-owned Ax algorithms must be emitted from typed Core bodies, not raw
operation attributes and not target-only helper functions. Backends may provide
small primitive intrinsic implementations for language-neutral operations such
as JSON parsing, regex matching, URL validation, string operations, dynamic host
callback dispatch, and exception construction.

`axir check` validates Core op shape, allowed attrs, value scopes, branch and
loop regions, intrinsic names, and selected intrinsic argument counts.
`axir lint --profile llm-core` adds style guidance for LLM-maintained source.
`axir explain --symbol <name>` prints a low-token symbol summary and normalized
Core body for debugging.
