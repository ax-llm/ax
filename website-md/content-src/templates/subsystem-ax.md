# ax() Generation

Use `ax()` to create a structured generation program from a signature.

```{{fence}}
{{axCode}}
```

Generation owns prompt construction, parsing, validation, retries, tools, streaming folds, traces, usage, demos, and field processors. It is the smallest useful Ax program.

## What It Does

`ax()` turns a signature into a runnable program. The program receives typed inputs, sends a provider request, parses structured outputs, validates fields, retries on parse or assertion failures, records traces/usage, and can call tools across multiple steps.

## Core Call Shape

```text
program = ax(signature, options)
result = program.forward(aiClient, inputs, runOptions)
```

Use `streamingForward()` when you need incremental output. Use `forward()` when the caller needs one parsed result object.

## Common Patterns

- Inline a string signature for small tasks.
- Pass a reusable `s()` signature when the contract is shared.
- Add tools when the program needs host data or side-effect boundaries.
- Add validation through fluent fields or Standard Schema where supported.
- Add assertions for whole-output invariants that should retry with feedback.
- Add streaming assertions for unsafe partial text.
- Use field processors for post-processing or streaming transforms.

### Tool-backed generation

{{axToolsExample}}

### MCP-backed generation

MCP servers become ordinary Ax functions after initialization. Use this when a direct `ax()` program needs a small set of external tools, prompts, or resources but does not need a full agent loop.

{{axMCPExample}}

For large MCP servers, keep the direct `ax()` path narrow. Prefer an agent with discovery when the server exposes many tools or when the model must plan multiple calls.

### Streaming output

{{axStreamingExample}}

## Production Notes

Keep signatures small and specific. Put provider and model policy in `ai()` or forward options. Trace parse failures, retries, tool calls, max-step exits, token usage, and final parsed output shape. For tasks that need planning, memory, clarification, or delegation, move up to `agent()`.

See [ax() API]({{langRoot}}/api/ax/), [Tools]({{langRoot}}/concepts/tools/), [Signatures]({{langRoot}}/concepts/signatures/), and [MCP]({{langRoot}}/concepts/mcp/).
