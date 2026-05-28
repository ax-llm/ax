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
- `ax.agent`: portable pipeline/runtime alpha over AxGen stages, including
  context-field routing, language-agnostic runtime metadata,
  discovery/delegation policy, final/clarification protocol normalization,
  chat-log aggregation, optimizer-facing metadata, runtime-session lifecycle
  ordering, actor-step action logs, `agent.test(...)`, and minimal state helpers.

The `core_kind` attribute says how an Ax operation lowers to Core IR. Backends
consume lowered Core IR, not raw Ax dialect operations.

The executable AxAI + AxGen slice currently requires these semantic operations
to be present in the lowered bundle for Python, Java, and C++:

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
- `agent_factory`
- `agent_forward`
- `normalize_agent_runtime`
- `normalize_agent_policy`
- `normalize_agent_callable_inventory`
- `split_agent_callable_inventory`
- `render_agent_discovery_catalog`
- `agent_discover`
- `normalize_agent_final_payload`
- `normalize_agent_clarification_payload`
- `agent_optimizer_metadata`
- `agent_export_runtime_state`
- `agent_restore_runtime_state`
- `agent_runtime_build_globals`
- `agent_runtime_create_session`
- `agent_runtime_execute_step`
- `normalize_agent_runtime_step_result`
- `agent_runtime_test`
- `agent_runtime_export_session_state`
- `agent_runtime_restore_session_state`
- `split_context_values`
- `normalize_agent_completion_payload`
- `throw_agent_clarification`
- `merge_agent_chat_log`
- `merge_agent_usage`

The Ax dialects may evolve faster than Core. When a dialect operation becomes
observable runtime behavior, add a fixture first, lower it into Core-owned
symbols, and make each executable backend consume the same lowered contract.
