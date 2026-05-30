# Ax Program Dialect

`ax.program` is the small shared contract used by executable Ax programs.
`AxGen` is the base program; `AxFlow` and `AxAgent` compose child programs
through the same forward/trace/component shape.

The dialect is intentionally thin. It should hold cross-program semantics such
as descriptors, trace events, component metadata, and rollout hooks, not become
a second runtime class hierarchy.
