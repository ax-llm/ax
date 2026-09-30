# Timeout changes in Ax 25

Per-call `timeout` is now milliseconds in every language, including Python and Go native Typesafe calls. A value of `250` bounds the wait for response headers to 250 ms. `timeoutMs` remains an alias and wins when both are present. Constructor timeout units are unchanged.

Agent forwards pass this timeout to model calls. They no longer copy `timeout`, `timeout_ms`, or `timeoutMs` into runtime execution options. Configure execution deadlines on the runtime itself.
