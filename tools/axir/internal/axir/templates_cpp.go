package axir

const cppHeader = `#pragma once

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdlib>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <iomanip>
#include <initializer_list>
#include <map>
#include <memory>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace ax {

struct Value;
using Array = std::vector<Value>;
using Object = std::map<std::string, Value>;
class AIClient;
class Transport;
class Tool;
class AxMemory;
class AxProgram;
class AxGen;
class AxAgent;
class AxFlow;
class AxCodeRuntime;
class AxCodeSession;
class RuntimeProtocolClient;
class RuntimeProtocolSession;
class RuntimeTransport;
class AxAIService;
class OpenAICompatibleClient;
class OpenAIResponsesClient;
class GoogleGeminiClient;
class AnthropicClient;
class AxGEPA;
class OptimizerEngine;
class OptimizerEvaluator;

struct Value {
  std::variant<std::nullptr_t, bool, double, std::string, std::shared_ptr<Array>, std::shared_ptr<Object>> data;
  Value();
  Value(std::nullptr_t);
  Value(bool value);
  Value(int value);
  Value(long value);
  Value(double value);
  Value(const char* value);
  Value(std::string value);
  Value(Array value);
  Value(Object value);
  static Value array();
  static Value object();
  bool is_null() const;
  bool is_bool() const;
  bool is_number() const;
  bool is_string() const;
  bool is_array() const;
  bool is_object() const;
};

class AxError : public std::runtime_error {
 public:
  std::string category;
  std::string type;
  int status;
  std::string code;
  bool retryable;
  AxError(std::string category, std::string message);
  AxError(std::string category, std::string message, std::string type, int status = 0,
          std::string code = "", bool retryable = false);
};

struct Core {
  static bool truthy(const Value& value);
  static Value truthy_value(Value value);
  static Value not_(Value value);
  static Value and_(Value left, Value right);
  static Value or_(Value left, Value right);
  static Value eq(Value left, Value right);
  static Value ne(Value left, Value right);
  static Value lt(Value left, Value right);
  static Value lte(Value left, Value right);
  static Value gt(Value left, Value right);
  static Value gte(Value left, Value right);
  static Value add(Value left, Value right);
  static Value mul(Value left, Value right);
  static Value div(Value left, Value right);
  static Value contains(Value container, Value item);
  static Value len(Value value);
  static Value is_none(Value value);
  static Value is_not_none(Value value);
  static Value none();
  static Value coalesce(Value value, Value fallback);
  static Value map_merge(Value left, Value right);
  static Value get(Value target, Value key, Value default_value = Value());
  static void set(Value& target, Value key, Value value);
  static void append(Value& target, Value value);
  static Array iter(Value value);
  static Value map_contains(Value values, Value key);
  static Value map_get(Value values, Value key);
  static Value map_delete(Value values, Value key);
  static Value map_update(Value target, Value values);
  static Value map_keys(Value values);
  static Value map_values(Value values);
  static Value list_get(Value values, Value index, Value default_value);
  static Value type_is(Value value, Value type_name);
  static Value regex_match(Value pattern, Value value);
  static Value string_trim(Value value);
  static Value string_join(Value sep, Value values);
  static Value string_lower(Value value);
  static Value string_lower_camel(Value values);
  static Value string_title_from_camel(Value value);
  static Value string_ends_with(Value value, Value suffix);
  static Value string_starts_with(Value value, Value prefix);
  static Value string_replace(Value value, Value old_value, Value new_value);
  static Value string_slice(Value value, Value start, Value end = Value());
  static Value string_remove_suffix(Value value, Value suffix);
  static Value string_words(Value value);
  static Value string_default_if_empty(Value value, Value fallback);
  static Value string_format(Value templ, Value a = Value(), Value b = Value(), Value c = Value());
  static Value string_split(Value value, Value sep);
  static Value string_split_once(Value value, Value sep);
  static Value string_split_trim_nonempty(Value value, Value sep);
  static Value string_find_outside_quotes(Value text, Value needle);
  static Value string_split_outside_quotes(Value text, Value sep);
  static Value string_consume_optional_quoted_prefix(Value text);
  static Value string_extract_quoted_suffix(Value text);
  static Value string_str(Value value);
  static Value regex_replace(Value pattern, Value repl, Value value);
  static Value sorted_strings(Value values);
  static Value json_parse(Value value);
  static Value json_stringify(Value value);
  static Value json_stable_stringify(Value value);
  static Value json_pretty(Value value);
  static Value signature_error(Value message);
  static Value validation_error(Value message);
  static Value runtime_error(Value message);
  static Value ai_error_response(Value message, Value response_body = Value());
  static Value ai_error_refusal(Value message, Value response_body);
  static Value ai_error_stream(Value message, Value response_body, Value retryable);
  static Value ai_error_unsupported(Value message);
  static Value ai_error_auth(Value message, Value status, Value code, Value response_body, Value request);
  static Value ai_error_timeout(Value message, Value status, Value code, Value response_body, Value request, Value retryable);
  static Value ai_error_status(Value message, Value status, Value code, Value response_body, Value request, Value retryable);
  static Value exception_value(const std::exception& error);
  static Value exception_message(Value error);
  static AxError as_error(Value error);
  static Value coerce_chat_request(Value request);
  static Value client_ref(AIClient& client);
  static Value agent_stage_ref(AxProgram& stage);
  static Value code_runtime_ref(AxCodeRuntime& runtime);
  static Value object_call_method(Value target, Value method_name, Value arg = Value());
  static Value program_components(Value program);
  static Value program_apply_components(Value program, Value component_map);
  static Value ai_complete_once(Value client, Value request);
  static Value retry_sleep(Value attempt);
  static Value tool_invoke(Value fn, Value params);
  static Value legacy_response_to_chat_response(Value raw);
  static Value record_new(Value name, Value values);
  static Value field_item(Value field);
  static Value fields_from_map(Value fields);
  static Value description_append(Value base, Value hint);
  static Value url_valid(Value value);
  static Value valid_image(Value value);
  static Value valid_audio(Value value);
  static Value valid_file(Value value);
  static Value valid_url_shape(Value value);
  static Value template_parse(Value source, Value context);
  static Value template_render_tree(Value nodes, Value vars, Value source, Value context);
  static Value template_collect_vars(Value nodes);
  static Value template_validate(Value source, Value context, Value required);
  static Value prompt_structured(Value signature, Value values, Value functions, Value options);
  static Value prompt_user_content(Value signature, Value values);
  static Value axgen_render_examples(Value gen);
  static Value axgen_render_demos(Value gen);
  static Value axgen_apply_field_processors(Value gen, Value output);
  static Value axgen_run_assertions(Value gen, Value output);
  static Value axgen_record_trace(Value gen, Value input, Value output, Value status);
  static Value axgen_should_continue_steps(Value gen, Value calls);
  static Value axgen_apply_context_cache(Value gen, Value messages, Value options);
  static Value axgen_memory_add_request(Value gen, Value messages);
  static Value axgen_memory_add_response(Value gen, Value request, Value response);
  static Value axgen_memory_add_function_result(Value gen, Value call, Value result, Value ok);
  static Value axgen_memory_add_correction(Value gen, Value response, Value error);
  static Value axgen_memory_cleanup_corrections(Value gen);
  static Value axgen_record_chat_log(Value gen, Value request, Value response);
  static Value axgen_record_function_call(Value gen, Value call, Value result, Value status);
  static Value agent_stage_forward(Value stage, Value client, Value values, Value options);
  static Value agent_stage_chat_log(Value stage);
  static Value agent_stage_usage(Value stage);
  static Value agent_stage_traces(Value stage);
  static Value agent_clarification_error(Value payload, Value state);
  static Value agent_runtime_create_session(Value runtime, Value globals, Value options);
  static Value agent_runtime_execute(Value session, Value code, Value options);
  static Value agent_runtime_inspect(Value session, Value options);
  static Value agent_runtime_export_state(Value session, Value options);
  static Value agent_runtime_restore_state(Value session, Value snapshot, Value options);
  static Value agent_runtime_close(Value session);
  static Value agent_memory_search(Value state, Value searches, Value already_loaded);
  static Value agent_skill_search(Value state, Value searches);
  static Value agent_callable_invoke(Value state, Value request, Value options);
  static Value stream_event_content_parts(Value event);
  static Value _normalize_agent_string_list(Value value, Value label);
  static Value _normalize_agent_discover_request(Value state, Value request);
  static Value _agent_append_unique_by_field(Value items, Value item, Value field);
  static Value _agent_render_discovered_tool_docs(Value docs);
  static Value _agent_render_loaded_skills(Value skills);
  static Value _agent_recall(Value state, Value request);
  static Value _agent_merge_memory_results(Value existing, Value incoming);
  static Value _normalize_agent_recall_request(Value state, Value request);
  static Value _agent_used(Value state, Value request, Value stage);
  static Value _normalize_agent_used_request(Value request, Value default_stage);
  static Value _agent_append_guidance(Value state, Value payload);
  static Value _normalize_agent_guidance_payload(Value value, Value triggered_by);
  static Value _agent_execute_callable(Value state, Value request, Value options);

  static Value _signature_parse_fields_impl(Value text, Value output);
  static Value _signature_validate_field_shape_impl(Value field, Value output, Value nested);
  static Value _signature_parse_field_impl(Value raw, Value output);
  static Value _signature_parse_impl(Value signature);
  static Value _signature_validate_impl(Value signature);
  static Value parse_signature(Value signature);
  static Value validate_signature(Value signature);
  static Value _schema_required_impl(Value field, Value options);
  static Value _schema_flexible_json_as_string_impl(Value typ, Value options);
  static Value _schema_json_type_impl(Value type_name);
  static Value _schema_enhance_description_impl(Value schema, Value typ);
  static Value _schema_apply_constraints_impl(Value schema, Value typ);
  static Value _schema_nullable_optional_impl(Value schema, Value field, Value options);
  static Value _schema_object_from_fields_impl(Value fields_map, Value is_nested, Value options);
  static Value _schema_field_schema_impl(Value field, Value is_nested, Value options);
  static Value _schema_to_json_schema_impl(Value fields, Value schema_title, Value options);
  static Value _validate_string_constraints_impl(Value value, Value field);
  static Value _validate_number_constraints_impl(Value value, Value field);
  static Value _validate_fields_impl(Value fields, Value values, Value context);
  static Value _validate_output_impl(Value fields, Value values);
  static Value _validate_value_impl(Value field, Value value, Value path);
  static Value _strip_internal_fields_impl(Value fields, Value values);
  static Value to_json_schema(Value fields, Value title, Value options);
  static Value validate_fields(Value fields, Value values, Value context);
  static Value validate_output(Value fields, Value values);
  static Value validate_value(Value field, Value value, Value path);
  static Value strip_internal(Value fields, Value values);
  static Value _template_parse_impl(Value template_, Value context);
  static Value _template_render_tree_impl(Value nodes, Value vars, Value source, Value context);
  static Value _template_collect_vars_impl(Value nodes);
  static Value _template_validate_impl(Value source, Value context, Value required_variables);
  static Value _prompt_structured_impl(Value signature, Value values, Value functions, Value options);
  static Value _prompt_user_content_impl(Value signature, Value values);
  static Value _prompt_messages_impl(Value system, Value user);
  static Value render_template_content(Value source, Value vars, Value context);
  static Value collect_template_variable_names(Value source, Value context);
  static Value validate_prompt_template_syntax(Value source, Value context, Value required_variables);
  static Value render_prompt(Value signature, Value values, Value functions, Value options);
  static Value _tool_spec_impl(Value fn);
  static Value _function_call_mode_impl(Value mode);
  static Value _build_gen_chat_request(Value gen, Value messages, Value options);
  static Value _complete_with_retries_impl(Value client, Value request, Value retries);
  static Value _parse_output_impl(Value content);
  static Value _set_examples(Value gen, Value examples);
  static Value _set_demos(Value gen, Value demos);
  static Value _render_examples(Value gen);
  static Value _render_demos(Value gen);
  static Value _apply_field_processors(Value gen, Value output);
  static Value _run_assertions(Value gen, Value output);
  static Value _append_assertion_retry_messages(Value messages, Value response, Value error);
  static Value _record_trace(Value gen, Value input, Value output, Value status);
  static Value _should_continue_steps(Value gen, Value calls);
  static Value _response_function_calls_impl(Value response);
  static Value _completion_call_to_chat_impl(Value call);
  static Value _append_tool_call_messages_impl(Value messages, Value response, Value calls);
  static Value _tool_result_message_impl(Value call, Value result);
  static Value _tool_error_message_impl(Value call, Value error);
  static Value _append_validation_retry_messages_impl(Value messages, Value response, Value error);
  static Value _execute_tool_call(Value functions, Value call);
  static Value _forward_impl(Value gen, Value client, Value values, Value options);
  static Value _stream_event_content_parts_impl(Value event);
  static Value fold_stream(Value events);
  static Value normalize_token_usage(Value usage);
  static Value _ai_model_usage_impl(Value ai_name, Value model, Value usage);
  static Value merge_model_config(Value base, Value override_, Value options);
  static Value validate_chat_request(Value request);
  static Value chat_response_to_completion(Value response);
  static Value _openai_finish_reason_impl(Value value);
  static Value _openai_tool_call_to_provider_impl(Value call);
  static Value _openai_content_part_impl(Value part);
  static Value _openai_message_impl(Value message);
  static Value _openai_tool_spec_impl(Value fn);
  static Value _openai_copy_config_key_impl(Value payload, Value model_config, Value source, Value target);
  static Value _openai_apply_model_config_impl(Value payload, Value model_config);
  static Value _openai_normalize_tool_calls_impl(Value calls);
  static Value _openai_normalize_choice_impl(Value choice, Value raw);
  static Value _openai_stream_choice_impl(Value choice, Value index_ids);
  static Value openai_build_chat_request(Value request);
  static Value openai_build_embed_request(Value request);
  static Value openai_normalize_chat_response(Value raw);
  static Value openai_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value openai_normalize_stream_delta(Value raw, Value state);
  static Value openai_normalize_stream_delta(Value raw, Value state, Value ai_name, Value model);
  static Value openai_normalize_embed_response(Value raw);
  static Value openai_normalize_embed_response(Value raw, Value ai_name, Value model);
  static Value openai_normalize_error(Value status, Value body, Value request);
  static Value provider_normalize_profile(Value profile);
  static Value provider_profile_registry();
  static Value provider_resolve_profile(Value profile);
  static Value provider_model_catalog_summary();
  static Value _provider_model_catalog_registry();
  static Value provider_model_catalog(Value options);
  static Value provider_route_request_requirements(Value request);
  static Value _provider_features_support(Value features, Value path);
  static Value _provider_route_score(Value provider, Value requirements);
  static Value provider_route_recommendation(Value providers, Value request, Value options);
  static Value _provider_route_any_supports(Value providers, Value path);
  static Value provider_route_validation(Value providers, Value request, Value processing, Value options);
  static Value provider_balancer_retry_policy(Value options);
  static Value provider_balancer_metric_score(Value metrics);
  static Value provider_balancer_candidate_allowed(Value features, Value request);
  static Value provider_routing_stats(Value providers);
  static Value provider_descriptor(Value profile);
  static Value provider_operation_descriptor(Value profile, Value operation);
  static Value provider_build_chat_request(Value profile, Value request);
  static Value _provider_apply_openai_compatible_profile_quirks(Value profile, Value payload, Value request);
  static Value _provider_apply_deepseek_chat_quirks(Value payload, Value model_config);
  static Value _provider_apply_mistral_chat_quirks(Value payload);
  static Value _provider_apply_grok_chat_quirks(Value payload, Value request, Value model_config);
  static Value provider_build_embed_request(Value profile, Value request);
  static Value provider_normalize_chat_response(Value profile, Value raw, Value ai_name, Value model);
  static Value provider_normalize_stream_delta(Value profile, Value raw, Value state, Value ai_name, Value model);
  static Value provider_normalize_embed_response(Value profile, Value raw, Value ai_name, Value model);
  static Value provider_build_transcribe_request(Value profile, Value request);
  static Value provider_build_speak_request(Value profile, Value request);
  static Value provider_normalize_transcribe_response(Value profile, Value raw);
  static Value provider_normalize_speak_response(Value profile, Value raw, Value request);
  static Value provider_normalize_realtime_event(Value profile, Value event, Value state, Value ai_name, Value model);
  static Value openai_responses_build_chat_request(Value request);
  static Value _openai_responses_apply_model_config_impl(Value payload, Value model_config);
  static Value _openai_responses_tool_spec_impl(Value fn);
  static Value _openai_responses_input_item_impl(Value message);
  static Value _openai_responses_content_parts_impl(Value content, Value role);
  static Value _openai_responses_content_part_impl(Value part, Value role);
  static Value openai_responses_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value _openai_responses_merge_output_item_impl(Value result, Value item);
  static Value _openai_responses_content_to_text_impl(Value content);
  static Value _openai_responses_extract_citations_impl(Value content);
  static Value _openai_responses_function_call_impl(Value item);
  static Value openai_responses_normalize_stream_delta(Value event, Value state, Value ai_name, Value model);
  static Value openai_responses_build_transcribe_request(Value request);
  static Value openai_responses_build_speak_request(Value request);
  static Value openai_responses_normalize_realtime_event(Value event, Value state, Value ai_name, Value model);
  static Value gemini_build_chat_request(Value request);
  static Value _gemini_apply_model_config_impl(Value payload, Value model_config);
  static Value _gemini_message_impl(Value message);
  static Value _gemini_content_parts_impl(Value content);
  static Value _gemini_content_part_impl(Value part);
  static Value _gemini_function_declaration_impl(Value fn);
  static Value _gemini_tool_config_impl(Value request);
  static Value gemini_build_embed_request(Value request);
  static Value gemini_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value _gemini_merge_response_part_impl(Value result, Value text_parts, Value function_calls, Value part);
  static Value _gemini_extract_citations_impl(Value candidate);
  static Value _gemini_usage_impl(Value usage);
  static Value gemini_normalize_embed_response(Value raw, Value ai_name, Value model);
  static Value anthropic_build_chat_request(Value request);
  static Value _anthropic_apply_model_config_impl(Value payload, Value model_config, Value model);
  static Value _anthropic_thinking_config_impl(Value model, Value level);
  static Value _anthropic_message_impl(Value message);
  static Value _anthropic_content_parts_impl(Value content);
  static Value _anthropic_content_part_impl(Value part);
  static Value _anthropic_tool_spec_impl(Value fn);
  static Value _anthropic_tool_choice_impl(Value request);
  static Value anthropic_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value _anthropic_merge_response_block_impl(Value text_parts, Value function_calls, Value thought_parts, Value thought_blocks, Value citations, Value block);
  static Value _anthropic_append_citations_impl(Value out, Value block);
  static Value _anthropic_finish_reason_impl(Value reason);
  static Value _anthropic_usage_impl(Value usage);
  static Value anthropic_normalize_stream_delta(Value event, Value state, Value ai_name, Value model);
  static Value build_chat_request(Value service, Value request, Value options);
  static Value normalize_chat_response(Value raw);
  static Value normalize_stream_delta(Value raw, Value state);
  static Value build_embed_request(Value service, Value request, Value options);
  static Value normalize_embed_response(Value raw);
  static Value _agent_reserved_runtime_names();
  static Value _agent_runtime_language_tokens(Value language);
  static Value _agent_runtime_language_alias_key(Value tokens);
  static Value _agent_runtime_is_javascript_alias(Value alias_key);
  static Value _agent_runtime_code_field_name(Value tokens, Value is_javascript);
  static Value _agent_runtime_code_fence_language(Value tokens, Value alias_key, Value is_javascript);
  static Value _normalize_agent_runtime(Value options);
  static Value _normalize_agent_policy(Value options);
  static Value _agent_policy_flags(Value options);
  static Value _agent_policy_action(Value id, Value category, Value kind, Value stages, Value availability, Value effect, Value host_boundary, Value actor_visible);
  static Value _agent_policy_vocabulary_registry();
  static Value _agent_context_policy_registry();
  static Value _agent_context_policy_migration_error(Value key);
  static Value _agent_context_budget_profile(Value budget);
  static Value _agent_context_preset_profile(Value preset);
  static Value _agent_context_event_name(Value stable_id);
  static Value _agent_context_event_reason(Value stable_id);
  static Value _agent_policy_registry(Value policy, Value flags);
  static Value _policy_flag_enabled(Value flags, Value condition);
  static Value _select_actor_primitives(Value registry, Value stage);
  static Value _select_protocol_actions(Value registry);
  static Value _select_runtime_globals(Value registry);
  static Value _validate_policy_reserved_names(Value registry, Value name);
  static Value _render_actor_primitive_guidance(Value registry, Value stage);
  static Value _record_policy_event(Value state, Value action, Value payload);
  static Value _normalize_policy_action_result(Value action, Value payload);
  static Value _build_agent_actor_prompt_policy(Value state);
  static Value _resolve_agent_context_policy(Value options);
  static Value _resolve_agent_executor_model_policy(Value options);
  static Value _select_agent_executor_model(Value policy, Value actor_model_state);
  static Value _agent_compute_effective_chat_budget(Value base_budget, Value fixed_overhead_chars);
  static Value _agent_action_log_char_count(Value entries);
  static Value _agent_compute_dynamic_runtime_chars(Value entries, Value target_prompt_chars, Value max_runtime_chars);
  static Value _agent_context_pressure(Value mutable_prompt_chars, Value effective_budget_chars, Value checkpoint_active);
  static Value _agent_render_context_pressure(Value pressure);
  static Value _agent_smart_stringify(Value value, Value max_chars);
  static Value _agent_record_context_event(Value state, Value event);
  static Value _agent_entry_turn(Value entry, Value fallback);
  static Value _agent_entry_is_error(Value entry);
  static Value _agent_entry_summary(Value entry, Value fallback_turn);
  static Value _agent_entry_callables_text(Value entry);
  static Value _agent_distill_structured_action_output(Value output);
  static Value _agent_render_full_action_entry(Value state, Value entry);
  static Value _agent_render_compact_action_entry(Value entry, Value turn, Value reason);
  static Value _agent_fallback_checkpoint_summary(Value entries, Value turns);
  static Value _agent_build_deterministic_tombstone(Value error_entry, Value resolution_entry);
  static Value _agent_apply_context_management(Value state);
  static Value _agent_working_code_state(Value entries, Value turns);
  static Value _agent_refresh_checkpoint_state(Value state);
  static Value _agent_build_action_log_parts(Value state, Value hygiene_mode);
  static Value _agent_render_runtime_state_summary(Value state, Value policy);
  static Value _agent_prepare_actor_context(Value state);
  static Value _agent_build_action_evidence_summary(Value state);
  static Value _agent_sanitize_action_log_entries(Value entries);
  static Value _agent_context_fixture_result(Value state, Value fixture);
  static Value _normalize_agent_callable(Value raw, Value namespace_);
  static Value _normalize_agent_group(Value raw);
  static Value _normalize_agent_callable_inventory(Value options);
  static Value _split_agent_callable_inventory(Value inventory);
  static Value _render_agent_discovery_catalog(Value split);
  static Value _agent_discover(Value state, Value request);
  static Value _normalize_agent_final_payload(Value value);
  static Value _normalize_agent_clarification_payload(Value value);
  static Value _agent_optimizer_metadata(Value state);
  static Value _agent_begin_trace(Value state, Value input);
  static Value _agent_record_trace_event(Value state, Value kind, Value payload);
  static Value _agent_normalize_host_boundary_event(Value boundary, Value request, Value result, Value status);
  static Value _agent_finalize_trace(Value state, Value status, Value output);
  static Value _agent_export_trace(Value state);
  static Value _agent_replay_trace(Value trace, Value fixtures);
  static Value _agent_export_runtime_state(Value state);
  static Value _agent_restore_runtime_state(Value state, Value snapshot);
  static Value _agent_runtime_build_globals(Value state, Value values);
  static Value _agent_runtime_sanitize_bindings(Value bindings);
  static Value _normalize_agent_runtime_snapshot(Value snapshot);
  static Value _agent_runtime_append_action_log(Value state, Value entry);
  static Value _normalize_agent_runtime_step_result(Value raw, Value code);
  static Value _agent_runtime_execution_options(Value state, Value options);
  static Value _agent_runtime_lifecycle_event(Value state, Value action, Value details);
  static Value _agent_runtime_create_session(Value state, Value runtime, Value globals, Value options);
  static Value _agent_runtime_execute_step(Value state, Value runtime, Value session, Value code, Value options);
  static Value _agent_runtime_inspect_state(Value state, Value session, Value options);
  static Value _agent_runtime_export_session_state(Value state, Value session, Value options);
  static Value _agent_runtime_restore_session_state(Value state, Value session, Value snapshot, Value options);
  static Value _agent_runtime_close_session(Value state, Value session);
  static Value _agent_runtime_test(Value state, Value runtime, Value code, Value values, Value options);
  static Value _agent_factory(Value signature, Value options);
  static Value _split_context_values(Value state, Value values);
  static Value _build_distiller_inputs(Value state, Value values);
  static Value _build_executor_inputs(Value state, Value values, Value distiller_payload);
  static Value _build_responder_inputs(Value state, Value values, Value executor_payload);
  static Value _normalize_agent_completion_payload(Value output);
  static Value _throw_agent_clarification(Value payload, Value state);
  static Value _merge_agent_chat_log(Value state, Value distiller, Value executor, Value responder);
  static Value _merge_agent_usage(Value state);
  static Value _agent_get_state(Value state);
  static Value _agent_set_state(Value state, Value runtime_state);
  static Value _agent_stage_options(Value state, Value stage, Value forward_options);
  static Value _extract_agent_runtime_code(Value state, Value executor_output);
  static Value _agent_forward(Value state, Value distiller, Value executor, Value responder, Value client, Value values, Value options);
  static Value _optimization_component(Value id, Value owner, Value kind, Value current, Value description, Value constraints, Value depends_on, Value preserve, Value format, Value validation);
  static Value _optimized_artifact(Value optimizer_name, Value optimizer_version, Value component_map, Value metadata);
  static Value _validate_optimization_component_value(Value component, Value value);
  static Value _validate_optimization_component_map(Value components, Value component_map);
  static Value _validate_optimized_artifact_provenance(Value artifact, Value components);
  static Value _validate_optimized_artifact(Value artifact, Value components);
  static Value _serialize_optimized_artifact(Value artifact);
  static Value _deserialize_optimized_artifact(Value text, Value components);
  static Value _optimization_changed_components(Value components, Value component_map);
  static Value _optimization_component_current_map(Value components);
  static Value _normalize_optimization_dataset(Value dataset);
  static Value _normalize_optimization_metric_scores(Value raw);
  static Value _scalarize_optimization_scores(Value scores, Value options);
  static Value _optimization_action_name_matches(Value expected, Value call);
  static Value _adjust_optimization_score_for_actions(Value score, Value task, Value prediction);
  static Value _map_optimization_judge_quality_to_score(Value quality);
  static Value _build_optimization_judge_payload(Value task, Value prediction, Value criteria);
  static Value _build_optimization_eval_row(Value task, Value prediction, Value scores, Value scalar, Value trace, Value error);
  static Value _build_optimization_eval_result(Value rows, Value candidate_map, Value phase);
  static Value _filter_optimization_components(Value components, Value target);
  static Value _build_optimizer_request(Value program_kind, Value components, Value dataset, Value options, Value trace);
  static Value _prepare_optimizer_run(Value program_kind, Value components, Value dataset, Value options, Value trace, Value evaluator_available);
  static Value _normalize_optimizer_engine_response(Value response, Value engine_name, Value engine_version, Value components);
  static Value _build_optimizer_evidence_batch(Value eval_result, Value components);
  static Value _build_agent_eval_prediction(Value output, Value action_log, Value usage, Value trace);
  static Value _program_descriptor(Value kind, Value id, Value metadata);
  static Value _program_trace_event(Value program_id, Value kind, Value payload);
  static Value _program_child_component_prefix(Value owner, Value node);
  static Value _program_prefix_component(Value component, Value owner, Value node);
  static Value _program_slice_component_map(Value component_map, Value prefix);
  static Value _flow_factory(Value options);
  static Value _flow_step(Value kind, Value name, Value program, Value options);
  static Value _flow_add_step(Value flow, Value step);
  static Value _flow_set_returns(Value flow, Value returns);
  static Value _flow_plan_entry(Value step, Value step_index);
  static Value _flow_plan_can_share_group(Value group, Value candidate);
  static Value _flow_plan(Value flow);
  static Value _flow_cache_key(Value values);
  static Value _flow_get_optimizable_components(Value flow);
  static Value _flow_apply_optimized_components(Value flow, Value component_map);
  static Value _flow_snapshot_components(Value flow);
  static Value _flow_restore_components(Value flow, Value snapshot);
  static Value _flow_evaluate_optimization(Value flow, Value client, Value dataset, Value candidate_map, Value options);
  static Value _flow_optimize_with(Value flow, Value dataset, Value options, Value evaluator_available);
  static Value _flow_cache_read_write(Value flow, Value values, Value options, Value mode, Value output);
  static Value _flow_check_abort(Value options, Value location);
  static Value _flow_project_returns(Value state, Value returns);
  static Value _flow_get_path(Value state, Value path);
  static Value _flow_record_child_chat_log(Value flow, Value node, Value program);
  static Value _flow_record_child_usage(Value flow, Value node, Value program);
  static Value _flow_record_child_traces(Value flow, Value node, Value program);
  static Value _flow_execute_program_node(Value flow, Value step, Value client, Value state, Value options);
  static Value _flow_execute_step(Value flow, Value step, Value plan_step, Value client, Value state, Value options);
  static Value _flow_merge_parallel_results(Value state, Value result);
  static Value _flow_execute_nested_steps(Value flow, Value client, Value steps, Value state, Value options);
  static Value _flow_execute_steps(Value flow, Value client, Value state, Value options);
  static Value _flow_forward(Value flow, Value client, Value values, Value options);
};

class AIClient {
 public:
  virtual ~AIClient() = default;
  virtual Value complete(Value request) = 0;
  virtual Value chat(Value request);
};

class AxAIService : public AIClient {
 public:
  ~AxAIService() override = default;
  virtual std::string get_id();
  virtual std::string get_name();
  Value chat(Value request) override;
  virtual Value chat(Value request, Value options);
  virtual std::vector<Value> stream(Value request);
  virtual Value embed(Value request, Value options);
  virtual Value embed(Value request) = 0;
  virtual Value transcribe(Value request);
  virtual Value transcribe(Value request, Value options);
  virtual Value speak(Value request);
  virtual Value speak(Value request, Value options);
  virtual Value get_features(Value model = Value());
  virtual Value get_model_list();
  virtual Value get_metrics();
  virtual std::function<void(std::string)> get_logger();
  virtual double get_estimated_cost(Value model_usage);
  virtual Value get_options();
  virtual void set_options(Value options);
  virtual Value get_last_used_chat_model();
  virtual Value get_last_used_embed_model();
  virtual Value get_last_used_model_config();
};

class AxBaseAI : public AxAIService {
 public:
  AxBaseAI(std::string name, std::string model, std::string embed_model,
           Value model_config = Value::object(), Value options = Value::object());
  Value chat(Value request) override;
  Value chat(Value request, Value options) override;
  Value complete(Value request) override;
  Value embed(Value request) override;
  Value embed(Value request, Value options) override;
  Value get_features(Value model = Value()) override;
  std::string get_id() override;
  std::string get_name() override;
  Value get_metrics() override;
  Value get_options() override;
  void set_options(Value options) override;
  Value get_last_used_chat_model() override;
  Value get_last_used_embed_model() override;
  Value get_last_used_model_config() override;

 protected:
  std::string name_;
  std::string model_;
  std::string embed_model_;
  Value model_config_;
  Value options_;
  Value last_used_chat_model_;
  Value last_used_embed_model_;
  Value last_used_model_config_;
  virtual Value do_chat(Value request, Value options) = 0;
  virtual Value do_embed(Value request, Value options) = 0;
};

Value get_supported_ai_models(Value options = Value::object());

class AxBalancer : public AxAIService {
 public:
  AxBalancer();
  explicit AxBalancer(std::vector<std::shared_ptr<AxAIService>> services, Value options = Value::object());
  std::string get_id() override;
  std::string get_name() override;
  Value get_model_list() override;
  Value get_features(Value model = Value()) override;
  Value chat(Value request) override;
  Value chat(Value request, Value options) override;
  Value embed(Value request) override;
  Value embed(Value request, Value options) override;
  Value transcribe(Value request) override;
  Value transcribe(Value request, Value options) override;
  Value speak(Value request) override;
  Value speak(Value request, Value options) override;
  Value get_metrics() override;
  std::function<void(std::string)> get_logger() override;
  double get_estimated_cost(Value model_usage) override;
  Value get_options() override;
  void set_options(Value options) override;
  Value get_last_used_chat_model() override;
  Value get_last_used_embed_model() override;
  Value get_last_used_model_config() override;
  Value complete(Value request) override;

 private:
  std::vector<std::shared_ptr<AxAIService>> services_;
  std::shared_ptr<AxAIService> current_service_;
  size_t current_service_index_ = 0;
  std::map<std::string, int> service_failures_;
  Value policy_ = Value::object();
  int max_retries_ = 3;
  void validate_models();
  bool can_retry_service(const std::shared_ptr<AxAIService>& service) const;
  void handle_failure(const std::shared_ptr<AxAIService>& service);
  void handle_success(const std::shared_ptr<AxAIService>& service);
  bool retryable(const AxError& error) const;
  std::vector<std::shared_ptr<AxAIService>> candidate_services(Value request);
  void reset();
};

class MultiServiceRouter : public AxAIService {
 public:
  MultiServiceRouter();
  explicit MultiServiceRouter(std::vector<std::shared_ptr<AxAIService>> services);
  explicit MultiServiceRouter(Value entries);
  std::string get_id() override;
  std::string get_name() override;
  Value get_model_list() override;
  Value get_features(Value model = Value()) override;
  Value chat(Value request) override;
  Value chat(Value request, Value options) override;
  Value embed(Value request) override;
  Value embed(Value request, Value options) override;
  Value transcribe(Value request) override;
  Value transcribe(Value request, Value options) override;
  Value speak(Value request) override;
  Value speak(Value request, Value options) override;
  Value get_metrics() override;
  std::function<void(std::string)> get_logger() override;
  double get_estimated_cost(Value model_usage) override;
  Value get_options() override;
  void set_options(Value options) override;
  Value get_last_used_chat_model() override;
  Value get_last_used_embed_model() override;
  Value get_last_used_model_config() override;
  Value complete(Value request) override;
  void set_service_entry(std::string key, Value entry);
  void set_service_entry(std::string key, std::shared_ptr<AxAIService> service, std::string description = "", bool is_internal = false);

 private:
  struct Entry {
    std::shared_ptr<AxAIService> service;
    std::string description;
    bool is_internal = false;
    Value model;
    Value embed_model;
  };
  std::map<std::string, Entry> services_;
  std::vector<std::string> service_keys_;
  std::shared_ptr<AxAIService> last_used_service_;
  Value options_ = Value::object();
};

class ProviderRouter {
 public:
  explicit ProviderRouter(Value config);
  ProviderRouter(std::vector<std::shared_ptr<AxAIService>> providers, Value routing = Value::object(), Value processing = Value::object());
  Value get_routing_recommendation(Value request);
  Value validate_request(Value request);
  Value get_routing_stats();
  Value chat(Value request, Value options = Value::object());

 private:
  std::vector<std::shared_ptr<AxAIService>> providers_;
  Value routing_;
  Value processing_;
  Value provider_records() const;
  std::shared_ptr<AxAIService> service_for_name(Value name) const;
};

class Transport {
 public:
  virtual ~Transport() = default;
  virtual Value call(Value request) = 0;
};

class OpenAICompatibleClient : public AxBaseAI {
 public:
  explicit OpenAICompatibleClient(Value options = Value::object(), Transport* transport = nullptr);
  std::vector<Value> stream(Value request) override;
  Value transcribe(Value request) override;
  Value speak(Value request) override;
  std::vector<Value> realtime(Value events);

 protected:
  OpenAICompatibleClient(std::string profile, std::string name, Value options, Transport* transport, std::string default_model, std::string default_embed_model);
  Value do_chat(Value request, Value options) override;
  Value do_embed(Value request, Value options) override;

 private:
  std::string profile_;
  std::string base_url_;
  std::string api_key_;
  Value descriptor_;
  std::string api_version_;
  double timeout_seconds_;
  Transport* transport_;
  Value request_json(const std::string& endpoint, Value payload, bool stream);
  Value request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key);
  std::string operation_path(const std::string& operation) const;
  std::string operation_path(const std::string& operation, Value model) const;
  Value headers() const;
  Value transport_result(Value result, Value request);
  std::vector<Value> iter_sse_json(Value raw);
};

class OpenAIResponsesClient : public OpenAICompatibleClient {
 public:
  explicit OpenAIResponsesClient(Value options = Value::object(), Transport* transport = nullptr);
};

class GoogleGeminiClient : public OpenAICompatibleClient {
 public:
  explicit GoogleGeminiClient(Value options = Value::object(), Transport* transport = nullptr);
};

class AnthropicClient : public OpenAICompatibleClient {
 public:
  explicit AnthropicClient(Value options = Value::object(), Transport* transport = nullptr);
};

class AzureOpenAIClient : public OpenAICompatibleClient {
 public:
  explicit AzureOpenAIClient(Value options = Value::object(), Transport* transport = nullptr);
};

class DeepSeekClient : public OpenAICompatibleClient {
 public:
  explicit DeepSeekClient(Value options = Value::object(), Transport* transport = nullptr);
};

class MistralClient : public OpenAICompatibleClient {
 public:
  explicit MistralClient(Value options = Value::object(), Transport* transport = nullptr);
};

class RekaClient : public OpenAICompatibleClient {
 public:
  explicit RekaClient(Value options = Value::object(), Transport* transport = nullptr);
};

class CohereClient : public OpenAICompatibleClient {
 public:
  explicit CohereClient(Value options = Value::object(), Transport* transport = nullptr);
};

class GrokClient : public OpenAICompatibleClient {
 public:
  explicit GrokClient(Value options = Value::object(), Transport* transport = nullptr);
};

class Tool {
 public:
  std::string id;
  std::string name;
  std::string description;
  Value parameters;
  Value args;
  Value returns;
  std::function<Value(Value)> handler;

  Tool(std::string name, std::string description, Value parameters = Value::object(),
       std::function<Value(Value)> handler = nullptr, Value args = Value::array(), Value returns = Value::array());
  Value value() const;
};

class AxMemory {
 public:
  AxMemory();
  AxMemory& add_request(Value messages);
  AxMemory& add_response(Value response);
  AxMemory& update_result(Value response);
  AxMemory& add_function_results(Value results);
  AxMemory& add_processor_output(Value output);
  AxMemory& add_correction(Value response, Value error_message);
  Value history() const;
  Value get_last() const;
  AxMemory& add_tag(const std::string& tag);
  AxMemory& rewind_to_tag(const std::string& tag);
  AxMemory& remove_by_tag(const std::string& tag);
  Value value() const;
  Value& value_ref();

 private:
  Value items_;
};

class AxProgram {
 public:
  virtual ~AxProgram() = default;
  virtual Value forward(AIClient& client, Value values, Value options = Value::object()) = 0;
  virtual Value get_optimizable_components() const { return Value::array(); }
  virtual AxProgram& apply_optimized_components(Value) { return *this; }
  virtual Value get_traces() const { return Value::array(); }
  virtual Value get_chat_log() const { return Value::array(); }
  virtual Value get_usage() const { return Value::object(); }
};

class AxGen : public AxProgram {
 public:
  explicit AxGen(Value signature, Value options = Value::object());
  Value forward(AIClient& client, Value values, Value options = Value::object());
  AxGen& add_tool(const Tool& tool);
  AxGen& set_examples(Value examples);
  AxGen& set_demos(Value demos);
  AxGen& add_assertion(Value assertion);
  AxGen& add_assertion(std::function<Value(Value)> assertion);
  AxGen& add_field_processor(std::string field, std::string op);
  AxGen& add_field_processor(std::string field, std::function<Value(Value)> processor);
  AxGen& on_function_call(std::function<void(Value)> hook);
  AxGen& set_stop_functions(Value names);
  AxGen& set_instruction(Value instruction);
  Value get_instruction() const;
  AxGen& clear_instruction();
  Value get_optimizable_components() const;
  AxGen& apply_optimized_components(Value component_map);
  AxGen& apply_optimization(Value artifact);
  Value evaluate_optimization(AIClient& client, Value dataset, Value candidate_map = Value::object(), Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, Value dataset, Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options = Value::object());
  Value get_traces() const;
  Value get_chat_log() const;
  Value get_function_call_traces() const;
  AxMemory& get_memory();
  Value value() const;

 private:
  Value state_;
  AxMemory memory_;
  void refresh_prompt_template();
};

class AxFlow : public AxProgram {
 public:
  explicit AxFlow(Value options = Value::object());
  AxFlow& execute(std::string name, AxProgram& program, Value options = Value::object());
  AxFlow& derive(std::string name, AxProgram& program, Value options = Value::object());
  AxFlow& map(std::string name, std::function<Value(Value)> mapper);
  AxFlow& map(std::string name, std::function<Value(Value)> mapper, Value options);
  AxFlow& branch(std::string name, std::function<Value(Value)> predicate, Value branches, Value options = Value::object());
  AxFlow& while_loop(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations = 100, Value options = Value::object());
  AxFlow& feedback(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations = 10, Value options = Value::object());
  AxFlow& node_extended(std::string name, Value base_signature, Value extensions = Value::object(), Value options = Value::object());
  AxFlow& nx(std::string name, Value base_signature, Value extensions = Value::object(), Value options = Value::object());
  AxFlow& parallel(Value steps);
  AxFlow& returns(Value spec);
  AxFlow& set_demos(Value demos);
  Value forward(AIClient& client, Value values, Value options = Value::object());
  Value streaming_forward(AIClient& client, Value values, Value options = Value::object());
  Value get_plan() const;
  Value get_traces() const;
  Value get_chat_log() const;
  Value get_usage() const;
  Value get_optimizable_components() const;
  AxFlow& apply_optimized_components(Value component_map);
  AxFlow& apply_optimization(Value artifact);
  Value evaluate_optimization(AIClient& client, Value dataset, Value candidate_map = Value::object(), Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, Value dataset, Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options = Value::object());
  Value value() const;
  AxFlow& add_raw_step(Value step);

 private:
  Value state_;
  AxFlow& add_step(Value kind, Value name, Value program, Value options);
};

Value flow_callback(std::function<Value(Value)> mapper);

class AxCodeSession {
 public:
  virtual ~AxCodeSession() = default;
  virtual Value execute(Value code, Value options = Value::object()) = 0;
  virtual Value inspect(Value options = Value::object()) {
    return Value("[runtime state inspection unavailable: runtime session does not implement inspect_globals()]");
  }
  virtual Value snapshot_globals(Value options = Value::object()) {
    throw AxError("runtime", "AxCodeSession.snapshot_globals() is required to export AxAgent state");
  }
  virtual Value patch_globals(Value snapshot, Value options = Value::object()) {
    throw AxError("runtime", "AxCodeSession.patch_globals() is required to restore AxAgent state");
  }
  virtual Value export_state(Value options = Value::object()) { return snapshot_globals(options); }
  virtual Value restore_state(Value snapshot, Value options = Value::object()) { return patch_globals(snapshot, options); }
  virtual Value close() = 0;
};

class AxCodeRuntime {
 public:
  virtual ~AxCodeRuntime() = default;
  virtual std::string language() const { return "JavaScript"; }
  virtual std::string usage_instructions() const { return ""; }
  virtual AxCodeSession* create_session(Value globals, Value options = Value::object()) = 0;
};

struct RuntimeCapabilities {
  bool inspect = true;
  bool snapshot = true;
  bool patch = true;
  bool abort = false;
  std::string language = "JavaScript";
  std::string usage_instructions = "";
  Value to_value() const;
};

struct RuntimeEnvelope {
  static Value result(Value value);
  static Value error(Value message, Value category = Value("runtime"));
  static Value session_closed(Value message = Value("session closed"));
  static Value timeout(Value message = Value("execution timed out"));
  static Value final_payload(std::initializer_list<Value> args);
  static Value final_payload(Value args);
  static Value ask_clarification(std::initializer_list<Value> args);
  static Value ask_clarification(Value args);
  static Value discover(Value request);
  static Value recall(Value request);
  static Value used(Value request, Value reason = Value(), Value stage = Value());
  static Value status(Value type, Value message = Value(""));
  static Value guide_agent(Value guidance, Value triggered_by = Value());
};

class RuntimeTransport {
 public:
  virtual ~RuntimeTransport() = default;
  virtual Value call(Value message) = 0;
};

class RuntimeProtocolClient : public AxCodeRuntime {
 public:
  explicit RuntimeProtocolClient(RuntimeTransport& transport);
  std::string language() const override { return "JavaScript"; }
  std::string usage_instructions() const override;
  AxCodeSession* create_session(Value globals, Value options = Value::object()) override;
  Value request(Value op, Value session_id = Value(), Value payload = Value::object(), bool throw_on_error = true);
  Value shutdown();

 private:
  RuntimeTransport& transport_;
  int next_id_ = 0;
  std::vector<std::unique_ptr<RuntimeProtocolSession>> sessions_;
};

class RuntimeProtocolSession : public AxCodeSession {
 public:
  RuntimeProtocolSession(RuntimeProtocolClient& client, Value session_id);
  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value close() override;

 private:
  RuntimeProtocolClient& client_;
  Value session_id_;
};

class OptimizerEvaluator {
 public:
  virtual ~OptimizerEvaluator() = default;
  virtual Value evaluate(Value candidate_map, Value options = Value::object()) = 0;
};

class OptimizerEngine {
 public:
  virtual ~OptimizerEngine() = default;
  virtual std::string name() const { return "host"; }
  virtual std::string version() const { return "host"; }
  virtual Value optimize(Value request) = 0;
  virtual Value optimize(Value request, OptimizerEvaluator* evaluator) { return optimize(std::move(request)); }
};

class AxGEPA : public OptimizerEngine {
 public:
  explicit AxGEPA(AIClient* reflection_client = nullptr, Value options = Value::object());
  std::string name() const override;
  std::string version() const override;
  Value optimize(Value request) override;
  Value optimize(Value request, OptimizerEvaluator* evaluator) override;

 private:
  AIClient* reflection_client_;
  Value options_;
  uint32_t rng_state_;
  Value selector_state_;
  double rand();
};

class AxAgent : public AxProgram {
 public:
  explicit AxAgent(Value signature, Value options = Value::object());
  Value forward(AIClient& client, Value values, Value options = Value::object());
  Value test(AxCodeRuntime& runtime, Value code, Value context_values = Value::object(), Value options = Value::object());
  Value execute_actor_step(AxCodeRuntime& runtime, Value code, Value values = Value::object(), Value options = Value::object());
  Value inspect_runtime(Value options = Value::object());
  Value export_session_state(Value options = Value::object());
  Value restore_session_state(Value snapshot, Value options = Value::object());
  Value close_runtime_session();
  Value get_state() const;
  void set_state(Value state);
  Value get_chat_log() const;
  Value get_action_log() const;
  Value get_trace() const;
  Value export_trace() const;
  Value replay_trace(Value trace, Value fixtures = Value::object()) const;
  Value get_usage() const;
  Value get_runtime_contract() const;
  Value get_policy() const;
  Value get_policy_registry() const;
  Value get_callable_inventory() const;
  Value get_discovery_catalog() const;
  Value discover(Value request);
  Value recall(Value request);
  Value used(Value id, Value reason = Value(""), Value stage = Value("executor"));
  Value invoke_callable(Value qualified_name, Value args = Value::object(), Value options = Value::object());
  Value export_runtime_state() const;
  Value restore_runtime_state(Value snapshot);
  Value get_optimizer_metadata() const;
  Value get_optimizable_components() const;
  AxAgent& apply_optimized_components(Value component_map);
  AxAgent& apply_optimization(Value artifact);
  Value evaluate_optimization_task(AIClient& client, Value task, Value options = Value::object());
  Value evaluate_optimization(AIClient& client, Value dataset, Value candidate_map = Value::object(), Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, Value dataset, Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options = Value::object());
  Value optimize(Value dataset = Value::array(), Value options = Value::object());

 private:
  Value state_;
  std::unique_ptr<AxGen> distiller_;
  std::unique_ptr<AxGen> executor_;
  std::unique_ptr<AxGen> responder_;
};

std::string stringify(const Value& value);
Value parse_json(const std::string& source);
bool equal(const Value& left, const Value& right);
std::string display(const Value& value);
Value object(std::initializer_list<std::pair<std::string, Value>> entries);
Value array(std::initializer_list<Value> entries);
Value s(const std::string& signature);
Value signature(const std::string& source);
AxGen ax(const std::string& signature, Value options = Value::object());
AxGen ax(const char* signature, Value options = Value::object());
AxGen ax(Value signature, Value options = Value::object());
AxAgent agent(const std::string& signature, Value options = Value::object());
AxAgent agent(const char* signature, Value options = Value::object());
AxAgent agent(Value signature, Value options = Value::object());
AxFlow flow(Value options = Value::object());
std::shared_ptr<AxAIService> ai(const std::string& provider, Value options = Value::object());
std::shared_ptr<AxAIService> ai(const char* provider, Value options = Value::object());
Value to_json_schema(Value fields, const std::string& title = "Schema", Value options = Value::object());
Value validate_output(Value fields, Value values);
Value strip_internal(Value fields, Value values);
Value render_prompt(Value signature, Value values, Value functions = Value::array(), Value options = Value::object());
Value fold_stream(Value events);

}  // namespace ax
`

const cppRuntime = `#include "ax.hpp"

#include <fstream>
#include <iostream>
#include <set>

namespace ax {

Value::Value() : data(nullptr) {}
Value::Value(std::nullptr_t) : data(nullptr) {}
Value::Value(bool value) : data(value) {}
Value::Value(int value) : data(static_cast<double>(value)) {}
Value::Value(long value) : data(static_cast<double>(value)) {}
Value::Value(double value) : data(value) {}
Value::Value(const char* value) : data(std::string(value == nullptr ? "" : value)) {}
Value::Value(std::string value) : data(std::move(value)) {}
Value::Value(Array value) : data(std::make_shared<Array>(std::move(value))) {}
Value::Value(Object value) : data(std::make_shared<Object>(std::move(value))) {}
Value Value::array() { return Value(Array{}); }
Value Value::object() { return Value(Object{}); }
bool Value::is_null() const { return std::holds_alternative<std::nullptr_t>(data); }
bool Value::is_bool() const { return std::holds_alternative<bool>(data); }
bool Value::is_number() const { return std::holds_alternative<double>(data); }
bool Value::is_string() const { return std::holds_alternative<std::string>(data); }
bool Value::is_array() const { return std::holds_alternative<std::shared_ptr<Array>>(data); }
bool Value::is_object() const { return std::holds_alternative<std::shared_ptr<Object>>(data); }

AxError::AxError(std::string category, std::string message)
    : AxError(std::move(category), std::move(message), "", 0, "", false) {}
AxError::AxError(std::string category, std::string message, std::string type_, int status_, std::string code_, bool retryable_)
    : std::runtime_error(std::move(message)),
      category(std::move(category)),
      type(std::move(type_)),
      status(status_),
      code(std::move(code_)),
      retryable(retryable_) {}

static std::map<std::string, AIClient*>& client_registry() {
  static std::map<std::string, AIClient*> clients;
  return clients;
}

static std::map<std::string, AxProgram*>& agent_stage_registry() {
  static std::map<std::string, AxProgram*> stages;
  return stages;
}

static std::map<std::string, AxCodeRuntime*>& code_runtime_registry() {
  static std::map<std::string, AxCodeRuntime*> runtimes;
  return runtimes;
}

static std::map<std::string, AxCodeSession*>& code_session_registry() {
  static std::map<std::string, AxCodeSession*> sessions;
  return sessions;
}

static std::map<std::string, std::function<Value(Value)>>& tool_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<Value(Value)>>& assertion_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<Value(Value)>>& processor_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<void(Value)>>& function_hook_registry() {
  static std::map<std::string, std::function<void(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<Value(Value)>>& flow_mapper_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static Value register_flow_mapper(std::string prefix, std::function<Value(Value)> mapper) {
  std::string id = std::move(prefix) + ":flow_mapper:" + std::to_string(flow_mapper_registry().size());
  flow_mapper_registry()[id] = std::move(mapper);
  return object({{"__flow_mapper_id", Value(id)}});
}

Value flow_callback(std::function<Value(Value)> mapper) {
  return register_flow_mapper("host", std::move(mapper));
}

static std::string pointer_id(const void* ptr) {
  std::ostringstream out;
  out << reinterpret_cast<std::uintptr_t>(ptr);
  return out.str();
}

static Array array_ref(const Value& value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return Array{};
}

static Array& array_mut(Value& value) {
  if (!value.is_array()) value = Value::array();
  return *std::get<std::shared_ptr<Array>>(value.data);
}

static Object object_ref(const Value& value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return Object{};
}

static std::string str(const Value& value);

static std::vector<std::pair<std::string, Value>> entries(const Value& value) {
  Object obj = object_ref(value);
  std::vector<std::pair<std::string, Value>> out;
  std::set<std::string> seen;
  auto order_it = obj.find("__order");
  if (order_it != obj.end()) {
    for (const auto& key_value : array_ref(order_it->second)) {
      std::string key = str(key_value);
      auto it = obj.find(key);
      if (it != obj.end() && key != "__order") {
        out.push_back(*it);
        seen.insert(key);
      }
    }
  }
  for (const auto& kv : obj) {
    if (kv.first != "__order" && seen.count(kv.first) == 0) out.push_back(kv);
  }
  return out;
}

static Object& object_mut(Value& value) {
  if (!value.is_object()) value = Value::object();
  return *std::get<std::shared_ptr<Object>>(value.data);
}

static std::string stable_stringify(const Value& value);

static std::string str(const Value& value) {
  if (auto p = std::get_if<std::string>(&value.data)) return *p;
  if (auto p = std::get_if<double>(&value.data)) return display(value);
  if (auto p = std::get_if<bool>(&value.data)) return *p ? "true" : "false";
  if (value.is_null()) return "";
  return stringify(value);
}

static double num(const Value& value) {
  if (auto p = std::get_if<double>(&value.data)) return *p;
  if (auto p = std::get_if<bool>(&value.data)) return *p ? 1.0 : 0.0;
  std::string s = str(value);
  return s.empty() ? 0.0 : std::stod(s);
}

static std::string key_string(const Value& key) {
  return str(key);
}

static Value get_key(const Value& object, const std::string& key, Value fallback = Value()) {
  const auto& obj = object_ref(object);
  auto it = obj.find(key);
  if (it != obj.end()) return it->second;
  static const std::map<std::string, std::string> aliases = {
      {"is_array", "isArray"}, {"is_optional", "isOptional"},
      {"is_internal", "isInternal"}, {"is_cached", "isCached"},
      {"min_length", "minLength"}, {"max_length", "maxLength"},
      {"pattern_description", "patternDescription"},
      {"input_fields", "inputs"}, {"output_fields", "outputs"}};
  auto alias = aliases.find(key);
  if (alias != aliases.end()) {
    auto jt = obj.find(alias->second);
    if (jt != obj.end()) return jt->second;
  }
  return fallback;
}

static bool has_key(const Value& object, const std::string& key) {
  const auto& obj = object_ref(object);
  if (obj.count(key) > 0) return true;
  static const std::map<std::string, std::string> aliases = {
      {"is_array", "isArray"}, {"is_optional", "isOptional"},
      {"is_internal", "isInternal"}, {"is_cached", "isCached"},
      {"min_length", "minLength"}, {"max_length", "maxLength"},
      {"pattern_description", "patternDescription"}};
  auto alias = aliases.find(key);
  return alias != aliases.end() && obj.count(alias->second) > 0;
}

bool Core::truthy(const Value& value) {
  if (value.is_null()) return false;
  if (auto p = std::get_if<bool>(&value.data)) return *p;
  if (auto p = std::get_if<double>(&value.data)) return *p != 0.0;
  if (auto p = std::get_if<std::string>(&value.data)) return !p->empty();
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return !(*p)->empty();
  if (value.is_object()) return !entries(value).empty();
  return true;
}

Value Core::truthy_value(Value value) { return Value(truthy(value)); }
Value Core::not_(Value value) { return Value(!truthy(value)); }
Value Core::and_(Value left, Value right) { return Value(truthy(left) && truthy(right)); }
Value Core::or_(Value left, Value right) { return Value(truthy(left) || truthy(right)); }
Value Core::eq(Value left, Value right) { return Value(equal(left, right)); }
Value Core::ne(Value left, Value right) { return Value(!equal(left, right)); }
Value Core::lt(Value left, Value right) { return Value(num(left) < num(right)); }
Value Core::lte(Value left, Value right) { return Value(num(left) <= num(right)); }
Value Core::gt(Value left, Value right) { return Value(num(left) > num(right)); }
Value Core::gte(Value left, Value right) { return Value(num(left) >= num(right)); }
Value Core::add(Value left, Value right) {
  if (left.is_number() && right.is_number()) return Value(num(left) + num(right));
  return Value(str(left) + str(right));
}
Value Core::mul(Value left, Value right) { return Value(num(left) * num(right)); }
Value Core::div(Value left, Value right) {
  double denom = num(right);
  return Value(num(left) / (denom == 0.0 ? 1.0 : denom));
}
Value Core::contains(Value container, Value item) {
  if (container.is_object()) return Value(has_key(container, key_string(item)));
  if (container.is_array()) {
    for (const auto& value : array_ref(container)) if (equal(value, item)) return Value(true);
    return Value(false);
  }
  return Value(str(container).find(str(item)) != std::string::npos);
}
Value Core::len(Value value) {
  if (value.is_string()) return Value(static_cast<double>(str(value).size()));
  if (value.is_array()) return Value(static_cast<double>(array_ref(value).size()));
  if (value.is_object()) return Value(static_cast<double>(entries(value).size()));
  return Value(0);
}
Value Core::is_none(Value value) { return Value(value.is_null()); }
Value Core::is_not_none(Value value) { return Value(!value.is_null()); }
Value Core::none() { return Value(); }
Value Core::coalesce(Value value, Value fallback) { return value.is_null() ? fallback : value; }
Value Core::map_merge(Value left, Value right) {
  Value out(object_ref(left));
  return map_update(out, right);
}
Value Core::get(Value target, Value key, Value default_value) {
  if (target.is_object()) return get_key(target, key_string(key), default_value);
  if (target.is_array() && key.is_number()) {
    int idx = static_cast<int>(num(key));
    const auto& arr = array_ref(target);
    return idx >= 0 && static_cast<size_t>(idx) < arr.size() ? arr[idx] : default_value;
  }
  return default_value;
}
void Core::set(Value& target, Value key, Value value) {
  std::string k = key_string(key);
  Object& obj = object_mut(target);
  if (obj.count(k) == 0) {
    Array order = array_ref(obj["__order"]);
    order.emplace_back(k);
    obj["__order"] = order;
  }
  obj[k] = std::move(value);
}
void Core::append(Value& target, Value value) {
  array_mut(target).push_back(std::move(value));
}
Array Core::iter(Value value) {
  if (value.is_object()) {
    Array out;
    for (const auto& kv : entries(value)) out.emplace_back(kv.first);
    return out;
  }
  return array_ref(value);
}
Value Core::map_contains(Value values, Value key) { return Value(has_key(values, key_string(key))); }
Value Core::map_get(Value values, Value key) { return get(values, key); }
Value Core::map_delete(Value values, Value key) {
  std::string k = key_string(key);
  Object& out = object_mut(values);
  out.erase(k);
  Array order;
  for (const auto& item : array_ref(out["__order"])) {
    if (str(item) != k) order.push_back(item);
  }
  out["__order"] = order;
  return values;
}
Value Core::map_update(Value target, Value values) {
  auto out = object_ref(target);
  Array order = array_ref(out["__order"]);
  for (const auto& kv : entries(values)) {
    if (out.count(kv.first) == 0) order.emplace_back(kv.first);
    out[kv.first] = kv.second;
  }
  out["__order"] = order;
  return Value(out);
}
Value Core::map_values(Value values) {
  Array out;
  for (const auto& kv : entries(values)) out.push_back(kv.second);
  return Value(out);
}
Value Core::map_keys(Value values) {
  Array out;
  for (const auto& kv : entries(values)) out.emplace_back(kv.first);
  return Value(out);
}
Value Core::list_get(Value values, Value index, Value default_value) {
  int idx = static_cast<int>(num(index));
  const auto& arr = array_ref(values);
  return idx >= 0 && static_cast<size_t>(idx) < arr.size() ? arr[idx] : default_value;
}
Value Core::type_is(Value value, Value type_name) {
  std::string t = str(type_name);
  if (t == "object") return Value(value.is_object());
  if (t == "list") return Value(value.is_array());
  if (t == "string") return Value(value.is_string());
  if (t == "number") return Value(value.is_number());
  if (t == "boolean") return Value(value.is_bool());
  if (t == "null") return Value(value.is_null());
  if (t == "json") return Value(true);
  return Value(false);
}
Value Core::regex_match(Value pattern, Value value) {
  return Value(value.is_string() && std::regex_search(str(value), std::regex(str(pattern))));
}
Value Core::string_trim(Value value) {
  std::string s = str(value);
  auto start = s.find_first_not_of(" \t\n\r");
  if (start == std::string::npos) return Value("");
  auto end = s.find_last_not_of(" \t\n\r");
  return Value(s.substr(start, end - start + 1));
}
Value Core::string_join(Value sep, Value values) {
  std::string out;
  bool first = true;
  for (const auto& item : array_ref(values)) {
    if (!first) out += str(sep);
    first = false;
    out += str(item);
  }
  return Value(out);
}
Value Core::string_lower(Value value) {
  std::string out = str(value);
  std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return Value(out);
}
Value Core::string_lower_camel(Value values) {
  const auto& items = array_ref(values);
  if (items.empty()) return Value("");
  std::string out = str(string_lower(items[0]));
  for (size_t i = 1; i < items.size(); ++i) {
    std::string part = str(string_lower(items[i]));
    if (!part.empty()) part[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(part[0])));
    out += part;
  }
  return Value(out);
}
Value Core::string_title_from_camel(Value value) {
  std::string text = std::regex_replace(str(value), std::regex("Code$"), " Code");
  text = std::regex_replace(text, std::regex("([a-z0-9])([A-Z])"), "$1 $2");
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front()))) text.erase(text.begin());
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back()))) text.pop_back();
  if (!text.empty()) text[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(text[0])));
  return Value(text);
}
Value Core::string_ends_with(Value value, Value suffix) {
  std::string s = str(value), suf = str(suffix);
  return Value(s.size() >= suf.size() && s.compare(s.size() - suf.size(), suf.size(), suf) == 0);
}
Value Core::string_starts_with(Value value, Value prefix) {
  std::string s = str(value), p = str(prefix);
  return Value(s.rfind(p, 0) == 0);
}
Value Core::string_replace(Value value, Value old_value, Value new_value) {
  std::string s = str(value), old = str(old_value), repl = str(new_value);
  size_t pos = 0;
  while (!old.empty() && (pos = s.find(old, pos)) != std::string::npos) {
    s.replace(pos, old.size(), repl);
    pos += repl.size();
  }
  return Value(s);
}
Value Core::string_slice(Value value, Value start, Value end) {
  std::string s = str(value);
  size_t a = static_cast<size_t>(std::max(0.0, num(start)));
  if (end.is_null()) return Value(a < s.size() ? s.substr(a) : "");
  size_t b = static_cast<size_t>(std::max(0.0, num(end)));
  if (a > s.size()) return Value("");
  return Value(s.substr(a, b > a ? b - a : 0));
}
Value Core::string_remove_suffix(Value value, Value suffix) {
  std::string s = str(value), suf = str(suffix);
  Object out;
  if (!suf.empty() && s.size() >= suf.size() && s.compare(s.size() - suf.size(), suf.size(), suf) == 0) {
    out["value"] = s.substr(0, s.size() - suf.size());
    out["removed"] = true;
  } else {
    out["value"] = s;
    out["removed"] = false;
  }
  return Value(out);
}
Value Core::string_words(Value value) {
  std::istringstream in(str(value));
  std::string word;
  Array out;
  while (in >> word) out.emplace_back(word);
  return Value(out);
}
Value Core::string_default_if_empty(Value value, Value fallback) {
  return truthy(string_trim(value)) ? string_trim(value) : fallback;
}
Value Core::string_format(Value templ, Value a, Value b, Value c) {
  std::string out = str(templ);
  for (const auto& arg : Array{a, b, c}) {
    if (arg.is_null()) continue;
    size_t pos = out.find("{}");
    if (pos == std::string::npos) break;
    out.replace(pos, 2, display(arg));
  }
  return Value(out);
}
Value Core::string_split(Value value, Value sep) {
  std::string s = str(value), delimiter = str(sep);
  Array out;
  size_t pos = 0;
  while (true) {
    size_t next = s.find(delimiter, pos);
    out.emplace_back(s.substr(pos, next == std::string::npos ? std::string::npos : next - pos));
    if (next == std::string::npos) break;
    pos = next + delimiter.size();
  }
  return Value(out);
}
Value Core::string_split_once(Value value, Value sep) {
  std::string s = str(value), delimiter = str(sep);
  size_t pos = s.find(delimiter);
  Object out;
  out["found"] = pos != std::string::npos;
  out["left"] = pos == std::string::npos ? s : s.substr(0, pos);
  out["right"] = pos == std::string::npos ? "" : s.substr(pos + delimiter.size());
  return Value(out);
}
Value Core::string_split_trim_nonempty(Value value, Value sep) {
  Array out;
  for (const auto& part : array_ref(string_split(value, sep))) {
    Value trimmed = string_trim(part);
    if (truthy(trimmed)) out.push_back(trimmed);
  }
  return Value(out);
}

static int find_outside_quotes_raw(const std::string& s, const std::string& needle) {
  char quote = 0;
  bool escaped = false;
  for (size_t i = 0; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch == '\\') { escaped = true; continue; }
    if (quote != 0) { if (ch == quote) quote = 0; continue; }
    if (ch == '\'' || ch == '"') { quote = ch; continue; }
    if (s.compare(i, needle.size(), needle) == 0) return static_cast<int>(i);
  }
  if (quote != 0) throw AxError("signature", "Unterminated string");
  return -1;
}
Value Core::string_find_outside_quotes(Value text, Value needle) { return Value(find_outside_quotes_raw(str(text), str(needle))); }
Value Core::string_split_outside_quotes(Value text, Value sep) {
  std::string s = str(text);
  char separator = str(sep).empty() ? ',' : str(sep)[0];
  Array out;
  std::string cur;
  char quote = 0;
  bool escaped = false;
  for (char ch : s) {
    if (escaped) { cur.push_back(ch); escaped = false; continue; }
    if (ch == '\\') { cur.push_back(ch); escaped = true; continue; }
    if (quote != 0) { cur.push_back(ch); if (ch == quote) quote = 0; continue; }
    if (ch == '\'' || ch == '"') { cur.push_back(ch); quote = ch; continue; }
    if (ch == separator) {
      Value trimmed = string_trim(cur);
      if (truthy(trimmed)) out.push_back(trimmed);
      cur.clear();
      continue;
    }
    cur.push_back(ch);
  }
  if (quote != 0) throw AxError("signature", "Unterminated string");
  Value trimmed = string_trim(cur);
  if (truthy(trimmed)) out.push_back(trimmed);
  return Value(out);
}
Value Core::string_consume_optional_quoted_prefix(Value text) {
  std::string s = str(text);
  Object out;
  if (s.empty() || (s[0] != '\'' && s[0] != '"')) {
    out["value"] = Value();
    out["rest"] = s;
    out["found"] = false;
    return Value(out);
  }
  char quote = s[0];
  bool escaped = false;
  std::string val;
  for (size_t i = 1; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { val.push_back(ch); escaped = false; }
    else if (ch == '\\') escaped = true;
    else if (ch == quote) {
      out["value"] = val;
      out["rest"] = s.substr(i + 1);
      out["found"] = true;
      return Value(out);
    } else val.push_back(ch);
  }
  throw AxError("signature", "Unterminated string");
}
Value Core::string_extract_quoted_suffix(Value text) {
  std::string s = str(text);
  bool escaped = false;
  for (size_t i = 0; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch == '\\') { escaped = true; continue; }
    if (ch == '\'' || ch == '"') {
      Value consumed = string_consume_optional_quoted_prefix(s.substr(i));
      Object out = object_ref(consumed);
      out["index"] = static_cast<double>(i);
      out["head"] = s.substr(0, i);
      return Value(out);
    }
  }
  return Value(Object{{"value", Value()}, {"index", Value()}, {"rest", ""}, {"head", s}, {"found", false}});
}
Value Core::string_str(Value value) { return Value(display(value)); }
Value Core::regex_replace(Value pattern, Value repl, Value value) {
  return Value(std::regex_replace(str(value), std::regex(str(pattern)), str(repl)));
}
Value Core::sorted_strings(Value values) {
  Array out;
  for (const auto& item : array_ref(values)) out.emplace_back(str(item));
  std::sort(out.begin(), out.end(), [](const Value& a, const Value& b) { return str(a) < str(b); });
  return Value(out);
}
Value Core::json_parse(Value value) {
  std::string text = str(value);
  Value trimmed = string_trim(text);
  text = str(trimmed);
  std::string fence(3, static_cast<char>(96));
  if (text.rfind(fence, 0) == 0) {
    text.erase(std::remove(text.begin(), text.end(), static_cast<char>(96)), text.end());
    text = str(string_trim(text));
    if (text.rfind("json", 0) == 0) text = str(string_trim(text.substr(4)));
  }
  return parse_json(text);
}
Value Core::json_stringify(Value value) { return Value(stringify(value)); }
Value Core::json_stable_stringify(Value value) { return Value(stable_stringify(value)); }
Value Core::json_pretty(Value value) { return Value(stringify(value)); }
Value Core::signature_error(Value message) { return Value(Object{{"__error", "signature"}, {"message", str(message)}}); }
Value Core::validation_error(Value message) { return Value(Object{{"__error", "validation"}, {"message", str(message)}}); }
Value Core::runtime_error(Value message) { return Value(Object{{"__error", "runtime"}, {"message", str(message)}}); }
static Value ai_error_object(const std::string& type, Value message, Value status = Value(), Value code = Value(), Value response_body = Value(), Value request = Value(), Value retryable = Value(false)) {
  Object out;
  out["__error"] = "ai";
  out["__type"] = type;
  out["message"] = str(message);
  out["status"] = status;
  out["code"] = code;
  out["response_body"] = response_body;
  out["request"] = request;
  out["retryable"] = Core::truthy(retryable);
  return Value(out);
}
Value Core::ai_error_response(Value message, Value response_body) { return ai_error_object("AxAIServiceResponseError", message, Value(), Value(), response_body); }
Value Core::ai_error_refusal(Value message, Value response_body) { return ai_error_object("AxAIRefusalError", message, Value(), Value(), response_body); }
Value Core::ai_error_stream(Value message, Value response_body, Value retryable) { return ai_error_object("AxAIServiceStreamTerminatedError", message, Value(), Value(), response_body, Value(), retryable); }
Value Core::ai_error_unsupported(Value message) { return ai_error_object("AxUnsupportedCapabilityError", message); }
Value Core::ai_error_auth(Value message, Value status, Value code, Value response_body, Value request) { return ai_error_object("AxAIServiceAuthenticationError", message, status, code, response_body, request); }
Value Core::ai_error_timeout(Value message, Value status, Value code, Value response_body, Value request, Value retryable) { return ai_error_object("AxAIServiceTimeoutError", message, status, code, response_body, request, retryable); }
Value Core::ai_error_status(Value message, Value status, Value code, Value response_body, Value request, Value retryable) { return ai_error_object("AxAIServiceStatusError", message, status, code, response_body, request, retryable); }
Value Core::exception_value(const std::exception& error) {
  if (const auto* ax = dynamic_cast<const AxError*>(&error)) {
    Object out{{"__error", ax->category}, {"message", std::string(ax->what())}};
    if (!ax->type.empty()) out["__type"] = ax->type;
    if (ax->status != 0) out["status"] = ax->status;
    if (!ax->code.empty()) out["code"] = ax->code;
    out["retryable"] = ax->retryable;
    return Value(out);
  }
  return runtime_error(error.what());
}
Value Core::exception_message(Value error) {
  if (error.is_object() && has_key(error, "message")) return get_key(error, "message");
  return Value(str(error));
}
AxError Core::as_error(Value error) {
  if (error.is_object() && has_key(error, "__error")) {
    int status = get_key(error, "status").is_null() ? 0 : static_cast<int>(num(get_key(error, "status")));
    return AxError(str(get_key(error, "__error")), str(get_key(error, "message")), str(get_key(error, "__type")), status, str(get_key(error, "code")), truthy(get_key(error, "retryable")));
  }
  return AxError("runtime", str(error));
}
Value Core::coerce_chat_request(Value request) {
  if (has_key(request, "chat_prompt")) return Value(object_ref(request));
  if (has_key(request, "chatPrompt")) {
    Value out(object_ref(request));
    Core::set(out, "chat_prompt", get_key(request, "chatPrompt"));
    return out;
  }
  if (has_key(request, "messages")) {
    Value out = Value::object();
    Core::set(out, "chat_prompt", get_key(request, "messages"));
    Core::set(out, "functions", get_key(request, "functions", Value::array()));
    Core::set(out, "function_call", get_key(request, "function_call", get_key(request, "tool_choice")));
    Core::set(out, "response_format", get_key(request, "response_format"));
    Core::set(out, "model", get_key(request, "model"));
    Core::set(out, "model_config", get_key(request, "model_config", Value::object()));
    return out;
  }
  return Value(object_ref(request));
}
Value Core::client_ref(AIClient& client) {
  std::string id = pointer_id(&client);
  client_registry()[id] = &client;
  return Value(Object{{"__client_id", id}});
}
Value Core::agent_stage_ref(AxProgram& stage) {
  std::string id = pointer_id(&stage);
  agent_stage_registry()[id] = &stage;
  return Value(Object{{"__agent_stage_id", id}});
}
Value Core::code_runtime_ref(AxCodeRuntime& runtime) {
  std::string id = pointer_id(&runtime);
  code_runtime_registry()[id] = &runtime;
  return Value(Object{{"__code_runtime_id", id}, {"language", runtime.language()}, {"usageInstructions", runtime.usage_instructions()}});
}
Value Core::legacy_response_to_chat_response(Value raw) {
  if (!get_key(raw, "results").is_null()) return raw;
  Array calls;
  for (const auto& item : array_ref(get_key(raw, "function_calls"))) {
    Object call = object_ref(item);
    Object fn;
    fn["name"] = get_key(item, "name");
    fn["params"] = get_key(item, "params");
    Object out;
    out["id"] = get_key(item, "id");
    out["type"] = "function";
    out["function"] = Value(fn);
    calls.emplace_back(out);
  }
  Object result;
  result["index"] = 0;
  result["content"] = get_key(raw, "content", "");
  result["function_calls"] = Value(calls);
  result["finish_reason"] = get_key(raw, "finish_reason", "stop");
  Object out;
  out["results"] = Value(Array{Value(result)});
  Value usage = get_key(raw, "usage");
  if (!usage.is_null()) out["model_usage"] = Value(Object{{"tokens", usage}});
  return Value(out);
}
Value Core::object_call_method(Value target, Value method_name, Value arg) {
  if (str(method_name) == "render" && str(get_key(target, "__kind")) == "PromptTemplate") {
    return render_prompt(get_key(target, "signature"), arg, get_key(target, "functions", Value::array()), get_key(target, "options", Value::object()));
  }
  if (str(method_name) == "call") {
    std::string mapper_id = str(get_key(target, "__flow_mapper_id"));
    auto it = flow_mapper_registry().find(mapper_id);
    if (it != flow_mapper_registry().end()) return it->second(arg);
  }
  throw AxError("runtime", "unsupported method call: " + str(method_name));
}
Value Core::program_components(Value program) {
  std::string stage_id = str(get_key(program, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  return it->second->get_optimizable_components();
}
Value Core::program_apply_components(Value program, Value component_map) {
  std::string stage_id = str(get_key(program, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it != agent_stage_registry().end() && it->second != nullptr) it->second->apply_optimized_components(std::move(component_map));
  return Value::object();
}
Value Core::ai_complete_once(Value client, Value request) {
  std::string id = str(get_key(client, "__client_id"));
  auto it = client_registry().find(id);
  if (it == client_registry().end() || it->second == nullptr) throw AxError("runtime", "client does not implement AIClient");
  return chat_response_to_completion(it->second->chat(request));
}
Value Core::retry_sleep(Value) { return Value(); }
Value Core::tool_invoke(Value fn, Value params) {
  Value args = get_key(fn, "args", Value::array());
  if (truthy(args)) validate_fields(args, params, "tool." + str(get_key(fn, "name")) + ".args");
  std::string id = str(get_key(fn, "__tool_id"));
  auto it = tool_registry().find(id);
  if (it == tool_registry().end()) throw AxError("runtime", "unknown tool");
  Value result = it->second(params.is_null() ? Value::object() : params);
  Value returns = get_key(fn, "returns", Value::array());
  if (truthy(returns) && result.is_object()) validate_fields(returns, result, "tool." + str(get_key(fn, "name")) + ".return");
  return result;
}
Value Core::agent_stage_forward(Value stage, Value client, Value values, Value options) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto stage_it = agent_stage_registry().find(stage_id);
  if (stage_it == agent_stage_registry().end() || stage_it->second == nullptr) {
    throw AxError("runtime", "agent stage is not AxProgram");
  }
  std::string client_id = str(get_key(client, "__client_id"));
  auto client_it = client_registry().find(client_id);
  if (client_it == client_registry().end() || client_it->second == nullptr) {
    throw AxError("runtime", "client does not implement AIClient");
  }
  return stage_it->second->forward(*client_it->second, values, options);
}
Value Core::agent_stage_chat_log(Value stage) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  return it->second->get_chat_log();
}
Value Core::agent_stage_usage(Value stage) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  Value usage = it->second->get_usage();
  if (truthy(usage)) return usage;
  Value items = Value::array();
  for (const auto& raw_entry : array_ref(it->second->get_chat_log())) {
    Value item = get_key(raw_entry, "usage");
    if (truthy(item)) append(items, item);
  }
  return items;
}
Value Core::agent_stage_traces(Value stage) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  return it->second->get_traces();
}
Value Core::agent_clarification_error(Value payload, Value state) {
  Value args = get_key(payload, "args", Value::array());
  Value clarification = array_ref(args).empty() ? payload : array_ref(args)[0];
  std::string message = str(get_key(clarification, "question", get_key(clarification, "message", clarification)));
  return Value(Object{
      {"__error", "AxAgentClarificationError"},
      {"message", message},
      {"clarification", clarification},
      {"state", get_key(state, "runtime_state", Value::object())},
      {"payload", payload},
  });
}
Value Core::agent_runtime_create_session(Value runtime, Value globals, Value options) {
  std::string runtime_id = str(get_key(runtime, "__code_runtime_id"));
  auto it = code_runtime_registry().find(runtime_id);
  if (it == code_runtime_registry().end() || it->second == nullptr) {
    throw AxError("runtime", "agent runtime does not implement AxCodeRuntime");
  }
  AxCodeSession* session = it->second->create_session(globals, options);
  if (session == nullptr) throw AxError("runtime", "agent runtime returned no session");
  std::string session_id = pointer_id(session);
  code_session_registry()[session_id] = session;
  return Value(Object{{"__code_session_id", session_id}});
}
Value Core::agent_runtime_execute(Value session, Value code, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->execute(code, options);
}
Value Core::agent_runtime_inspect(Value session, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->inspect(options);
}
Value Core::agent_runtime_export_state(Value session, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->export_state(options);
}
Value Core::agent_runtime_restore_state(Value session, Value snapshot, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->restore_state(snapshot, options);
}
Value Core::agent_runtime_close(Value session) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) return Value(Object{{"closed", true}});
  Value result = it->second->close();
  code_session_registry().erase(it);
  return result.is_null() ? Value(Object{{"closed", true}}) : result;
}
Value Core::agent_memory_search(Value state, Value searches, Value already_loaded) {
  Value options = get_key(state, "options", Value::object());
  Value scripted = get_key(options, "memory_search_results", get_key(options, "memorySearchResults", Value::object()));
  if (scripted.is_object()) {
    std::vector<std::string> parts;
    for (const auto& item : array_ref(searches)) parts.push_back(str(item));
    std::string joined;
    for (size_t i = 0; i < parts.size(); ++i) {
      if (i > 0) joined += "|";
      joined += parts[i];
    }
    Value exact = get_key(scripted, joined, Value());
    if (!exact.is_null()) return exact;
    for (const auto& item : parts) {
      Value hit = get_key(scripted, item, Value());
      if (!hit.is_null()) return hit;
    }
    return get_key(scripted, "*", Value::array());
  }
  if (scripted.is_array()) return scripted;
  return Value::array();
}
Value Core::agent_skill_search(Value state, Value searches) {
  Value options = get_key(state, "options", Value::object());
  Value scripted = get_key(options, "skill_search_results", get_key(options, "skillSearchResults", Value::object()));
  if (scripted.is_object()) {
    std::vector<std::string> parts;
    for (const auto& item : array_ref(searches)) parts.push_back(str(item));
    std::string joined;
    for (size_t i = 0; i < parts.size(); ++i) {
      if (i > 0) joined += "|";
      joined += parts[i];
    }
    Value exact = get_key(scripted, joined, Value());
    if (!exact.is_null()) return exact;
    Value out = Value::array();
    for (const auto& item : parts) {
      for (const auto& match : array_ref(get_key(scripted, item, Value::array()))) append(out, match);
    }
    if (!array_ref(out).empty()) return out;
    return get_key(scripted, "*", Value::array());
  }
  if (scripted.is_array()) return scripted;
  return Value::array();
}
Value Core::agent_callable_invoke(Value state, Value request, Value options_arg) {
  Value options = get_key(state, "options", Value::object());
  std::string qualified = str(get_key(request, "qualified_name", get_key(request, "name", Value(""))));
  std::string name = str(get_key(request, "name", Value("")));
  Value scripted = get_key(options, "callable_results", get_key(options, "callableResults", Value::object()));
  if (scripted.is_object()) {
    Value result = get_key(scripted, qualified, Value());
    if (result.is_null() && !name.empty()) result = get_key(scripted, name, Value());
    if (result.is_null()) result = get_key(scripted, "*", Value());
    if (!result.is_null()) {
      if (result.is_object()) {
        Value out = result;
        if (!get_key(out, "error", Value()).is_null()) {
          Value err = Value::object();
          set(err, "status", "error");
          set(err, "error", get_key(out, "error"));
          return err;
        }
        if (get_key(out, "status", Value()).is_null()) set(out, "status", "ok");
        return out;
      }
      return object({{"status", "ok"}, {"value", result}});
    }
  }
  return object({{"status", "error"}, {"error", std::string("unknown callable: ") + qualified}});
}

static std::string titleize(const std::string& name) {
  std::string spaced;
  for (size_t i = 0; i < name.size(); ++i) {
    char ch = name[i] == '_' ? ' ' : name[i];
    if (i > 0 && (std::isupper(static_cast<unsigned char>(ch)) || std::isdigit(static_cast<unsigned char>(ch)))) spaced.push_back(' ');
    spaced.push_back(ch);
  }
  Value trimmed = Core::string_trim(spaced);
  std::string out = str(trimmed);
  if (!out.empty()) out[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(out[0])));
  return out;
}

Value Core::record_new(Value name, Value values) {
  std::string type = str(name);
  Object in = object_ref(values);
  if (type == "FieldType") {
    Object out;
    out["name"] = in.count("name") ? in["name"] : Value("string");
    out["isArray"] = get_key(values, "is_array", false);
    for (const auto& key : {"options", "fields", "minLength", "maxLength", "minimum", "maximum", "pattern", "patternDescription", "format", "description"}) {
      if (in.count(key)) out[key] = in[key];
    }
    for (const auto& kv : in) if (!out.count(kv.first) && kv.first != "is_array") out[kv.first] = kv.second;
    return Value(out);
  }
  if (type == "Field") {
    std::string field_name = str(in["name"]);
    Object out;
    out["name"] = field_name;
    out["title"] = in.count("title") ? in["title"] : Value(titleize(field_name));
    out["type"] = in.count("type") ? in["type"] : record_new("FieldType", Object{{"name", "string"}});
    if (in.count("description") && !in["description"].is_null()) out["description"] = in["description"];
    out["isOptional"] = get_key(values, "is_optional", false);
    out["isInternal"] = get_key(values, "is_internal", false);
    out["isCached"] = get_key(values, "is_cached", false);
    return Value(out);
  }
  if (type == "AxSignature") {
    Object out;
    out["description"] = in.count("description") ? in["description"] : Value();
    out["inputs"] = in.count("inputs") ? in["inputs"] : Value::array();
    out["outputs"] = in.count("outputs") ? in["outputs"] : Value::array();
    return Value(out);
  }
  return values;
}
Value Core::field_item(Value field) {
  Object f = object_ref(field);
  Object t = object_ref(get_key(field, "type"));
  t["isArray"] = false;
  f["type"] = Value(t);
  return Value(f);
}
Value Core::fields_from_map(Value fields) {
  Array out;
  for (const auto& kv : entries(fields)) {
    Value item = kv.second;
    if (item.is_object() && has_key(item, "type")) {
      Object f = object_ref(item);
      if (!f.count("name") || str(f["name"]).empty()) f["name"] = kv.first;
      out.emplace_back(record_new("Field", Value(f)));
    } else {
      out.emplace_back(record_new("Field", Object{{"name", kv.first}, {"type", item}}));
    }
  }
  return Value(out);
}
Value Core::description_append(Value base, Value hint) {
  std::string h = str(string_trim(hint));
  if (h.empty()) return base;
  std::string b = str(string_trim(base));
  if (b.empty()) return Value(h);
  if (b.back() != '.') b.push_back('.');
  return Value(b + " " + h);
}
Value Core::url_valid(Value value) {
  return Value(value.is_string() && std::regex_search(str(value), std::regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")));
}
Value Core::valid_image(Value value) { return Value(value.is_object() && has_key(value, "mimeType") && has_key(value, "data")); }
Value Core::valid_audio(Value value) { return Value(value.is_string() || (value.is_object() && (has_key(value, "data") || has_key(value, "id")))); }
Value Core::valid_file(Value value) { return Value(value.is_object() && has_key(value, "mimeType") && (has_key(value, "data") != has_key(value, "fileUri"))); }
Value Core::valid_url_shape(Value value) { return Value(value.is_string() || (value.is_object() && has_key(value, "url"))); }

struct TemplateRuntime {
  static Value parse(const std::string& source, const std::string& context);
  static std::string render(Value nodes, Value vars, const std::string& source, const std::string& context);
  static Value collect(Value nodes);
  static Value validate(const std::string& source, const std::string& context, Value required);
  static Object parse_range(const Array& tokens, const std::string& source, const std::string& context, size_t start, const std::set<std::string>& terms);
  static Object node(std::string type, Value value = Value()) { Object out; out["type"] = type; if (!value.is_null()) out["value"] = value; return out; }
  static Value resolve(Value vars, const std::string& path, const std::string& source, const std::string& context, int index);
  static void collect_into(Value nodes, std::set<std::string>& out);
  static std::string error(const std::string& context, const std::string& source, int index, const std::string& message);
};

Value Core::template_parse(Value source, Value context) { return TemplateRuntime::parse(str(source), str(context)); }
Value Core::template_render_tree(Value nodes, Value vars, Value source, Value context) { return Value(TemplateRuntime::render(nodes, vars, str(source), str(context))); }
Value Core::template_collect_vars(Value nodes) { return TemplateRuntime::collect(nodes); }
Value Core::template_validate(Value source, Value context, Value required) { return TemplateRuntime::validate(str(source), str(context), required); }

Value TemplateRuntime::parse(const std::string& source, const std::string& context) {
  std::regex tag_re("\\{\\{\\s*([^}]+?)\\s*\\}\\}");
  Array tokens;
  size_t last = 0;
  for (auto it = std::sregex_iterator(source.begin(), source.end(), tag_re); it != std::sregex_iterator(); ++it) {
    size_t start = static_cast<size_t>(it->position());
    if (start > last) tokens.emplace_back(Object{{"type", "text"}, {"value", source.substr(last, start - last)}});
    tokens.emplace_back(Object{{"type", "tag"}, {"value", str(Core::string_trim((*it)[1].str()))}, {"index", static_cast<double>(start)}});
    last = start + static_cast<size_t>(it->length());
  }
  if (last < source.size()) tokens.emplace_back(Object{{"type", "text"}, {"value", source.substr(last)}});
  Object result = parse_range(tokens, source, context, 0, {});
  if (!result["terminator"].is_null()) throw AxError("template", "Unexpected template terminator '" + str(result["terminator"]) + "' in " + context);
  return result["nodes"];
}

Object TemplateRuntime::parse_range(const Array& tokens, const std::string& source, const std::string& context, size_t start, const std::set<std::string>& terms) {
  Array nodes;
  size_t i = start;
  std::regex ident("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$");
  std::regex eq("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*\\s*===\\s*('([^']*)'|\\\"([^\\\"]*)\\\")$");
  while (i < tokens.size()) {
    Object tok = object_ref(tokens[i]);
    if (str(tok["type"]) == "text") { nodes.emplace_back(Object{{"type", "text"}, {"value", tok["value"]}}); ++i; continue; }
    std::string tag = str(tok["value"]);
    if (terms.count(tag)) return Object{{"nodes", nodes}, {"index", static_cast<double>(i)}, {"terminator", tag}};
    int index = static_cast<int>(num(tok["index"]));
    if (tag.rfind("if ", 0) == 0) {
      std::string condition = str(Core::string_trim(tag.substr(3)));
      if (!std::regex_match(condition, ident) && !std::regex_match(condition, eq)) throw AxError("template", error(context, source, index, "Invalid if condition '" + condition + "'"));
      Object then_result = parse_range(tokens, source, context, i + 1, {"else", "/if"});
      if (then_result["terminator"].is_null()) throw AxError("template", error(context, source, index, "Unclosed 'if' block"));
      Array else_nodes;
      size_t next = static_cast<size_t>(num(then_result["index"]));
      if (str(then_result["terminator"]) == "else") {
        Object else_result = parse_range(tokens, source, context, next + 1, {"/if"});
        if (str(else_result["terminator"]) != "/if") throw AxError("template", error(context, source, index, "Unclosed 'if' block"));
        else_nodes = array_ref(else_result["nodes"]);
        next = static_cast<size_t>(num(else_result["index"]));
      }
      nodes.emplace_back(Object{{"type", "if"}, {"condition", condition}, {"then", then_result["nodes"]}, {"else", else_nodes}, {"index", static_cast<double>(index)}});
      i = next + 1;
      continue;
    }
    if (tag == "else") throw AxError("template", error(context, source, index, "Unexpected 'else'"));
    if (tag == "/if") throw AxError("template", error(context, source, index, "Unexpected '/if'"));
    if (!tag.empty() && tag[0] == '!') { ++i; continue; }
    if (tag.rfind("include ", 0) == 0) throw AxError("template", error(context, source, index, "Unexpected 'include' directive at runtime (includes must be compiled)"));
    if (!std::regex_match(tag, ident)) throw AxError("template", error(context, source, index, "Invalid tag '" + tag + "'"));
    nodes.emplace_back(Object{{"type", "var"}, {"name", tag}, {"index", static_cast<double>(index)}});
    ++i;
  }
  return Object{{"nodes", nodes}, {"index", static_cast<double>(i)}, {"terminator", Value()}};
}

std::string TemplateRuntime::render(Value nodes, Value vars, const std::string& source, const std::string& context) {
  std::ostringstream out;
  std::regex eq("^([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)\\s*===\\s*(?:'([^']*)'|\\\"([^\\\"]*)\\\")$");
  for (const auto& item : array_ref(nodes)) {
    Object node = object_ref(item);
    std::string type = str(node["type"]);
    if (type == "text") out << str(node["value"]);
    else if (type == "var") {
      Value value = resolve(vars, str(node["name"]), source, context, static_cast<int>(num(node["index"])));
      if (!(value.is_string() || value.is_number() || value.is_bool())) throw AxError("template", error(context, source, static_cast<int>(num(node["index"])), "Variable '" + str(node["name"]) + "' must be string, number, or boolean"));
      out << display(value);
    } else if (type == "if") {
      std::smatch m;
      std::string condition = str(node["condition"]);
      bool ok = false;
      if (std::regex_match(condition, m, eq)) {
        std::string expected = m[2].matched ? m[2].str() : m[3].str();
        ok = equal(resolve(vars, m[1].str(), source, context, static_cast<int>(num(node["index"]))), Value(expected));
      } else {
        Value resolved = resolve(vars, condition, source, context, static_cast<int>(num(node["index"])));
        if (!resolved.is_bool()) throw AxError("template", error(context, source, static_cast<int>(num(node["index"])), "Condition '" + condition + "' must be boolean"));
        ok = Core::truthy(resolved);
      }
      out << render(ok ? node["then"] : node["else"], vars, source, context);
    }
  }
  return out.str();
}

Value TemplateRuntime::resolve(Value vars, const std::string& path, const std::string& source, const std::string& context, int index) {
  Value current = vars;
  std::stringstream ss(path);
  std::string part;
  while (std::getline(ss, part, '.')) {
    if (!current.is_object() || !has_key(current, part)) throw AxError("template", error(context, source, index, "Missing template variable '" + path + "'"));
    current = get_key(current, part);
  }
  return current;
}

void TemplateRuntime::collect_into(Value nodes, std::set<std::string>& out) {
  std::regex eq("^([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)\\s*===");
  for (const auto& item : array_ref(nodes)) {
    Object node = object_ref(item);
    if (str(node["type"]) == "var") out.insert(str(node["name"]));
    else if (str(node["type"]) == "if") {
      std::smatch m;
      std::string condition = str(node["condition"]);
      if (std::regex_search(condition, m, eq)) out.insert(m[1].str());
      else out.insert(condition);
      collect_into(node["then"], out);
      collect_into(node["else"], out);
    }
  }
}
Value TemplateRuntime::collect(Value nodes) {
  std::set<std::string> names;
  collect_into(nodes, names);
  Array out;
  for (const auto& name : names) out.emplace_back(name);
  return Value(out);
}
Value TemplateRuntime::validate(const std::string& source, const std::string& context, Value required) {
  try {
    std::set<std::string> present;
    collect_into(parse(source, context), present);
    for (const auto& item : array_ref(required)) if (!present.count(str(item))) return Value("must preserve template variable {{" + str(item) + "}}");
    return Value(true);
  } catch (const std::exception& e) {
    return Value(std::string(e.what()));
  }
}
std::string TemplateRuntime::error(const std::string& context, const std::string& source, int index, const std::string& message) {
  int line = 1, col = 1;
  for (int i = 0; i < index && i < static_cast<int>(source.size()); ++i) {
    if (source[static_cast<size_t>(i)] == '\n') { ++line; col = 1; } else ++col;
  }
  return context + ":" + std::to_string(line) + ":" + std::to_string(col) + " " + message;
}

static std::string prompt_format_description(const std::string& text) {
  std::string v = str(Core::string_trim(text));
  if (v.empty()) return "";
  v[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(v[0])));
  if (v.back() != '.') v.push_back('.');
  return v;
}
static bool prompt_provided(Value value) {
  return !value.is_null() && !(value.is_string() && str(value).empty()) && !(value.is_array() && array_ref(value).empty());
}
static Array prompt_inputs_for_values(Value sig, Value values) {
  Array fields = array_ref(get_key(sig, "inputs"));
  std::stable_sort(fields.begin(), fields.end(), [](const Value& a, const Value& b) { return Core::truthy(get_key(a, "isCached")) && !Core::truthy(get_key(b, "isCached")); });
  Array out;
  for (const auto& field : fields) if (!Core::truthy(get_key(field, "isOptional")) || prompt_provided(get_key(values, str(get_key(field, "name"))))) out.push_back(field);
  return out;
}
static std::string prompt_desc_fields(const Array& fields) {
  std::vector<std::string> out;
  for (const auto& f : fields) out.push_back(std::string(1, static_cast<char>(96)) + str(get_key(f, "title")) + static_cast<char>(96));
  std::string joined;
  for (size_t i = 0; i < out.size(); ++i) { if (i) joined += ", "; joined += out[i]; }
  return joined;
}
static Object prompt_field_map(Value sig) {
  Object out;
  for (const auto& f : array_ref(get_key(sig, "inputs"))) out[str(get_key(f, "name"))] = get_key(f, "title");
  for (const auto& f : array_ref(get_key(sig, "outputs"))) out[str(get_key(f, "name"))] = get_key(f, "title");
  return out;
}
static std::string prompt_format_refs(std::string desc, const Object& names) {
  std::vector<std::string> keys;
  for (const auto& kv : names) keys.push_back(kv.first);
  std::sort(keys.begin(), keys.end(), [](const std::string& a, const std::string& b) { return a.size() > b.size(); });
  for (const auto& key : keys) {
    std::string title = str(names.at(key));
    desc = str(Core::string_replace(desc, std::string(1, static_cast<char>(96)) + key + static_cast<char>(96), std::string(1, static_cast<char>(96)) + title + static_cast<char>(96)));
    desc = str(Core::string_replace(desc, "\"" + key + "\"", "\"" + title + "\""));
    desc = str(Core::string_replace(desc, "'" + key + "'", "'" + title + "'"));
    desc = str(Core::string_replace(desc, "[" + key + "]", "[" + title + "]"));
    desc = str(Core::string_replace(desc, "(" + key + ")", "(" + title + ")"));
    desc = std::regex_replace(desc, std::regex("\\$" + key + "\\b"), std::string(1, static_cast<char>(96)) + title + static_cast<char>(96));
  }
  return desc;
}
static std::string prompt_field_type_text(Value typ);
static std::string prompt_object_structure(Value fields) {
  std::vector<std::string> out;
  for (const auto& kv : entries(fields)) {
    Value f = kv.second;
    if (!has_key(f, "type")) f = Core::record_new("Field", Object{{"name", kv.first}, {"type", f}});
    out.push_back(kv.first + (Core::truthy(get_key(f, "isOptional")) ? "?" : "") + ": " + prompt_field_type_text(get_key(f, "type")));
  }
  std::string joined;
  for (size_t i = 0; i < out.size(); ++i) { if (i) joined += ", "; joined += out[i]; }
  return "{ " + joined + " }";
}
static std::string prompt_field_type_text(Value typ) {
  std::string name = str(get_key(typ, "name"));
  std::string base = "string";
  if (name == "number") base = "number";
  else if (name == "boolean") base = "boolean (true or false)";
  else if (name == "date") base = "date (YYYY-MM-DD, e.g. 2024-05-09)";
  else if (name == "dateRange") base = "date range ({ \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" }, e.g. {\"start\":\"2024-05-09\",\"end\":\"2024-05-12\"})";
  else if (name == "datetime") base = "datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)";
  else if (name == "datetimeRange") base = "datetime range ({ \"start\": ISO datetime, \"end\": ISO datetime }, e.g. {\"start\":\"2024-05-09T14:30:00Z\",\"end\":\"2024-05-09T15:30:00Z\"})";
  else if (name == "json") base = "JSON object";
  else if (name == "class") base = "classification class";
  else if (name == "code") base = "code";
  else if (name == "file") base = "file (with filename, mimeType, and data)";
  else if (name == "audio") base = "speech script (plain text to synthesize as audio)";
  else if (name == "url") base = "URL (string or object with url, title, description)";
  else if (name == "object") base = object_ref(get_key(typ, "fields")).empty() ? "object" : "object " + prompt_object_structure(get_key(typ, "fields"));
  return Core::truthy(get_key(typ, "isArray")) ? "json array of " + base + " items" : base;
}
static bool prompt_complex(Value sig) {
  for (const auto& field : array_ref(get_key(sig, "outputs"))) {
    Value typ = get_key(field, "type");
    if (str(get_key(typ, "name")) == "object" || !object_ref(get_key(typ, "fields")).empty()) return true;
  }
  return false;
}
static std::string prompt_render_input_fields(const Array& fields, const Object& names) {
  std::vector<std::string> rows;
  for (const auto& f : fields) {
    std::string row = str(get_key(f, "title")) + ":";
    if (!get_key(f, "description").is_null()) row += " " + prompt_format_refs(prompt_format_description(str(get_key(f, "description"))), names);
    rows.push_back(str(Core::string_trim(row)));
  }
  std::string joined;
  for (size_t i = 0; i < rows.size(); ++i) { if (i) joined += "\n"; joined += rows[i]; }
  return joined;
}
static std::string prompt_render_output_fields(const Array& fields, const Object& names) {
  std::vector<std::string> rows;
  for (const auto& f : fields) {
    Value typ = get_key(f, "type");
    std::string type_text = prompt_field_type_text(typ);
    std::string req = Core::truthy(get_key(f, "isOptional")) ? "Only include this " + type_text + " field if its value is available" : "This " + type_text + " field must be included";
    std::string desc;
    if (!get_key(f, "description").is_null()) desc = " " + prompt_format_refs(str(get_key(typ, "name")) == "class" ? str(get_key(f, "description")) : prompt_format_description(str(get_key(f, "description"))), names);
    if (!array_ref(get_key(typ, "options")).empty()) {
      std::vector<std::string> opts;
      for (const auto& option : array_ref(get_key(typ, "options"))) opts.push_back(str(option));
      std::string joined;
      for (size_t i = 0; i < opts.size(); ++i) { if (i) joined += ", "; joined += opts[i]; }
      desc += std::string(desc.empty() ? "" : ". ") + "Allowed values: " + joined;
    }
    rows.push_back(str(Core::string_trim(str(get_key(f, "title")) + ": (" + req + ")" + desc)));
  }
  std::string joined;
  for (size_t i = 0; i < rows.size(); ++i) { if (i) joined += "\n"; joined += rows[i]; }
  return joined;
}
static std::string prompt_task(Value sig) {
  Value desc = get_key(sig, "description");
  if (desc.is_null() || str(Core::string_trim(desc)).empty()) return "";
  return prompt_format_refs(prompt_format_description(str(desc)), prompt_field_map(sig));
}
static std::string prompt_render_functions(Value functions) {
  std::vector<std::string> rows;
  for (const auto& fn : array_ref(functions)) {
    rows.push_back("- " + std::string(1, static_cast<char>(96)) + str(get_key(fn, "name")) + static_cast<char>(96) + ": " + prompt_format_description(str(get_key(fn, "description", ""))));
  }
  std::string joined;
  for (size_t i = 0; i < rows.size(); ++i) { if (i) joined += "\n"; joined += rows[i]; }
  return joined;
}
Value Core::prompt_structured(Value signature, Value values, Value functions, Value options) {
  bool complex = prompt_complex(signature);
  std::string task = prompt_task(signature);
  Object vars;
  vars["hasFunctions"] = !array_ref(functions).empty();
  vars["hasTaskDefinition"] = !task.empty();
  vars["hasExampleDemonstrations"] = truthy(get_key(options, "has_example_demonstrations", get_key(options, "hasExampleDemonstrations")));
  vars["hasOutputFields"] = !complex;
  vars["hasComplexFields"] = complex;
  vars["hasStructuredOutputFunction"] = complex && !get_key(options, "structured_output_function_name").is_null();
  Array inputs = prompt_inputs_for_values(signature, values);
  vars["identityText"] = "You will be provided with the following fields: " + prompt_desc_fields(inputs) + ". Your task is to generate new fields: " + prompt_desc_fields(array_ref(get_key(signature, "outputs"))) + ".";
  vars["taskDefinitionText"] = task;
  vars["functionsList"] = prompt_render_functions(functions);
  vars["inputFieldsSection"] = "**Input Fields**: The following fields will be provided to you:\n\n" + prompt_render_input_fields(inputs, prompt_field_map(signature));
  vars["outputFieldsSection"] = complex ? "" : "**Output Fields**: You must generate the following fields:\n\n" + prompt_render_output_fields(array_ref(get_key(signature, "outputs")), prompt_field_map(signature));
  vars["structuredOutputFunctionName"] = get_key(options, "structured_output_function_name", "");
  std::string bt(1, static_cast<char>(96));
  std::string source =
      "<identity>\n{{ identityText }}\n</identity>{{ if hasFunctions }}\n\n"
      "<available_functions>\n**Available Functions**: You can call the following functions to complete the task:\n\n{{ functionsList }}\n\n"
      "## Function Call Instructions\n- Complete the task, using the functions defined earlier in this prompt.\n- Output fields should only be generated after all functions have been called.\n- Use the function results to generate the output fields.\n</available_functions>{{ /if }}\n\n"
      "<input_fields>\n{{ inputFieldsSection }}\n</input_fields>{{ if hasOutputFields }}\n\n<output_fields>\n{{ outputFieldsSection }}\n</output_fields>{{ /if }}\n"
      "{{ if hasTaskDefinition }}\n\n<task_definition>\n{{ taskDefinitionText }}\n</task_definition>{{ /if }}\n\n<formatting_rules>\n{{ if hasStructuredOutputFunction }}\n"
      "Return the complete output by calling " + bt + "{{ structuredOutputFunctionName }}" + bt + ".\n{{ else }}{{ if hasComplexFields }}\nReturn valid JSON matching <output_fields>.\n{{ else }}\nReturn one " + bt + "field name: value" + bt + " pair per line for the required output fields only.\n{{ /if }}{{ /if }}Above rules override later instructions.\n\n</formatting_rules>\n{{ if hasExampleDemonstrations }}\n\n## Example Demonstrations\nThe following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.\n{{ /if }}\n";
  std::string context = "template:dsp/dspy.md";
  if (!get_key(options, "custom_template").is_null()) { source = str(get_key(options, "custom_template")); context = "inline-template"; }
  return string_trim(render_template_content(source, Value(vars), context));
}
Value Core::prompt_user_content(Value signature, Value values) {
  Array parts;
  for (const auto& field : prompt_inputs_for_values(signature, values)) {
    std::string name = str(get_key(field, "name"));
    Value value = get_key(values, name);
    if (!prompt_provided(value)) {
      if (truthy(get_key(field, "isOptional")) || truthy(get_key(field, "isInternal"))) continue;
      throw AxError("runtime", "Value for input field '" + name + "' is required.");
    }
    std::string rendered = value.is_string() ? str(value) : stringify(value);
    Value part(Object{{"type", "text"}, {"text", str(get_key(field, "title")) + ": " + rendered + "\n"}});
    if (truthy(get_key(field, "isCached"))) Core::set(part, "cache", true);
    parts.emplace_back(part);
  }
  bool all_text = true;
  for (const auto& part : parts) if (str(get_key(part, "type")) != "text" || truthy(get_key(part, "cache"))) all_text = false;
  if (!all_text) return Value(parts);
  std::string out;
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i) out += "\n";
    out += str(get_key(parts[i], "text"));
  }
  return Value(out);
}
static std::string axgen_value_text(Value value) {
  return value.is_string() ? str(value) : stringify(value);
}
static std::string axgen_format_values(Value gen, Value values, const std::string& kind) {
  std::vector<std::string> lines;
  for (const auto& field : array_ref(Core::get(Core::get(gen, "signature"), kind + "_fields", Value::array()))) {
    std::string name = str(get_key(field, "name"));
    if (!get_key(values, name).is_null()) lines.push_back(str(get_key(field, "title", name)) + ": " + axgen_value_text(get_key(values, name)));
  }
  if (lines.empty()) {
    for (const auto& entry : object_ref(values)) lines.push_back(entry.first + ": " + axgen_value_text(entry.second));
  }
  std::string out;
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) out += "\n";
    out += lines[i];
  }
  return out;
}
static Value axgen_render_turns(Value gen, Value turns, const std::string& label) {
  Array out;
  for (const auto& item : array_ref(turns)) {
    if (label == "Demo" && get_key(item, "input", get_key(item, "values")).is_null()) continue;
    Value input = get_key(item, "input", get_key(item, "values", Value::object()));
    Value output = get_key(item, "output", get_key(item, "expected_output", Value::object()));
    Value user = Value::object();
    Core::set(user, "role", "user");
    Core::set(user, "content", label + " Input:\n" + axgen_format_values(gen, input, "input"));
    out.push_back(user);
    Value assistant = Value::object();
    Core::set(assistant, "role", "assistant");
    Core::set(assistant, "content", label + " Output:\n" + axgen_format_values(gen, output, "output"));
    out.push_back(assistant);
  }
  return Value(out);
}
Value Core::axgen_render_examples(Value gen) {
  if (truthy(get(get(gen, "options", Value::object()), "examplesInSystem"))) return Value::array();
  return axgen_render_turns(gen, get(gen, "examples", Value::array()), "Example");
}
Value Core::axgen_render_demos(Value gen) {
  if (truthy(get(get(gen, "options", Value::object()), "examplesInSystem"))) return Value::array();
  return axgen_render_turns(gen, get(gen, "demos", Value::array()), "Demo");
}
Value Core::axgen_apply_context_cache(Value gen, Value raw_messages, Value runtime_options) {
  Value messages = Value::array();
  for (const auto& raw : array_ref(raw_messages)) append(messages, Value(object_ref(raw)));
  Value options = map_merge(get(gen, "options", Value::object()), runtime_options);
  if (truthy(get_key(options, "examplesInSystem")) && !array_ref(messages).empty()) {
    std::vector<std::string> blocks;
    for (const auto& message : array_ref(axgen_render_turns(gen, get(gen, "examples", Value::array()), "Example"))) blocks.push_back(str(get_key(message, "content", "")));
    for (const auto& message : array_ref(axgen_render_turns(gen, get(gen, "demos", Value::array()), "Demo"))) blocks.push_back(str(get_key(message, "content", "")));
    if (!blocks.empty()) {
      std::string joined;
      for (size_t i = 0; i < blocks.size(); ++i) { if (i) joined += "\n\n"; joined += blocks[i]; }
      Value first = list_get(messages, 0, Value::object());
      set(first, "content", str(get_key(first, "content", "")) + "\n\n--- EXAMPLES ---\n" + joined + "\n--- END OF EXAMPLES ---");
      Array arr = array_ref(messages);
      if (!arr.empty()) {
        arr[0] = first;
        messages = Value(arr);
      }
    }
  }
  Value context_cache = get_key(options, "context_cache", get_key(options, "contextCache"));
  if (!truthy(context_cache) || truthy(get_key(options, "ignore_cache_breakpoints"))) return messages;
  if (!array_ref(messages).empty()) {
    Value first = list_get(messages, 0, Value::object());
    set(first, "cache", true);
    Array arr = array_ref(messages);
    if (!arr.empty()) {
      arr[0] = first;
      messages = Value(arr);
    }
  }
  std::string breakpoint = context_cache.is_object() ? str(get_key(context_cache, "breakpoint", get_key(context_cache, "cache_breakpoint", get_key(context_cache, "cacheBreakpoint", "after_examples")))) : "after_examples";
  if (breakpoint.empty() || breakpoint == "after_examples" || breakpoint == "afterExamples") {
    Array arr = array_ref(messages);
    for (int i = static_cast<int>(arr.size()) - 2; i >= 0; --i) {
      if (str(get_key(arr[i], "role")) == "assistant" || str(get_key(arr[i], "role")) == "tool") {
        Value item = arr[static_cast<size_t>(i)];
        set(item, "cache", true);
        arr[static_cast<size_t>(i)] = item;
        messages = Value(arr);
        break;
      }
    }
  }
  return messages;
}
Value Core::axgen_apply_field_processors(Value gen, Value output) {
  Value result(object_ref(output));
  bool changed = false;
  for (const auto& raw : array_ref(get(gen, "field_processors", Value::array()))) {
    std::string field = str(get_key(raw, "field", get_key(raw, "name")));
    if (field.empty() || get_key(result, field).is_null()) continue;
    Value processor = get_key(raw, "processor", get_key(raw, "op"));
    std::string processor_id = str(get_key(raw, "__processor_id"));
    if (!processor_id.empty()) {
      auto it = processor_registry().find(processor_id);
      if (it != processor_registry().end()) {
        set(result, field, it->second(get_key(result, field)));
        changed = true;
        continue;
      }
    }
    std::string op = str(processor);
    std::string value = str(get_key(result, field));
    if (op == "uppercase") {
      std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
      set(result, field, value);
      changed = true;
    } else if (op == "lowercase") {
      std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      set(result, field, value);
      changed = true;
    } else if (op == "trim") {
      set(result, field, str(string_trim(value)));
      changed = true;
    } else if (op.rfind("prefix:", 0) == 0) {
      set(result, field, op.substr(7) + value);
      changed = true;
    } else if (op.rfind("suffix:", 0) == 0) {
      set(result, field, value + op.substr(7));
      changed = true;
    }
  }
  if (changed) {
    Value memory = get(gen, "memory", Value::object());
    Value items = get_key(memory, "items", Value::array());
    Value item(Object{{"role", "processor"}, {"output", result}, {"tags", Value(Array{Value("processor")})}});
    append(items, item);
    set(memory, "items", items);
    set(gen, "memory", memory);
  }
  return result;
}
Value Core::axgen_run_assertions(Value gen, Value output) {
  for (const auto& raw : array_ref(get(gen, "assertions", Value::array()))) {
    std::string assertion_id = str(get_key(raw, "__assertion_id"));
    if (!assertion_id.empty()) {
      auto it = assertion_registry().find(assertion_id);
      if (it != assertion_registry().end()) {
        Value returned = it->second(output);
        if (returned.is_string()) throw AxError("runtime", str(returned));
        if (returned.is_bool() && !truthy(returned)) throw AxError("runtime", "assertion failed");
      }
      continue;
    }
    std::string field = str(get_key(raw, "field"));
    Value value = field.empty() ? output : get_key(output, field);
    std::string message = str(get_key(raw, "message", "assertion failed"));
    Value returned = get_key(raw, "return");
    if (!returned.is_null()) {
      if (returned.is_bool() && !truthy(returned) && get_key(raw, "message").is_null()) throw AxError("runtime", "assertion failed without message");
      if (returned.is_bool() && !truthy(returned)) throw AxError("runtime", message);
      if (returned.is_string()) throw AxError("runtime", str(returned));
    }
    Value contains = get_key(raw, "contains");
    if (!contains.is_null() && str(value).find(str(contains)) == std::string::npos) throw AxError("runtime", message);
    Value equals = get_key(raw, "equals");
    if (!equals.is_null() && !equal(value, equals)) throw AxError("runtime", message);
  }
  return Value();
}
Value Core::axgen_record_trace(Value gen, Value input, Value output, Value status) {
  Value traces = get(gen, "traces", Value::array());
  Value trace = Value::object();
  set(trace, "status", status);
  set(trace, "input", input);
  set(trace, "output", output);
  set(trace, "chat_log", get(gen, "chat_log", Value::array()));
  set(trace, "function_calls", get(gen, "function_call_traces", Value::array()));
  append(traces, trace);
  set(gen, "traces", traces);
  return Value();
}
Value Core::axgen_memory_add_request(Value gen, Value messages) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "request"}, {"messages", messages}, {"tags", Value::array()}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_add_response(Value gen, Value request, Value response) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "assistant"}, {"response", response}, {"tags", Value::array()}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_add_function_result(Value gen, Value call, Value result, Value ok) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "function"}, {"results", Value(Array{Value(Object{{"call", call}, {"result", result}, {"ok", Value(truthy(ok))}})})}, {"tags", Value::array()}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_add_correction(Value gen, Value response, Value error) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "user"}, {"content", std::string("Correction: ") + str(exception_message(error))}, {"response", response}, {"tags", Value(Array{Value("correction")})}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_cleanup_corrections(Value gen) {
  Value memory = get(gen, "memory", Value::object());
  Array kept;
  for (const auto& item : array_ref(get_key(memory, "items", Value::array()))) {
    bool has = false;
    for (const auto& tag : array_ref(get_key(item, "tags", Value::array()))) if (str(tag) == "correction") has = true;
    if (!has) kept.push_back(item);
  }
  set(memory, "items", Value(kept));
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_record_chat_log(Value gen, Value request, Value response) {
  Value chat_log = get(gen, "chat_log", Value::array());
  Value entry(Object{
      {"model", get_key(request, "model")},
      {"messages", get_key(request, "chat_prompt", Value::array())},
      {"response", response},
      {"remote_id", get_key(response, "remote_id", get_key(response, "id"))},
      {"session_id", get_key(response, "session_id")},
      {"usage", get_key(response, "usage", get_key(response, "model_usage"))},
      {"function_calls", get_key(response, "function_calls", Value::array())},
  });
  append(chat_log, entry);
  set(gen, "chat_log", chat_log);
  return Value();
}
Value Core::axgen_record_function_call(Value gen, Value call, Value result, Value status) {
  Value traces = get(gen, "function_call_traces", Value::array());
  Value fn = get_key(call, "function");
  Value record(Object{
      {"name", fn.is_object() ? get_key(fn, "name") : get_key(call, "name")},
      {"id", get_key(call, "id")},
      {"args", get_key(call, "params", get_key(call, "args", Value::object()))},
      {"status", status},
      {"result", result},
  });
  append(traces, record);
  set(gen, "function_call_traces", traces);
  std::string hook_id = str(get_key(get(gen, "options", Value::object()), "__function_hook_id"));
  if (!hook_id.empty()) {
    auto it = function_hook_registry().find(hook_id);
    if (it != function_hook_registry().end()) {
      try { it->second(record); } catch (...) {}
    }
  }
  return Value();
}
Value Core::axgen_should_continue_steps(Value gen, Value calls) {
  std::set<std::string> stops;
  for (const auto& item : array_ref(get(gen, "stop_functions", Value::array()))) stops.insert(str(item));
  if (stops.empty()) return Value(true);
  for (const auto& call : array_ref(calls)) {
    Value fn = get_key(call, "function");
    std::string name = fn.is_object() ? str(get_key(fn, "name")) : str(get_key(call, "name"));
    if (stops.count(name) > 0) return Value(false);
  }
  return Value(true);
}
Value Core::stream_event_content_parts(Value event) {
  if (event.is_string()) return Value(Array{event});
  Value data = event;
  Value nested = get_key(data, "data");
  if (nested.is_object()) data = nested;
  std::string type = str(get_key(data, "type"));
  if (type == "done" || type == "message_stop") return Value::array();
  if (!get_key(data, "results").is_null()) {
    Array out;
    for (const auto& result : array_ref(get_key(data, "results"))) out.emplace_back(str(get_key(result, "content", "")));
    return Value(out);
  }
  return Value(Array{get_key(data, "delta", get_key(data, "content_delta", get_key(data, "contentDelta", get_key(data, "text", get_key(data, "content", "")))) )});
}

Value Core::openai_normalize_chat_response(Value raw) { return openai_normalize_chat_response(std::move(raw), "openai", Value()); }
Value Core::openai_normalize_stream_delta(Value raw, Value state) { return openai_normalize_stream_delta(std::move(raw), std::move(state), "openai", Value()); }
Value Core::openai_normalize_embed_response(Value raw) { return openai_normalize_embed_response(std::move(raw), "openai", Value()); }

// AXIR_CORE_CPP_FUNCTIONS

Value parse_json(const std::string& source) {
  struct Parser {
    std::string s;
    size_t pos = 0;
    explicit Parser(std::string src) : s(std::move(src)) {}
    void skip() { while (pos < s.size() && std::isspace(static_cast<unsigned char>(s[pos]))) ++pos; }
    char peek() { skip(); return pos < s.size() ? s[pos] : '\0'; }
    bool match(char c) { skip(); if (pos < s.size() && s[pos] == c) { ++pos; return true; } return false; }
    void expect(char c) { skip(); if (pos >= s.size() || s[pos] != c) throw AxError("json", std::string("expected ") + c); ++pos; }
    Value value() {
      skip();
      if (match('{')) return object();
      if (match('[')) return array();
      if (peek() == '"') return string();
      if (s.compare(pos, 4, "true") == 0) { pos += 4; return Value(true); }
      if (s.compare(pos, 5, "false") == 0) { pos += 5; return Value(false); }
      if (s.compare(pos, 4, "null") == 0) { pos += 4; return Value(); }
      return number();
    }
    Value object() {
      Object out;
      Array order;
      skip(); if (match('}')) return Value(out);
      while (true) {
        std::string k = str(string());
        expect(':');
        order.emplace_back(k);
        out[k] = value();
        out["__order"] = order;
        skip();
        if (match('}')) return Value(out);
        expect(',');
      }
    }
    Value array() {
      Array out;
      skip(); if (match(']')) return Value(out);
      while (true) {
        out.push_back(value());
        skip();
        if (match(']')) return Value(out);
        expect(',');
      }
    }
    Value string() {
      expect('"');
      std::string out;
      while (pos < s.size()) {
        char c = s[pos++];
        if (c == '"') break;
        if (c == '\\' && pos < s.size()) {
          char e = s[pos++];
          if (e == 'n') c = '\n';
          else if (e == 't') c = '\t';
          else if (e == 'r') c = '\r';
          else c = e;
        }
        out.push_back(c);
      }
      return Value(out);
    }
    Value number() {
      size_t start = pos;
      if (pos < s.size() && s[pos] == '-') ++pos;
      while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) ++pos;
      if (pos < s.size() && s[pos] == '.') { ++pos; while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) ++pos; }
      if (pos < s.size() && (s[pos] == 'e' || s[pos] == 'E')) { ++pos; if (pos < s.size() && (s[pos] == '+' || s[pos] == '-')) ++pos; while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) ++pos; }
      return Value(std::stod(s.substr(start, pos - start)));
    }
  };
  Parser p(source);
  return p.value();
}

std::string display(const Value& value) {
  if (auto p = std::get_if<double>(&value.data)) {
    if (std::floor(*p) == *p) return std::to_string(static_cast<long long>(*p));
    std::ostringstream ss; ss << *p; return ss.str();
  }
  return str(value);
}

static std::string escape_json(const std::string& in) {
  std::string out;
  for (char c : in) {
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else out.push_back(c);
  }
  return out;
}

std::string stringify(const Value& value) {
  if (value.is_null()) return "null";
  if (auto p = std::get_if<bool>(&value.data)) return *p ? "true" : "false";
  if (value.is_number()) return display(value);
  if (auto p = std::get_if<std::string>(&value.data)) return "\"" + escape_json(*p) + "\"";
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) {
    std::string out = "[";
    for (size_t i = 0; i < (*p)->size(); ++i) { if (i) out += ","; out += stringify((**p)[i]); }
    return out + "]";
  }
  std::string out = "{";
  size_t i = 0;
  for (const auto& kv : entries(value)) { if (i++) out += ","; out += "\"" + escape_json(kv.first) + "\":" + stringify(kv.second); }
  return out + "}";
}

static std::string stable_stringify(const Value& value) {
  if (value.is_null()) return "null";
  if (auto p = std::get_if<bool>(&value.data)) return *p ? "true" : "false";
  if (value.is_number()) return display(value);
  if (auto p = std::get_if<std::string>(&value.data)) return "\"" + escape_json(*p) + "\"";
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) {
    std::string out = "[";
    for (size_t i = 0; i < (*p)->size(); ++i) { if (i) out += ","; out += stable_stringify((**p)[i]); }
    return out + "]";
  }
  std::string out = "{";
  size_t i = 0;
  for (const auto& kv : object_ref(value)) {
    if (kv.first == "__order") continue;
    if (i++) out += ",";
    out += "\"" + escape_json(kv.first) + "\":" + stable_stringify(kv.second);
  }
  return out + "}";
}

bool equal(const Value& left, const Value& right) {
  if (left.is_number() && right.is_number()) return std::fabs(num(left) - num(right)) < 0.0000001;
  if (left.data.index() != right.data.index()) return false;
  if (left.is_null()) return true;
  if (left.is_bool()) return std::get<bool>(left.data) == std::get<bool>(right.data);
  if (left.is_string()) return std::get<std::string>(left.data) == std::get<std::string>(right.data);
  if (left.is_array()) {
    const auto& a = array_ref(left); const auto& b = array_ref(right);
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) if (!equal(a[i], b[i])) return false;
    return true;
  }
  auto a = object_ref(left); auto b = object_ref(right);
  a.erase("__order"); b.erase("__order");
  if (a.size() != b.size()) return false;
  for (const auto& kv : a) { auto it = b.find(kv.first); if (it == b.end() || !equal(kv.second, it->second)) return false; }
  return true;
}

Value AIClient::chat(Value request) {
  return Core::legacy_response_to_chat_response(complete(std::move(request)));
}

std::string AxAIService::get_id() { return get_name() + "-id"; }
std::string AxAIService::get_name() { return "ai"; }
Value AxAIService::chat(Value request) { return AIClient::chat(std::move(request)); }
Value AxAIService::chat(Value request, Value) { return chat(std::move(request)); }
std::vector<Value> AxAIService::stream(Value request) { return {chat(std::move(request))}; }
Value AxAIService::embed(Value request, Value) { return embed(std::move(request)); }
Value AxAIService::transcribe(Value) { throw Core::as_error(Core::ai_error_unsupported("transcribe is not supported by this generated AxAI beta provider")); }
Value AxAIService::transcribe(Value request, Value) { return transcribe(std::move(request)); }
Value AxAIService::speak(Value) { throw Core::as_error(Core::ai_error_unsupported("speak is not supported by this generated AxAI beta provider")); }
Value AxAIService::speak(Value request, Value) { return speak(std::move(request)); }
Value AxAIService::get_features(Value) {
  return Value(Object{{"functions", true}, {"streaming", true}, {"structured_outputs", true}, {"multi_turn", true}});
}
Value AxAIService::get_model_list() { return Value(); }
Value AxAIService::get_metrics() { return Value::object(); }
std::function<void(std::string)> AxAIService::get_logger() { return [](std::string) {}; }
double AxAIService::get_estimated_cost(Value) { return 0.0; }
Value AxAIService::get_options() { return Value::object(); }
void AxAIService::set_options(Value) {}
Value AxAIService::get_last_used_chat_model() { return Value(); }
Value AxAIService::get_last_used_embed_model() { return Value(); }
Value AxAIService::get_last_used_model_config() { return Value(); }

AxBaseAI::AxBaseAI(std::string name, std::string model, std::string embed_model, Value model_config, Value options)
    : name_(std::move(name)),
      model_(std::move(model)),
      embed_model_(std::move(embed_model)),
      model_config_(Value(Object{{"temperature", 0}})),
      options_(std::move(options)) {
  if (model_.empty()) throw AxError("runtime", "No model defined");
  model_config_ = Core::map_merge(model_config_, std::move(model_config));
}

Value AxBaseAI::chat(Value request) {
  return chat(std::move(request), options_);
}

Value AxBaseAI::chat(Value request, Value call_options) {
  Value req = Core::coerce_chat_request(std::move(request));
  Core::validate_chat_request(req);
  Value merged_options = Core::map_merge(options_, std::move(call_options));
  Value selected_model = Core::get(req, "model", model_);
  Value merged_config = Core::merge_model_config(model_config_, Core::get(req, "model_config"), merged_options);
  Core::set(req, "model", selected_model);
  Core::set(req, "model_config", merged_config);
  last_used_chat_model_ = selected_model;
  last_used_model_config_ = merged_config;
  return do_chat(req, merged_options);
}

Value AxBaseAI::complete(Value request) {
  return Core::chat_response_to_completion(chat(Core::coerce_chat_request(std::move(request))));
}

Value AxBaseAI::embed(Value request) {
  return embed(std::move(request), options_);
}

Value AxBaseAI::embed(Value request, Value call_options) {
  Value texts = Core::get(request, "texts");
  if (!texts.is_array() || array_ref(texts).empty()) throw Core::as_error(Core::ai_error_response("Embed texts is empty"));
  Value selected = Core::get(request, "embed_model", Core::get(request, "embedModel", embed_model_));
  if (!Core::truthy(selected)) throw Core::as_error(Core::ai_error_response("Embed model not set"));
  Value req(object_ref(request));
  Core::set(req, "embed_model", selected);
  last_used_embed_model_ = selected;
  Value merged_options = Core::map_merge(options_, std::move(call_options));
  return do_embed(req, merged_options);
}

Value AxBaseAI::get_features(Value) { return AxAIService::get_features(Value()); }
std::string AxBaseAI::get_id() { return name_ + "-id"; }
std::string AxBaseAI::get_name() { return name_; }
Value AxBaseAI::get_metrics() { return Value::object(); }
Value AxBaseAI::get_options() { return options_; }
void AxBaseAI::set_options(Value options) { options_ = std::move(options); }
Value AxBaseAI::get_last_used_chat_model() { return last_used_chat_model_; }
Value AxBaseAI::get_last_used_embed_model() { return last_used_embed_model_; }
Value AxBaseAI::get_last_used_model_config() { return last_used_model_config_; }

static std::string option_string(Value options, const std::string& snake, const std::string& camel, const std::string& fallback) {
  Value value = Core::get(options, snake, Core::get(options, camel));
  return value.is_null() ? fallback : display(value);
}

static std::string env_or_default(const char* name, const std::string& fallback) {
  const char* value = std::getenv(name);
  return value == nullptr ? fallback : std::string(value);
}

static std::string strip_trailing_slashes(std::string value) {
  while (!value.empty() && value.back() == '/') value.pop_back();
  return value;
}

static std::string url_component(std::string value) {
  std::ostringstream out;
  for (unsigned char ch : value) {
    if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
      out << static_cast<char>(ch);
    } else {
      out << '%' << std::uppercase << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(ch) << std::nouppercase << std::dec;
    }
  }
  return out.str();
}

OpenAICompatibleClient::OpenAICompatibleClient(Value options, Transport* transport)
    : OpenAICompatibleClient("openai-compatible", "openai", std::move(options), transport, "gpt-4.1-mini", "text-embedding-3-small") {}

OpenAICompatibleClient::OpenAICompatibleClient(std::string profile, std::string name, Value options, Transport* transport, std::string default_model, std::string default_embed_model)
    : AxBaseAI(
          std::move(name),
          option_string(options, "model", "model", default_model),
          option_string(options, "embed_model", "embedModel", default_embed_model),
          Core::get(options, "model_config", Value::object()),
          Core::get(options, "options", Value::object())),
      profile_(std::move(profile)),
      descriptor_(Core::provider_descriptor(profile_)),
      base_url_(strip_trailing_slashes(option_string(options, "base_url", "baseUrl", env_or_default("OPENAI_BASE_URL", str(Core::get(Core::provider_descriptor(profile_), "baseUrl", "https://api.openai.com/v1")))))),
      api_key_(option_string(options, "api_key", "apiKey", env_or_default("OPENAI_API_KEY", ""))),
      api_version_(option_string(options, "api_version", "apiVersion", str(Core::get(descriptor_, "apiVersion", "")))),
      timeout_seconds_(Core::get(options, "timeout", 60).is_number() ? num(Core::get(options, "timeout", 60)) : 60.0),
      transport_(transport) {}

OpenAIResponsesClient::OpenAIResponsesClient(Value options, Transport* transport)
    : OpenAICompatibleClient("openai-responses", "openai-responses", std::move(options), transport, "gpt-4o", "text-embedding-ada-002") {}

GoogleGeminiClient::GoogleGeminiClient(Value options, Transport* transport)
    : OpenAICompatibleClient("google-gemini", "GoogleGeminiAI", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("GOOGLE_API_KEY", env_or_default("GEMINI_API_KEY", "")));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("GOOGLE_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"));
        return out;
      }(), transport, "gemini-2.5-flash", "gemini-embedding-2") {}

AnthropicClient::AnthropicClient(Value options, Transport* transport)
    : OpenAICompatibleClient("anthropic", "anthropic", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("ANTHROPIC_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"));
        return out;
      }(), transport, "claude-3-7-sonnet-latest", "") {}

AzureOpenAIClient::AzureOpenAIClient(Value options, Transport* transport)
    : OpenAICompatibleClient("azure-openai", "Azure OpenAI", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("AZURE_OPENAI_API_KEY", ""));
        std::string version = option_string(out, "api_version", "apiVersion", option_string(out, "version", "version", "2024-02-15-preview"));
        std::string marker = "api-version=";
        auto idx = version.find(marker);
        if (idx != std::string::npos) {
          version = version.substr(idx + marker.size());
          auto amp = version.find('&');
          if (amp != std::string::npos) version = version.substr(0, amp);
        }
        Core::set(out, "api_version", version);
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) {
          std::string env_base = env_or_default("AZURE_OPENAI_BASE_URL", "");
          if (!env_base.empty()) {
            Core::set(out, "base_url", env_base);
          } else {
            std::string resource = option_string(out, "resource_name", "resourceName", env_or_default("AZURE_OPENAI_RESOURCE_NAME", ""));
            std::string deployment = option_string(out, "deployment_name", "deploymentName", env_or_default("AZURE_OPENAI_DEPLOYMENT_NAME", ""));
            if (!resource.empty() && !deployment.empty()) {
              std::string host = resource.find("://") == std::string::npos ? "https://" + resource + ".openai.azure.com" : resource;
              Core::set(out, "base_url", strip_trailing_slashes(host) + "/openai/deployments/" + url_component(deployment));
            }
          }
        }
        return out;
      }(), transport, "gpt-5-mini", "text-embedding-3-small") {}

DeepSeekClient::DeepSeekClient(Value options, Transport* transport)
    : OpenAICompatibleClient("deepseek", "DeepSeek", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("DEEPSEEK_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("DEEPSEEK_BASE_URL", "https://api.deepseek.com"));
        return out;
      }(), transport, "deepseek-v4-flash", "") {}

MistralClient::MistralClient(Value options, Transport* transport)
    : OpenAICompatibleClient("mistral", "Mistral", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("MISTRAL_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("MISTRAL_BASE_URL", "https://api.mistral.ai/v1"));
        return out;
      }(), transport, "mistral-small-latest", "mistral-embed") {}

RekaClient::RekaClient(Value options, Transport* transport)
    : OpenAICompatibleClient("reka", "Reka", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("REKA_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("REKA_BASE_URL", "https://api.reka.ai/v1"));
        return out;
      }(), transport, "reka-core", "") {}

CohereClient::CohereClient(Value options, Transport* transport)
    : OpenAICompatibleClient("cohere", "Cohere", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("COHERE_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("COHERE_BASE_URL", "https://api.cohere.ai/compatibility/v1"));
        return out;
      }(), transport, "command-r-plus", "embed-english-v3.0") {}

GrokClient::GrokClient(Value options, Transport* transport)
    : OpenAICompatibleClient("grok", "Grok", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("XAI_API_KEY", env_or_default("GROK_API_KEY", "")));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("XAI_BASE_URL", env_or_default("GROK_BASE_URL", "https://api.x.ai/v1")));
        return out;
      }(), transport, "grok-4.3", "") {}

Value OpenAICompatibleClient::do_chat(Value request, Value) {
  Value payload = Core::provider_build_chat_request(profile_, request);
  bool stream = Core::truthy(Core::get(payload, "stream"));
  if (stream) {
    Value model = Core::get(request, "model", Core::get(payload, "model", model_));
    Value raw = request_json(operation_path("stream_chat", model), payload, true);
    Value state = Value::object();
    Value results = Value::array();
    for (const auto& event : iter_sse_json(raw)) {
      Core::append(results, Core::provider_normalize_stream_delta(profile_, event, state, name_, model));
    }
    return Value(Object{{"results", results}});
  }
  Value model = Core::get(request, "model", Core::get(payload, "model", model_));
  Value raw = request_json(operation_path("chat", model), payload, false);
  return Core::provider_normalize_chat_response(profile_, raw, name_, model);
}

Value OpenAICompatibleClient::do_embed(Value request, Value) {
  Value payload = Core::provider_build_embed_request(profile_, request);
  Value model = Core::get(request, "embed_model", Core::get(request, "embedModel", Core::get(payload, "model", embed_model_)));
  Value raw = request_json(operation_path("embed", model), payload, false);
  return Core::provider_normalize_embed_response(profile_, raw, name_, model);
}

std::vector<Value> OpenAICompatibleClient::stream(Value request) {
  Value req = Core::coerce_chat_request(std::move(request));
  Core::validate_chat_request(req);
  Value config = Core::merge_model_config(model_config_, Core::get(req, "model_config"), Value(Object{{"stream", true}}));
  Core::set(config, "stream", true);
  Core::set(req, "model", Core::get(req, "model", model_));
  Core::set(req, "model_config", config);
  Value payload = Core::provider_build_chat_request(profile_, req);
  Value model = Core::get(req, "model", Core::get(payload, "model", model_));
  Value raw = request_json(operation_path("stream_chat", model), payload, true);
  Value state = Value::object();
  std::vector<Value> out;
  for (const auto& event : iter_sse_json(raw)) out.push_back(Core::provider_normalize_stream_delta(profile_, event, state, name_, model));
  return out;
}

Value OpenAICompatibleClient::transcribe(Value request) {
  Value payload = Core::provider_build_transcribe_request(profile_, request);
  Value raw = request_json(operation_path("transcribe"), payload, false, "data");
  return Core::provider_normalize_transcribe_response(profile_, raw);
}

Value OpenAICompatibleClient::speak(Value request) {
  Value payload = Core::provider_build_speak_request(profile_, request);
  Value raw = request_json(operation_path("speak"), payload, false);
  return Core::provider_normalize_speak_response(profile_, raw, request);
}

std::vector<Value> OpenAICompatibleClient::realtime(Value events) {
  std::vector<Value> out;
  Value state = Value::object();
  for (const auto& event : array_ref(events)) out.push_back(Core::provider_normalize_realtime_event(profile_, event, state, name_, model_));
  return out;
}

Value OpenAICompatibleClient::headers() const {
  Value headers = Value::object();
  Core::set(headers, "Content-Type", "application/json");
  if (str(Core::get(descriptor_, "auth")) == "bearer") Core::set(headers, "Authorization", "Bearer " + api_key_);
  if (str(Core::get(descriptor_, "auth")) == "anthropic_key") Core::set(headers, "x-api-key", api_key_);
  if (str(Core::get(descriptor_, "auth")) == "api_key_header") Core::set(headers, str(Core::get(descriptor_, "apiKeyHeader", "api-key")), api_key_);
  for (const auto& entry : object_ref(Core::get(descriptor_, "headers", Value::object()))) {
    Core::set(headers, entry.first, str(entry.second));
  }
  return headers;
}

Value OpenAICompatibleClient::request_json(const std::string& endpoint, Value payload, bool stream) {
  return request_json(endpoint, std::move(payload), stream, "json");
}

Value OpenAICompatibleClient::request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key) {
  Value call = Value::object();
  Core::set(call, "method", "POST");
  Core::set(call, "url", base_url_ + endpoint);
  Core::set(call, "headers", headers());
  Core::set(call, body_key.empty() ? "json" : body_key, payload);
  Core::set(call, "stream", stream);
  if (transport_ != nullptr) return transport_result(transport_->call(call), call);
  if (api_key_.empty() || api_key_ == "null") throw Core::as_error(Core::ai_error_auth("OPENAI_API_KEY is required", Value(), Value(), Value(), call));
  throw Core::as_error(Core::ai_error_unsupported("C++ OpenAI network transport is not implemented in generated alpha"));
}

std::string OpenAICompatibleClient::operation_path(const std::string& operation) const {
  return operation_path(operation, Value());
}

std::string OpenAICompatibleClient::operation_path(const std::string& operation, Value model) const {
  std::string path = str(Core::get(Core::provider_operation_descriptor(profile_, operation), "path", "/" + operation));
  if (!model.is_null()) {
    std::string token = "{model}";
    std::string::size_type pos = 0;
    while ((pos = path.find(token, pos)) != std::string::npos) {
      path.replace(pos, token.size(), url_component(str(model)));
      pos += str(model).size();
    }
  }
  if (str(Core::get(descriptor_, "auth")) == "api_key_query") {
    std::string key = str(Core::get(descriptor_, "apiKeyQuery", "key"));
    path += (path.find('?') == std::string::npos ? "?" : "&") + url_component(key) + "=" + url_component(api_key_);
  }
  if (!api_version_.empty() && api_version_ != "null") {
    path += (path.find('?') == std::string::npos ? "?" : "&") + std::string("api-version=") + url_component(api_version_);
  }
  return path;
}

Value OpenAICompatibleClient::transport_result(Value result, Value request) {
  if (result.is_object() && has_key(result, "status")) {
    int status = static_cast<int>(num(Core::get(result, "status", 200)));
    Value body = Core::get(result, "json", Core::get(result, "body", Core::get(result, "data")));
    if (status >= 400) throw Core::as_error(Core::openai_normalize_error(status, body, request));
    return body;
  }
  return result;
}

std::vector<Value> OpenAICompatibleClient::iter_sse_json(Value raw) {
  std::vector<Value> out;
  if (raw.is_array()) {
    for (const auto& item : array_ref(raw)) if (display(item) != "[DONE]") out.push_back(item);
    return out;
  }
  std::istringstream lines(display(raw));
  std::string line;
  while (std::getline(lines, line)) {
    Value trimmed = Core::string_trim(line);
    std::string text = display(trimmed);
    if (text.rfind("data:", 0) != 0) continue;
    std::string data = display(Core::string_trim(text.substr(5)));
    if (data.empty() || data == "[DONE]") continue;
    out.push_back(parse_json(data));
  }
  return out;
}

Tool::Tool(std::string name_, std::string description_, Value parameters_, std::function<Value(Value)> handler_, Value args_, Value returns_)
    : id(pointer_id(this)),
      name(std::move(name_)),
      description(std::move(description_)),
      parameters(std::move(parameters_)),
      args(std::move(args_)),
      returns(std::move(returns_)),
      handler(std::move(handler_)) {
  tool_registry()[id] = handler ? handler : [](Value) { return Value(); };
}

Value Tool::value() const {
  return Value(Object{
      {"__tool_id", id},
      {"name", name},
      {"description", description},
      {"parameters", parameters},
      {"args", args},
      {"returns", returns},
  });
}

AxMemory::AxMemory() : items_(Value(Object{{"items", Value::array()}})) {}
AxMemory& AxMemory::add_request(Value messages) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "request"}, {"messages", messages}, {"tags", Value::array()}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::add_response(Value response) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "assistant"}, {"response", response}, {"tags", Value::array()}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::update_result(Value response) { return add_response(std::move(response)); }
AxMemory& AxMemory::add_function_results(Value results) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "function"}, {"results", results.is_array() ? results : Value(Array{results})}, {"tags", Value::array()}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::add_processor_output(Value output) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "processor"}, {"output", output}, {"tags", Value(Array{Value("processor")})}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::add_correction(Value response, Value error_message) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "user"}, {"content", std::string("Correction: ") + str(error_message)}, {"response", response}, {"tags", Value(Array{Value("correction")})}}));
  Core::set(items_, "items", items);
  return *this;
}
Value AxMemory::history() const { return Core::get(items_, "items", Value::array()); }
Value AxMemory::get_last() const {
  Array arr = array_ref(history());
  return arr.empty() ? Value() : arr.back();
}
AxMemory& AxMemory::add_tag(const std::string& tag) {
  Array arr = array_ref(history());
  if (!arr.empty()) {
    Value item = arr.back();
    Value tags = Core::get(item, "tags", Value::array());
    Core::append(tags, tag);
    Core::set(item, "tags", tags);
    arr[arr.size() - 1] = item;
    Core::set(items_, "items", Value(arr));
  }
  return *this;
}
AxMemory& AxMemory::rewind_to_tag(const std::string& tag) {
  Array arr = array_ref(history());
  for (int i = static_cast<int>(arr.size()) - 1; i >= 0; --i) {
    bool has = false;
    for (const auto& t : array_ref(Core::get(arr[static_cast<size_t>(i)], "tags", Value::array()))) if (str(t) == tag) has = true;
    if (has) {
      arr.erase(arr.begin() + i + 1, arr.end());
      Core::set(items_, "items", Value(arr));
      return *this;
    }
  }
  return *this;
}
AxMemory& AxMemory::remove_by_tag(const std::string& tag) {
  Array kept;
  for (const auto& item : array_ref(history())) {
    bool has = false;
    for (const auto& t : array_ref(Core::get(item, "tags", Value::array()))) if (str(t) == tag) has = true;
    if (!has) kept.push_back(item);
  }
  Core::set(items_, "items", Value(kept));
  return *this;
}
Value AxMemory::value() const { return items_; }
Value& AxMemory::value_ref() { return items_; }

AxGen::AxGen(Value signature, Value options) {
  state_ = Value::object();
  Core::set(state_, "signature", std::move(signature));
  Core::set(state_, "options", options);
  Core::set(state_, "functions", Core::get(options, "functions", Value::array()));
  Core::set(state_, "examples", Core::get(options, "examples", Value::array()));
  Core::set(state_, "demos", Core::get(options, "demos", Value::array()));
  Core::set(state_, "assertions", Core::get(options, "assertions", Value::array()));
  Core::set(state_, "field_processors", Core::get(options, "field_processors", Core::get(options, "fieldProcessors", Value::array())));
  Core::set(state_, "stop_functions", Core::get(options, "stop_functions", Core::get(options, "stopFunctions", Value::array())));
  Core::set(state_, "program_id", Core::get(options, "id", Core::get(options, "program_id", Core::get(options, "programId", Value("root")))));
  Core::set(state_, "instruction", Core::get(options, "instruction", Value("")));
  Core::set(state_, "memory", memory_.value());
  Core::set(state_, "chat_log", Value::array());
  Core::set(state_, "function_call_traces", Value::array());
  Core::set(state_, "traces", Value::array());
  refresh_prompt_template();
}

void AxGen::refresh_prompt_template() {
  Value prompt = Value::object();
  Core::set(prompt, "__kind", "PromptTemplate");
  Core::set(prompt, "signature", Core::get(state_, "signature"));
  Core::set(prompt, "functions", Core::get(state_, "functions", Value::array()));
  Core::set(prompt, "options", Core::get(state_, "options", Value::object()));
  Core::set(state_, "prompt_template", prompt);
}

AxGen& AxGen::add_tool(const Tool& tool) {
  Value functions = Core::get(state_, "functions", Value::array());
  Core::append(functions, tool.value());
  Core::set(state_, "functions", functions);
  refresh_prompt_template();
  return *this;
}

AxGen& AxGen::set_examples(Value examples) {
  Core::set(state_, "examples", examples);
  return *this;
}

AxGen& AxGen::set_demos(Value demos) {
  Core::set(state_, "demos", demos);
  return *this;
}

AxGen& AxGen::add_assertion(Value assertion) {
  Value assertions = Core::get(state_, "assertions", Value::array());
  Core::append(assertions, assertion);
  Core::set(state_, "assertions", assertions);
  return *this;
}

AxGen& AxGen::add_assertion(std::function<Value(Value)> assertion) {
  std::string id = pointer_id(this) + ":assert:" + std::to_string(assertion_registry().size());
  assertion_registry()[id] = std::move(assertion);
  Value spec = Value::object();
  Core::set(spec, "__assertion_id", id);
  return add_assertion(spec);
}

AxGen& AxGen::add_field_processor(std::string field, std::string op) {
  Value processors = Core::get(state_, "field_processors", Value::array());
  Value spec = Value::object();
  Core::set(spec, "field", std::move(field));
  Core::set(spec, "processor", std::move(op));
  Core::append(processors, spec);
  Core::set(state_, "field_processors", processors);
  return *this;
}

AxGen& AxGen::add_field_processor(std::string field, std::function<Value(Value)> processor) {
  std::string id = pointer_id(this) + ":processor:" + std::to_string(processor_registry().size());
  processor_registry()[id] = std::move(processor);
  Value processors = Core::get(state_, "field_processors", Value::array());
  Value spec = Value::object();
  Core::set(spec, "field", std::move(field));
  Core::set(spec, "__processor_id", id);
  Core::append(processors, spec);
  Core::set(state_, "field_processors", processors);
  return *this;
}

AxGen& AxGen::on_function_call(std::function<void(Value)> hook) {
  std::string id = pointer_id(this) + ":function_hook";
  function_hook_registry()[id] = std::move(hook);
  Value options = Core::get(state_, "options", Value::object());
  Core::set(options, "__function_hook_id", id);
  Core::set(state_, "options", options);
  return *this;
}

AxGen& AxGen::set_stop_functions(Value names) {
  Core::set(state_, "stop_functions", names);
  return *this;
}

AxGen& AxGen::set_instruction(Value instruction) {
  Core::set(state_, "instruction", instruction);
  Value options = Core::get(state_, "options", Value::object());
  Core::set(options, "instruction", instruction);
  Core::set(state_, "options", options);
  refresh_prompt_template();
  return *this;
}

Value AxGen::get_instruction() const {
  return Core::get(state_, "instruction", Value(""));
}

AxGen& AxGen::clear_instruction() {
  return set_instruction(Value(""));
}

Value AxGen::get_optimizable_components() const {
  Value components = Value::array();
  Value owner = Core::get(state_, "program_id", Value("root"));
  Value signature = Core::get(state_, "signature", Value::object());
  Value description = Core::get(signature, "description", Value());
  if (!description.is_null() && !str(description).empty()) {
    Core::append(components, Core::_optimization_component(
        Value(str(owner) + "::description"),
        owner,
        Value("description"),
        description,
        Value("Program signature description."),
        array({Value("Preserve the task intent and field references.")}),
        Value::array(),
        Value(false),
        Value("markdown"),
        object({{"required_placeholders", Value::array()}})));
  }
  Core::append(components, Core::_optimization_component(
      Value(str(owner) + "::instruction"),
      owner,
      Value("instruction"),
      Core::get(state_, "instruction", Value("")),
      Value("Prompt instruction text used by this generator."),
      array({Value("Keep required input and output fields intact.")}),
      Value::array(),
      Value(false),
      Value("markdown"),
      object({{"required_placeholders", Value::array()}})));
  for (const auto& fn : array_ref(Core::get(state_, "functions", Value::array()))) {
    Value name = Core::get(fn, "name", Value(""));
    if (str(name).empty()) continue;
    Value desc = Core::get(fn, "description", Value(""));
    Core::append(components, Core::_optimization_component(
        Value(str(owner) + "::fn:" + str(name) + ":desc"),
        owner,
        Value("fn-desc"),
        desc,
        Value("Description for tool " + str(name) + "."),
        array({Value("Non-empty, concise, and faithful to the tool behavior.")}),
        Value::array(),
        Value(false),
        Value("text"),
        object({{"maxLength", Value(320)}})));
    Core::append(components, Core::_optimization_component(
        Value(str(owner) + "::fn:" + str(name) + ":name"),
        owner,
        Value("fn-name"),
        name,
        Value("Callable name for tool " + str(name) + "."),
        array({Value("snake_case"), Value("32 characters or fewer"), Value("unique among tools")}),
        Value::array(),
        Value(true),
        Value("snake_case"),
        object({{"pattern", Value("^[a-z][a-z0-9_]{0,31}$")}})));
  }
  return components;
}

AxGen& AxGen::apply_optimized_components(Value component_map) {
  Value owner = Core::get(state_, "program_id", Value("root"));
  Value instruction_id(str(owner) + "::instruction");
  if (Core::truthy(Core::map_contains(component_map, instruction_id))) set_instruction(Core::get(component_map, instruction_id, Value("")));
  Value description_id(str(owner) + "::description");
  if (Core::truthy(Core::map_contains(component_map, description_id))) Core::set(state_, "optimized_description", Core::get(component_map, description_id, Value("")));
  Value functions = Core::get(state_, "functions", Value::array());
  Array out;
  for (const auto& raw_fn : array_ref(functions)) {
    Value fn = raw_fn;
    Value name = Core::get(fn, "name", Value(""));
    Value desc_id(str(owner) + "::fn:" + str(name) + ":desc");
    Value name_id(str(owner) + "::fn:" + str(name) + ":name");
    if (Core::truthy(Core::map_contains(component_map, desc_id))) Core::set(fn, "description", Core::get(component_map, desc_id, Value("")));
    if (Core::truthy(Core::map_contains(component_map, name_id))) Core::set(fn, "name", Core::get(component_map, name_id, name));
    out.push_back(fn);
  }
  Core::set(state_, "functions", Value(out));
  refresh_prompt_template();
  return *this;
}

AxGen& AxGen::apply_optimization(Value artifact) {
  Value components = get_optimizable_components();
  Value map = artifact.is_string() ? Core::_deserialize_optimized_artifact(artifact, components) : Core::_validate_optimized_artifact(artifact, components);
  return apply_optimized_components(Core::get(map, "componentMap", Value::object()));
}

static int gepa_int(Value value, int fallback) {
  if (value.is_null()) return fallback;
  if (value.is_number()) return static_cast<int>(std::floor(num(value)));
  try {
    return std::stoi(display(value));
  } catch (...) {
    return fallback;
  }
}

static double gepa_num(Value value, double fallback = 0.0) {
  if (value.is_null()) return fallback;
  if (value.is_number()) return num(value);
  try {
    return std::stod(display(value));
  } catch (...) {
    return fallback;
  }
}

static Value gepa_current_map(Value components) {
  Value out = Value::object();
  for (const auto& raw : Core::iter(components)) {
    std::string id = display(Core::get(raw, "id", Value("")));
    Value current = Core::get(raw, "current", Value(""));
    if (!id.empty() && current.is_string()) Core::set(out, id, current);
  }
  return out;
}

static Value gepa_dataset_for(const std::vector<Value>& examples) {
  Value train = Value::array();
  for (const auto& example : examples) Core::append(train, example);
  Value out = Value::object();
  Core::set(out, "train", train);
  Core::set(out, "validation", Value::array());
  return out;
}

static std::vector<Value> gepa_train(Value dataset) {
  return Core::iter(Core::get(dataset, "train", Value::array()));
}

static std::vector<Value> gepa_validation(Value dataset) {
  std::vector<Value> validation = Core::iter(Core::get(dataset, "validation", Value::array()));
  if (validation.empty()) return gepa_train(dataset);
  return validation;
}

static Value gepa_avg_vec(Value rows) {
  std::map<std::string, double> sums;
  std::map<std::string, int> counts;
  for (const auto& row : Core::iter(rows)) {
    for (const auto& kv : object_ref(Core::get(row, "scores", Value::object()))) {
      if (kv.second.is_number()) {
        sums[kv.first] += num(kv.second);
        counts[kv.first] += 1;
      }
    }
  }
  Value out = Value::object();
  for (const auto& kv : sums) Core::set(out, kv.first, Value(kv.second / std::max(1, counts[kv.first])));
  return out;
}

static double gepa_scalar(Value scores, Value options) {
  Value key = Core::get(options, "paretoMetricKey", Core::get(options, "pareto_metric_key", Value()));
  if (!key.is_null()) return gepa_num(Core::get(scores, display(key), Value()), 0.0);
  double sum = 0.0;
  int count = 0;
  for (const auto& kv : object_ref(scores)) {
    if (kv.second.is_number()) {
      sum += num(kv.second);
      count += 1;
    }
  }
  return count == 0 ? 0.0 : sum / count;
}

static bool gepa_dominates(Value a, Value b, double eps) {
  std::set<std::string> keys;
  for (const auto& kv : object_ref(a)) keys.insert(kv.first);
  for (const auto& kv : object_ref(b)) keys.insert(kv.first);
  bool at_least = true;
  bool strict = false;
  for (const auto& key : keys) {
    double av = gepa_num(Core::get(a, key, Value(0)), 0.0);
    double bv = gepa_num(Core::get(b, key, Value(0)), 0.0);
    if (av + eps < bv) {
      at_least = false;
      break;
    }
    if (av > bv + eps) strict = true;
  }
  return at_least && strict;
}

struct GepCandidate {
  Value cfg;
  Value scores;
  int parent = -1;
};

static Value gepa_pareto_front(const std::vector<GepCandidate>& candidates, double eps) {
  Value front = Value::array();
  for (size_t i = 0; i < candidates.size(); ++i) {
    bool dominated = false;
    int dominated_count = 0;
    for (size_t j = 0; j < candidates.size(); ++j) {
      if (i == j) continue;
      if (gepa_dominates(candidates[j].scores, candidates[i].scores, eps)) {
        dominated = true;
        break;
      }
      if (gepa_dominates(candidates[i].scores, candidates[j].scores, eps)) dominated_count += 1;
    }
    if (!dominated) {
      Value item = Value::object();
      Core::set(item, "idx", Value(static_cast<int>(i)));
      Core::set(item, "scores", candidates[i].scores);
      Core::set(item, "dominated", Value(dominated_count));
      Core::append(front, item);
    }
  }
  return front;
}

static std::string gepa_extract_text(Value response) {
  Value results = Core::get(response, "results", Value::array());
  if (Core::iter(results).empty()) return "";
  std::string text = display(Core::get(Core::iter(results)[0], "content", Value("")));
  auto trim = [](std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    return s;
  };
  text = trim(text);
  const std::string prefix = "New Value:";
  if (text.rfind(prefix, 0) == 0) return trim(text.substr(prefix.size()));
  const std::string fence = "\x60\x60\x60";
  size_t start = text.find(fence);
  size_t end = text.rfind(fence);
  if (start != std::string::npos && end != std::string::npos && end > start) {
    std::string inner = trim(text.substr(start + 3, end - start - 3));
    size_t newline = inner.find('\n');
    if (newline != std::string::npos) inner = inner.substr(newline + 1);
    return trim(inner);
  }
  return text;
}

static Value gepa_validate_value(Value component, const std::string& value) {
  if (value.empty()) return Value("component value must be a non-empty string");
  if (display(Core::get(component, "format", Value(""))) == "snake_case") {
    if (!std::regex_match(value, std::regex("^[a-z_][a-z0-9_]*$"))) return Value("must be snake_case");
  }
  Value max_len = Core::get(component, "maxLength", Value());
  if (max_len.is_number() && value.size() > static_cast<size_t>(num(max_len))) return Value("must be at most " + display(max_len) + " characters");
  for (const auto& literal : Core::iter(Core::get(component, "preserve", Value::array()))) {
    if (value.find(display(literal)) == std::string::npos) return Value("must preserve " + display(literal));
  }
  return Value(true);
}

static void gepa_component_visit(const std::string& id, const std::map<std::string, Value>& by_id, std::set<std::string>& seen, std::vector<Value>& out) {
  if (seen.count(id) != 0) return;
  auto it = by_id.find(id);
  if (it == by_id.end()) return;
  seen.insert(id);
  out.push_back(it->second);
  Value deps = Core::get(it->second, "dependsOn", Core::get(it->second, "depends_on", Value::array()));
  for (const auto& dep : Core::iter(deps)) gepa_component_visit(display(dep), by_id, seen, out);
}

static std::vector<Value> gepa_component_group(Value target, const std::vector<Value>& components) {
  std::map<std::string, Value> by_id;
  for (const auto& component : components) by_id[display(Core::get(component, "id", Value("")))] = component;
  std::vector<Value> out;
  std::set<std::string> seen;
  gepa_component_visit(display(Core::get(target, "id", Value(""))), by_id, seen, out);
  return out;
}

AxGEPA::AxGEPA(AIClient* reflection_client, Value options)
    : reflection_client_(reflection_client), options_(std::move(options)), rng_state_(123456789), selector_state_(Value::object()) {
  int seed = gepa_int(Core::get(options_, "seed", Value(123456789)), 123456789);
  rng_state_ = static_cast<uint32_t>(seed == 0 ? 123456789 : seed);
}

std::string AxGEPA::name() const { return "GEPA"; }
std::string AxGEPA::version() const { return "axir-gepa-v1"; }
Value AxGEPA::optimize(Value request) { return optimize(std::move(request), nullptr); }

double AxGEPA::rand() {
  rng_state_ ^= (rng_state_ << 13);
  rng_state_ ^= (rng_state_ >> 17);
  rng_state_ ^= (rng_state_ << 5);
  return static_cast<double>(rng_state_) / 4294967296.0;
}

Value AxGEPA::optimize(Value request, OptimizerEvaluator* evaluator) {
  if (evaluator == nullptr) throw AxError("runtime", "AxGEPA requires an OptimizerEvaluator");
  Value options = Core::map_merge(Value::object(), options_);
  options = Core::map_merge(options, Core::get(request, "options", Value::object()));
  Value components = Core::get(request, "components", Value::array());
  if (Core::iter(components).empty()) throw AxError("runtime", "AxGEPA: program exposes no optimizable components");
  Value dataset = Core::get(request, "dataset", Value::object());
  std::vector<Value> train = gepa_train(dataset);
  std::vector<Value> validation = gepa_validation(dataset);
  int max_calls = gepa_int(Core::get(options, "maxMetricCalls", Core::get(options, "max_metric_calls", Value(0))), 0);
  if (max_calls <= 0) throw AxError("runtime", "AxGEPA: options.maxMetricCalls must be set to a positive integer");
  int num_trials = gepa_int(Core::get(options, "numTrials", Core::get(options, "num_trials", Value(30))), 30);
  bool minibatch = !Core::truthy(Core::eq(Core::get(options, "minibatch", Value(true)), Value(false)));
  int minibatch_size = std::max(1, gepa_int(Core::get(options, "minibatchSize", Core::get(options, "minibatch_size", Value(20))), 20));
  int early_stop = std::max(1, gepa_int(Core::get(options, "earlyStoppingTrials", Core::get(options, "early_stopping_trials", Value(5))), 5));
  double min_improvement = gepa_num(Core::get(options, "minImprovementThreshold", Core::get(options, "min_improvement_threshold", Value(0))), 0.0);
  int pareto_size = std::min(1000, std::max(1, gepa_int(Core::get(options, "paretoSetSize", Core::get(options, "pareto_set_size", Value(std::max(10, std::min(200, minibatch_size * 3))))), 10)));
  double tie_eps = gepa_num(Core::get(options, "tieEpsilon", Core::get(options, "tie_epsilon", Value(0))), 0.0);
  Value base_cfg = gepa_current_map(components);
  std::vector<Value> pareto_set(validation.begin(), validation.begin() + std::min(validation.size(), static_cast<size_t>(pareto_size)));
  selector_state_ = Value::object();
  Value initial_selector = Core::get(options, "selectorState", Core::get(options, "selector_state", Value::object()));
  for (const auto& raw : Core::iter(components)) {
    std::string id = display(Core::get(raw, "id", Value("")));
    Value old = Core::get(initial_selector, id, Value::object());
    Value state = Value::object();
    Core::set(state, "proposals", Value(std::max(0, gepa_int(Core::get(old, "proposals", Value(0)), 0))));
    Core::set(state, "accepts", Value(std::max(0, gepa_int(Core::get(old, "accepts", Value(0)), 0))));
    Core::set(state, "lastAcceptIter", Value(gepa_int(Core::get(old, "lastAcceptIter", Value(-1)), -1)));
    Core::set(state, "stagnation", Value(std::max(0, gepa_int(Core::get(old, "stagnation", Value(0)), 0))));
    Core::set(selector_state_, id, state);
  }

  int total_calls = 0;
  auto evaluate = [&](Value cfg, const std::vector<Value>& examples, const std::string& phase, bool required, bool capture) -> Value {
    if (total_calls + static_cast<int>(examples.size()) > max_calls) {
      if (required) throw AxError("runtime", "AxGEPA: options.maxMetricCalls=" + std::to_string(max_calls) + " is too small to evaluate the initial Pareto set; need at least " + std::to_string(examples.size()) + " metric calls");
      return Value();
    }
    Value eval_options = Value::object();
    Core::set(eval_options, "dataset", gepa_dataset_for(examples));
    Core::set(eval_options, "phase", Value(phase));
    Core::set(eval_options, "captureTraces", Value(capture));
    Value result = evaluator->evaluate(cfg, eval_options);
    total_calls += static_cast<int>(gepa_num(Core::get(result, "count", Value(static_cast<int>(examples.size()))), examples.size()));
    Value rows = Core::get(result, "rows", Value::array());
    Value scalars = Value::array();
    for (const auto& row : Core::iter(rows)) Core::append(scalars, Core::get(row, "scalar", Value(0)));
    Value out = Value::object();
    Core::set(out, "rows", rows);
    Core::set(out, "avgScores", gepa_avg_vec(rows));
    Core::set(out, "avg", Core::get(result, "avg", Value(0)));
    Core::set(out, "sum", Core::get(result, "sum", Value(0)));
    Core::set(out, "scalars", scalars);
    return out;
  };

  Value demos = Value::array();
  if (Core::truthy(Core::get(options, "bootstrap", Value(false)))) {
    Value bootstrap = Core::get(options, "bootstrap", Value::object());
    double threshold = gepa_num(Core::get(bootstrap, "scoreThreshold", Core::get(bootstrap, "score_threshold", Value(0.8))), 0.8);
    int max_demos = std::max(1, gepa_int(Core::get(bootstrap, "maxBootstrapDemos", Core::get(bootstrap, "max_bootstrap_demos", Value(4))), 4));
    int max_boot_calls = std::max(1, gepa_int(Core::get(bootstrap, "maxBootstrapMetricCalls", Core::get(bootstrap, "max_bootstrap_metric_calls", Value(static_cast<int>(std::min<size_t>(train.size(), 8))))), static_cast<int>(std::min<size_t>(train.size(), 8))));
    int boot_calls = 0;
    for (const auto& example : train) {
      if (boot_calls >= max_boot_calls || static_cast<int>(Core::iter(demos).size()) >= max_demos) break;
      Value boot_eval = evaluate(base_cfg, std::vector<Value>{example}, "bootstrap", false, false);
      boot_calls += 1;
      if (boot_eval.is_null()) break;
      std::vector<Value> rows = Core::iter(Core::get(boot_eval, "rows", Value::array()));
      if (!rows.empty() && gepa_num(Core::get(rows[0], "scalar", Value(0)), 0.0) >= threshold) {
        Value demo = Value::object();
        Core::set(demo, "programId", Value("root"));
        Value traces = Value::array();
        Core::append(traces, Core::get(rows[0], "prediction", Core::get(rows[0], "input", Value::object())));
        Core::set(demo, "traces", traces);
        Core::append(demos, demo);
      }
    }
  }

  Value base_eval = evaluate(base_cfg, pareto_set, "initial Pareto evaluation", true, false);
  std::vector<GepCandidate> candidates{{base_cfg, Core::get(base_eval, "avgScores", Value::object()), -1}};
  std::vector<std::vector<double>> per_instance;
  std::vector<double> base_scalars;
  for (const auto& scalar : Core::iter(Core::get(base_eval, "scalars", Value::array()))) base_scalars.push_back(gepa_num(scalar, 0.0));
  per_instance.push_back(base_scalars);
  int stagnation = 0;
  std::vector<Value> component_list = Core::iter(components);

  for (int iteration = 0; iteration < num_trials; ++iteration) {
    if (total_calls >= max_calls) break;
    int parent_idx = 0;
    double parent_avg = -1e100;
    for (size_t i = 0; i < per_instance.size(); ++i) {
      double sum = 0.0;
      for (double v : per_instance[i]) sum += v;
      double avg = per_instance[i].empty() ? 0.0 : sum / per_instance[i].size();
      if (avg > parent_avg) {
        parent_avg = avg;
        parent_idx = static_cast<int>(i);
      }
    }
    std::vector<Value> mini;
    if (minibatch) {
      for (int i = 0; i < std::min(minibatch_size, static_cast<int>(train.size())); ++i) mini.push_back(train[(iteration * minibatch_size + i) % train.size()]);
    } else {
      mini = train;
    }
    Value parent_eval = evaluate(candidates[parent_idx].cfg, mini, "parent minibatch", false, true);
    if (parent_eval.is_null()) break;
    double perfect = gepa_num(Core::get(options, "perfectScore", Core::get(options, "perfect_score", Value(1))), 1.0);
    bool all_perfect = !Core::iter(Core::get(parent_eval, "scalars", Value::array())).empty();
    for (const auto& score : Core::iter(Core::get(parent_eval, "scalars", Value::array()))) if (gepa_num(score, 0.0) < perfect) all_perfect = false;
    if (!Core::truthy(Core::eq(Core::get(options, "skipPerfectScore", Core::get(options, "skip_perfect_score", Value(true))), Value(false))) && all_perfect) continue;
    Value target = component_list.empty() ? Value::object() : component_list[static_cast<size_t>(std::floor(rand() * component_list.size())) % component_list.size()];
    std::vector<Value> group = gepa_component_group(target, component_list);
    Value proposed = Core::map_merge(Value::object(), candidates[parent_idx].cfg);
    Value rows = Core::get(parent_eval, "rows", Value::array());
    Value tuples = Value::array();
    Value trace_dataset = Value::array();
    for (const auto& row : Core::iter(rows)) {
      Value tuple = Value::object();
      Core::set(tuple, "input", Core::get(row, "input", Value()));
      Core::set(tuple, "prediction", Core::get(row, "prediction", Value()));
      Core::set(tuple, "score", Core::get(row, "scalar", Value(0)));
      Core::append(tuples, tuple);
      Value trace = Value::object();
      Core::set(trace, "score", Core::get(row, "scalar", Value(0)));
      Core::set(trace, "trace", Core::get(row, "trace", Value()));
      Core::set(trace, "output", Core::get(row, "prediction", Value()));
      Core::append(trace_dataset, trace);
    }
    if (reflection_client_ == nullptr) throw AxError("runtime", "AxGEPA requires a reflection_client for reflective trials");
    for (const auto& group_target : group) {
      std::string target_id = display(Core::get(group_target, "id", Value("")));
      Value state = Core::get(selector_state_, target_id, Value::object());
      Core::set(state, "proposals", Value(gepa_int(Core::get(state, "proposals", Value(0)), 0) + 1));
      Core::set(selector_state_, target_id, state);
      std::string current = display(Core::get(proposed, target_id, Value("")));
      std::string candidate_text = current;
      Value previous;
      for (int attempt = 0; attempt < 2; ++attempt) {
        Value payload = Value::object();
        Core::set(payload, "componentKey", Value(target_id));
        Core::set(payload, "componentKind", Core::get(group_target, "kind", Value("component")));
        Core::set(payload, "currentValue", Value(current));
        Core::set(payload, "previousValidationError", previous);
        Core::set(payload, "minibatch", tuples);
        Core::set(payload, "traceDataset", trace_dataset);
        Value request_chat = Value::object();
        Value messages = Value::array();
        Value message = Value::object();
        Core::set(message, "role", Value("user"));
        Core::set(message, "content", Core::json_stringify(payload));
        Core::append(messages, message);
        Core::set(request_chat, "chatPrompt", messages);
        candidate_text = gepa_extract_text(reflection_client_->chat(request_chat));
        Value validation = gepa_validate_value(group_target, candidate_text);
        if (Core::truthy(Core::eq(validation, Value(true)))) break;
        previous = validation;
        candidate_text = current;
      }
      Core::set(proposed, target_id, Value(candidate_text));
    }
    Value child_mini = evaluate(proposed, mini, "child minibatch", false, false);
    if (child_mini.is_null()) break;
    bool accepted = gepa_num(Core::get(child_mini, "sum", Value(0)), 0.0) > gepa_num(Core::get(parent_eval, "sum", Value(0)), 0.0) + min_improvement;
    for (const auto& group_target : group) {
      std::string target_id = display(Core::get(group_target, "id", Value("")));
      Value state = Core::get(selector_state_, target_id, Value::object());
      if (accepted) {
        Core::set(state, "accepts", Value(gepa_int(Core::get(state, "accepts", Value(0)), 0) + 1));
        Core::set(state, "lastAcceptIter", Value(iteration));
        Core::set(state, "stagnation", Value(0));
      } else {
        Core::set(state, "stagnation", Value(gepa_int(Core::get(state, "stagnation", Value(0)), 0) + 1));
      }
      Core::set(selector_state_, target_id, state);
    }
    if (!accepted) {
      if (++stagnation >= early_stop) break;
      continue;
    }
    Value child_eval = evaluate(proposed, pareto_set, "validation evaluation", false, false);
    if (child_eval.is_null()) break;
    candidates.push_back(GepCandidate{proposed, Core::get(child_eval, "avgScores", Value::object()), parent_idx});
    std::vector<double> child_scalars;
    for (const auto& scalar : Core::iter(Core::get(child_eval, "scalars", Value::array()))) child_scalars.push_back(gepa_num(scalar, 0.0));
    per_instance.push_back(child_scalars);
    stagnation = 0;
  }

  Value front = gepa_pareto_front(candidates, tie_eps);
  int best_idx = 0;
  double best_score = -1e100;
  for (const auto& item : Core::iter(front)) {
    int idx = static_cast<int>(gepa_num(Core::get(item, "idx", Value(0)), 0));
    double score = gepa_scalar(Core::get(item, "scores", Value::object()), options);
    if (score > best_score) {
      best_score = score;
      best_idx = idx;
    }
  }
  Value owners = Value::object();
  for (const auto& component : component_list) {
    std::string id = display(Core::get(component, "id", Value("")));
    std::string owner = display(Core::get(component, "owner", Value(id.substr(0, id.find("::")))));
    Core::set(owners, id, Value(owner));
  }
  Value metadata = Value::object();
  Core::set(metadata, "optimizer", Value("GEPA"));
  Core::set(metadata, "selectorState", selector_state_);
  Core::set(metadata, "paretoFront", front);
  Core::set(metadata, "bestScore", Value(best_score == -1e100 ? 0.0 : best_score));
  Core::set(metadata, "totalMetricCalls", Value(total_calls));
  Core::set(metadata, "candidatesExplored", Value(static_cast<int>(candidates.size())));
  Value report = Value::object();
  Core::set(report, "summary", Value("GEPA Multi-Objective Optimization Complete"));
  Value stats = Value::object();
  Core::set(stats, "totalEvaluations", Value(total_calls));
  Core::set(stats, "candidatesExplored", Value(static_cast<int>(candidates.size())));
  Core::set(stats, "converged", Value(true));
  Core::set(report, "statistics", stats);
  Core::set(metadata, "report", report);
  Value artifact = Value::object();
  Core::set(artifact, "artifactVersion", Value("axir-optimized-artifact-v1"));
  Core::set(artifact, "optimizerName", Value("GEPA"));
  Core::set(artifact, "optimizerVersion", Value(version()));
  Core::set(artifact, "componentMap", candidates[static_cast<size_t>(best_idx)].cfg);
  Core::set(artifact, "demos", demos);
  Core::set(artifact, "metadata", metadata);
  Value evidence = Value::object();
  Core::set(evidence, "avg", Value(best_score == -1e100 ? 0.0 : best_score));
  Core::set(evidence, "count", Value(static_cast<int>(pareto_set.size())));
  Core::set(evidence, "totalMetricCalls", Value(total_calls));
  Core::set(artifact, "evidence", evidence);
  Value provenance = Value::object();
  Core::set(provenance, "sourceProgramKind", Core::get(request, "programKind", Value("unknown")));
  Core::set(provenance, "componentOwners", owners);
  Core::set(artifact, "provenance", provenance);
  return artifact;
}

Value AxGen::evaluate_optimization(AIClient& client, Value dataset, Value candidate_map, Value options) {
  Value normalized = Core::_normalize_optimization_dataset(dataset.is_null() ? Value::array() : dataset);
  Value rows = Value::array();
  Value original = Core::_optimization_component_current_map(get_optimizable_components());
  try {
    if (Core::truthy(candidate_map)) apply_optimized_components(candidate_map);
    for (const auto& raw_task : Core::iter(Core::get(normalized, "train", Value::array()))) {
      Value task = raw_task;
      Value prediction = Value::object();
      Value error;
      try {
        Value output = forward(client, Core::get(task, "input", task), Core::get(options, "forward_options", Value::object()));
        prediction = object({{"completionType", "final"}, {"output", output}, {"finalOutput", output}, {"functionCalls", get_function_call_traces()}, {"actionLog", get_chat_log()}, {"usage", Value::object()}, {"trace", object({{"traces", get_traces()}})}});
      } catch (const AxError& e) {
        error = object({{"message", Value(std::string(e.what()))}});
        prediction = object({{"completionType", "error"}, {"error", error}, {"functionCalls", get_function_call_traces()}, {"actionLog", get_chat_log()}, {"usage", Value::object()}, {"trace", object({{"traces", get_traces()}})}});
      }
      Value default_score = Core::truthy(Core::eq(Core::get(prediction, "completionType", Value("")), Value("error"))) ? Value(0) : Value(1);
      Value raw_score = Core::get(task, "metric_score", Core::get(task, "scores", Core::get(task, "score", default_score)));
      Value scores = Core::_normalize_optimization_metric_scores(raw_score);
      Value scalar = Core::_adjust_optimization_score_for_actions(Core::_scalarize_optimization_scores(scores, options), task, prediction);
      Core::append(rows, Core::_build_optimization_eval_row(task, prediction, scores, scalar, Core::get(prediction, "trace"), error));
    }
    Value result = Core::_build_optimization_eval_result(rows, candidate_map, Core::get(options, "phase", Value("train")));
    apply_optimized_components(original);
    return result;
  } catch (...) {
    apply_optimized_components(original);
    throw;
  }
}

struct AxGenOptimizerEvaluator : OptimizerEvaluator {
  AxGen& gen;
  AIClient& client;
  Value dataset;
  Value options;
  AxGenOptimizerEvaluator(AxGen& gen_, AIClient& client_, Value dataset_, Value options_)
      : gen(gen_), client(client_), dataset(std::move(dataset_)), options(std::move(options_)) {}
  Value evaluate(Value candidate_map, Value eval_options = Value::object()) override {
    Value merged = Core::map_merge(options, eval_options);
    Value eval_dataset = Core::get(merged, "dataset", Core::get(merged, "_dataset", dataset));
    return gen.evaluate_optimization(client, eval_dataset, std::move(candidate_map), merged);
  }
};

Value AxGen::optimize_with(OptimizerEngine& engine, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axgen"), components, dataset.is_null() ? Value::array() : dataset, options, object({{"traces", get_traces()}, {"chat_log", get_chat_log()}}), Value(false));
  Value request = Core::get(run, "request", Value::object());
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}

Value AxGen::optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axgen"), components, dataset.is_null() ? Value::array() : dataset, options, object({{"traces", get_traces()}, {"chat_log", get_chat_log()}}), Value(true));
  Value request = Core::get(run, "request", Value::object());
  AxGenOptimizerEvaluator evaluator(*this, client, dataset, options);
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request, &evaluator), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}

Value AxGen::get_traces() const {
  return Core::get(state_, "traces", Value::array());
}

Value AxGen::get_chat_log() const {
  return Core::get(state_, "chat_log", Value::array());
}

Value AxGen::get_function_call_traces() const {
  return Core::get(state_, "function_call_traces", Value::array());
}

AxMemory& AxGen::get_memory() {
  memory_.value_ref() = Core::get(state_, "memory", memory_.value());
  return memory_;
}

Value AxGen::forward(AIClient& client, Value values, Value options) {
  return Core::_forward_impl(state_, Core::client_ref(client), std::move(values), std::move(options));
}

Value AxGen::value() const { return state_; }

AxFlow::AxFlow(Value options) {
  state_ = Core::_flow_factory(std::move(options));
}

AxFlow& AxFlow::execute(std::string name, AxProgram& program, Value options) {
  return add_step(Value("execute"), Value(std::move(name)), Core::agent_stage_ref(program), std::move(options));
}

AxFlow& AxFlow::derive(std::string name, AxProgram& program, Value options) {
  return add_step(Value("derive"), Value(std::move(name)), Core::agent_stage_ref(program), std::move(options));
}

AxFlow& AxFlow::map(std::string name, std::function<Value(Value)> mapper) {
  return map(std::move(name), std::move(mapper), Value::object());
}

AxFlow& AxFlow::map(std::string name, std::function<Value(Value)> mapper, Value options) {
  return add_step(Value("map"), Value(std::move(name)), register_flow_mapper(pointer_id(this), std::move(mapper)), std::move(options));
}

AxFlow& AxFlow::branch(std::string name, std::function<Value(Value)> predicate, Value branches, Value options) {
  Core::set(options, "predicate", register_flow_mapper(pointer_id(this), std::move(predicate)));
  Core::set(options, "branches", std::move(branches));
  return add_step(Value("branch"), Value(std::move(name)), Value(), std::move(options));
}

AxFlow& AxFlow::while_loop(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations, Value options) {
  Core::set(options, "condition", register_flow_mapper(pointer_id(this), std::move(condition)));
  Core::set(options, "steps", std::move(steps));
  Core::set(options, "maxIterations", Value(static_cast<double>(max_iterations)));
  return add_step(Value("while"), Value(std::move(name)), Value(), std::move(options));
}

AxFlow& AxFlow::feedback(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations, Value options) {
  Core::set(options, "condition", register_flow_mapper(pointer_id(this), std::move(condition)));
  Core::set(options, "steps", std::move(steps));
  Core::set(options, "maxIterations", Value(static_cast<double>(max_iterations)));
  Core::set(options, "label", Value(name));
  return add_step(Value("feedback"), Value(std::move(name)), Value(), std::move(options));
}

AxFlow& AxFlow::node_extended(std::string name, Value base_signature, Value extensions, Value options) {
  Value signature = Core::get(extensions, "extended_signature", Core::get(extensions, "extendedSignature", base_signature));
  auto* gen = new AxGen(Core::parse_signature(signature), options);
  return execute(std::move(name), *gen, std::move(options));
}

AxFlow& AxFlow::nx(std::string name, Value base_signature, Value extensions, Value options) {
  return node_extended(std::move(name), std::move(base_signature), std::move(extensions), std::move(options));
}

AxFlow& AxFlow::parallel(Value steps) {
  for (const auto& raw_step : array_ref(steps)) {
    Value step = raw_step;
    add_step(
      Core::get(step, "kind", Value("execute")),
      Core::get(step, "name", Value("parallel")),
      Core::get(step, "program", Value()),
      Core::get(step, "options", Value::object())
    );
  }
  return *this;
}

AxFlow& AxFlow::returns(Value spec) {
  state_ = Core::_flow_set_returns(state_, std::move(spec));
  return *this;
}

AxFlow& AxFlow::set_demos(Value demos) {
  if (demos.is_array()) {
    std::string owner = str(Core::get(state_, "program_id", Value("root.flow")));
    std::set<std::string> known_ids;
    known_ids.insert(owner);
    known_ids.insert("root");
    Value steps = Core::get(state_, "steps", Value::array());
    for (const auto& raw_step : array_ref(steps)) {
      std::string name = str(Core::get(raw_step, "name", Value("")));
      if (!name.empty()) {
        known_ids.insert(owner + "." + name);
        known_ids.insert("root." + name);
      }
    }
    std::set<std::string> unknown;
    for (const auto& raw_demo : array_ref(demos)) {
      Value id = Core::get(raw_demo, "programId", Value());
      if (!id.is_null() && known_ids.find(str(id)) == known_ids.end()) unknown.insert(str(id));
    }
    if (!unknown.empty()) throw AxError("runtime", "Unknown program ID(s) in demos: " + *unknown.begin());
    Core::set(state_, "demos", std::move(demos));
    return *this;
  }
  Value steps = Core::get(state_, "steps", Value::array());
  for (const auto& kv : object_ref(demos)) {
    if (kv.first == "__order") continue;
    bool found = false;
    for (const auto& raw_step : array_ref(steps)) {
      if (str(Core::get(raw_step, "name", Value(""))) == kv.first) found = true;
    }
    if (!found) throw AxError("runtime", "unknown flow node in demos: " + kv.first);
  }
  Core::set(state_, "demos", std::move(demos));
  return *this;
}

Value AxFlow::forward(AIClient& client, Value values, Value options) {
  return Core::_flow_forward(state_, Core::client_ref(client), std::move(values), std::move(options));
}

Value AxFlow::streaming_forward(AIClient& client, Value values, Value options) {
  return array({object({{"version", Value(1)}, {"index", Value(0)}, {"delta", forward(client, std::move(values), std::move(options))}})});
}

Value AxFlow::get_plan() const { return Core::_flow_plan(state_); }
Value AxFlow::get_traces() const { return Core::get(state_, "traces", Value::array()); }
Value AxFlow::get_chat_log() const { return Core::get(state_, "chat_log", Value::array()); }
Value AxFlow::get_usage() const { return Core::get(state_, "usage", Value::object()); }

Value AxFlow::get_optimizable_components() const { return Core::_flow_get_optimizable_components(state_); }

AxFlow& AxFlow::apply_optimized_components(Value component_map) {
  Core::_flow_apply_optimized_components(state_, std::move(component_map));
  return *this;
}
AxFlow& AxFlow::apply_optimization(Value artifact) {
  Value components = get_optimizable_components();
  Value map = artifact.is_string() ? Core::_deserialize_optimized_artifact(artifact, components) : Core::_validate_optimized_artifact(artifact, components);
  return apply_optimized_components(Core::get(map, "componentMap", Value::object()));
}
Value AxFlow::evaluate_optimization(AIClient& client, Value dataset, Value candidate_map, Value options) {
  return Core::_flow_evaluate_optimization(state_, Core::client_ref(client), std::move(dataset), std::move(candidate_map), std::move(options));
}
struct AxFlowOptimizerEvaluator : OptimizerEvaluator {
  AxFlow& flow;
  AIClient& client;
  Value dataset;
  Value options;
  AxFlowOptimizerEvaluator(AxFlow& flow_, AIClient& client_, Value dataset_, Value options_)
      : flow(flow_), client(client_), dataset(std::move(dataset_)), options(std::move(options_)) {}
  Value evaluate(Value candidate_map, Value eval_options = Value::object()) override {
    Value merged = Core::map_merge(options, eval_options);
    Value eval_dataset = Core::get(merged, "dataset", Core::get(merged, "_dataset", dataset));
    return flow.evaluate_optimization(client, eval_dataset, std::move(candidate_map), merged);
  }
};
Value AxFlow::optimize_with(OptimizerEngine& engine, Value dataset, Value options) {
  Value request = Core::_flow_optimize_with(state_, dataset, options, Value(false));
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request), Value(engine.name()), Value(engine.version()), get_optimizable_components());
  if (!Core::truthy(Core::eq(Core::get(options, "apply", Value(true)), Value(false)))) apply_optimization(artifact);
  return artifact;
}
Value AxFlow::optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options) {
  Value request = Core::_flow_optimize_with(state_, dataset, options, Value(true));
  AxFlowOptimizerEvaluator evaluator(*this, client, dataset, options);
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request, &evaluator), Value(engine.name()), Value(engine.version()), get_optimizable_components());
  if (!Core::truthy(Core::eq(Core::get(options, "apply", Value(true)), Value(false)))) apply_optimization(artifact);
  return artifact;
}
Value AxFlow::value() const { return state_; }

AxFlow& AxFlow::add_raw_step(Value step) {
  state_ = Core::_flow_add_step(state_, std::move(step));
  return *this;
}

AxFlow& AxFlow::add_step(Value kind, Value name, Value program, Value options) {
  state_ = Core::_flow_add_step(state_, Core::_flow_step(std::move(kind), std::move(name), std::move(program), std::move(options)));
  return *this;
}

AxAgent::AxAgent(Value signature, Value options) {
  state_ = Core::_agent_factory(std::move(signature), options);
  distiller_ = std::make_unique<AxGen>(s(str(Core::get(state_, "distiller_signature"))), object({{"validation_retries", 0}, {"id", "ctx.root.actor"}}));
  executor_ = std::make_unique<AxGen>(s(str(Core::get(state_, "executor_signature"))), object({{"validation_retries", 0}, {"id", "task.root.actor"}}));
  responder_ = std::make_unique<AxGen>(Core::get(state_, "signature"), object({{"validation_retries", Core::get(options, "validation_retries", 2)}, {"id", "task.root.responder"}}));
}

Value AxAgent::forward(AIClient& client, Value values, Value options) {
  return Core::_agent_forward(
      state_,
      Core::agent_stage_ref(*distiller_),
      Core::agent_stage_ref(*executor_),
      Core::agent_stage_ref(*responder_),
      Core::client_ref(client),
      std::move(values),
      std::move(options));
}

Value AxAgent::test(AxCodeRuntime& runtime, Value code, Value context_values, Value options) {
  return Core::_agent_runtime_test(state_, Core::code_runtime_ref(runtime), std::move(code), std::move(context_values), std::move(options));
}

Value AxAgent::execute_actor_step(AxCodeRuntime& runtime, Value code, Value values, Value options) {
  Core::_agent_runtime_build_globals(state_, std::move(values));
  Value session = Core::get(state_, "runtime_session", Value());
  return Core::_agent_runtime_execute_step(state_, Core::code_runtime_ref(runtime), session, std::move(code), std::move(options));
}

Value AxAgent::inspect_runtime(Value options) {
  return Core::_agent_runtime_inspect_state(state_, Core::get(state_, "runtime_session", Value()), std::move(options));
}

Value AxAgent::export_session_state(Value options) {
  return Core::_agent_runtime_export_session_state(state_, Core::get(state_, "runtime_session", Value()), std::move(options));
}

Value AxAgent::restore_session_state(Value snapshot, Value options) {
  return Core::_agent_runtime_restore_session_state(state_, Core::get(state_, "runtime_session", Value()), std::move(snapshot), std::move(options));
}

Value AxAgent::close_runtime_session() {
  return Core::_agent_runtime_close_session(state_, Core::get(state_, "runtime_session", Value()));
}

Value AxAgent::get_state() const { return Core::_agent_get_state(state_); }
void AxAgent::set_state(Value state) { Core::_agent_set_state(state_, std::move(state)); }
Value AxAgent::get_chat_log() const { return Core::get(state_, "chat_log", Value::array()); }
Value AxAgent::get_action_log() const { return Core::get(state_, "action_log", Value::array()); }
Value AxAgent::get_trace() const { return Core::_agent_export_trace(state_); }
Value AxAgent::export_trace() const { return Core::_agent_export_trace(state_); }
Value AxAgent::replay_trace(Value trace, Value fixtures) const { return Core::_agent_replay_trace(std::move(trace), std::move(fixtures)); }
Value AxAgent::get_usage() const { return Core::get(state_, "usage", Value::object()); }
Value AxAgent::get_runtime_contract() const { return Core::get(state_, "runtime_contract", Value::object()); }
Value AxAgent::get_policy() const { return Core::get(state_, "policy", Value::object()); }
Value AxAgent::get_policy_registry() const { return Core::get(state_, "policy_registry", Value::object()); }
Value AxAgent::get_callable_inventory() const { return Core::get(state_, "callable_inventory", Value::array()); }
Value AxAgent::get_discovery_catalog() const { return Core::get(state_, "discovery_catalog", Value::array()); }
Value AxAgent::discover(Value request) { return Core::_agent_discover(state_, std::move(request)); }
Value AxAgent::recall(Value request) { return Core::_agent_recall(state_, std::move(request)); }
Value AxAgent::used(Value id, Value reason, Value stage) {
  Value request = object({{"id", id}, {"reason", reason}, {"stage", stage}});
  return Core::_agent_used(state_, request, stage);
}
Value AxAgent::invoke_callable(Value qualified_name, Value args, Value options) {
  Value request = object({{"qualified_name", qualified_name}, {"args", args}});
  return Core::_agent_execute_callable(state_, request, std::move(options));
}
Value AxAgent::export_runtime_state() const { return Core::_agent_export_runtime_state(state_); }
Value AxAgent::restore_runtime_state(Value snapshot) { return Core::_agent_restore_runtime_state(state_, std::move(snapshot)); }
Value AxAgent::get_optimizer_metadata() const { return Core::_agent_optimizer_metadata(state_); }
Value AxAgent::get_optimizable_components() const {
  Value components = Value::array();
  for (const auto& item : array_ref(distiller_->get_optimizable_components())) Core::append(components, item);
  for (const auto& item : array_ref(executor_->get_optimizable_components())) Core::append(components, item);
  for (const auto& item : array_ref(responder_->get_optimizable_components())) Core::append(components, item);
  Core::append(components, Core::_optimization_component(
      Value("root.agent.runtime"),
      Value("root.agent"),
      Value("runtime-policy"),
      get_runtime_contract(),
      Value("Agent runtime-language metadata and code-field policy."),
      array({Value("Keep code field names aligned with the selected runtime language.")}),
      Value::array(),
      Value(true),
      Value("json"),
      object({{"component", Value("runtime_contract")}})));
  Core::append(components, Core::_optimization_component(
      Value("root.agent.policy"),
      Value("root.agent"),
      Value("agent-policy"),
      get_policy(),
      Value("Actor primitive, discovery, delegation, and prompt placement policy."),
      array({Value("Do not expose protocol-only actions as actor primitives.")}),
      array({Value("root.agent.runtime")}),
      Value(true),
      Value("json"),
      object({{"component", Value("policy_registry")}})));
  return components;
}
AxAgent& AxAgent::apply_optimized_components(Value component_map) {
  Core::_validate_optimization_component_map(get_optimizable_components(), component_map);
  distiller_->apply_optimized_components(component_map);
  executor_->apply_optimized_components(component_map);
  responder_->apply_optimized_components(component_map);
  if (Core::truthy(Core::map_contains(component_map, Value("root.agent.runtime")))) Core::set(state_, "runtime_contract", Core::get(component_map, "root.agent.runtime", Value::object()));
  if (Core::truthy(Core::map_contains(component_map, Value("root.agent.policy")))) Core::set(state_, "policy", Core::get(component_map, "root.agent.policy", Value::object()));
  Core::set(state_, "optimizer_metadata", Core::_agent_optimizer_metadata(state_));
  return *this;
}
AxAgent& AxAgent::apply_optimization(Value artifact) {
  Value components = get_optimizable_components();
  Value map = artifact.is_string() ? Core::_deserialize_optimized_artifact(artifact, components) : Core::_validate_optimized_artifact(artifact, components);
  return apply_optimized_components(Core::get(map, "componentMap", Value::object()));
}
Value AxAgent::evaluate_optimization_task(AIClient& client, Value task, Value options) {
  Value input = Core::get(task, "input", task);
  Value forward_options = Core::get(options, "forward_options", Value::object());
  try {
    Value output = forward(client, input, forward_options);
    return Core::_build_agent_eval_prediction(output, get_action_log(), get_usage(), export_trace());
  } catch (const AxError& e) {
    if (e.category == "AxAgentClarificationError") {
      return object({{"completionType", Value("askClarification")}, {"clarification", Value(std::string(e.what()))}, {"actionLog", get_action_log()}, {"functionCalls", Core::get(state_, "function_call_traces", Value::array())}, {"toolErrors", Value::array()}, {"turnCount", Value(0)}, {"usage", get_usage()}, {"trace", export_trace()}});
    }
    Value err = object({{"message", Value(std::string(e.what()))}});
    return object({{"completionType", Value("error")}, {"error", err}, {"actionLog", get_action_log()}, {"functionCalls", Core::get(state_, "function_call_traces", Value::array())}, {"toolErrors", array({Value(std::string(e.what()))})}, {"turnCount", Value(0)}, {"usage", get_usage()}, {"trace", export_trace()}});
  }
}
Value AxAgent::evaluate_optimization(AIClient& client, Value dataset, Value candidate_map, Value options) {
  Value normalized = Core::_normalize_optimization_dataset(dataset.is_null() ? Value::array() : dataset);
  Value rows = Value::array();
  Value original = Core::_optimization_component_current_map(get_optimizable_components());
  int max_metric_calls = static_cast<int>(num(Core::get(options, "maxMetricCalls", Core::get(options, "max_metric_calls", Value(2147483647)))));
  int calls = 0;
  try {
    if (Core::truthy(candidate_map)) apply_optimized_components(candidate_map);
    for (const auto& raw_task : Core::iter(Core::get(normalized, "train", Value::array()))) {
      if (calls >= max_metric_calls) throw AxError("runtime", "max metric calls exceeded: " + std::to_string(max_metric_calls));
      ++calls;
      Value task = raw_task;
      Value prediction = evaluate_optimization_task(client, task, options);
      Value error = Core::get(prediction, "error");
      Value default_score = Core::truthy(Core::eq(Core::get(prediction, "completionType", Value("")), Value("error"))) ? Value(0) : Value(1);
      Value raw_score = Core::get(task, "metric_score", Core::get(task, "scores", Core::get(task, "score", default_score)));
      Value scores = Core::_normalize_optimization_metric_scores(raw_score);
      Value scalar = Core::_adjust_optimization_score_for_actions(Core::_scalarize_optimization_scores(scores, options), task, prediction);
      Core::append(rows, Core::_build_optimization_eval_row(task, prediction, scores, scalar, Core::get(prediction, "trace"), error));
    }
    Value result = Core::_build_optimization_eval_result(rows, candidate_map, Core::get(options, "phase", Value("train")));
    apply_optimized_components(original);
    return result;
  } catch (...) {
    apply_optimized_components(original);
    throw;
  }
}

struct AxAgentOptimizerEvaluator : OptimizerEvaluator {
  AxAgent& agent;
  AIClient& client;
  Value dataset;
  Value options;
  AxAgentOptimizerEvaluator(AxAgent& agent_, AIClient& client_, Value dataset_, Value options_)
      : agent(agent_), client(client_), dataset(std::move(dataset_)), options(std::move(options_)) {}
  Value evaluate(Value candidate_map, Value eval_options = Value::object()) override {
    Value merged = Core::map_merge(options, eval_options);
    Value eval_dataset = Core::get(merged, "dataset", Core::get(merged, "_dataset", dataset));
    return agent.evaluate_optimization(client, eval_dataset, std::move(candidate_map), merged);
  }
};

Value AxAgent::optimize_with(OptimizerEngine& engine, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axagent"), components, dataset.is_null() ? Value::array() : dataset, options, export_trace(), Value(false));
  Value request = Core::get(run, "request", Value::object());
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}
Value AxAgent::optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axagent"), components, dataset.is_null() ? Value::array() : dataset, options, export_trace(), Value(true));
  Value request = Core::get(run, "request", Value::object());
  AxAgentOptimizerEvaluator evaluator(*this, client, dataset, options);
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request, &evaluator), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}
Value AxAgent::optimize(Value dataset, Value options) {
  throw AxError("unsupported", "AxIR generated runtimes require an OptimizerEngine for optimize()");
}

Value object(std::initializer_list<std::pair<std::string, Value>> items) {
  Value out = Value::object();
  for (const auto& item : items) Core::set(out, item.first, item.second);
  return out;
}

Value array(std::initializer_list<Value> items) {
  Value out = Value::array();
  for (const auto& item : items) Core::append(out, item);
  return out;
}

Value RuntimeCapabilities::to_value() const {
  return object({
    {"inspect", inspect},
    {"snapshot", snapshot},
    {"patch", patch},
    {"abort", abort},
    {"language", language.empty() ? "JavaScript" : language},
    {"usage_instructions", usage_instructions}
  });
}

Value RuntimeEnvelope::result(Value value) {
  return object({{"kind", "result"}, {"result", std::move(value)}});
}

Value RuntimeEnvelope::error(Value message, Value category) {
  return object({{"kind", "error"}, {"is_error", true}, {"error_category", std::move(category)}, {"error", std::move(message)}});
}

Value RuntimeEnvelope::session_closed(Value message) {
  return error(std::move(message), "session_closed");
}

Value RuntimeEnvelope::timeout(Value message) {
  return error(std::move(message), "timeout");
}

Value RuntimeEnvelope::final_payload(std::initializer_list<Value> args) {
  return object({{"type", "final"}, {"args", array(args)}});
}

Value RuntimeEnvelope::final_payload(Value args) {
  return object({{"type", "final"}, {"args", args.is_array() ? std::move(args) : array({std::move(args)})}});
}

Value RuntimeEnvelope::ask_clarification(std::initializer_list<Value> args) {
  return object({{"type", "askClarification"}, {"args", array(args)}});
}

Value RuntimeEnvelope::ask_clarification(Value args) {
  return object({{"type", "askClarification"}, {"args", args.is_array() ? std::move(args) : array({std::move(args)})}});
}

Value RuntimeEnvelope::discover(Value request) {
  return object({{"kind", "discover"}, {"discover", std::move(request)}});
}

Value RuntimeEnvelope::recall(Value request) {
  return object({{"kind", "recall"}, {"recall", std::move(request)}});
}

Value RuntimeEnvelope::used(Value request, Value reason, Value stage) {
  Value payload = request.is_object() ? request : object({{"id", std::move(request)}});
  if (!reason.is_null()) Core::set(payload, "reason", std::move(reason));
  if (!stage.is_null()) Core::set(payload, "stage", std::move(stage));
  return object({{"kind", "used"}, {"used", std::move(payload)}});
}

Value RuntimeEnvelope::status(Value type, Value message) {
  return object({{"kind", "status"}, {"status", object({{"type", std::move(type)}, {"message", std::move(message)}})}});
}

Value RuntimeEnvelope::guide_agent(Value guidance, Value triggered_by) {
  Value payload = object({{"type", "guide_agent"}, {"guidance", std::move(guidance)}});
  if (!triggered_by.is_null()) Core::set(payload, "triggeredBy", std::move(triggered_by));
  return payload;
}

RuntimeProtocolClient::RuntimeProtocolClient(RuntimeTransport& transport) : transport_(transport) {}

std::string RuntimeProtocolClient::usage_instructions() const {
  try {
    Value response = const_cast<RuntimeProtocolClient*>(this)->request("capabilities", Value(), Value::object(), false);
    return str(Core::get(Core::get(response, "result", Value::object()), "usage_instructions", ""));
  } catch (...) {
    return "";
  }
}

AxCodeSession* RuntimeProtocolClient::create_session(Value globals, Value options) {
  Value response = request("create_session", Value(), object({{"globals", std::move(globals)}, {"options", std::move(options)}}), true);
  Value session_id = Core::get(response, "session_id");
  if (session_id.is_null()) session_id = Core::get(Core::get(response, "result", Value::object()), "session_id");
  if (session_id.is_null()) throw AxError("runtime", "runtime protocol did not return a session_id");
  sessions_.push_back(std::make_unique<RuntimeProtocolSession>(*this, session_id));
  return sessions_.back().get();
}

Value RuntimeProtocolClient::request(Value op, Value session_id, Value payload, bool throw_on_error) {
  Value message = object({{"id", std::to_string(++next_id_)}, {"op", std::move(op)}, {"payload", std::move(payload)}});
  if (!session_id.is_null()) Core::set(message, "session_id", session_id);
  Value response = transport_.call(message);
  if (!response.is_object()) throw AxError("runtime", "runtime protocol response must be an object");
  if (str(Core::get(response, "id")) != str(Core::get(message, "id"))) {
    throw AxError("runtime", "runtime protocol response id mismatch");
  }
  if (!session_id.is_null() && !Core::get(response, "session_id").is_null() && str(Core::get(response, "session_id")) != str(session_id)) {
    throw AxError("runtime", "runtime protocol session_id mismatch");
  }
  if (!Core::truthy(Core::get(response, "ok", false)) && throw_on_error) {
    Value error = Core::get(response, "error", Value::object());
    throw AxError(str(Core::get(error, "category", "runtime")), str(Core::get(error, "message", "runtime protocol error")));
  }
  return response;
}

Value RuntimeProtocolClient::shutdown() {
  return request("shutdown", Value(), Value::object(), false);
}

RuntimeProtocolSession::RuntimeProtocolSession(RuntimeProtocolClient& client, Value session_id)
    : client_(client), session_id_(std::move(session_id)) {}

Value RuntimeProtocolSession::execute(Value code, Value options) {
  Value response = client_.request("execute", session_id_, object({{"code", std::move(code)}, {"options", std::move(options)}}), false);
  if (!Core::truthy(Core::get(response, "ok", false))) {
    Value error = Core::get(response, "error", Value::object());
    return RuntimeEnvelope::error(Core::get(error, "message", "runtime protocol error"), Core::get(error, "category", "runtime"));
  }
  return Core::get(response, "result");
}

Value RuntimeProtocolSession::inspect(Value options) {
  return Core::get(client_.request("inspect_globals", session_id_, std::move(options), true), "result");
}

Value RuntimeProtocolSession::snapshot_globals(Value options) {
  return Core::get(client_.request("snapshot_globals", session_id_, std::move(options), true), "result");
}

Value RuntimeProtocolSession::patch_globals(Value snapshot, Value options) {
  return Core::get(client_.request("patch_globals", session_id_, object({{"globals", std::move(snapshot)}, {"options", std::move(options)}}), true), "result");
}

Value RuntimeProtocolSession::close() {
  return Core::get(client_.request("close", session_id_, Value::object(), false), "result");
}

Value s(const std::string& source) {
  Value sig = Core::parse_signature(source);
  Core::validate_signature(sig);
  return sig;
}
Value signature(const std::string& source) { return s(source); }
AxGen ax(const std::string& source, Value options) { return AxGen(s(source), std::move(options)); }
AxGen ax(const char* source, Value options) { return ax(std::string(source == nullptr ? "" : source), std::move(options)); }
AxGen ax(Value signature, Value options) { return AxGen(std::move(signature), std::move(options)); }
AxAgent agent(const std::string& source, Value options) { return AxAgent(Value(source), std::move(options)); }
AxAgent agent(const char* source, Value options) { return agent(std::string(source == nullptr ? "" : source), std::move(options)); }
AxAgent agent(Value signature, Value options) { return AxAgent(std::move(signature), std::move(options)); }
AxFlow flow(Value options) { return AxFlow(std::move(options)); }
std::shared_ptr<AxAIService> ai(const std::string& provider, Value options) {
  Value resolved = Core::provider_resolve_profile(provider.empty() ? "openai" : provider);
  if (!Core::truthy(Core::get(resolved, "known"))) {
    throw AxError("provider", "unsupported AxAI provider: " + provider);
  }
  std::string canonical = display(Core::get(resolved, "id"));
  if (canonical == "openai-compatible") {
    return std::make_shared<OpenAICompatibleClient>(std::move(options));
  }
  if (canonical == "openai-responses") {
    return std::make_shared<OpenAIResponsesClient>(std::move(options));
  }
  if (canonical == "google-gemini") {
    return std::make_shared<GoogleGeminiClient>(std::move(options));
  }
  if (canonical == "anthropic") {
    return std::make_shared<AnthropicClient>(std::move(options));
  }
  if (canonical == "azure-openai") {
    return std::make_shared<AzureOpenAIClient>(std::move(options));
  }
  if (canonical == "deepseek") {
    return std::make_shared<DeepSeekClient>(std::move(options));
  }
  if (canonical == "mistral") {
    return std::make_shared<MistralClient>(std::move(options));
  }
  if (canonical == "reka") {
    return std::make_shared<RekaClient>(std::move(options));
  }
  if (canonical == "cohere") {
    return std::make_shared<CohereClient>(std::move(options));
  }
  if (canonical == "grok") {
    return std::make_shared<GrokClient>(std::move(options));
  }
  throw AxError("runtime", "unsupported AxAI provider: " + provider);
}
std::shared_ptr<AxAIService> ai(const char* provider, Value options) { return ai(std::string(provider == nullptr ? "" : provider), std::move(options)); }

Value get_supported_ai_models(Value options) { return Core::provider_model_catalog(std::move(options)); }

static Value balancer_base_features_cpp() {
  return object({
      {"functions", false},
      {"streaming", false},
      {"thinking", false},
      {"multiTurn", false},
      {"structuredOutputs", false},
      {"media", object({
          {"images", object({{"supported", false}, {"formats", Value::array()}})},
          {"audio", object({{"supported", false}, {"formats", Value::array()}})},
          {"files", object({{"supported", false}, {"formats", Value::array()}, {"uploadMethod", "none"}})},
          {"urls", object({{"supported", false}, {"webSearch", false}, {"contextFetching", false}})}
      })},
      {"caching", object({{"supported", false}, {"types", Value::array()}})}
  });
}

static bool feature_truthy_cpp(Value features, const std::string& key, const std::string& alt = "") {
  if (Core::truthy(Core::get(features, key))) return true;
  return !alt.empty() && Core::truthy(Core::get(features, alt));
}

static void append_unique_cpp(Value& target, Value values) {
  for (const auto& item : Core::iter(values)) {
    bool found = false;
    for (const auto& existing : Core::iter(target)) {
      if (equal(existing, item)) { found = true; break; }
    }
    if (!found) Core::append(target, item);
  }
}

static Value metric_bucket_cpp() {
  return object({{"mean", 0}, {"p95", 0}, {"p99", 0}, {"samples", Value::array()}});
}

static Value error_bucket_cpp() {
  return object({{"count", 0}, {"rate", 0}, {"total", 0}});
}

static Value balancer_base_metrics_cpp() {
  return object({
      {"latency", object({{"chat", metric_bucket_cpp()}, {"embed", metric_bucket_cpp()}})},
      {"errors", object({{"chat", error_bucket_cpp()}, {"embed", error_bucket_cpp()}})}
  });
}

AxBalancer::AxBalancer() = default;

AxBalancer::AxBalancer(std::vector<std::shared_ptr<AxAIService>> services, Value options)
    : services_(std::move(services)), policy_(Core::provider_balancer_retry_policy(std::move(options))) {
  if (services_.empty()) throw AxError("runtime", "No AI services provided.");
  max_retries_ = static_cast<int>(num(Core::get(policy_, "maxRetries", 3)));
  validate_models();
  if (str(Core::get(policy_, "strategy", "metric")) != "input_order") {
    std::stable_sort(services_.begin(), services_.end(), [](const auto& a, const auto& b) {
      return num(Core::provider_balancer_metric_score(a->get_metrics())) < num(Core::provider_balancer_metric_score(b->get_metrics()));
    });
  }
  current_service_ = services_.front();
}

void AxBalancer::validate_models() {
  Value reference;
  bool has_reference = false;
  for (const auto& service : services_) {
    Value model_list = service->get_model_list();
    if (!model_list.is_null()) { reference = model_list; has_reference = true; break; }
  }
  if (!has_reference) return;
  std::set<std::string> reference_keys;
  for (const auto& entry : Core::iter(reference)) reference_keys.insert(str(Core::get(entry, "key")));
  for (size_t index = 0; index < services_.size(); ++index) {
    Value model_list = services_[index]->get_model_list();
    if (model_list.is_null()) throw AxError("runtime", "Service at index " + std::to_string(index) + " (" + services_[index]->get_name() + ") has no model list while another service does.");
    std::set<std::string> keys;
    for (const auto& entry : Core::iter(model_list)) keys.insert(str(Core::get(entry, "key")));
    for (const auto& key : reference_keys) if (!keys.count(key)) throw AxError("runtime", "Service at index " + std::to_string(index) + " (" + services_[index]->get_name() + ") is missing model \"" + key + "\"");
    for (const auto& key : keys) if (!reference_keys.count(key)) throw AxError("runtime", "Service at index " + std::to_string(index) + " (" + services_[index]->get_name() + ") has extra model \"" + key + "\"");
  }
}

bool AxBalancer::can_retry_service(const std::shared_ptr<AxAIService>& service) const {
  return service_failures_.find(service->get_id()) == service_failures_.end();
}

void AxBalancer::handle_failure(const std::shared_ptr<AxAIService>& service) {
  service_failures_[service->get_id()] += 1;
}

void AxBalancer::handle_success(const std::shared_ptr<AxAIService>& service) {
  service_failures_.erase(service->get_id());
}

bool AxBalancer::retryable(const AxError& error) const {
  if (error.category != "ai") return false;
  if (error.type == "AxAIServiceAuthenticationError") return false;
  if (error.type == "AxAIServiceStatusError") {
    return error.status == 408 || error.status == 429 || error.status == 500 || error.status == 502 || error.status == 503 || error.status == 504;
  }
  return error.type == "AxAIServiceNetworkError" || error.type == "AxAIServiceResponseError" || error.type == "AxAIServiceStreamTerminatedError" || error.type == "AxAIServiceTimeoutError";
}

std::vector<std::shared_ptr<AxAIService>> AxBalancer::candidate_services(Value request) {
  std::vector<std::shared_ptr<AxAIService>> out;
  Value model = Core::get(request, "model");
  for (const auto& service : services_) {
    if (Core::truthy(Core::provider_balancer_candidate_allowed(service->get_features(model), request))) out.push_back(service);
  }
  if (!out.empty()) return out;
  std::vector<std::string> requirements;
  if (str(Core::get(Core::get(request, "responseFormat", Core::get(request, "response_format", Value::object())), "type", "")) == "json_schema") requirements.push_back("structured outputs");
  Value caps = Core::get(request, "capabilities", Value::object());
  if (Core::truthy(Core::get(caps, "requiresImages", Core::get(caps, "requires_images", false)))) requirements.push_back("images");
  if (Core::truthy(Core::get(caps, "requiresAudio", Core::get(caps, "requires_audio", false)))) requirements.push_back("audio");
  Value reqs = Value::array();
  for (const auto& item : requirements) Core::append(reqs, item);
  throw AxError("runtime", "No services available that support required capabilities: " + str(Core::string_join(", ", reqs)) + ".");
}

void AxBalancer::reset() {
  current_service_index_ = 0;
  current_service_ = services_.front();
}

std::string AxBalancer::get_id() { return current_service_ ? current_service_->get_id() : ""; }
std::string AxBalancer::get_name() { return current_service_ ? current_service_->get_name() : ""; }

Value AxBalancer::get_model_list() {
  for (const auto& service : services_) {
    Value model_list = service->get_model_list();
    if (!model_list.is_null()) return model_list;
  }
  return Value();
}

Value AxBalancer::get_features(Value model) {
  Value features = balancer_base_features_cpp();
  for (const auto& service : services_) {
    Value raw = service->get_features(model);
    for (const auto& pair : std::vector<std::pair<std::string, std::string>>{{"functions", ""}, {"streaming", ""}, {"thinking", ""}, {"multiTurn", "multi_turn"}, {"structuredOutputs", "structured_outputs"}, {"functionCot", "function_cot"}, {"hasThinkingBudget", "has_thinking_budget"}, {"hasShowThoughts", "has_show_thoughts"}}) {
      if (feature_truthy_cpp(raw, pair.first, pair.second)) Core::set(features, pair.first, true);
    }
    Value media = Core::get(features, "media", Value::object());
    Value raw_media = Core::get(raw, "media", Value::object());
    for (const auto& kind : std::vector<std::string>{"images", "audio", "files"}) {
      Value dst = Core::get(media, kind, Value::object());
      Value src = Core::get(raw_media, kind, Value::object());
      if (Core::truthy(Core::get(src, "supported", false))) Core::set(dst, "supported", true);
      Value formats = Core::get(dst, "formats", Value::array());
      append_unique_cpp(formats, Core::get(src, "formats", Value::array()));
      Core::set(dst, "formats", formats);
      if (kind == "files") {
        Value upload = Core::get(src, "uploadMethod", Core::get(src, "upload_method", Value()));
        if (!upload.is_null() && str(upload) != "none") Core::set(dst, "uploadMethod", upload);
      }
      Core::set(media, kind, dst);
    }
    Value urls = Core::get(media, "urls", Value::object());
    Value raw_urls = Core::get(raw_media, "urls", Value::object());
    if (Core::truthy(Core::get(raw_urls, "supported", false))) Core::set(urls, "supported", true);
    if (Core::truthy(Core::get(raw_urls, "webSearch", Core::get(raw_urls, "web_search", false)))) Core::set(urls, "webSearch", true);
    if (Core::truthy(Core::get(raw_urls, "contextFetching", Core::get(raw_urls, "context_fetching", false)))) Core::set(urls, "contextFetching", true);
    Core::set(media, "urls", urls);
    Core::set(features, "media", media);
    Value caching = Core::get(features, "caching", Value::object());
    Value raw_caching = Core::get(raw, "caching", Value::object());
    if (Core::truthy(Core::get(raw_caching, "supported", false))) Core::set(caching, "supported", true);
    Value types = Core::get(caching, "types", Value::array());
    append_unique_cpp(types, Core::get(raw_caching, "types", Value::array()));
    Core::set(caching, "types", types);
    Core::set(features, "caching", caching);
  }
  return features;
}

Value AxBalancer::get_metrics() {
  double chat_error_count = 0, chat_error_total = 0, embed_error_count = 0, embed_error_total = 0;
  double chat_sum = 0, chat_count = 0, embed_sum = 0, embed_count = 0;
  double chat_p95 = 0, chat_p99 = 0, embed_p95 = 0, embed_p99 = 0;
  for (const auto& service : services_) {
    Value metrics = service->get_metrics();
    Value errors = Core::get(metrics, "errors", Value::object());
    Value chat_errors = Core::get(errors, "chat", Value::object());
    Value embed_errors = Core::get(errors, "embed", Value::object());
    chat_error_count += num(Core::get(chat_errors, "count", 0));
    chat_error_total += num(Core::get(chat_errors, "total", 0));
    embed_error_count += num(Core::get(embed_errors, "count", 0));
    embed_error_total += num(Core::get(embed_errors, "total", 0));
    Value latency = Core::get(metrics, "latency", Value::object());
    Value chat = Core::get(latency, "chat", Value::object());
    double chat_samples = static_cast<double>(Core::iter(Core::get(chat, "samples", Value::array())).size());
    if (chat_samples > 0) { chat_sum += num(Core::get(chat, "mean", 0)) * chat_samples; chat_count += chat_samples; }
    Value embed = Core::get(latency, "embed", Value::object());
    double embed_samples = static_cast<double>(Core::iter(Core::get(embed, "samples", Value::array())).size());
    if (embed_samples > 0) { embed_sum += num(Core::get(embed, "mean", 0)) * embed_samples; embed_count += embed_samples; }
    chat_p95 = std::max(chat_p95, num(Core::get(chat, "p95", 0)));
    chat_p99 = std::max(chat_p99, num(Core::get(chat, "p99", 0)));
    embed_p95 = std::max(embed_p95, num(Core::get(embed, "p95", 0)));
    embed_p99 = std::max(embed_p99, num(Core::get(embed, "p99", 0)));
  }
  return object({
      {"latency", object({
          {"chat", object({{"mean", chat_count > 0 ? chat_sum / chat_count : 0}, {"p95", chat_p95}, {"p99", chat_p99}, {"samples", Value::array()}})},
          {"embed", object({{"mean", embed_count > 0 ? embed_sum / embed_count : 0}, {"p95", embed_p95}, {"p99", embed_p99}, {"samples", Value::array()}})}
      })},
      {"errors", object({
          {"chat", object({{"count", chat_error_count}, {"rate", chat_error_total > 0 ? chat_error_count / chat_error_total : 0}, {"total", chat_error_total}})},
          {"embed", object({{"count", embed_error_count}, {"rate", embed_error_total > 0 ? embed_error_count / embed_error_total : 0}, {"total", embed_error_total}})}
      })}
  });
}

Value AxBalancer::chat(Value request) { return chat(std::move(request), Value::object()); }
Value AxBalancer::chat(Value request, Value options) {
  auto candidates = candidate_services(request);
  size_t index = 0;
  auto service = candidates.at(index);
  current_service_ = service;
  while (true) {
    if (!can_retry_service(service)) {
      ++index;
      if (index >= candidates.size()) throw AxError("runtime", "All candidate services exhausted (tried " + std::to_string(candidates.size()) + " service(s))");
      service = candidates.at(index);
      current_service_ = service;
      continue;
    }
    try {
      Value response = service->chat(request, options);
      handle_success(service);
      return response;
    } catch (const AxError& error) {
      if (!retryable(error)) throw;
      handle_failure(service);
      if (service_failures_[service->get_id()] >= max_retries_) {
        ++index;
        if (index >= candidates.size()) throw;
        service = candidates.at(index);
        current_service_ = service;
      }
    }
  }
}

Value AxBalancer::embed(Value request) { return embed(std::move(request), Value::object()); }
Value AxBalancer::embed(Value request, Value options) {
  reset();
  size_t index = current_service_index_;
  while (true) {
    if (!can_retry_service(current_service_)) {
      ++index;
      if (index >= services_.size()) throw AxError("runtime", "All services exhausted (tried " + std::to_string(services_.size()) + " service(s))");
      current_service_ = services_.at(index);
      current_service_index_ = index;
      continue;
    }
    try {
      Value response = current_service_->embed(request, options);
      handle_success(current_service_);
      return response;
    } catch (const AxError& error) {
      if (!retryable(error)) throw;
      handle_failure(current_service_);
      if (service_failures_[current_service_->get_id()] >= max_retries_) {
        ++index;
        if (index >= services_.size()) throw;
        current_service_ = services_.at(index);
        current_service_index_ = index;
      }
    }
  }
}

Value AxBalancer::transcribe(Value request) { return transcribe(std::move(request), Value::object()); }
Value AxBalancer::transcribe(Value request, Value options) { return current_service_->transcribe(std::move(request), std::move(options)); }
Value AxBalancer::speak(Value request) { return speak(std::move(request), Value::object()); }
Value AxBalancer::speak(Value request, Value options) { return current_service_->speak(std::move(request), std::move(options)); }
std::function<void(std::string)> AxBalancer::get_logger() { return current_service_->get_logger(); }
double AxBalancer::get_estimated_cost(Value usage) { return current_service_->get_estimated_cost(std::move(usage)); }
Value AxBalancer::get_options() { return current_service_->get_options(); }
void AxBalancer::set_options(Value options) { for (auto& service : services_) service->set_options(options); if (current_service_) current_service_->set_options(options); }
Value AxBalancer::get_last_used_chat_model() { return current_service_ ? current_service_->get_last_used_chat_model() : Value(); }
Value AxBalancer::get_last_used_embed_model() { return current_service_ ? current_service_->get_last_used_embed_model() : Value(); }
Value AxBalancer::get_last_used_model_config() { return current_service_ ? current_service_->get_last_used_model_config() : Value(); }
Value AxBalancer::complete(Value request) { return Core::chat_response_to_completion(chat(Core::coerce_chat_request(std::move(request)))); }

static Value router_default_features_cpp() {
  return object({
      {"functions", false},
      {"streaming", false},
      {"media", object({
          {"images", object({{"supported", false}, {"formats", Value::array()}})},
          {"audio", object({{"supported", false}, {"formats", Value::array()}, {"output", object({{"supported", false}, {"formats", Value::array()}})}})},
          {"files", object({{"supported", false}, {"formats", Value::array()}, {"uploadMethod", "none"}})},
          {"urls", object({{"supported", false}, {"webSearch", false}, {"contextFetching", false}})}
      })},
      {"caching", object({{"supported", false}, {"types", Value::array()}})},
      {"thinking", false},
      {"multiTurn", true}
  });
}

MultiServiceRouter::MultiServiceRouter() = default;

MultiServiceRouter::MultiServiceRouter(std::vector<std::shared_ptr<AxAIService>> services) {
  if (services.empty()) throw AxError("runtime", "No AI services provided.");
  for (size_t index = 0; index < services.size(); ++index) {
    auto service = services[index];
    Value model_list = service->get_model_list();
    if (!model_list.is_array() || array_ref(model_list).empty()) {
      throw AxError("runtime", "Service " + std::to_string(index) + " '" + service->get_name() + "' has no model list.");
    }
    for (const auto& raw : array_ref(model_list)) {
      std::string key = display(Core::get(raw, "key"));
      if (services_.count(key)) {
        throw AxError("runtime", "Service " + std::to_string(index) + " '" + service->get_name() + "' has duplicate model key: " + key + " as service " + services_[key].service->get_name());
      }
      Entry entry;
      entry.service = service;
      entry.description = display(Core::get(raw, "description", ""));
      if (!Core::get(raw, "model").is_null()) entry.model = Core::get(raw, "model");
      else if (!Core::get(raw, "embedModel").is_null()) entry.embed_model = Core::get(raw, "embedModel");
      else throw AxError("runtime", "Key " + key + " in model list for service " + std::to_string(index) + " '" + service->get_name() + "' is missing a model or embedModel property.");
      services_[key] = std::move(entry);
      service_keys_.push_back(key);
    }
  }
}

MultiServiceRouter::MultiServiceRouter(Value) {
  throw AxError("runtime", "C++ MultiServiceRouter dynamic entries require host-owned service pointers");
}

void MultiServiceRouter::set_service_entry(std::string key, std::shared_ptr<AxAIService> service, std::string description, bool is_internal) {
  if (services_.count(key)) throw AxError("runtime", "Duplicate model key: " + key);
  Entry entry;
  entry.service = std::move(service);
  entry.description = std::move(description);
  entry.is_internal = is_internal;
  service_keys_.push_back(key);
  services_[std::move(key)] = std::move(entry);
}

void MultiServiceRouter::set_service_entry(std::string, Value) {
  throw AxError("runtime", "C++ MultiServiceRouter dynamic entries require host-owned service pointers");
}

std::string MultiServiceRouter::get_id() {
  std::vector<std::string> ids;
  for (const auto& key : service_keys_) ids.push_back(services_[key].service->get_id());
  std::string out = "MultiServiceRouter:";
  for (size_t i = 0; i < ids.size(); ++i) { if (i) out += ","; out += ids[i]; }
  return out;
}

std::string MultiServiceRouter::get_name() { return "MultiServiceRouter"; }

Value MultiServiceRouter::get_model_list() {
  Value out = Value::array();
  for (const auto& key : service_keys_) {
    const Entry& entry = services_[key];
    if (entry.is_internal) continue;
    Value item = object({{"key", key}, {"description", entry.description}});
    if (!entry.model.is_null()) Core::set(item, "model", entry.model);
    else if (!entry.embed_model.is_null()) Core::set(item, "embedModel", entry.embed_model);
    else throw AxError("runtime", "Service " + key + " has no model or embedModel");
    Core::append(out, item);
  }
  return out;
}

Value MultiServiceRouter::get_features(Value model) {
  if (!model.is_null()) {
    auto it = services_.find(display(model));
    if (it != services_.end()) return it->second.service->get_features(model);
  }
  return router_default_features_cpp();
}

Value MultiServiceRouter::chat(Value request) { return chat(std::move(request), Value::object()); }
Value MultiServiceRouter::chat(Value request, Value options) {
  Value model_key = Core::get(request, "model");
  if (model_key.is_null()) throw AxError("runtime", "Model key must be specified for multi-service");
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for model key: " + display(model_key));
  last_used_service_ = it->second.service;
  Value req(object_ref(request));
  if (Core::get(req, "model_config").is_null() && !Core::get(req, "modelConfig").is_null()) Core::set(req, "model_config", Core::get(req, "modelConfig"));
  if (it->second.model.is_null()) Core::map_delete(req, "model");
  return last_used_service_->chat(req, options);
}

Value MultiServiceRouter::embed(Value request) { return embed(std::move(request), Value::object()); }
Value MultiServiceRouter::embed(Value request, Value options) {
  Value model_key = Core::get(request, "embedModel", Core::get(request, "embed_model"));
  if (model_key.is_null()) throw AxError("runtime", "Embed model key must be specified for multi-service");
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for embed model key: " + display(model_key));
  last_used_service_ = it->second.service;
  Value req(object_ref(request));
  if (it->second.model.is_null()) {
    Core::map_delete(req, "embedModel");
    Core::map_delete(req, "embed_model");
  }
  return last_used_service_->embed(req, options);
}

Value MultiServiceRouter::transcribe(Value request) { return transcribe(std::move(request), Value::object()); }
Value MultiServiceRouter::transcribe(Value request, Value options) {
  Value model_key = Core::get(request, "model");
  if (model_key.is_null()) {
    if (services_.empty()) throw AxError("runtime", "No AI services provided.");
    last_used_service_ = services_.begin()->second.service;
    return last_used_service_->transcribe(request, options);
  }
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for transcription model key: " + display(model_key));
  last_used_service_ = it->second.service;
  return last_used_service_->transcribe(request, options);
}

Value MultiServiceRouter::speak(Value request) { return speak(std::move(request), Value::object()); }
Value MultiServiceRouter::speak(Value request, Value options) {
  Value model_key = Core::get(request, "model");
  if (model_key.is_null()) {
    if (services_.empty()) throw AxError("runtime", "No AI services provided.");
    last_used_service_ = services_.begin()->second.service;
    return last_used_service_->speak(request, options);
  }
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for speech model key: " + display(model_key));
  last_used_service_ = it->second.service;
  return last_used_service_->speak(request, options);
}

Value MultiServiceRouter::get_metrics() {
  auto service = last_used_service_;
  if (!service && !services_.empty()) service = services_.begin()->second.service;
  if (!service) throw AxError("runtime", "No service available to get metrics.");
  return service->get_metrics();
}
std::function<void(std::string)> MultiServiceRouter::get_logger() {
  auto service = last_used_service_;
  if (!service && !services_.empty()) service = services_.begin()->second.service;
  if (!service) throw AxError("runtime", "No service available to get logger.");
  return service->get_logger();
}
double MultiServiceRouter::get_estimated_cost(Value usage) { return last_used_service_ ? last_used_service_->get_estimated_cost(usage) : 0.0; }
Value MultiServiceRouter::get_options() { return options_; }
void MultiServiceRouter::set_options(Value options) { options_ = options; for (auto& kv : services_) kv.second.service->set_options(options); }
Value MultiServiceRouter::get_last_used_chat_model() { return last_used_service_ ? last_used_service_->get_last_used_chat_model() : Value(); }
Value MultiServiceRouter::get_last_used_embed_model() { return last_used_service_ ? last_used_service_->get_last_used_embed_model() : Value(); }
Value MultiServiceRouter::get_last_used_model_config() { return last_used_service_ ? last_used_service_->get_last_used_model_config() : Value(); }
Value MultiServiceRouter::complete(Value request) { return Core::chat_response_to_completion(chat(Core::coerce_chat_request(std::move(request)))); }

ProviderRouter::ProviderRouter(Value config) {
  Value providers = Core::get(config, "providers", Value::object());
  routing_ = Core::get(Core::get(config, "routing", Value::object()), "capability", Value::object());
  processing_ = Core::get(config, "processing", Value::object());
  (void)providers;
}

ProviderRouter::ProviderRouter(std::vector<std::shared_ptr<AxAIService>> providers, Value routing, Value processing)
    : providers_(std::move(providers)), routing_(std::move(routing)), processing_(std::move(processing)) {}

Value ProviderRouter::provider_records() const {
  Value out = Value::array();
  for (const auto& provider : providers_) {
    Core::append(out, object({{"name", provider->get_name()}, {"id", provider->get_id()}, {"features", provider->get_features(Value())}}));
  }
  return out;
}

std::shared_ptr<AxAIService> ProviderRouter::service_for_name(Value name) const {
  for (auto provider : providers_) if (provider->get_name() == display(name)) return provider;
  return providers_.empty() ? nullptr : providers_.front();
}

Value ProviderRouter::get_routing_recommendation(Value request) {
  Value rec = Core::provider_route_recommendation(provider_records(), Core::coerce_chat_request(request), routing_);
  return rec;
}

Value ProviderRouter::validate_request(Value request) {
  return Core::provider_route_validation(provider_records(), Core::coerce_chat_request(request), processing_, routing_);
}

Value ProviderRouter::get_routing_stats() { return Core::provider_routing_stats(provider_records()); }
Value ProviderRouter::chat(Value request, Value options) {
  Value rec = get_routing_recommendation(request);
  auto provider = service_for_name(Core::get(rec, "providerName"));
  if (!provider) throw Core::as_error(Core::ai_error_unsupported("No provider selected"));
  return object({{"response", provider->chat(request, options)}, {"routing", rec}});
}

Value to_json_schema(Value fields, const std::string& title, Value options) { return Core::to_json_schema(fields, title, options); }
Value validate_output(Value fields, Value values) { return Core::validate_output(fields, values); }
Value strip_internal(Value fields, Value values) { return Core::strip_internal(fields, values); }
Value render_prompt(Value signature, Value values, Value functions, Value options) { return Core::render_prompt(signature, values, functions, options); }
Value fold_stream(Value events) { return Core::fold_stream(events); }

}  // namespace ax
`

const cppConformance = `#include "ax/ax.hpp"

#include <fstream>
#include <iostream>

using namespace ax;

static Array as_array(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return {};
}

static Object as_object(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return {};
}

struct FakeAIClient : AIClient {
  Array responses;
  std::vector<Value> requests;
  int chat_calls = 0;

  explicit FakeAIClient(Value values) : responses(as_array(values)) {}

  Value complete(Value request) override {
    requests.push_back(request);
    if (responses.empty()) throw AxError("fixture", "fake client exhausted");
    Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }

  Value chat(Value request) override {
    ++chat_calls;
    return Core::legacy_response_to_chat_response(complete(request));
  }
};

struct FakeTransport : Transport {
  Array responses;
  std::vector<Value> requests;

  explicit FakeTransport(Value values) : responses(as_array(values)) {}

  Value call(Value request) override {
    requests.push_back(request);
    if (responses.empty()) throw AxError("fixture", "fake transport exhausted");
    Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

static Value router_fixture_default_features() {
  return object({
      {"functions", false},
      {"streaming", false},
      {"media", object({
          {"images", object({{"supported", false}, {"formats", Value::array()}})},
          {"audio", object({{"supported", false}, {"formats", Value::array()}, {"output", object({{"supported", false}, {"formats", Value::array()}})}})},
          {"files", object({{"supported", false}, {"formats", Value::array()}, {"uploadMethod", "none"}})},
          {"urls", object({{"supported", false}, {"webSearch", false}, {"contextFetching", false}})}
      })},
      {"caching", object({{"supported", false}, {"types", Value::array()}})},
      {"thinking", false},
      {"multiTurn", true}
  });
}

static AxError fixture_ai_service_error_cpp(Value spec) {
  std::string type = display(Core::get(spec, "type", "network"));
  std::string message = display(Core::get(spec, "message", "fixture error"));
  auto number = [](Value value, int fallback) {
    if (value.is_null()) return fallback;
    return static_cast<int>(std::stod(display(value)));
  };
  if (type == "status") return AxError("ai", message, "AxAIServiceStatusError", number(Core::get(spec, "status"), 500), "", true);
  if (type == "authentication") return AxError("ai", "Authentication failed", "AxAIServiceAuthenticationError", number(Core::get(spec, "status"), 401), "", false);
  if (type == "response") return AxError("ai", message, "AxAIServiceResponseError", 0, "", false);
  if (type == "timeout") return AxError("ai", message, "AxAIServiceTimeoutError", 0, "", true);
  if (type == "plain") return AxError("runtime", message);
  return AxError("ai", "Network Error: " + message, "AxAIServiceNetworkError", 0, "", true);
}

struct RouterFixtureService : AxBaseAI {
  std::string fixture_id;
  Value model_list;
  Value features;
  Value metrics;
  std::vector<Value> requests;
  Array responses;

  explicit RouterFixtureService(Value spec)
      : AxBaseAI(display(Core::get(spec, "name", "fixture")),
                 display(Core::get(spec, "model", "fixture-chat")),
                 display(Core::get(spec, "embedModel", Core::get(spec, "embed_model", "fixture-embed")))),
        fixture_id(display(Core::get(spec, "id", display(Core::get(spec, "name", "fixture")) + "-id"))),
        model_list(Core::get(spec, "modelList")),
        features(Core::get(spec, "features", router_fixture_default_features())),
        metrics(Core::get(spec, "metrics", object({{"service", display(Core::get(spec, "name", "fixture"))}, {"calls", 0}}))),
        responses(as_array(Core::get(spec, "responses", Value::array()))) {}

  std::string get_id() override { return fixture_id; }
  Value get_model_list() override { return model_list; }
  Value get_features(Value = Value()) override { return features; }
  Value get_metrics() override {
    Value out(as_object(metrics));
    if (!Core::get(out, "calls").is_null()) Core::set(out, "calls", static_cast<double>(requests.size()));
    return out;
  }

 protected:
  Value do_chat(Value request, Value options) override {
    requests.push_back(object({{"method", "chat"}, {"opt", options}}));
    if (!responses.empty()) {
      Value out = responses.front();
      responses.erase(responses.begin());
      Value error = Core::get(out, "error");
      if (!error.is_null()) throw fixture_ai_service_error_cpp(error);
      return Core::get(out, "response", out);
    }
    return object({{"results", Value(Array{object({{"index", 0}, {"content", name_ + " chat"}})})}});
  }

  Value do_embed(Value request, Value options) override {
    requests.push_back(object({{"method", "embed"}, {"opt", options}}));
    return object({{"embeddings", Value(Array{Value(Array{1, 2})})}, {"modelUsage", object({{"ai", name_}})}});
  }

 public:
  Value transcribe(Value request, Value options) override {
    requests.push_back(object({{"method", "transcribe"}, {"opt", options}}));
    return object({{"text", name_ + " transcript"}});
  }

  Value speak(Value request, Value options) override {
    requests.push_back(object({{"method", "speak"}, {"opt", options}}));
    return object({{"audio", "pcm"}});
  }
};

static double conf_number(Value value) {
  if (auto p = std::get_if<double>(&value.data)) return *p;
  std::string text = display(value);
  return text.empty() ? 0.0 : std::stod(text);
}

struct FakeOptimizerEngine : OptimizerEngine {
  Value response;
  std::vector<Value> requests;
  std::vector<Value> evaluations;
  std::vector<Value> transcripts;

  explicit FakeOptimizerEngine(Value response_) : response(std::move(response_)) {}

  std::string name() const override { return "fake"; }
  std::string version() const override { return "1"; }

  Value optimize(Value request) override {
    requests.push_back(request);
    return response;
  }

  Value optimize(Value request, OptimizerEvaluator* evaluator) override {
    requests.push_back(request);
    if (evaluator != nullptr && !Core::get(response, "referenceCandidates").is_null()) {
      Value best_map = Value::object();
      bool has_best = false;
      double best_score = 0.0;
      for (const auto& step : Core::iter(Core::get(response, "referenceCandidates", Value::array()))) {
        Value candidate_map = Core::get(step, "component_map", Core::get(step, "componentMap", Value::object()));
        Value eval_options = Core::get(step, "options", Value::object());
        Value result = evaluator->evaluate(candidate_map, eval_options);
        Value evidence = Core::_build_optimizer_evidence_batch(result, Core::get(request, "components", Value::array()));
        evaluations.push_back(result);
        transcripts.push_back(object({{"candidateMap", candidate_map}, {"options", eval_options}, {"result", result}, {"evidence", evidence}}));
        double score = conf_number(Core::get(result, "avg", Value(0)));
        if (!has_best || score > best_score) {
          has_best = true;
          best_score = score;
          best_map = candidate_map;
        }
      }
      return object({{"componentMap", best_map}, {"metadata", object({{"referenceEngine", true}, {"evaluations", Value(transcripts)}})}});
    }
    if (evaluator != nullptr && !Core::get(response, "evaluate").is_null()) {
      for (const auto& step : Core::iter(Core::get(response, "evaluate", Value::array()))) {
        Value candidate_map = Core::get(step, "component_map", Core::get(step, "componentMap", Value::object()));
        Value eval_options = Core::get(step, "options", Value::object());
        Value result = evaluator->evaluate(
            candidate_map,
            eval_options);
        Value evidence = Core::_build_optimizer_evidence_batch(result, Core::get(request, "components", Value::array()));
        evaluations.push_back(result);
        transcripts.push_back(object({{"candidateMap", candidate_map}, {"options", eval_options}, {"result", result}, {"evidence", evidence}}));
      }
    }
    return response;
  }
};

struct ScriptedGEPAEvaluator : OptimizerEvaluator {
  Value fixture;
  std::vector<Value> evaluations;

  explicit ScriptedGEPAEvaluator(Value fixture_) : fixture(std::move(fixture_)) {}

  std::string component_id(Value candidate_map) const {
    std::string explicit_id = display(Core::get(fixture, "score_component_id", Value("")));
    if (!explicit_id.empty()) return explicit_id;
    Array keys = Core::iter(Core::map_keys(candidate_map));
    return keys.empty() ? "component" : display(keys[0]);
  }

  Value evaluate(Value candidate_map, Value options) override {
    Value dataset_input = !Core::get(options, "dataset").is_null() ? Core::get(options, "dataset") : Core::get(fixture, "dataset", Value::array());
    Value normalized = Core::_normalize_optimization_dataset(dataset_input);
    Array examples = Core::iter(Core::get(normalized, "train", Value::array()));
    if (examples.empty()) examples.push_back(object({{"input", object({{"fixture", "gepa"}})}}));
    std::string id = component_id(candidate_map);
    Value value = Core::get(candidate_map, id, Core::get(fixture, "base_component_value", Value("")));
    Value score_map = Core::get(fixture, "gepa_scores", Value::object());
    Value raw_score = Core::get(score_map, display(value), Core::get(score_map, "*", Value(0)));
    Array score_list = as_array(raw_score);
    Value rows = Value::array();
    for (size_t i = 0; i < examples.size(); ++i) {
      Value item_score = score_list.empty() ? raw_score : score_list[std::min(i, score_list.size() - 1)];
      Value scores = Core::_normalize_optimization_metric_scores(item_score);
      Value scalar = Core::_scalarize_optimization_scores(scores, Core::get(fixture, "score_options", Value::object()));
      Value trace = object({{"componentValue", display(value)}});
      Value prediction = object({
          {"completionType", "final"},
          {"output", object({{"componentValue", display(value)}})},
          {"finalOutput", object({{"componentValue", display(value)}})},
          {"functionCalls", Value::array()},
          {"actionLog", Value::array()},
          {"usage", Value::object()},
          {"trace", trace},
      });
      Core::append(rows, Core::_build_optimization_eval_row(examples[i], prediction, scores, scalar, trace, Value()));
    }
    Value result = Core::_build_optimization_eval_result(rows, candidate_map, Core::get(options, "phase", "gepa"));
    evaluations.push_back(result);
    return result;
  }
};

static void assert_subset(Value actual, Value expected, const std::string& label);

struct FakeCodeRuntime;

struct FakeCodeSession : AxCodeSession {
  FakeCodeRuntime* runtime;
  Value globals;
  Value create_options;
  bool closed = false;

  FakeCodeSession(FakeCodeRuntime* runtime_, Value globals_, Value options_) : runtime(runtime_), globals(std::move(globals_)), create_options(std::move(options_)) {}

  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value export_state(Value options = Value::object()) override {
    return snapshot_globals(options);
  }
  Value restore_state(Value snapshot, Value options = Value::object()) override {
    return patch_globals(snapshot, options);
  }
  Value close() override {
    closed = true;
    return object({{"closed", true}});
  }
};

struct FakeCodeRuntime : AxCodeRuntime {
  Array script;
  std::vector<std::unique_ptr<FakeCodeSession>> sessions;
  std::vector<Value> executed;
  std::vector<Value> create_requests;
  std::vector<Value> execute_options;
  std::string runtime_language;
  std::string runtime_usage;
  Value capabilities;

  explicit FakeCodeRuntime(Value script_value, std::string language = "JavaScript", std::string usage = "", Value capabilities_ = Value::object())
      : script(as_array(script_value)), runtime_language(std::move(language)), runtime_usage(std::move(usage)), capabilities(object({{"inspect", true}, {"snapshot", true}, {"patch", true}})) {
    for (const auto& kv : as_object(capabilities_)) {
      if (kv.first != "__order") Core::set(capabilities, kv.first, kv.second);
    }
  }

  std::string language() const override { return runtime_language.empty() ? "JavaScript" : runtime_language; }
  std::string usage_instructions() const override { return runtime_usage; }

  AxCodeSession* create_session(Value globals, Value options = Value::object()) override {
    create_requests.push_back(object({{"globals", globals}, {"options", options}}));
    sessions.push_back(std::make_unique<FakeCodeSession>(this, std::move(globals), std::move(options)));
    return sessions.back().get();
  }
};

Value FakeCodeSession::inspect(Value) {
  if (!Core::truthy(Core::get(runtime->capabilities, "inspect", true))) {
    return Value("[runtime state inspection unavailable: runtime session does not implement inspect_globals()]");
  }
  return globals;
}

Value FakeCodeSession::snapshot_globals(Value) {
  if (!Core::truthy(Core::get(runtime->capabilities, "snapshot", true))) {
    throw AxError("runtime", "AxCodeSession.snapshot_globals() is required to export AxAgent state");
  }
  Array entries;
  for (const auto& kv : as_object(globals)) {
    if (kv.first == "__order") continue;
    entries.push_back(object({{"name", kv.first}, {"type", "json"}, {"preview", display(kv.second)}}));
  }
  return object({{"version", 1}, {"entries", entries}, {"bindings", globals}, {"globals", globals}, {"closed", closed}});
}

Value FakeCodeSession::patch_globals(Value snapshot, Value options) {
  if (!Core::truthy(Core::get(runtime->capabilities, "patch", true))) {
    throw AxError("runtime", "AxCodeSession.patch_globals() is required to restore AxAgent state");
  }
  Value raw = !Core::get(snapshot, "bindings", Value()).is_null() ? Core::get(snapshot, "bindings", Value::object()) : Core::get(snapshot, "globals", Value::object());
  globals = raw;
  closed = Core::truthy(Core::get(snapshot, "closed", false));
  return snapshot_globals(options);
}

Value FakeCodeSession::execute(Value code, Value options) {
  if (closed) return object({{"is_error", true}, {"error_category", "session_closed"}, {"error", "session closed"}});
  if (runtime->script.empty()) throw AxError("fixture", "fake runtime exhausted");
  Value step = runtime->script.front();
  runtime->script.erase(runtime->script.begin());
  Value expected = Core::get(step, "expected_code", Value());
  if (!expected.is_null() && display(expected) != display(code)) {
    throw AxError("fixture", "expected code " + display(expected) + ", got " + display(code));
  }
  Value expected_options = Core::get(step, "expected_options_subset", Value());
  if (!expected_options.is_null()) {
    assert_subset(options, expected_options, "runtime execute options");
  }
  runtime->executed.emplace_back(display(code));
  runtime->execute_options.push_back(options);
  Value patch = Core::get(step, "bindings_patch", Value::object());
  for (const auto& kv : as_object(patch)) {
    if (kv.first != "__order") Core::set(globals, kv.first, kv.second);
  }
  if (Core::truthy(Core::get(step, "close_before_result", false))) closed = true;
  Value default_result = object({{"kind", "result"}, {"result", globals}});
  return Core::get(step, "result", default_result);
}

static std::vector<std::pair<std::string, Value>> conf_entries(Value value) {
  Object obj = as_object(value);
  std::vector<std::pair<std::string, Value>> out;
  std::set<std::string> seen;
  auto order_it = obj.find("__order");
  if (order_it != obj.end()) {
    for (const auto& item : as_array(order_it->second)) {
      std::string key = display(item);
      auto it = obj.find(key);
      if (it != obj.end() && key != "__order") {
        out.push_back(*it);
        seen.insert(key);
      }
    }
  }
  for (const auto& kv : obj) {
    if (kv.first != "__order" && seen.count(kv.first) == 0) out.push_back(kv);
  }
  return out;
}

static std::string read_file(const std::filesystem::path& path) {
  std::ifstream in(path);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

static std::vector<std::filesystem::path> expand(const std::filesystem::path& path) {
  if (!std::filesystem::is_directory(path)) return {path};
  std::vector<std::filesystem::path> out;
  for (const auto& entry : std::filesystem::directory_iterator(path)) {
    if (entry.path().extension() == ".json") out.push_back(entry.path());
  }
  std::sort(out.begin(), out.end());
  return out;
}

static Value field_from_spec(Value spec);

static Value string_array(Value value) {
  Array out;
  for (const auto& item : as_array(value)) out.emplace_back(display(item));
  return Value(out);
}

static Value field_from_spec(Value spec) {
  Object s = as_object(spec);
  std::string typ = s.count("type") ? display(s["type"]) : "string";
  Object type{{"name", typ}, {"isArray", Core::truthy(Core::get(spec, "array", false))}};
  if (typ == "class") type["options"] = s.count("options") ? s["options"] : Value::array();
  if (typ == "object") {
    Object nested;
    Array order;
    for (const auto& kv : conf_entries(Core::get(spec, "fields", Value::object()))) {
      Value nested_field = field_from_spec(kv.second);
      Core::set(nested_field, "name", kv.first);
      nested[kv.first] = Core::record_new("Field", nested_field);
      order.emplace_back(kv.first);
    }
    nested["__order"] = order;
    type["fields"] = Value(nested);
  }
  if (s.count("description") && (typ != "object" || Core::truthy(Core::get(spec, "array", false)))) type["description"] = s["description"];
  if (s.count("min")) {
    if (typ == "number") type["minimum"] = s["min"];
    else type["minLength"] = s["min"];
  }
  if (s.count("max")) {
    if (typ == "number") type["maximum"] = s["max"];
    else type["maxLength"] = s["max"];
  }
  if (Core::truthy(Core::get(spec, "email", false))) type["format"] = "email";
  if (Core::truthy(Core::get(spec, "url", false)) && typ == "string") type["format"] = "uri";
  if (s.count("pattern")) {
    type["pattern"] = s["pattern"];
    type["patternDescription"] = s.count("patternDescription") ? s["patternDescription"] : s["pattern"];
  }
  Object field{{"name", ""}, {"type", Core::record_new("FieldType", Value(type))},
               {"isOptional", Core::truthy(Core::get(spec, "optional", false))},
               {"isInternal", Core::truthy(Core::get(spec, "internal", false))},
               {"isCached", Core::truthy(Core::get(spec, "cache", false))}};
  if (s.count("arrayDescription")) field["description"] = s["arrayDescription"];
  else if (s.count("description")) field["description"] = s["description"];
  return Value(field);
}

static Value signature_from_spec(Value spec) {
  Object out{{"description", Core::get(spec, "description")}};
  Array inputs, outputs;
  for (const auto& kv : conf_entries(Core::get(spec, "inputs", Value::object()))) {
    Value f = field_from_spec(kv.second);
    Core::set(f, "name", kv.first);
    f = Core::record_new("Field", f);
    inputs.push_back(f);
  }
  for (const auto& kv : conf_entries(Core::get(spec, "outputs", Value::object()))) {
    Value f = field_from_spec(kv.second);
    Core::set(f, "name", kv.first);
    f = Core::record_new("Field", f);
    outputs.push_back(f);
  }
  out["inputs"] = inputs;
  out["outputs"] = outputs;
  Value sig(out);
  Core::validate_signature(sig);
  return sig;
}

static Value build_signature(Value fixture) {
  if (!Core::get(fixture, "signature_spec").is_null()) return signature_from_spec(Core::get(fixture, "signature_spec"));
  Value sig = Core::parse_signature(Core::get(fixture, "signature"));
  Core::validate_signature(sig);
  return sig;
}

static Value field_payload(Value field);
static Value type_payload(Value typ) {
  Object out{{"name", Core::get(typ, "name")}, {"isArray", Core::get(typ, "is_array", false)}};
  for (const auto& key : {"options", "description", "fields", "minLength", "maxLength", "minimum", "maximum", "pattern", "patternDescription", "format"}) {
    Value value = Core::get(typ, key);
    if (!value.is_null()) {
      if (std::string(key) == "fields") {
        Object nested;
        Array order;
        for (const auto& kv : conf_entries(value)) {
          Value nested_field = kv.second;
          if (Core::get(nested_field, "name").is_null() || display(Core::get(nested_field, "name")).empty()) {
            Core::set(nested_field, "name", kv.first);
            nested_field = Core::record_new("Field", nested_field);
          }
          nested[kv.first] = field_payload(nested_field);
          order.emplace_back(kv.first);
        }
        nested["__order"] = order;
        out[key] = Value(nested);
      } else out[key] = value;
    }
  }
  return Value(out);
}
static Value field_payload(Value field) {
  Object out{{"name", Core::get(field, "name")}, {"title", Core::get(field, "title")}, {"type", type_payload(Core::get(field, "type"))},
             {"isOptional", Core::get(field, "is_optional", false)}, {"isInternal", Core::get(field, "is_internal", false)}, {"isCached", Core::get(field, "is_cached", false)}};
  if (!Core::get(field, "description").is_null()) out["description"] = Core::get(field, "description");
  return Value(out);
}
static Value signature_payload(Value sig) {
  Array inputs, outputs;
  for (const auto& f : as_array(Core::get(sig, "inputs"))) inputs.push_back(field_payload(f));
  for (const auto& f : as_array(Core::get(sig, "outputs"))) outputs.push_back(field_payload(f));
  return Value(Object{{"description", Core::get(sig, "description")}, {"inputs", inputs}, {"outputs", outputs}});
}

static void assert_equal(Value actual, Value expected, const std::string& label) {
  if (!equal(actual, expected)) throw AxError("fixture", label + " mismatch actual=" + stringify(actual) + " expected=" + stringify(expected));
}

static void assert_subset(Value actual, Value expected, const std::string& label) {
  if (expected.is_object()) {
    Object act = as_object(actual);
    for (const auto& kv : conf_entries(expected)) {
      auto it = act.find(kv.first);
      if (it == act.end()) throw AxError("fixture", label + " missing key " + kv.first);
      assert_subset(it->second, kv.second, label + "." + kv.first);
    }
    return;
  }
  if (expected.is_array()) {
    assert_equal(actual, expected, label);
    return;
  }
  if (!equal(actual, expected)) throw AxError("fixture", label + " expected " + stringify(expected) + ", got " + stringify(actual));
}

static void assert_list_subset(Value actual, Value expected, const std::string& label) {
  Array act = Core::iter(actual);
  size_t start = 0;
  for (const auto& item : Core::iter(expected)) {
    bool matched = false;
    for (size_t i = start; i < act.size(); ++i) {
      try {
        assert_subset(act[i], item, label + "[" + std::to_string(i) + "]");
        start = i + 1;
        matched = true;
        break;
      } catch (const AxError&) {
      }
    }
    if (!matched) throw AxError("fixture", label + " missing expected item " + stringify(item));
  }
}

static Value expect_maybe_error(const std::function<Value()>& fn, Value fixture) {
  try {
    Value out = fn();
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected operation to fail");
    return out;
  } catch (const AxError& e) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(e.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + e.what());
    return Value();
  }
}

struct ToolBuild {
  std::vector<Tool> tools;
  Value values = Value::array();
  Value calls = Value::array();
};

static ToolBuild build_tools(Value specs) {
  ToolBuild out;
  for (const auto& item : as_array(specs)) {
    Value spec = item;
    std::string name = display(Core::get(spec, "name"));
    Value args = Value::array();
    for (const auto& kv : conf_entries(Core::get(spec, "args", Value::object()))) {
      Value field = field_from_spec(kv.second);
      Core::set(field, "name", kv.first);
      Core::append(args, Core::record_new("Field", field));
    }
    Value returns = Value::array();
    for (const auto& kv : conf_entries(Core::get(spec, "returns", Value::object()))) {
      Value field = field_from_spec(kv.second);
      Core::set(field, "name", kv.first);
      Core::append(returns, Core::record_new("Field", field));
    }
    Value parameters = Core::to_json_schema(args, name + "Args", Value::object());
    Value calls = out.calls;
    Tool tool(
        name,
        display(Core::get(spec, "description", name)),
        parameters,
        [calls, spec, name](Value params) mutable {
          Value call = Value::object();
          Core::set(call, "name", name);
          Core::set(call, "args", params);
          Core::append(calls, call);
          Value error = Core::get(spec, "error");
          if (!error.is_null() && Core::truthy(error)) throw AxError("runtime", display(error));
          return Core::get(spec, "result");
        },
        args,
        returns);
    Core::append(out.values, tool.value());
    out.tools.push_back(std::move(tool));
  }
  return out;
}

static void run_forward(Value fixture) {
  Value sig = build_signature(fixture);
  ToolBuild tool_build = build_tools(Core::get(fixture, "tools", Value::array()));
  Value options = Core::map_merge(Core::get(fixture, "options", Value::object()), Value(Object{{"functions", tool_build.values}}));
  AxGen gen(sig, options);
  if (!Core::get(fixture, "examples").is_null()) gen.set_examples(Core::get(fixture, "examples"));
  if (!Core::get(fixture, "demos").is_null()) gen.set_demos(Core::get(fixture, "demos"));
  for (const auto& assertion : Core::iter(Core::get(fixture, "assertions", Value::array()))) gen.add_assertion(assertion);
  for (const auto& processor : Core::iter(Core::get(fixture, "field_processors", Core::get(fixture, "fieldProcessors", Value::array())))) {
    gen.add_field_processor(display(Core::get(processor, "field")), display(Core::get(processor, "processor", Core::get(processor, "op"))));
  }
  if (!Core::get(fixture, "stop_functions", Core::get(fixture, "stopFunctions")).is_null()) {
    gen.set_stop_functions(Core::get(fixture, "stop_functions", Core::get(fixture, "stopFunctions", Value::array())));
  }
  FakeAIClient client(Core::get(fixture, "responses", Value::array()));
  Value input = Core::get(fixture, "input", Core::get(fixture, "values", Value::object()));
  Value output = expect_maybe_error([&] { return gen.forward(client, input, Core::get(fixture, "forward_options", Value::object())); }, fixture);
  if (Core::get(fixture, "expected_error_contains").is_null() && !Core::get(fixture, "expected_output").is_null()) {
    assert_equal(output, Core::get(fixture, "expected_output"), "forward output");
  }
  Value expected_count = Core::get(fixture, "expected_request_count");
  if (!expected_count.is_null() && client.requests.size() != static_cast<size_t>(std::stoul(display(expected_count)))) {
    throw AxError("fixture", "expected request count mismatch");
  }
  if (Core::truthy(Core::get(fixture, "expect_chat_path", true)) && client.chat_calls == 0) {
    throw AxError("fixture", "expected AxGen to use AIClient.chat()");
  }
  Value expected_request = Core::get(fixture, "expected_request");
  if (!expected_request.is_null()) {
    if (client.requests.empty()) throw AxError("fixture", "fixture expected a request but none were sent");
    assert_subset(client.requests[0], expected_request, "request");
  }
  Value expected_contains = Core::get(fixture, "expected_request_contains");
  if (!expected_contains.is_null()) {
    std::string request_text = stringify(Value(client.requests));
    for (const auto& item : Core::iter(expected_contains)) {
      if (request_text.find(display(item)) == std::string::npos) throw AxError("fixture", "request missing " + display(item) + ": " + request_text);
    }
  }
  Value expected_tool_calls = Core::get(fixture, "expected_tool_calls");
  if (!expected_tool_calls.is_null()) assert_equal(tool_build.calls, expected_tool_calls, "tool calls");
  Value expected_trace = Core::get(fixture, "expected_trace");
  if (!expected_trace.is_null()) {
    Value traces = gen.get_traces();
    Array trace_items = Core::iter(traces);
    if (trace_items.empty()) throw AxError("fixture", "expected trace but none was recorded");
    assert_subset(trace_items.back(), expected_trace, "trace");
  }
  if (!Core::get(fixture, "expected_memory_history_subset").is_null()) assert_list_subset(gen.get_memory().history(), Core::get(fixture, "expected_memory_history_subset"), "memory history");
  if (!Core::get(fixture, "expected_chat_log_subset").is_null()) assert_list_subset(gen.get_chat_log(), Core::get(fixture, "expected_chat_log_subset"), "chat log");
  if (!Core::get(fixture, "expected_function_traces_subset").is_null()) assert_list_subset(gen.get_function_call_traces(), Core::get(fixture, "expected_function_traces_subset"), "function call traces");
  if (!Core::get(fixture, "expected_chat_prompt").is_null()) {
    if (client.requests.empty()) throw AxError("fixture", "fixture expected a request but none were sent");
    assert_equal(Core::get(client.requests[0], "chat_prompt"), Core::get(fixture, "expected_chat_prompt"), "chat prompt");
  }
  if (!Core::get(fixture, "expected_chat_prompt_contains").is_null()) {
    if (client.requests.empty()) throw AxError("fixture", "fixture expected a request but none were sent");
    std::string prompt_text = stringify(Core::get(client.requests[0], "chat_prompt"));
    for (const auto& item : Core::iter(Core::get(fixture, "expected_chat_prompt_contains"))) {
      if (prompt_text.find(display(item)) == std::string::npos) throw AxError("fixture", "chat prompt missing " + display(item) + ": " + prompt_text);
    }
  }
}

static Value optimize_component_ids(Value components) {
  Value ids = Value::array();
  for (const auto& component : Core::iter(components)) Core::append(ids, Core::get(component, "id"));
  return ids;
}

static AxFlow build_flow(Value fixture, std::vector<std::unique_ptr<AxGen>>& programs, std::vector<std::unique_ptr<AxFlow>>& flows, std::vector<std::unique_ptr<AxAgent>>& agents);

static void run_optimize(Value fixture) {
  std::string program_kind = display(Core::get(fixture, "program", "agent"));
  Value options = Core::get(fixture, "options", Value::object());
  ToolBuild tool_build = build_tools(Core::get(fixture, "tools", Value::array()));
  if (!as_array(tool_build.values).empty()) Core::set(options, "functions", tool_build.values);
  std::string op = display(Core::get(fixture, "operation", "components"));
  try {
    if (op == "dataset") {
      Value normalized = Core::_normalize_optimization_dataset(Core::get(fixture, "dataset", Value::array()));
      assert_equal(normalized, Core::get(fixture, "expected_dataset"), "normalized dataset");
      return;
    }
    if (op == "score") {
      Value scores = Core::_normalize_optimization_metric_scores(Core::get(fixture, "metric_score"));
      Value scalar = Core::_scalarize_optimization_scores(scores, Core::get(fixture, "score_options", Value::object()));
      Value adjusted = Core::_adjust_optimization_score_for_actions(scalar, Core::get(fixture, "task", Value::object()), Core::get(fixture, "prediction", object({{"functionCalls", Value::array()}})));
      if (!Core::get(fixture, "expected_scores").is_null()) assert_equal(scores, Core::get(fixture, "expected_scores"), "metric scores");
      if (!Core::get(fixture, "expected_scalar").is_null()) assert_equal(adjusted, Core::get(fixture, "expected_scalar"), "metric scalar");
      if (!Core::get(fixture, "quality").is_null()) assert_equal(Core::_map_optimization_judge_quality_to_score(Core::get(fixture, "quality")), Core::get(fixture, "expected_quality_score"), "judge quality score");
      return;
    }
    if (op == "judge_payload") {
      Value payload = Core::_build_optimization_judge_payload(Core::get(fixture, "task", Value::object()), Core::get(fixture, "prediction", Value::object()), Core::get(fixture, "criteria", Value("")));
      if (!Core::get(fixture, "expected_judge_payload_subset").is_null()) assert_subset(payload, Core::get(fixture, "expected_judge_payload_subset"), "judge payload");
      return;
    }
    if (op == "evidence") {
      Value evidence = Core::_build_optimizer_evidence_batch(Core::get(fixture, "eval_result", Value::object()), Core::get(fixture, "components", Value::array()));
      if (!Core::get(fixture, "expected_evidence_subset").is_null()) assert_subset(evidence, Core::get(fixture, "expected_evidence_subset"), "optimizer evidence");
      return;
    }
    if (op == "gepa") {
      Value components = Core::get(fixture, "components", Value::array());
      Value request = object({
          {"contractVersion", "axir-optimize-v1"},
          {"programId", program_kind},
          {"programKind", program_kind},
          {"components", components},
          {"targetComponents", components},
          {"dataset", Core::_normalize_optimization_dataset(Core::get(fixture, "dataset", Value::array()))},
          {"options", Core::get(fixture, "optimize_options", Value::object())},
          {"evidence", object({{"source", "fixture"}})},
      });
      std::unique_ptr<FakeAIClient> reflection;
      AIClient* reflection_ptr = nullptr;
      if (!Core::get(fixture, "reflection_responses").is_null()) {
        reflection = std::make_unique<FakeAIClient>(Core::get(fixture, "reflection_responses", Value::array()));
        reflection_ptr = reflection.get();
      }
      AxGEPA engine(reflection_ptr, Core::get(fixture, "gepa_options", Value::object()));
      ScriptedGEPAEvaluator evaluator(fixture);
      Value artifact = engine.optimize(request, &evaluator);
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "GEPA artifact");
      if (!Core::get(fixture, "expected_gepa_evaluations_subset").is_null()) assert_list_subset(Value(evaluator.evaluations), Core::get(fixture, "expected_gepa_evaluations_subset"), "GEPA evaluations");
      return;
    }
    if (program_kind == "axgen") {
      AxGen gen(build_signature(fixture), options);
      if (op == "components") {
        Value components = gen.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "optimizable components");
        if (!Core::get(fixture, "expected_component_ids").is_null()) assert_equal(optimize_component_ids(components), Core::get(fixture, "expected_component_ids"), "component ids");
        return;
      }
      if (op == "apply") {
        Value before = gen.get_optimizable_components();
        Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", object({{"source", "fixture"}})));
        Value validated = Core::_validate_optimized_artifact(artifact, before);
        Value payload = Core::truthy(Core::get(fixture, "serialized_artifact", false)) ? Core::_serialize_optimized_artifact(validated) : validated;
        gen.apply_optimization(payload);
        Value after = gen.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(after, Core::get(fixture, "expected_components_subset"), "optimized components");
        if (!Core::get(fixture, "expected_changed_components").is_null()) assert_equal(Core::_optimization_changed_components(before, Core::get(fixture, "component_map", Value::object())), Core::get(fixture, "expected_changed_components"), "changed components");
        return;
      }
      if (op == "evaluate") {
        FakeAIClient client(Core::get(fixture, "responses", Value::array()));
        Value result = gen.evaluate_optimization(client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "candidate_map", Value::object()), Core::get(fixture, "eval_options", Value::object()));
        if (!Core::get(fixture, "expected_evaluation_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_evaluation_subset"), "optimization evaluation");
        if (!Core::get(fixture, "expected_evaluation_rows_subset").is_null()) assert_list_subset(Core::get(result, "rows", Value::array()), Core::get(fixture, "expected_evaluation_rows_subset"), "optimization evaluation rows");
        if (!Core::get(fixture, "expected_components_subset_after").is_null()) assert_list_subset(gen.get_optimizable_components(), Core::get(fixture, "expected_components_subset_after"), "post-eval components");
        return;
      }
      if (op == "engine") {
        FakeOptimizerEngine engine(Core::get(fixture, "engine_response", Value::object()));
        Value artifact;
        if (Core::truthy(Core::get(fixture, "engine_uses_evaluator", false))) {
          FakeAIClient client(Core::get(fixture, "responses", Value::array()));
          artifact = gen.optimize_with(engine, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        } else {
          artifact = gen.optimize_with(engine, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        }
        if (!Core::get(fixture, "expected_engine_request_subset").is_null()) {
          if (engine.requests.empty()) throw AxError("fixture", "optimizer engine was not called");
          assert_subset(engine.requests[0], Core::get(fixture, "expected_engine_request_subset"), "optimizer engine request");
        }
        if (!Core::get(fixture, "expected_engine_evaluations_subset").is_null()) assert_list_subset(Value(engine.evaluations), Core::get(fixture, "expected_engine_evaluations_subset"), "optimizer engine evaluations");
        if (!Core::get(fixture, "expected_engine_transcripts_subset").is_null()) assert_list_subset(Value(engine.transcripts), Core::get(fixture, "expected_engine_transcripts_subset"), "optimizer engine transcripts");
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimizer artifact");
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(gen.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "optimized components");
        return;
      }
    }
    if (program_kind == "flow") {
      std::vector<std::unique_ptr<AxGen>> programs;
      std::vector<std::unique_ptr<AxFlow>> flows;
      std::vector<std::unique_ptr<AxAgent>> agents;
      AxFlow fl = build_flow(fixture, programs, flows, agents);
      if (op == "components") {
        Value components = fl.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "optimizable components");
        if (!Core::get(fixture, "expected_component_ids").is_null()) assert_equal(optimize_component_ids(components), Core::get(fixture, "expected_component_ids"), "component ids");
        return;
      }
      if (op == "filter") {
        Value filtered = Core::_filter_optimization_components(fl.get_optimizable_components(), Core::get(fixture, "target", "all"));
        assert_equal(optimize_component_ids(filtered), Core::get(fixture, "expected_component_ids", Value::array()), "filtered component ids");
        return;
      }
      if (op == "apply") {
        Value before = fl.get_optimizable_components();
        Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", object({{"source", "fixture"}})));
        Value validated = Core::_validate_optimized_artifact(artifact, before);
        Value payload = Core::truthy(Core::get(fixture, "serialized_artifact", false)) ? Core::_serialize_optimized_artifact(validated) : validated;
        fl.apply_optimization(payload);
        Value after = fl.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(after, Core::get(fixture, "expected_components_subset"), "optimized components");
        if (!Core::get(fixture, "expected_changed_components").is_null()) assert_equal(Core::_optimization_changed_components(before, Core::get(fixture, "component_map", Value::object())), Core::get(fixture, "expected_changed_components"), "changed components");
        return;
      }
      if (op == "evaluate") {
        FakeAIClient client(Core::get(fixture, "responses", Value::array()));
        Value result = fl.evaluate_optimization(client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "candidate_map", Value::object()), Core::get(fixture, "eval_options", Value::object()));
        if (!Core::get(fixture, "expected_evaluation_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_evaluation_subset"), "optimization evaluation");
        if (!Core::get(fixture, "expected_evaluation_rows_subset").is_null()) assert_list_subset(Core::get(result, "rows", Value::array()), Core::get(fixture, "expected_evaluation_rows_subset"), "optimization evaluation rows");
        if (!Core::get(fixture, "expected_components_subset_after").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset_after"), "post-eval components");
        return;
      }
      if (op == "engine") {
        FakeOptimizerEngine engine(Core::get(fixture, "engine_response", Value::object()));
        Value artifact;
        if (Core::truthy(Core::get(fixture, "engine_uses_evaluator", false))) {
          FakeAIClient client(Core::get(fixture, "responses", Value::array()));
          artifact = fl.optimize_with(engine, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        } else {
          artifact = fl.optimize_with(engine, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        }
        if (!Core::get(fixture, "expected_engine_request_subset").is_null()) {
          if (engine.requests.empty()) throw AxError("fixture", "optimizer engine was not called");
          assert_subset(engine.requests[0], Core::get(fixture, "expected_engine_request_subset"), "optimizer engine request");
        }
        if (!Core::get(fixture, "expected_engine_evaluations_subset").is_null()) assert_list_subset(Value(engine.evaluations), Core::get(fixture, "expected_engine_evaluations_subset"), "optimizer engine evaluations");
        if (!Core::get(fixture, "expected_engine_transcripts_subset").is_null()) assert_list_subset(Value(engine.transcripts), Core::get(fixture, "expected_engine_transcripts_subset"), "optimizer engine transcripts");
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimizer artifact");
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "optimized components");
        return;
      }
    }
    AxAgent ag(Core::get(fixture, "signature", "question:string -> answer:string"), options);
    if (op == "components") {
      Value components = ag.get_optimizable_components();
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "optimizable components");
      if (!Core::get(fixture, "expected_component_ids").is_null()) assert_equal(optimize_component_ids(components), Core::get(fixture, "expected_component_ids"), "component ids");
      return;
    }
    if (op == "filter") {
      Value filtered = Core::_filter_optimization_components(ag.get_optimizable_components(), Core::get(fixture, "target", "all"));
      assert_equal(optimize_component_ids(filtered), Core::get(fixture, "expected_component_ids", Value::array()), "filtered component ids");
      return;
    }
    if (op == "apply") {
      Value before = ag.get_optimizable_components();
      Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", object({{"source", "fixture"}})));
      Value validated = Core::_validate_optimized_artifact(artifact, before);
      Value payload = Core::truthy(Core::get(fixture, "serialized_artifact", false)) ? Core::_serialize_optimized_artifact(validated) : validated;
      ag.apply_optimization(payload);
      Value after = ag.get_optimizable_components();
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(after, Core::get(fixture, "expected_components_subset"), "optimized components");
      if (!Core::get(fixture, "expected_changed_components").is_null()) assert_equal(Core::_optimization_changed_components(before, Core::get(fixture, "component_map", Value::object())), Core::get(fixture, "expected_changed_components"), "changed components");
      return;
    }
    if (op == "artifact") {
      Value components = ag.get_optimizable_components();
      Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", Value::object()));
      Value decoded = Core::_deserialize_optimized_artifact(Core::_serialize_optimized_artifact(Core::_validate_optimized_artifact(artifact, components)), components);
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(decoded, Core::get(fixture, "expected_artifact_subset"), "optimized artifact");
      return;
    }
    if (op == "engine") {
      FakeOptimizerEngine engine(Core::get(fixture, "engine_response", Value::object()));
      Value artifact;
      if (Core::truthy(Core::get(fixture, "engine_uses_evaluator", false))) {
        FakeAIClient client(Core::get(fixture, "responses", Value::array()));
        artifact = ag.optimize_with(engine, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
      } else {
        artifact = ag.optimize_with(engine, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
      }
      if (!Core::get(fixture, "expected_engine_request_subset").is_null()) {
        if (engine.requests.empty()) throw AxError("fixture", "optimizer engine was not called");
        assert_subset(engine.requests[0], Core::get(fixture, "expected_engine_request_subset"), "optimizer engine request");
      }
      if (!Core::get(fixture, "expected_engine_evaluations_subset").is_null()) assert_list_subset(Value(engine.evaluations), Core::get(fixture, "expected_engine_evaluations_subset"), "optimizer engine evaluations");
      if (!Core::get(fixture, "expected_engine_transcripts_subset").is_null()) assert_list_subset(Value(engine.transcripts), Core::get(fixture, "expected_engine_transcripts_subset"), "optimizer engine transcripts");
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimizer artifact");
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(ag.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "optimized components");
      return;
    }
    if (op == "evaluate") {
      FakeAIClient client(Core::get(fixture, "responses", Value::array()));
      Value result = ag.evaluate_optimization(client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "candidate_map", Value::object()), Core::get(fixture, "eval_options", Value::object()));
      if (!Core::get(fixture, "expected_evaluation_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_evaluation_subset"), "optimization evaluation");
      if (!Core::get(fixture, "expected_evaluation_rows_subset").is_null()) assert_list_subset(Core::get(result, "rows", Value::array()), Core::get(fixture, "expected_evaluation_rows_subset"), "optimization evaluation rows");
      if (!Core::get(fixture, "expected_components_subset_after").is_null()) assert_list_subset(ag.get_optimizable_components(), Core::get(fixture, "expected_components_subset_after"), "post-eval components");
      return;
    }
    if (op == "eval") {
      FakeAIClient client(Core::get(fixture, "responses", Value::array()));
      Value prediction = ag.evaluate_optimization_task(client, Core::get(fixture, "task", object({{"input", Core::get(fixture, "input", Value::object())}})), Core::get(fixture, "eval_options", Value::object()));
      if (!Core::get(fixture, "expected_prediction_subset").is_null()) assert_subset(prediction, Core::get(fixture, "expected_prediction_subset"), "eval prediction");
      return;
    }
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(error.what()).find(display(expected)) != std::string::npos) return;
    throw;
  }
  throw AxError("fixture", "unknown optimize operation " + op);
}

static void assert_agent_trace(AxAgent& ag, Value fixture);

static void run_agent_forward(Value fixture) {
  FakeAIClient client(Core::get(fixture, "responses", Value::array()));
  Value agent_options = Core::get(fixture, "options", Value::object());
  std::unique_ptr<FakeCodeRuntime> runtime;
  if (!Core::get(fixture, "runtime_script").is_null()) {
    Value runtime_config = Core::get(agent_options, "runtime", Value::object());
    runtime = std::make_unique<FakeCodeRuntime>(
        Core::get(fixture, "runtime_script", Value::array()),
        display(Core::get(runtime_config, "language", Core::get(fixture, "runtime_language", "JavaScript"))),
        display(Core::get(runtime_config, "usageInstructions", Core::get(runtime_config, "usage_instructions", ""))));
    Core::set(agent_options, "runtime", Core::code_runtime_ref(*runtime));
  }
  std::unique_ptr<AxAgent> ag;
  try {
    ag = std::make_unique<AxAgent>(Core::get(fixture, "signature"), agent_options);
    if (!Core::get(fixture, "set_state").is_null()) ag->set_state(Core::get(fixture, "set_state"));
    Value output = ag->forward(client, Core::get(fixture, "input", Value::object()), Core::get(fixture, "forward_options", Value::object()));
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected agent forward to fail");
    if (!Core::get(fixture, "expected_output").is_null()) assert_equal(output, Core::get(fixture, "expected_output"), "agent output");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + error.what());
    if (ag) assert_agent_trace(*ag, fixture);
    return;
  }
  Value expected_count = Core::get(fixture, "expected_request_count");
  if (!expected_count.is_null() && client.requests.size() != static_cast<size_t>(std::stoul(display(expected_count)))) {
    throw AxError("fixture", "expected agent request count mismatch");
  }
  Value expected_contains = Core::get(fixture, "expected_request_contains");
  if (!expected_contains.is_null()) {
    std::string request_text = stringify(Value(client.requests));
    for (const auto& item : Core::iter(expected_contains)) {
      if (request_text.find(display(item)) == std::string::npos) throw AxError("fixture", "agent request missing " + display(item) + ": " + request_text);
    }
  }
  Value expected_absent = Core::get(fixture, "expected_stage_request_not_contains");
  if (!expected_absent.is_null()) {
    for (const auto& raw : Core::iter(expected_absent)) {
      int index = static_cast<int>(std::stoul(display(Core::get(raw, "index", 0))));
      std::string text = index < static_cast<int>(client.requests.size()) ? stringify(client.requests[static_cast<size_t>(index)]) : "";
      for (const auto& item : Core::iter(Core::get(raw, "absent", Value::array()))) {
        if (text.find(display(item)) != std::string::npos) throw AxError("fixture", "agent request unexpectedly contained " + display(item));
      }
    }
  }
  Value expected_cached = Core::get(fixture, "expected_cached_request_indices");
  if (!expected_cached.is_null()) {
    for (const auto& raw_index : Core::iter(expected_cached)) {
      int index = static_cast<int>(std::stoul(display(raw_index)));
      if (index >= static_cast<int>(client.requests.size())) throw AxError("fixture", "missing cached request index " + std::to_string(index));
      bool has_cache = false;
      for (const auto& raw_message : Core::iter(Core::get(client.requests[static_cast<size_t>(index)], "chat_prompt", Value::array()))) {
        if (Core::truthy(Core::get(raw_message, "cache", false))) {
          has_cache = true;
          break;
        }
      }
      if (!has_cache) throw AxError("fixture", "agent request did not contain a cached prompt message");
    }
  }
  if (!Core::get(fixture, "expected_chat_log_subset").is_null()) assert_list_subset(ag->get_chat_log(), Core::get(fixture, "expected_chat_log_subset"), "agent chat log");
  if (!Core::get(fixture, "expected_state").is_null()) assert_subset(ag->get_state(), Core::get(fixture, "expected_state"), "agent state");
  Value exported = ag->export_runtime_state();
  if (!Core::get(fixture, "expected_runtime_contract_subset").is_null()) assert_subset(ag->get_runtime_contract(), Core::get(fixture, "expected_runtime_contract_subset"), "runtime contract");
  if (!Core::get(fixture, "expected_exported_state_subset").is_null()) assert_subset(exported, Core::get(fixture, "expected_exported_state_subset"), "runtime state");
  if (!Core::get(fixture, "expected_action_log_subset").is_null()) assert_list_subset(Core::get(exported, "action_log", Value::array()), Core::get(fixture, "expected_action_log_subset"), "action log");
  if (runtime && !Core::get(fixture, "expected_executed").is_null()) assert_equal(Value(runtime->executed), Core::get(fixture, "expected_executed"), "executed code");
  assert_agent_trace(*ag, fixture);
}

static void assert_agent_trace(AxAgent& ag, Value fixture) {
  Value trace = ag.export_trace();
  if (!Core::get(fixture, "expected_trace_subset").is_null()) assert_subset(trace, Core::get(fixture, "expected_trace_subset"), "agent trace");
  if (!Core::get(fixture, "expected_trace_event_kinds").is_null()) {
    Value kinds = Value::array();
    for (const auto& event : Core::iter(Core::get(trace, "events", Value::array()))) {
      Core::append(kinds, Core::get(event, "kind", ""));
    }
    assert_equal(kinds, Core::get(fixture, "expected_trace_event_kinds"), "agent trace event kinds");
  }
  if (Core::truthy(Core::get(fixture, "replay_trace", false))) {
    Value replay_fixtures = Core::get(fixture, "replay_fixtures", Value::object());
    if (!Core::get(fixture, "expected_trace_event_kinds").is_null() && Core::get(replay_fixtures, "expected_event_kinds").is_null()) {
      Core::set(replay_fixtures, "expected_event_kinds", Core::get(fixture, "expected_trace_event_kinds"));
    }
    if (!Core::get(fixture, "expected_output").is_null() && Core::get(replay_fixtures, "expected_output").is_null()) {
      Core::set(replay_fixtures, "expected_output", Core::get(fixture, "expected_output"));
    }
    Value replayed = ag.replay_trace(trace, replay_fixtures);
    if (!Core::get(fixture, "expected_replay_result_subset").is_null()) assert_subset(replayed, Core::get(fixture, "expected_replay_result_subset"), "agent replay");
    else assert_subset(replayed, object({{"ok", true}, {"status", "replayed"}}), "agent replay");
  }
}

static void run_agent_runtime_policy(Value fixture) {
  std::unique_ptr<AxAgent> ag;
  try {
    ag = std::make_unique<AxAgent>(Core::get(fixture, "signature", "question:string -> answer:string"), Core::get(fixture, "options", Value::object()));
    if (!Core::get(fixture, "discover").is_null()) {
      Value result = ag->discover(Core::get(fixture, "discover", Value::object()));
      if (!Core::get(fixture, "expected_discover_result").is_null()) assert_equal(result, Core::get(fixture, "expected_discover_result"), "discover result");
    }
    if (!Core::get(fixture, "recall").is_null()) {
      Value result = ag->recall(Core::get(fixture, "recall", Value::array()));
      if (!Core::get(fixture, "expected_recall_result").is_null()) assert_equal(result, Core::get(fixture, "expected_recall_result"), "recall result");
    }
    if (!Core::get(fixture, "used").is_null()) {
      Value used = Core::get(fixture, "used");
      Value result = ag->used(Core::get(used, "id"), Core::get(used, "reason", ""), Core::get(used, "stage", "executor"));
      if (!Core::get(fixture, "expected_used_result").is_null()) assert_equal(result, Core::get(fixture, "expected_used_result"), "used result");
    }
    if (!Core::get(fixture, "invoke_callable").is_null()) {
      Value call = Core::get(fixture, "invoke_callable");
      Value result = ag->invoke_callable(Core::get(call, "qualified_name", Core::get(call, "name", "")), Core::get(call, "args", Value::object()));
      if (!Core::get(fixture, "expected_callable_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_callable_result_subset"), "callable result");
    }
    if (!Core::get(fixture, "replay_trace_input").is_null()) {
      Value result = ag->replay_trace(Core::get(fixture, "replay_trace_input", Value::object()), Core::get(fixture, "replay_fixtures", Value::object()));
      if (!Core::get(fixture, "expected_replay_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_replay_result_subset"), "agent replay");
    }
    if (!Core::get(fixture, "restore_runtime_state").is_null()) ag->restore_runtime_state(Core::get(fixture, "restore_runtime_state"));
    if (!Core::get(fixture, "context_operation").is_null()) {
      Value context_state = ag->export_runtime_state();
      Value result = Core::_agent_context_fixture_result(context_state, fixture);
      if (!Core::get(fixture, "expected_context_result").is_null()) assert_equal(result, Core::get(fixture, "expected_context_result"), "agent context result");
      if (!Core::get(fixture, "expected_context_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_context_result_subset"), "agent context result");
      if (!Core::get(fixture, "expected_context_events_subset").is_null()) {
        Value exported_context = Core::get(result, "exported", Value::object());
        assert_list_subset(Core::get(exported_context, "context_events", Value::array()), Core::get(fixture, "expected_context_events_subset"), "agent context events");
      }
    }
    if (!Core::get(fixture, "final_payload").is_null()) assert_equal(Core::_normalize_agent_final_payload(Core::get(fixture, "final_payload")), Core::get(fixture, "expected_final_payload"), "final payload");
    if (!Core::get(fixture, "clarification_payload").is_null()) assert_equal(Core::_normalize_agent_clarification_payload(Core::get(fixture, "clarification_payload")), Core::get(fixture, "expected_clarification_payload"), "clarification payload");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + error.what());
    return;
  }
  if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected agent runtime policy fixture to fail");
  if (!Core::get(fixture, "expected_runtime_contract_subset").is_null()) assert_subset(ag->get_runtime_contract(), Core::get(fixture, "expected_runtime_contract_subset"), "runtime contract");
  if (!Core::get(fixture, "expected_policy_subset").is_null()) assert_subset(ag->get_policy(), Core::get(fixture, "expected_policy_subset"), "agent policy");
  if (!Core::get(fixture, "expected_policy_registry_subset").is_null()) assert_subset(ag->get_policy_registry(), Core::get(fixture, "expected_policy_registry_subset"), "policy registry");
  Value registry = ag->get_policy_registry();
  if (!Core::get(fixture, "expected_actor_primitives_subset").is_null()) assert_list_subset(Core::get(registry, "actor_primitives", Value::array()), Core::get(fixture, "expected_actor_primitives_subset"), "actor primitives");
  if (!Core::get(fixture, "expected_protocol_actions_subset").is_null()) assert_list_subset(Core::get(registry, "protocol_actions", Value::array()), Core::get(fixture, "expected_protocol_actions_subset"), "protocol actions");
  if (!Core::get(fixture, "expected_runtime_globals_subset").is_null()) assert_list_subset(Core::get(registry, "runtime_globals", Value::array()), Core::get(fixture, "expected_runtime_globals_subset"), "runtime globals");
  if (!Core::get(fixture, "expected_host_boundaries_subset").is_null()) assert_list_subset(Core::get(registry, "host_boundaries", Value::array()), Core::get(fixture, "expected_host_boundaries_subset"), "host boundaries");
  if (!Core::get(fixture, "expected_callable_inventory_subset").is_null()) assert_list_subset(ag->get_callable_inventory(), Core::get(fixture, "expected_callable_inventory_subset"), "callable inventory");
  if (!Core::get(fixture, "expected_discovery_catalog_subset").is_null()) assert_list_subset(ag->get_discovery_catalog(), Core::get(fixture, "expected_discovery_catalog_subset"), "discovery catalog");
  Value exported = ag->export_runtime_state();
  if (!Core::get(fixture, "expected_discovered_tool_docs_subset").is_null()) assert_list_subset(Core::get(exported, "discovered_tool_docs", Value::array()), Core::get(fixture, "expected_discovered_tool_docs_subset"), "discovered tools");
  if (!Core::get(fixture, "expected_loaded_skill_docs_subset").is_null()) assert_list_subset(Core::get(exported, "loaded_skill_docs", Value::array()), Core::get(fixture, "expected_loaded_skill_docs_subset"), "loaded skills");
  if (!Core::get(fixture, "expected_loaded_memories_subset").is_null()) assert_list_subset(Core::get(exported, "loaded_memories", Value::array()), Core::get(fixture, "expected_loaded_memories_subset"), "loaded memories");
  if (!Core::get(fixture, "expected_used_memories_subset").is_null()) assert_list_subset(Core::get(exported, "used_memories", Value::array()), Core::get(fixture, "expected_used_memories_subset"), "used memories");
  if (!Core::get(fixture, "expected_used_skills_subset").is_null()) assert_list_subset(Core::get(exported, "used_skills", Value::array()), Core::get(fixture, "expected_used_skills_subset"), "used skills");
  if (!Core::get(fixture, "expected_guidance_log_subset").is_null()) assert_list_subset(Core::get(exported, "guidance_log", Value::array()), Core::get(fixture, "expected_guidance_log_subset"), "guidance log");
  if (!Core::get(fixture, "expected_function_call_traces_subset").is_null()) assert_list_subset(Core::get(exported, "function_call_traces", Value::array()), Core::get(fixture, "expected_function_call_traces_subset"), "function call traces");
  if (!Core::get(fixture, "expected_policy_trace_subset").is_null()) assert_list_subset(Core::get(exported, "policy_trace", Value::array()), Core::get(fixture, "expected_policy_trace_subset"), "policy trace");
  if (!Core::get(fixture, "expected_exported_state_subset").is_null()) assert_subset(exported, Core::get(fixture, "expected_exported_state_subset"), "exported runtime state");
  if (!Core::get(fixture, "expected_optimizer_metadata_subset").is_null()) assert_subset(ag->get_optimizer_metadata(), Core::get(fixture, "expected_optimizer_metadata_subset"), "optimizer metadata");
  assert_agent_trace(*ag, fixture);
}

static void run_agent_runtime_session(Value fixture) {
  AxAgent ag(Core::get(fixture, "signature", "question:string -> answer:string"), Core::get(fixture, "options", Value::object()));
  FakeCodeRuntime runtime(Core::get(fixture, "runtime_script", Value::array()), "JavaScript", "", Core::get(fixture, "runtime_capabilities", Value::object()));
  Value result;
  bool caught_expected_error = false;
  try {
    std::string operation = display(Core::get(fixture, "operation", "test"));
    if (operation == "test") {
      result = ag.test(runtime, Core::get(fixture, "code", ""), Core::get(fixture, "context_values", Core::get(fixture, "input", Value::object())), Core::get(fixture, "runtime_options", Value::object()));
    } else if (operation == "steps") {
      for (const auto& raw_step : as_array(Core::get(fixture, "steps", Value::array()))) {
        Value step = raw_step;
        if (!Core::get(step, "restore_session_state").is_null()) ag.restore_session_state(Core::get(step, "restore_session_state"));
        result = ag.execute_actor_step(runtime, Core::get(step, "code", ""), Core::get(step, "values", Core::get(fixture, "context_values", Core::get(fixture, "input", Value::object()))), Core::get(step, "options", Value::object()));
        if (Core::truthy(Core::get(step, "inspect", false))) ag.inspect_runtime();
        if (Core::truthy(Core::get(step, "export_session_state", false))) ag.export_session_state();
      }
      if (Core::truthy(Core::get(fixture, "close_runtime_session", false))) ag.close_runtime_session();
    } else if (operation == "reserved") {
      result = ag.test(runtime, Core::get(fixture, "code", ""), Core::get(fixture, "context_values", Value::object()), Value::object());
    } else {
      throw AxError("fixture", "unknown agent runtime session operation " + operation);
    }
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + error.what());
    caught_expected_error = true;
  }
  if (!Core::get(fixture, "expected_error_contains").is_null() && !caught_expected_error) throw AxError("fixture", "expected agent runtime session fixture to fail");
  if (!Core::get(fixture, "expected_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_result_subset"), "runtime result");
  if (!Core::get(fixture, "expected_result").is_null()) assert_equal(result, Core::get(fixture, "expected_result"), "runtime result");
  Value exported = ag.export_runtime_state();
  if (!Core::get(fixture, "expected_exported_state_subset").is_null()) assert_subset(exported, Core::get(fixture, "expected_exported_state_subset"), "runtime state");
  if (!Core::get(fixture, "expected_action_log_subset").is_null()) assert_list_subset(Core::get(exported, "action_log", Value::array()), Core::get(fixture, "expected_action_log_subset"), "action log");
  if (!Core::get(fixture, "expected_status_log_subset").is_null()) assert_list_subset(Core::get(exported, "status_log", Value::array()), Core::get(fixture, "expected_status_log_subset"), "status log");
  if (!Core::get(fixture, "expected_session_count").is_null() && runtime.sessions.size() != static_cast<size_t>(std::stoi(display(Core::get(fixture, "expected_session_count"))))) {
    throw AxError("fixture", "expected session count mismatch");
  }
  if (!Core::get(fixture, "expected_closed_session_count").is_null()) {
    size_t closed_count = 0;
    for (const auto& session : runtime.sessions) if (session->closed) closed_count++;
    if (closed_count != static_cast<size_t>(std::stoi(display(Core::get(fixture, "expected_closed_session_count"))))) {
      throw AxError("fixture", "expected closed session count mismatch");
    }
  }
  if (!Core::get(fixture, "expected_executed").is_null()) assert_equal(Value(runtime.executed), Core::get(fixture, "expected_executed"), "executed code");
  if (!Core::get(fixture, "expected_create_globals_subset").is_null()) {
    if (runtime.create_requests.empty()) throw AxError("fixture", "expected at least one runtime create_session request");
    assert_subset(Core::get(runtime.create_requests.back(), "globals", Value::object()), Core::get(fixture, "expected_create_globals_subset"), "runtime create globals");
  }
  if (!Core::get(fixture, "expected_create_options_subset").is_null()) {
    if (runtime.create_requests.empty()) throw AxError("fixture", "expected at least one runtime create_session request");
    assert_subset(Core::get(runtime.create_requests.back(), "options", Value::object()), Core::get(fixture, "expected_create_options_subset"), "runtime create options");
  }
  if (!Core::get(fixture, "expected_execute_options_subset").is_null()) {
    if (runtime.execute_options.empty()) throw AxError("fixture", "expected at least one runtime execute request");
    assert_subset(runtime.execute_options.back(), Core::get(fixture, "expected_execute_options_subset"), "runtime execute options");
  }
  if (!Core::get(fixture, "expected_runtime_inspection").is_null()) assert_equal(Core::get(exported, "runtime_inspection", Value()), Core::get(fixture, "expected_runtime_inspection"), "runtime inspection");
  if (!Core::get(fixture, "expected_runtime_inspection_contains").is_null()) {
    std::string actual_inspection = display(Core::get(exported, "runtime_inspection", Value()));
    std::string expected_fragment = display(Core::get(fixture, "expected_runtime_inspection_contains"));
    if (actual_inspection.find(expected_fragment) == std::string::npos) throw AxError("fixture", "runtime inspection expected fragment missing");
  }
  if (!Core::get(fixture, "expected_absent_runtime_session_globals").is_null()) {
    Value globals = Core::get(Core::get(exported, "runtime_session_state", Value::object()), "globals", Value::object());
    for (const auto& key : as_array(Core::get(fixture, "expected_absent_runtime_session_globals", Value::array()))) {
      if (!Core::get(globals, display(key), Value()).is_null()) throw AxError("fixture", "runtime session globals unexpectedly contained " + display(key));
    }
  }
  assert_agent_trace(ag, fixture);
}

static Value runtime_adapter_call(Value spec) {
  std::string name = display(Core::get(spec, "name", ""));
  Value args = Core::get(spec, "args", Value::array());
  Value kwargs = Core::get(spec, "kwargs", Value::object());
  if (name == "result") return RuntimeEnvelope::result(Core::get(args, 0));
  if (name == "error") return RuntimeEnvelope::error(Core::get(args, 0, ""), Core::get(args, 1, Core::get(kwargs, "category", "runtime")));
  if (name == "session_closed") return RuntimeEnvelope::session_closed(Core::get(args, 0, "session closed"));
  if (name == "timeout") return RuntimeEnvelope::timeout(Core::get(args, 0, "execution timed out"));
  if (name == "final") return RuntimeEnvelope::final_payload(args);
  if (name == "ask_clarification") return RuntimeEnvelope::ask_clarification(args);
  if (name == "discover") return RuntimeEnvelope::discover(Core::get(args, 0, Value::object()));
  if (name == "recall") return RuntimeEnvelope::recall(Core::get(args, 0, Value::array()));
  if (name == "used") return RuntimeEnvelope::used(Core::get(args, 0, Value::object()), Core::get(kwargs, "reason"), Core::get(kwargs, "stage"));
  if (name == "status") return RuntimeEnvelope::status(Core::get(args, 0, "success"), Core::get(args, 1, ""));
  if (name == "guide_agent") return RuntimeEnvelope::guide_agent(Core::get(args, 0, ""), Core::get(args, 1));
  throw AxError("fixture", "unknown runtime adapter helper " + name);
}

static void run_agent_runtime_adapter(Value fixture) {
  if (!Core::get(fixture, "capabilities").is_null()) {
    Value raw = Core::get(fixture, "capabilities", Value::object());
    RuntimeCapabilities capabilities;
    capabilities.inspect = Core::truthy(Core::get(raw, "inspect", true));
    capabilities.snapshot = Core::truthy(Core::get(raw, "snapshot", true));
    capabilities.patch = Core::truthy(Core::get(raw, "patch", true));
    capabilities.abort = Core::truthy(Core::get(raw, "abort", false));
    capabilities.language = display(Core::get(raw, "language", "JavaScript"));
    capabilities.usage_instructions = display(Core::get(raw, "usage_instructions", ""));
    if (!Core::get(fixture, "expected_capabilities").is_null()) assert_subset(capabilities.to_value(), Core::get(fixture, "expected_capabilities"), "runtime capabilities");
  }
  for (const auto& raw_spec : Core::iter(Core::get(fixture, "helper_calls", Value::array()))) {
    Value spec = raw_spec;
    Value actual = runtime_adapter_call(spec);
    if (!Core::get(spec, "expected").is_null()) assert_equal(actual, Core::get(spec, "expected"), "runtime helper");
    if (!Core::get(spec, "expected_subset").is_null()) assert_subset(actual, Core::get(spec, "expected_subset"), "runtime helper");
    if (Core::truthy(Core::get(spec, "normalize", false))) {
      Value normalized = Core::_normalize_agent_runtime_step_result(actual, Core::get(spec, "code", "<adapter>"));
      if (!Core::get(spec, "expected_normalized_subset").is_null()) assert_subset(normalized, Core::get(spec, "expected_normalized_subset"), "normalized runtime helper");
    }
  }
  if (!Core::get(fixture, "run_session").is_null()) {
    Value session_fixture = Value::object();
    Core::set(session_fixture, "signature", Core::get(fixture, "signature", "question:string -> answer:string"));
    Core::set(session_fixture, "operation", "test");
    Core::set(session_fixture, "code", "adapter()");
    Core::set(session_fixture, "context_values", Core::get(fixture, "context_values", object({{"question", "adapter"}})));
    Core::set(session_fixture, "runtime_script", array({object({{"expected_code", "adapter()"}, {"result", runtime_adapter_call(Core::get(fixture, "run_session"))}})}));
    if (!Core::get(fixture, "expected_result_subset").is_null()) Core::set(session_fixture, "expected_result_subset", Core::get(fixture, "expected_result_subset"));
    if (!Core::get(fixture, "expected_action_log_subset").is_null()) Core::set(session_fixture, "expected_action_log_subset", Core::get(fixture, "expected_action_log_subset"));
    if (!Core::get(fixture, "expected_trace_event_kinds").is_null()) Core::set(session_fixture, "expected_trace_event_kinds", Core::get(fixture, "expected_trace_event_kinds"));
    if (!Core::get(fixture, "expected_closed_session_count").is_null()) Core::set(session_fixture, "expected_closed_session_count", Core::get(fixture, "expected_closed_session_count"));
    run_agent_runtime_session(session_fixture);
  }
}

struct ProtocolFixtureTransport : RuntimeTransport {
  std::string mode;
  int next_session = 0;
  Object sessions;

  explicit ProtocolFixtureTransport(Value fixture_mode) : mode(display(fixture_mode.is_null() ? Value("normal") : fixture_mode)) {}

  Value fail(Value id, const std::string& category, const std::string& message) {
    return object({{"id", std::move(id)}, {"ok", false}, {"error", object({{"category", category}, {"message", message}})}});
  }

  Value ok(Value id, Value result, Value session_id = Value()) {
    Value out = object({{"id", std::move(id)}, {"ok", true}, {"result", std::move(result)}});
    if (!session_id.is_null()) Core::set(out, "session_id", std::move(session_id));
    return out;
  }

  Value snapshot(Value session) {
    Value bindings = Core::get(session, "globals", Value::object());
    Value entry_list = Value::array();
    for (const auto& key : Core::iter(Core::map_keys(bindings))) {
      Core::append(entry_list, object({{"name", key}, {"type", "json"}, {"preview", display(Core::get(bindings, key))}}));
    }
    return object({{"version", 1}, {"entries", entry_list}, {"bindings", bindings}, {"globals", bindings}, {"closed", Core::get(session, "closed", false)}});
  }

  Value call(Value message) override {
    if (mode == "eof") throw AxError("runtime", "runtime protocol process closed without a response (exit code 0)");
    if (mode == "nonzero") throw AxError("runtime", "runtime protocol process closed without a response (exit code 7): fixture stderr before nonzero exit");
    if (mode == "malformed_json") return Value("not an object");
    Value id = mode == "id_mismatch" ? Value("mismatch") : Core::get(message, "id");
    std::string op = display(Core::get(message, "op"));
    if (op == "capabilities") {
      return ok(id, object({
        {"language", "JavaScript"},
        {"usage_instructions", "fixture protocol runtime"},
        {"inspect", mode != "unavailable"},
        {"snapshot", mode != "unavailable"},
        {"patch", mode != "unavailable"},
        {"abort", true}
      }));
    }
    if (op == "create_session") {
      std::string session_id = "s" + std::to_string(++next_session);
      Value payload = Core::get(message, "payload", Value::object());
      Value globals = Core::get(payload, "globals", Value::object());
      Core::set(globals, "__create_options", Core::get(payload, "options", Value::object()));
      sessions[session_id] = object({{"globals", globals}, {"closed", false}});
      return ok(id, object({{"session_id", session_id}}), session_id);
    }
    if (op == "execute") {
      std::string session_id = display(Core::get(message, "session_id"));
      Value session = sessions.count(session_id) ? sessions[session_id] : Value();
      if (session.is_null() || Core::truthy(Core::get(session, "closed", false))) return fail(Core::get(message, "id"), "session_closed", "session closed or unknown");
      Value payload = Core::get(message, "payload", Value::object());
      Value globals = Core::get(session, "globals", Value::object());
      Core::set(globals, "__last_execute_options", Core::get(payload, "options", Value::object()));
      Core::set(session, "globals", globals);
      sessions[session_id] = session;
      std::string code = display(Core::get(payload, "code", ""));
      if (code == "timeout()") return fail(Core::get(message, "id"), "timeout", "fixture timeout");
      if (code == "sessionClosed()") return fail(Core::get(message, "id"), "session_closed", "fixture session closed");
      if (code == "abort()") return fail(Core::get(message, "id"), "abort", "fixture abort");
      if (code == "userError()") return fail(Core::get(message, "id"), "user_error", "fixture user error");
      Core::set(globals, "answer", "fixture");
      Core::set(session, "globals", globals);
      sessions[session_id] = session;
      Value response = ok(id, object({{"type", "final"}, {"args", array({object({{"answer", "fixture"}})})}}), session_id);
      if (mode == "session_mismatch") Core::set(response, "session_id", "wrong-session");
      return response;
    }
    if (op == "inspect_globals") {
      if (mode == "unavailable") return fail(Core::get(message, "id"), "unavailable", "inspectGlobals unavailable");
      Value session_id = Core::get(message, "session_id");
      Value session = sessions.count(display(session_id)) ? sessions[display(session_id)] : Value::object();
      return ok(id, Core::get(session, "globals", Value::object()), session_id);
    }
    if (op == "snapshot_globals") {
      if (mode == "unavailable") return fail(Core::get(message, "id"), "unavailable", "snapshotGlobals unavailable");
      Value session_id = Core::get(message, "session_id");
      Value session = sessions.count(display(session_id)) ? sessions[display(session_id)] : Value::object();
      return ok(id, snapshot(session), session_id);
    }
    if (op == "patch_globals") {
      if (mode == "unavailable") return fail(Core::get(message, "id"), "unavailable", "patchGlobals unavailable");
      std::string session_id = display(Core::get(message, "session_id"));
      Value session = sessions.count(session_id) ? sessions[session_id] : Value::object();
      Value raw = Core::get(Core::get(message, "payload", Value::object()), "globals", Value::object());
      Value bindings = Core::get(raw, "bindings", raw);
      Core::set(session, "globals", bindings);
      sessions[session_id] = session;
      return ok(id, snapshot(session), Value(session_id));
    }
    if (op == "close") {
      std::string session_id = display(Core::get(message, "session_id"));
      Value session = sessions.count(session_id) ? sessions[session_id] : Value::object();
      Core::set(session, "closed", true);
      sessions[session_id] = session;
      return ok(id, object({{"closed", true}}), Value(session_id));
    }
    if (op == "shutdown") return ok(id, object({{"shutdown", true}}));
    return fail(Core::get(message, "id"), "protocol", "unknown runtime protocol op: " + op);
  }
};

static void run_agent_runtime_protocol(Value fixture) {
  ProtocolFixtureTransport transport(Core::get(fixture, "mode", "normal"));
  RuntimeProtocolClient runtime(transport);
  AxCodeSession* session = nullptr;
  try {
    std::string operation = display(Core::get(fixture, "operation", "roundtrip"));
    if (operation == "roundtrip") {
      Value capabilities = Core::get(runtime.request("capabilities", Value(), Value::object(), true), "result");
      if (!Core::get(fixture, "expected_capabilities_subset").is_null()) assert_subset(capabilities, Core::get(fixture, "expected_capabilities_subset"), "protocol capabilities");
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      Value result = session->execute(Core::get(fixture, "execute_code", "final()"), Core::get(fixture, "execute_options", Value::object()));
      if (!Core::get(fixture, "expected_execute_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_execute_subset"), "protocol execute");
      Value inspected = session->inspect(Value::object());
      if (!Core::get(fixture, "expected_inspect_subset").is_null()) assert_subset(inspected, Core::get(fixture, "expected_inspect_subset"), "protocol inspect");
      Value snapshot = session->snapshot_globals(Value::object());
      if (!Core::get(fixture, "expected_snapshot_subset").is_null()) assert_subset(snapshot, Core::get(fixture, "expected_snapshot_subset"), "protocol snapshot");
      Value patched = session->patch_globals(Core::get(fixture, "patch_globals", Value::object()), Value::object());
      if (!Core::get(fixture, "expected_patch_subset").is_null()) assert_subset(patched, Core::get(fixture, "expected_patch_subset"), "protocol patch");
      Value closed = session->close();
      if (!Core::get(fixture, "expected_close_subset").is_null()) assert_subset(closed, Core::get(fixture, "expected_close_subset"), "protocol close");
      return;
    }
    if (operation == "execute_error") {
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      Value result = session->execute(Core::get(fixture, "execute_code", "timeout()"), Core::get(fixture, "execute_options", Value::object()));
      if (!Core::get(fixture, "expected_execute_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_execute_subset"), "protocol execute error");
      return;
    }
    if (operation == "unknown_op") {
      runtime.request("unknown_op", Value(), Value::object(), true);
      throw AxError("fixture", "expected unknown protocol op to fail");
    }
    if (operation == "capabilities_error") {
      runtime.request("capabilities", Value(), Value::object(), true);
      throw AxError("fixture", "expected protocol capabilities request to fail");
    }
    if (operation == "unavailable") {
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      std::string method = display(Core::get(fixture, "method", "inspect_globals"));
      if (method == "snapshot_globals") session->snapshot_globals(Value::object());
      else if (method == "patch_globals") session->patch_globals(Value::object(), Value::object());
      else session->inspect(Value::object());
      throw AxError("fixture", "expected unavailable protocol method to fail");
    }
    if (operation == "session_mismatch") {
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      runtime.request("execute", "s1", object({{"code", Core::get(fixture, "execute_code", "final()")}, {"options", Value::object()}}), true);
      throw AxError("fixture", "expected protocol session mismatch to fail");
    }
    throw AxError("fixture", "unknown runtime protocol operation " + operation);
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(error.what()).find(display(expected)) != std::string::npos) return;
    throw;
  }
}

struct ClientFixture {
  FakeTransport transport;
  std::unique_ptr<OpenAICompatibleClient> client;

  explicit ClientFixture(Value fixture)
      : transport(Core::get(fixture, "transport_responses", Core::get(fixture, "responses", Value::array()))),
        client(make_client(fixture, &transport)) {}

  static std::unique_ptr<OpenAICompatibleClient> make_client(Value fixture, FakeTransport* transport) {
    std::string provider = display(Core::provider_normalize_profile(Core::get(fixture, "provider", "openai-compatible")));
    if (provider == "google-gemini") return std::make_unique<GoogleGeminiClient>(options(fixture), transport);
    if (provider == "anthropic") return std::make_unique<AnthropicClient>(options(fixture), transport);
    if (provider == "openai-responses") return std::make_unique<OpenAIResponsesClient>(options(fixture), transport);
    if (provider == "azure-openai") return std::make_unique<AzureOpenAIClient>(options(fixture), transport);
    if (provider == "deepseek") return std::make_unique<DeepSeekClient>(options(fixture), transport);
    if (provider == "mistral") return std::make_unique<MistralClient>(options(fixture), transport);
    if (provider == "reka") return std::make_unique<RekaClient>(options(fixture), transport);
    if (provider == "cohere") return std::make_unique<CohereClient>(options(fixture), transport);
    if (provider == "grok") return std::make_unique<GrokClient>(options(fixture), transport);
    return std::make_unique<OpenAICompatibleClient>(options(fixture), transport);
  }

  static Value options(Value fixture) {
    Value out = Value::object();
    std::string provider = display(Core::provider_normalize_profile(Core::get(fixture, "provider", "openai-compatible")));
    bool responses_provider = provider == "openai-responses";
    bool gemini_provider = provider == "google-gemini";
    bool anthropic_provider = provider == "anthropic";
    bool azure_provider = provider == "azure-openai";
    bool deepseek_provider = provider == "deepseek";
    bool mistral_provider = provider == "mistral";
    bool reka_provider = provider == "reka";
    bool cohere_provider = provider == "cohere";
    bool grok_provider = provider == "grok";
    std::string default_model = anthropic_provider ? "claude-3-7-sonnet-latest" : gemini_provider ? "gemini-2.5-flash" : responses_provider ? "gpt-4o" : azure_provider ? "gpt-5-mini" : deepseek_provider ? "deepseek-v4-flash" : mistral_provider ? "mistral-small-latest" : reka_provider ? "reka-core" : cohere_provider ? "command-r-plus" : grok_provider ? "grok-4.3" : "gpt-4.1-mini";
    std::string default_embed_model = anthropic_provider || deepseek_provider || reka_provider || grok_provider ? "" : gemini_provider ? "gemini-embedding-2" : responses_provider ? "text-embedding-ada-002" : mistral_provider ? "mistral-embed" : cohere_provider ? "embed-english-v3.0" : "text-embedding-3-small";
    Core::set(out, "model", Core::get(fixture, "model", default_model));
    Core::set(out, "embed_model", Core::get(fixture, "embed_model", default_embed_model));
    Core::set(out, "api_key", "test-key");
    Core::set(out, "model_config", Core::get(fixture, "model_config", Value::object()));
    for (const std::string& key : {"base_url", "baseUrl", "resource_name", "resourceName", "deployment_name", "deploymentName", "api_version", "apiVersion", "version"}) {
      Value value = Core::get(fixture, key);
      if (!value.is_null()) Core::set(out, key, value);
    }
    return out;
  }
};

static void assert_transport(Value fixture, const FakeTransport& transport) {
  Value expected = Core::get(fixture, "expected_transport_request");
  if (expected.is_null()) return;
  if (transport.requests.empty()) throw AxError("fixture", "expected provider transport request but none were sent");
  assert_subset(transport.requests[0], expected, "provider request");
}

static void assert_ai_error(const AxError& error, Value fixture, const FakeTransport& transport) {
  Value expected = Core::get(fixture, "expected_error_contains");
  if (!expected.is_null() && std::string(error.what()).find(display(expected)) == std::string::npos) {
    throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
  Value expected_type = Core::get(fixture, "expected_error_type");
  if (!expected_type.is_null() && error.type != display(expected_type)) {
    throw AxError("fixture", "expected error type " + display(expected_type) + ", got " + error.type);
  }
  Value expected_status = Core::get(fixture, "expected_status");
  if (!expected_status.is_null() && error.status != static_cast<int>(std::stoul(display(expected_status)))) {
    throw AxError("fixture", "expected status " + display(expected_status) + ", got " + std::to_string(error.status));
  }
  assert_transport(fixture, transport);
}

static void run_ai_chat(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->chat(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai chat output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_embed(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->embed(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai embed output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_stream(Value fixture) {
  ClientFixture cf(fixture);
  Value out = Value::array();
  for (const auto& item : cf.client->stream(Core::get(fixture, "request", Value::object()))) Core::append(out, item);
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(out, expected, "ai stream output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_error(Value fixture) {
  ClientFixture cf(fixture);
  try {
    std::string method = display(Core::get(fixture, "method", "chat"));
    if (method == "stream") {
      for (const auto& ignored : cf.client->stream(Core::get(fixture, "request", Value::object()))) (void)ignored;
    } else if (method == "embed") {
      cf.client->embed(Core::get(fixture, "request", Value::object()));
    } else if (method == "transcribe") {
      cf.client->transcribe(Core::get(fixture, "request", Value::object()));
    } else if (method == "speak") {
      cf.client->speak(Core::get(fixture, "request", Value::object()));
    } else {
      cf.client->chat(Core::get(fixture, "request", Value::object()));
    }
  } catch (const AxError& error) {
    assert_ai_error(error, fixture, cf.transport);
    return;
  }
  throw AxError("fixture", "expected AxAI call to fail");
}

static void run_ai_unsupported(Value fixture) {
  ClientFixture cf(fixture);
  try {
    std::string method = display(Core::get(fixture, "method", "transcribe"));
    if (method == "speak") cf.client->speak(Core::get(fixture, "request", Value::object()));
    else cf.client->transcribe(Core::get(fixture, "request", Value::object()));
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(error.what()).find(display(expected)) == std::string::npos) {
      throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
    }
    return;
  }
  throw AxError("fixture", "expected unsupported capability error");
}

static void run_ai_provider_descriptor(Value fixture) {
  Value descriptor = Core::provider_descriptor(Core::get(fixture, "provider", "openai-compatible"));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(descriptor, expected, "provider descriptor");
}

static void run_ai_provider_registry(Value fixture) {
  Value registry = Core::provider_profile_registry();
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(registry, expected, "provider profile registry");
  Value aliases = Core::get(fixture, "alias_expectations", Value::object());
  for (const auto& kv : as_object(aliases)) {
    if (kv.first == "__order") continue;
    assert_equal(Core::provider_normalize_profile(kv.first), kv.second, "provider alias " + kv.first);
  }
}

static void run_ai_model_catalog_audit(Value fixture) {
  Value summary = Core::provider_model_catalog_summary();
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(summary, expected, "provider model catalog audit");
}

static void run_ai_model_catalog_runtime(Value fixture) {
  Value type = Core::get(fixture, "model_type");
  Value result = type.is_null() ? get_supported_ai_models(Value::object()) : get_supported_ai_models(object({{"type", type}}));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) {
    Value provider_names = Value::array();
    std::set<std::string> openai_types;
    int model_count = 0;
    Value openai_first;
    for (const auto& raw : as_array(result)) {
      Core::append(provider_names, Core::get(raw, "name"));
      Value models = Core::get(raw, "models", Value::array());
      model_count += static_cast<int>(as_array(models).size());
      if (display(Core::get(raw, "name")) == "openai") {
        if (!as_array(models).empty()) openai_first = Core::get(as_array(models).front(), "name");
        for (const auto& model : as_array(models)) openai_types.insert(display(Core::get(model, "type")));
      }
    }
    Value type_values = Value::array();
    for (const auto& item : openai_types) Core::append(type_values, item);
    Value actual = object({{"providerCount", static_cast<double>(as_array(result).size())}, {"providerNames", provider_names}, {"modelCount", model_count}, {"openaiFirstModel", openai_first}, {"openaiModelTypes", type_values}});
    assert_subset(actual, expected, "provider model catalog runtime");
  }
}

static std::vector<std::shared_ptr<RouterFixtureService>> router_services(Value fixture) {
  std::vector<std::shared_ptr<RouterFixtureService>> services;
  for (const auto& spec : as_array(Core::get(fixture, "services", Value::array()))) {
    services.push_back(std::make_shared<RouterFixtureService>(spec));
  }
  return services;
}

static void run_ai_multiservice_router(Value fixture) {
  auto services = router_services(fixture);
  MultiServiceRouter router;
  bool use_vector_constructor = true;
  for (const auto& raw : as_array(Core::get(fixture, "router_entries", Value::array()))) {
    if (display(Core::get(raw, "kind", "")) == "key") use_vector_constructor = false;
  }
  try {
    if (use_vector_constructor) {
      std::vector<std::shared_ptr<AxAIService>> base;
      for (const auto& raw : as_array(Core::get(fixture, "router_entries", Value::array()))) {
        int index = static_cast<int>(conf_number(Core::get(raw, "service_index", 0)));
        base.push_back(services.at(index));
      }
      router = MultiServiceRouter(base);
    } else {
      for (const auto& raw : as_array(Core::get(fixture, "router_entries", Value::array()))) {
        int index = static_cast<int>(conf_number(Core::get(raw, "service_index", 0)));
        router.set_service_entry(display(Core::get(raw, "key")), services.at(index), display(Core::get(raw, "description", "")), Core::truthy(Core::get(raw, "isInternal", Core::get(raw, "is_internal", false))));
      }
    }
    Value outputs = Value::object();
    for (const auto& raw : as_array(Core::get(fixture, "operations", Value::array()))) {
      std::string name = display(Core::get(raw, "name"));
      Value request = Core::get(raw, "request", Value::object());
      Value options = Core::get(raw, "options", Value::object());
      if (name == "chat") Core::set(outputs, name, router.chat(request, options));
      else if (name == "embed") Core::set(outputs, name, router.embed(request, options));
      else if (name == "transcribe") Core::set(outputs, name, router.transcribe(request, options));
      else if (name == "speak") Core::set(outputs, name, router.speak(request, options));
      else if (name == "set_options") router.set_options(options);
    }
    Value service_calls = Value::array();
    for (const auto& service : services) {
      Value calls = Value::array();
      for (const auto& call : service->requests) Core::append(calls, call);
      if (!as_array(calls).empty()) Core::append(service_calls, calls);
    }
    Value actual = object({{"outputs", outputs}, {"lastChat", router.get_last_used_chat_model()}, {"lastEmbed", router.get_last_used_embed_model()}, {"lastConfig", router.get_last_used_model_config()}, {"metrics", router.get_metrics()}, {"options", router.get_options()}, {"serviceCalls", service_calls}});
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected multi-service router to fail");
    Value expected = Core::get(fixture, "expected_output");
    if (!Core::get(expected, "modelList").is_null()) Core::set(actual, "modelList", router.get_model_list());
    if (!expected.is_null()) assert_subset(actual, expected, "multi-service router");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
}

static void run_ai_provider_router(Value fixture) {
  auto services = router_services(fixture);
  std::vector<std::shared_ptr<AxAIService>> providers;
  if (!services.empty()) providers.push_back(services.at(static_cast<int>(conf_number(Core::get(fixture, "primary_index", 0)))));
  for (const auto& index : as_array(Core::get(fixture, "alternative_indices", Value::array()))) providers.push_back(services.at(static_cast<int>(conf_number(index))));
  Value routing = Core::get(Core::get(fixture, "routing", object({{"capability", object({{"requireExactMatch", false}, {"allowDegradation", true}})}})), "capability", Value::object());
  ProviderRouter router(providers, routing, Core::get(fixture, "processing", Value::object()));
  Value request = Core::get(fixture, "request", Value::object());
  Value rec = router.get_routing_recommendation(request);
  Value recommendation = object({{"provider", Core::get(rec, "providerName")}, {"processingApplied", Core::get(rec, "processingApplied")}, {"degradations", Core::get(rec, "degradations")}, {"warnings", Core::get(rec, "warnings")}});
  Value actual = object({{"recommendation", recommendation}, {"validation", router.validate_request(request)}, {"stats", router.get_routing_stats()}});
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(actual, expected, "provider router");
}

static void run_ai_balancer(Value fixture) {
  auto services = router_services(fixture);
  std::vector<std::shared_ptr<AxAIService>> base;
  for (const auto& service : services) base.push_back(service);
  try {
    AxBalancer balancer(base, Core::get(fixture, "options", Value::object()));
    Value outputs = Value::object();
    for (const auto& raw : Core::iter(Core::get(fixture, "operations", Value::array()))) {
      std::string name = display(Core::get(raw, "name"));
      Value request = Core::get(raw, "request", Value::object());
      Value options = Core::get(raw, "options", Value::object());
      if (name == "chat") Core::set(outputs, name, balancer.chat(request, options));
      else if (name == "embed") Core::set(outputs, name, balancer.embed(request, options));
      else if (name == "transcribe") Core::set(outputs, name, balancer.transcribe(request, options));
      else if (name == "speak") Core::set(outputs, name, balancer.speak(request, options));
      else if (name == "set_options") balancer.set_options(options);
    }
    Value service_calls = Value::array();
    for (const auto& service : services) {
      Value calls = Value::array();
      for (const auto& call : service->requests) Core::append(calls, call);
      if (!Core::iter(calls).empty()) Core::append(service_calls, calls);
    }
    Value actual = object({
        {"id", balancer.get_id()},
        {"name", balancer.get_name()},
        {"outputs", outputs},
        {"lastChat", balancer.get_last_used_chat_model()},
        {"lastEmbed", balancer.get_last_used_embed_model()},
        {"lastConfig", balancer.get_last_used_model_config()},
        {"metrics", balancer.get_metrics()},
        {"options", balancer.get_options()},
        {"serviceCalls", service_calls}
    });
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected balancer to fail");
    Value expected = Core::get(fixture, "expected_output");
    if (!Core::get(expected, "modelList").is_null()) Core::set(actual, "modelList", balancer.get_model_list());
    if (!Core::get(expected, "features").is_null()) Core::set(actual, "features", balancer.get_features());
    if (!expected.is_null()) assert_subset(actual, expected, "balancer");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
}

static void run_ai_transcribe(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->transcribe(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai transcribe output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_speak(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->speak(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai speak output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_realtime(Value fixture) {
  ClientFixture cf(fixture);
  Value out = Value::array();
  for (const auto& item : cf.client->realtime(Core::get(fixture, "events", Value::array()))) Core::append(out, item);
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(out, expected, "ai realtime output");
}

static Value flow_state_value(Value state, Value field, Value fallback = Value()) {
  if (field.is_null()) return fallback;
  Value cur = state;
  std::stringstream ss(display(field));
  std::string part;
  while (std::getline(ss, part, '.')) cur = Core::get(cur, part, fallback);
  return cur;
}

static Value flow_condition_from_spec(Value spec) {
  return flow_callback([spec](Value state) {
    std::string op = display(Core::get(spec, "op", Value("truthy")));
    if (op == "field") return flow_state_value(state, Core::get(spec, "field"), Core::get(spec, "default"));
    if (op == "lt") return Core::lt(flow_state_value(state, Core::get(spec, "field"), Value(0)), Core::get(spec, "value", Value(0)));
    if (op == "eq") return Core::eq(flow_state_value(state, Core::get(spec, "field")), Core::get(spec, "value"));
    if (op == "always") return Value(Core::truthy(Core::get(spec, "value", Value(true))));
    return Value(Core::truthy(flow_state_value(state, Core::get(spec, "field"))));
  });
}

static Value flow_mapper_from_spec(Value spec) {
  return flow_callback([spec](Value state) {
    Value out = Core::map_merge(Value::object(), state);
    std::string op = display(Core::get(spec, "op", Value("set")));
    if (op == "increment") {
      Value field = Core::get(spec, "field");
      Core::set(out, field, Core::add(flow_state_value(out, field, Value(0)), Core::get(spec, "by", Value(1))));
    } else if (op == "append") {
      Value field = Core::get(spec, "field");
      Value values = flow_state_value(out, field, Value::array());
      Core::append(values, Core::get(spec, "valueField").is_null() ? Core::get(spec, "value") : flow_state_value(out, Core::get(spec, "valueField")));
      Core::set(out, field, values);
    } else if (op == "copy") {
      Core::set(out, Core::get(spec, "to"), flow_state_value(out, Core::get(spec, "from")));
    } else {
      out = Core::map_update(out, Core::get(spec, "values", Value::object()));
    }
    return out;
  });
}

static Value build_flow_step(Value step, Value fixture, std::vector<std::unique_ptr<AxGen>>& programs, std::vector<std::unique_ptr<AxFlow>>& flows, std::vector<std::unique_ptr<AxAgent>>& agents) {
  std::string kind = display(Core::get(step, "kind", Value("execute")));
  std::string name = display(Core::get(step, "name"));
  Value options = Core::get(step, "options", Value::object());
  if (kind == "map") {
    Value mapper = Core::get(step, "mapper").is_null()
      ? flow_callback([output = Core::get(step, "output", Value::object())](Value) { return output; })
      : flow_mapper_from_spec(Core::get(step, "mapper"));
    return Core::_flow_step(Value("map"), Value(name), mapper, options);
  }
  if (kind == "branch") {
    Core::set(options, "predicate", flow_condition_from_spec(Core::get(step, "predicate", Core::get(options, "predicate", Value::object()))));
    Value branches = Value::array();
    for (const auto& raw_branch : Core::iter(Core::get(step, "branches", Core::get(options, "branches", Value::array())))) {
      Value branch_steps = Value::array();
      for (const auto& raw_child : Core::iter(Core::get(raw_branch, "steps", Value::array()))) {
        Core::append(branch_steps, build_flow_step(raw_child, fixture, programs, flows, agents));
      }
      Core::append(branches, object({{"when", Core::get(raw_branch, "when")}, {"steps", branch_steps}}));
    }
    Core::set(options, "branches", branches);
    return Core::_flow_step(Value("branch"), Value(name), Value(), options);
  }
  if (kind == "while" || kind == "feedback") {
    Core::set(options, "condition", flow_condition_from_spec(Core::get(step, "condition", Core::get(options, "condition", Value::object()))));
    Value body_steps = Value::array();
    for (const auto& raw_child : Core::iter(Core::get(step, "steps", Core::get(options, "steps", Value::array())))) {
      Core::append(body_steps, build_flow_step(raw_child, fixture, programs, flows, agents));
    }
    Core::set(options, "steps", body_steps);
    return Core::_flow_step(Value(kind), Value(name), Value(), options);
  }
  if (kind == "parallel" || kind == "parallelMerge") return Core::_flow_step(Value(kind), Value(name), Value(), options);
  Value step_options = Core::map_merge(Core::get(step, "forward_options", Value::object()), options);
  if (display(Core::get(step, "program", Value(""))) == "flow") {
    Value nested = object({
      {"flow_options", Core::get(step, "flow_options", object({{"id", Core::get(step, "program_id", Value("root." + name))}}))},
      {"steps", Core::get(step, "steps", Value::array())},
      {"returns", Core::get(step, "returns", Value::object())},
      {"signature", Core::get(step, "signature", Core::get(fixture, "signature", Value("question:string -> answer:string")))}
    });
    flows.push_back(std::make_unique<AxFlow>(build_flow(nested, programs, flows, agents)));
    return Core::_flow_step(Value(kind), Value(name), Core::agent_stage_ref(*flows.back()), step_options);
  }
  if (display(Core::get(step, "program", Value(""))) == "agent") {
    agents.push_back(std::make_unique<AxAgent>(
        Core::get(step, "signature", Core::get(fixture, "signature", Value("question:string -> answer:string"))),
        Core::get(step, "options", Value::object())));
    return Core::_flow_step(Value(kind), Value(name), Core::agent_stage_ref(*agents.back()), step_options);
  }
  Value signature = Core::get(step, "extended_signature", Core::get(step, "extendedSignature", Core::get(step, "signature", Core::get(fixture, "signature", Value("question:string -> answer:string")))));
  programs.push_back(std::make_unique<AxGen>(Core::parse_signature(signature), Core::get(step, "options", Value::object())));
  return Core::_flow_step(Value(kind), Value(name), Core::agent_stage_ref(*programs.back()), step_options);
}

static AxFlow build_flow(Value fixture, std::vector<std::unique_ptr<AxGen>>& programs, std::vector<std::unique_ptr<AxFlow>>& flows, std::vector<std::unique_ptr<AxAgent>>& agents) {
  Value flow_options = Core::get(fixture, "flow_options", object({{"id", Core::get(fixture, "program_id", Value("root.flow"))}}));
  AxFlow fl(flow_options);
  for (const auto& raw_step : Core::iter(Core::get(fixture, "steps", Value::array()))) {
    fl.add_raw_step(build_flow_step(raw_step, fixture, programs, flows, agents));
  }
  if (!Core::get(fixture, "returns").is_null()) fl.returns(Core::get(fixture, "returns", Value::object()));
  if (!Core::get(fixture, "demos").is_null()) fl.set_demos(Core::get(fixture, "demos", Value::object()));
  return fl;
}

static void run_program_contract(Value fixture) {
  std::vector<std::unique_ptr<AxGen>> programs;
  std::vector<std::unique_ptr<AxFlow>> flows;
  std::vector<std::unique_ptr<AxAgent>> agents;
  Value components;
  if (display(Core::get(fixture, "program", Value("axgen"))) == "flow") {
    AxFlow fl = build_flow(fixture, programs, flows, agents);
    components = fl.get_optimizable_components();
  } else {
    AxGen gen(Core::parse_signature(Core::get(fixture, "signature", Value("question:string -> answer:string"))), Core::get(fixture, "options", Value::object()));
    components = gen.get_optimizable_components();
  }
  if (!Core::get(fixture, "expected_component_ids").is_null()) {
    Value ids = Value::array();
    for (const auto& component : Core::iter(components)) Core::append(ids, Core::get(component, "id"));
    assert_equal(ids, Core::get(fixture, "expected_component_ids"), "program component ids");
  }
  if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "program components");
}

static void run_flow(Value fixture) {
  try {
    std::vector<std::unique_ptr<AxGen>> programs;
    std::vector<std::unique_ptr<AxFlow>> flows;
    std::vector<std::unique_ptr<AxAgent>> agents;
    AxFlow fl = build_flow(fixture, programs, flows, agents);
    if (display(Core::get(fixture, "operation", Value(""))) == "cache_key") {
      std::set<std::string> keys;
      size_t count = 0;
      for (const auto& item : Core::iter(Core::get(fixture, "cache_key_inputs", Value::array()))) {
        keys.insert(display(Core::_flow_cache_key(item)));
        count++;
      }
      if (Core::truthy(Core::get(fixture, "expected_cache_keys_equal", Value(false))) && keys.size() != 1) throw AxError("fixture", "expected equal flow cache keys");
      if (Core::truthy(Core::get(fixture, "expected_cache_keys_distinct", Value(false))) && keys.size() != count) throw AxError("fixture", "expected distinct flow cache keys");
      return;
    }
    if (!Core::get(fixture, "expected_plan").is_null()) assert_equal(fl.get_plan(), Core::get(fixture, "expected_plan"), "flow plan");
    if (!Core::get(fixture, "expected_plan_subset").is_null()) assert_list_subset(fl.get_plan(), Core::get(fixture, "expected_plan_subset"), "flow plan");
    if (display(Core::get(fixture, "operation", Value(""))) == "plan") return;
    FakeAIClient client(Core::get(fixture, "responses", Value::array()));
    Value forward_options = Core::get(fixture, "forward_options", Value::object());
    if (!Core::get(fixture, "cache_seed_value").is_null()) {
      Value cache_store = Core::get(forward_options, "cache_store", Value::object());
      Core::set(cache_store, Core::_flow_cache_key(Core::get(fixture, "input", Value::object())), Core::get(fixture, "cache_seed_value"));
      Core::set(forward_options, "cache_store", cache_store);
    }
    Value output = display(Core::get(fixture, "operation", Value(""))) == "streaming"
      ? fl.streaming_forward(client, Core::get(fixture, "input", Value::object()), forward_options)
      : fl.forward(client, Core::get(fixture, "input", Value::object()), forward_options);
    if (!Core::get(fixture, "expected_output").is_null()) assert_equal(output, Core::get(fixture, "expected_output"), "flow output");
    if (!Core::get(fixture, "expected_streaming_output").is_null()) assert_equal(output, Core::get(fixture, "expected_streaming_output"), "flow streaming output");
    Value expected_count = Core::get(fixture, "expected_request_count");
    if (!expected_count.is_null() && client.requests.size() != static_cast<size_t>(std::stoul(display(expected_count)))) throw AxError("fixture", "expected request count mismatch");
    if (!Core::get(fixture, "expected_request_contains").is_null()) {
      std::string text = stringify(Value(client.requests));
      for (const auto& item : Core::iter(Core::get(fixture, "expected_request_contains"))) {
        if (text.find(display(item)) == std::string::npos) throw AxError("fixture", "flow request missing " + display(item) + ": " + text);
      }
    }
    if (!Core::get(fixture, "expected_chat_log_subset").is_null()) assert_list_subset(fl.get_chat_log(), Core::get(fixture, "expected_chat_log_subset"), "flow chat log");
    if (!Core::get(fixture, "expected_trace_kinds").is_null()) {
      Value kinds = Value::array();
      for (const auto& event : Core::iter(fl.get_traces())) Core::append(kinds, Core::get(event, "kind"));
      assert_equal(kinds, Core::get(fixture, "expected_trace_kinds"), "flow trace kinds");
    }
    if (!Core::get(fixture, "expected_trace_subset").is_null()) assert_list_subset(fl.get_traces(), Core::get(fixture, "expected_trace_subset"), "flow traces");
    if (!Core::get(fixture, "expected_usage_subset").is_null()) assert_subset(fl.get_usage(), Core::get(fixture, "expected_usage_subset"), "flow usage");
    if (!Core::get(fixture, "expected_cache_store_subset").is_null()) assert_subset(Core::get(forward_options, "cache_store", Core::get(forward_options, "cacheStore", Value::object())), Core::get(fixture, "expected_cache_store_subset"), "flow cache store");
    if (!Core::get(fixture, "expected_cache_value_for_input").is_null()) assert_equal(Core::get(Core::get(forward_options, "cache_store", Core::get(forward_options, "cacheStore", Value::object())), Core::_flow_cache_key(Core::get(fixture, "input", Value::object()))), Core::get(fixture, "expected_cache_value_for_input"), "flow cache value");
    if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "flow components");
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected flow fixture to fail");
  } catch (const AxError& e) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(e.what()).find(display(expected)) != std::string::npos) return;
    throw;
  }
}

static void run(Value fixture) {
  std::string kind = display(Core::get(fixture, "kind", "forward"));
  if (kind == "signature_error") {
    expect_maybe_error([&] { return build_signature(fixture); }, fixture);
  } else if (kind == "signature") {
    assert_equal(signature_payload(build_signature(fixture)), Core::get(fixture, "expected_signature"), "signature");
  } else if (kind == "json_schema") {
    Value sig = build_signature(fixture);
    Value fields = display(Core::get(fixture, "target", "outputs")) == "inputs" ? Core::get(sig, "inputs") : Core::get(sig, "outputs");
    assert_equal(Core::to_json_schema(fields, Core::get(fixture, "schema_title", "Schema"), Core::get(fixture, "schema_options", Value::object())), Core::get(fixture, "expected_schema"), "json schema");
  } else if (kind == "validate_value") {
    Value field = field_from_spec(Core::get(fixture, "field", Value::object()));
    Core::set(field, "name", Core::get(fixture, "field_name", "value"));
    field = Core::record_new("Field", field);
    expect_maybe_error([&] { return Core::validate_value(field, Core::get(fixture, "value"), Value()); }, fixture);
  } else if (kind == "validate_output") {
    Value sig = build_signature(fixture);
    Value result = expect_maybe_error([&] { return Core::validate_output(Core::get(sig, "outputs"), Core::get(fixture, "values", Value::object())); }, fixture);
    if (Core::get(fixture, "expected_error_contains").is_null()) assert_equal(result, Core::get(fixture, "expected_values", Core::get(fixture, "values", Value::object())), "validated output");
  } else if (kind == "strip_internal") {
    Value sig = build_signature(fixture);
    assert_equal(Core::strip_internal(Core::get(sig, "outputs"), Core::get(fixture, "values", Value::object())), Core::get(fixture, "expected_output"), "strip internal");
  } else if (kind == "template") {
    assert_equal(Core::render_template_content(Core::get(fixture, "template"), Core::get(fixture, "vars", Value::object()), Core::get(fixture, "context", "fixture-template")), Core::get(fixture, "expected_output", ""), "template");
  } else if (kind == "template_error") {
    expect_maybe_error([&] {
      if (display(Core::get(fixture, "operation")) == "validate") {
        Value result = Core::validate_prompt_template_syntax(Core::get(fixture, "template"), Core::get(fixture, "context", "fixture-template"), Core::get(fixture, "required_variables", Value::array()));
        if (!result.is_bool() || !Core::truthy(result)) throw AxError("template", display(result));
        return result;
      }
      return Core::render_template_content(Core::get(fixture, "template"), Core::get(fixture, "vars", Value::object()), Core::get(fixture, "context", "fixture-template"));
    }, fixture);
  } else if (kind == "template_validate") {
    assert_equal(Core::validate_prompt_template_syntax(Core::get(fixture, "template"), Core::get(fixture, "context", "fixture-template"), Core::get(fixture, "required_variables", Value::array())), Core::get(fixture, "expected_result", true), "template validation");
  } else if (kind == "prompt") {
    Value sig = build_signature(fixture);
    Value options = Core::get(fixture, "options", Value::object());
    if (!Core::get(options, "customTemplate").is_null()) Core::set(options, "custom_template", Core::get(options, "customTemplate"));
    if (!Core::get(options, "structuredOutputFunctionName").is_null()) Core::set(options, "structured_output_function_name", Core::get(options, "structuredOutputFunctionName"));
    Value messages = Core::render_prompt(sig, Core::get(fixture, "input", Core::get(fixture, "values", Value::object())), Core::get(fixture, "tools", Value::array()), options);
    if (!Core::get(fixture, "expected_messages").is_null()) assert_equal(messages, Core::get(fixture, "expected_messages"), "messages");
  } else if (kind == "stream") {
    assert_equal(Core::fold_stream(Core::get(fixture, "stream_events", Value::array())), Core::get(fixture, "expected_folded", ""), "stream");
  } else if (kind == "forward") {
    run_forward(fixture);
  } else if (kind == "agent_forward") {
    run_agent_forward(fixture);
  } else if (kind == "agent_runtime_policy") {
    run_agent_runtime_policy(fixture);
  } else if (kind == "agent_runtime_session") {
    run_agent_runtime_session(fixture);
  } else if (kind == "agent_runtime_adapter") {
    run_agent_runtime_adapter(fixture);
  } else if (kind == "agent_runtime_protocol") {
    run_agent_runtime_protocol(fixture);
  } else if (kind == "program_contract") {
    run_program_contract(fixture);
  } else if (kind == "flow") {
    run_flow(fixture);
  } else if (kind == "optimize") {
    run_optimize(fixture);
  } else if (kind == "ai_chat") {
    run_ai_chat(fixture);
  } else if (kind == "ai_embed") {
    run_ai_embed(fixture);
  } else if (kind == "ai_stream") {
    run_ai_stream(fixture);
  } else if (kind == "ai_error") {
    run_ai_error(fixture);
  } else if (kind == "ai_unsupported") {
    run_ai_unsupported(fixture);
  } else if (kind == "ai_provider_descriptor") {
    run_ai_provider_descriptor(fixture);
  } else if (kind == "ai_provider_registry") {
    run_ai_provider_registry(fixture);
  } else if (kind == "ai_model_catalog_audit") {
    run_ai_model_catalog_audit(fixture);
  } else if (kind == "ai_model_catalog_runtime") {
    run_ai_model_catalog_runtime(fixture);
  } else if (kind == "ai_multiservice_router") {
    run_ai_multiservice_router(fixture);
  } else if (kind == "ai_provider_router") {
    run_ai_provider_router(fixture);
  } else if (kind == "ai_balancer") {
    run_ai_balancer(fixture);
  } else if (kind == "ai_transcribe") {
    run_ai_transcribe(fixture);
  } else if (kind == "ai_speak") {
    run_ai_speak(fixture);
  } else if (kind == "ai_realtime") {
    run_ai_realtime(fixture);
  } else {
    throw AxError("fixture", "unsupported C++ alpha fixture kind " + kind);
  }
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: axir-cpp-conformance <fixture-or-dir>...\n";
    return 2;
  }
  try {
    for (int i = 1; i < argc; ++i) {
      for (const auto& path : expand(argv[i])) {
        Value fixture = parse_json(read_file(path));
        run(fixture);
        std::cout << "ok " << display(Core::get(fixture, "name", path.filename().string())) << "\n";
      }
    }
  } catch (const std::exception& e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
  return 0;
}
`
