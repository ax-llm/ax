# schema.axir Reference Notes

Reference files:

- `src/ax/dsp/jsonSchema.ts` for Ax field to JSON Schema conversion.
- `src/ax/dsp/standardSchema.ts` for Standard Schema conversion.
- `src/ax/ai/types.ts` for `AxFunctionJSONSchema`.

## Standard Schema host boundary

`standard_schema_bridge` records the TypeScript source boundary; it is not a
generated-language adapter for Zod objects or JavaScript validator callbacks.
Python, Java, C++, Go, and Rust construct native Ax field descriptors. Their
array element types, class options, optionality, JSON schemas, and validation
are implemented by the shared Core schema and validation helpers.

The `zod-v4-*` schema and validation fixtures derive expectations from the
TypeScript Zod 4 bridge and exercise equivalent native descriptors in every
generated language. This covers PR #886 without introducing Zod introspection
into those runtimes. Zod-specific regex flags and transformation callbacks
remain TypeScript host behavior.
