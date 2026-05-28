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

- values and calls: `core.const`, `core.let`, `core.call`, `core.return`, `core.raise`
- control flow: `core.if`, `core.switch`, `core.for`
- aggregates: `core.list`, `core.map`, `core.append`, `core.get`, `core.set`
- primitives: `core.regex_match`, `core.string_split`, `core.string_trim`, `core.type_is`

Every `region @body` block must terminate with `core.return` or `core.raise`.
Backends may initially support a subset of these operations, but the checker
must reject unknown Core body operations and invalid value references.

`core.call` may target another Core symbol with `attr callee = @some_func` or a
registered language-neutral intrinsic such as `intrinsic.string.lower` or
`intrinsic.validate.value`. Calls to backend escape helpers prefixed `_axir_`
are invalid; algorithms must be represented by Core symbols and registered
intrinsics so another backend can implement the same contract.
