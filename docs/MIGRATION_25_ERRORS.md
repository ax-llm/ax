# Generation errors in Ax 25

Failures reported as `Generate failed: ...` now have a concrete `AxGenerateError` type, with the original failure retained as their cause. Catch this type at generation boundaries and inspect the cause for validation or provider details. Cancellation still propagates as its abort error.

Python exposes `__cause__`, Java `getCause()`, Go `errors.As` and `errors.Unwrap`, and C++ `cause()`. Rust keeps the common `AxError` result envelope; `as_generate_error()` returns its typed `AxGenerateError` payload, whose `cause` retains the original `AxError`. The standard error source chain also exposes both.
