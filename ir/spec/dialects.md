# AxIR Ax Dialects

Ax dialects are the MLIR-like high-level layer. They preserve Ax runtime meaning
until staged lowering.

- `ax.api`: public API declarations such as `ai`, `s`, `f`, `fn`, `ax`,
  `AxAIService`, `AxBaseAI`, `AxSignature`, `AxGen`.
- `ax.program`: the shared Ax program contract used by AxGen, AxFlow, and
  AxAgent. It keeps common program metadata, trace events, demos/examples,
  usage/chat-log aggregation, optimizer component shape, and evaluation hooks
  semantic without becoming a large user-facing base class.
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
  Volatile actor decisions live in the versioned policy registry: actor-visible
  primitives, protocol-only actions, runtime globals, and host boundaries are
  modeled separately so target runtimes do not hard-code today's prompt policy.
- `ax.optimize`: prompt-level optimization contract. It models optimizable
  components, target selection, component-map application, eval prediction
  shape, and portable optimized artifacts. It deliberately does not encode GEPA
  or any other optimizer algorithm; optimizers plug in through a host/runtime
  engine boundary.
- `ax.flow`: AxFlow as an Ax/DSPy program graph. It models graph inputs, state,
  step nodes, dependency edges, node result fields, actual-input cache keys,
  `.returns()` projection, planner barriers, and aggregation of child-program
  traces, usage, and chat logs.

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
- `agent_policy_registry`
- `select_actor_primitives`
- `select_protocol_actions`
- `select_runtime_globals`
- `validate_policy_reserved_names`
- `render_actor_primitive_guidance`
- `record_policy_event`
- `normalize_policy_action_result`
- `normalize_agent_callable_inventory`
- `split_agent_callable_inventory`
- `render_agent_discovery_catalog`
- `agent_discover`
- `agent_recall`
- `agent_used`
- `agent_execute_callable`
- `agent_append_guidance`
- `agent_begin_trace`
- `agent_record_trace_event`
- `agent_finalize_trace`
- `agent_export_trace`
- `agent_replay_trace`
- `normalize_agent_final_payload`
- `normalize_agent_clarification_payload`
- `agent_optimizer_metadata`
- `optimization_component`
- `optimized_artifact`
- `validate_optimization_component_map`
- `validate_optimized_artifact`
- `serialize_optimized_artifact`
- `deserialize_optimized_artifact`
- `optimization_changed_components`
- `filter_optimization_components`
- `build_optimizer_request`
- `normalize_optimization_dataset`
- `normalize_optimization_metric_scores`
- `scalarize_optimization_scores`
- `adjust_optimization_score_for_actions`
- `build_optimization_judge_payload`
- `build_optimization_eval_row`
- `build_optimization_eval_result`
- `build_agent_eval_prediction`

`optimized_artifact` is the stable persistence boundary for generated
runtimes. AxIR owns artifact validation, component-map compatibility,
provenance/evidence serialization, and apply/rollback safety; optimizer engines
own only proposal/search behavior through `OptimizerEngine.optimize(request,
evaluator)`. GEPA-compatible engines consume the same request, evaluator, and
evidence shapes as any other prompt optimizer.
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
- `program_descriptor`
- `program_trace_event`
- `flow_factory`
- `flow_step`
- `flow_add_step`
- `flow_set_returns`
- `flow_plan`
- `flow_cache_key`
- `flow_forward`

The exported AxAgent trace is the canonical optimizer/replay artifact. It is a
JSON-compatible run record with normalized stage, runtime, discovery, recall,
usage, callable, guidance, status, final/clarification, error, usage, and state
events. Replay is fixture-grade in this milestone: it matches trace events and
scripted host-boundary fixtures without invoking real providers or sandboxes.

The optimization artifact is the canonical prompt-optimizer artifact. It is a
JSON-compatible record containing optimizer identity, a component map, optional
demos, scores/stats, and metadata. Generated targets may expose idiomatic
optimizer APIs, but the request/response envelopes stay JSON-compatible so GEPA,
deterministic search, or future external optimizers can share the same contract.
Candidate evaluation is a host-boundary-assisted Core contract: Core normalizes
datasets, applies component maps temporarily, shapes metric/judge payloads, and
restores program state after rollouts; target-native optimizer engines decide
which candidates to request.

The Ax dialects may evolve faster than Core. When a dialect operation becomes
observable runtime behavior, add a fixture first, lower it into Core-owned
symbols, and make each executable backend consume the same lowered contract.
