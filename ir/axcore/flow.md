# AxFlow Dialect

`ax.flow` models AxFlow as an Ax program graph. It is not a generic workflow
engine: every executable node is an Ax program boundary or a deterministic host
callback, and the flow itself exposes the same program surfaces as AxGen and
AxAgent where useful.

The alpha contract covers graph construction, duplicate step checks, planning
metadata, cache-key generation from the actual input object, child-program
forward calls, trace/chat-log aggregation, and `.returns()` projection.
