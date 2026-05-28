# AxIR Ax Dialects

Ax dialects are the MLIR-like high-level layer. They preserve Ax runtime meaning
until staged lowering.

- `ax.api`: public API declarations such as `ai`, `s`, `f`, `fn`, `ax`,
  `AxAIService`, `AxBaseAI`, `AxSignature`, `AxGen`.
- `ax.signature`: field model, string signature grammar, fluent field builder,
  duplicate-field rules.
- `ax.schema`: JSON schema conversion and nested object shape.
- `ax.validate`: required/optional/null behavior, constraints, media rules,
  output validation, internal stripping.
- `ax.template`: prompt section assembly and template render conformance.
- `ax.ai`: provider-neutral service contract, request/response records, model
  config, embeddings, usage, errors, and AI client compatibility interface.
- `ax.tool`: tool builder, host handler interface, tool result normalization.
- `ax.gen`: generation loop, structured output, tool loop, retries.
- `ax.stream`: streaming fold semantics.
- `ax.provider`: OpenAI-compatible adapter and capability checks.
- `ax.agent`: reserved public stubs only in this milestone.

The `core_kind` attribute says how an Ax operation lowers to Core IR. Backends
consume lowered Core IR, not raw Ax dialect operations.

The Python AxAI + AxGen beta slice currently requires these semantic operations
to be present in the lowered bundle:

- `ai_factory`
- `select_model`
- `merge_model_config`
- `validate_chat_request`
- `build_chat_request`
- `normalize_chat_response`
- `normalize_stream_delta`
- `build_embed_request`
- `normalize_embed_response`
- `record_ai_metrics`
- `parse_signature`
- `to_json_schema`
- `render_prompt`
- `build_gen_chat_request`
- `execute_tool_call`
- `validate_output`
- `strip_internal_fields`
- `fold_stream`
- `forward`
