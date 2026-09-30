# C++ changes in Ax 25

`add_field_processor(field, processor)` now takes an `AxFieldProcessor` callback with `(value, context)` and defaults to feedback. A non-empty result requests another model step; return null when satisfied.

Use `add_field_transform` for local rewriting. The old string-operation and single-argument callback overloads of `add_field_processor` are removed. Explicit `AxFieldProcessorMode::Transform` remains available.
