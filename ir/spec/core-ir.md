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

## Type Strings

`type signature` and `type fields` attributes are validated, not decorative.
The grammar:

- signature: `"(param, ...) -> return [effects]"`. Parameters may be
  positional (`json`), named (`flow:json`), or optional (`options?:json`,
  `AxModelConfig?`); optional parameters may be omitted at call sites.
- fields: `"name:type,opt?:type"`; every field is named.
- types: the primitives (`string`, `bool`, `i64`, `f64`, `json`, `bytes`,
  `void`) plus `number` (dynamic numeric), `error`, and `external`
  (host-boundary placeholders); generics `list<T>`, `map<K,V>`,
  `optional<T>`, `result<T,E>`, `stream<T>`; unions `A|B`; and named types,
  which must resolve to a declared record, enum, interface, or error symbol.

A `type` attribute whose value is not a type expression, field list, or
signature is rejected: configuration values belong in `attr` slots.

## Effects

`throws` in a signature (or `attr effect = "throws"`) is a checked contract:
a function that executes `core.raise`, or calls a throwing function outside a
`core.try` body region, must itself declare `throws`. The `pure`, `async`,
and `stream` effects are reserved with the same propagation rule.

## Values

`%` bindings are mutable locals, not SSA values: a binding may be rebound by
any result-producing statement, including inside branch regions, and the new
value is visible after the region. `axir check --strict-types` additionally
warns when a rebind changes a binding's concrete kind (for example list to
map) and when a called core function has no parseable signature.

## Checker

`axir check` validates Core op shape, allowed attrs, value scopes, branch and
loop regions, intrinsic names, and selected intrinsic argument counts. The
typed checker additionally enforces the type-string grammar above, named-type
resolution, call arity against the callee's signature (optional parameters
may be omitted), throws propagation, and coarse kind discipline for container
and string operations (definite misuse such as `core.append` to a string
binding is reported).
`axir lint --profile llm-core` adds style guidance for LLM-maintained source.
`axir explain --symbol <name>` prints a low-token symbol summary and normalized
Core body for debugging.
`axir audit provenance` proves every Core-owned function is emitted from the
IR inside the generated packages' marker regions; see `rules.md`.
