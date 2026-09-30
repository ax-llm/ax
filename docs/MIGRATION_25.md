# Migrating to Ax 25.0.0

This guide records the breaking changes as they land for 25.0.0.

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
