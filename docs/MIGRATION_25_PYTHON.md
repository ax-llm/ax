# Python migration to Ax 25

`streaming_forward(client, values)` now yields TypeScript-style field deltas with `version`, `index`, and `delta`. Merge deltas within a version and reset when the version changes. Use `stream_raw()` for provider events. Existing explicit `deltas=True` calls still work; `deltas=False` keeps raw events.

`add_field_processor(field, callback)` now feeds a non-empty callback result back to the model for another step. The callback receives the field value and a context containing `values` and `done`. Use `add_field_transform` for local value rewrites; explicit `feedback=False` still selects that behavior.

A connection timeout is an `AxAIServiceTimeoutError` and no longer also an `AxAIServiceNetworkError`. A dropped stream is an `AxAIServiceNetworkError` and no longer also an `http.client.IncompleteRead`. The original transport exception remains available through `__cause__`.
