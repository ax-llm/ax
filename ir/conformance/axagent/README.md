# AxAgent Conformance

Fixtures in this directory cover the portable AxAgent pipeline/runtime alpha.
They are focused on deterministic wiring: context-field routing,
distiller/executor/responder stage calls, language-agnostic runtime metadata,
discovery/delegation policy, callable inventory normalization, effect-only
`discover(...)`, completion payload normalization, clarification errors,
chat-log aggregation, optimizer-facing metadata, runtime session lifecycle,
`agent.test(...)`, single actor-step execution, action-log/status records,
reserved runtime globals, session export/restore/close, and minimal state
handling.

Runtime fixtures use scripted generated `AxCodeRuntime`/`AxCodeSession`
implementations. They validate the portable protocol without requiring Python,
Java, C++, or JavaScript interpreters inside AxIR itself.
