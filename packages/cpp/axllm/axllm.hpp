#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <thread>
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

namespace axllm {

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
class AxBootstrapFewShot;
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
  static Value agent_transcribe(Value client, Value request, Value options);
  static Value agent_callable_invoke(Value state, Value request, Value options);
  static Value stream_event_content_parts(Value event);
  static Value openai_normalize_chat_response(Value raw);
  static Value openai_normalize_stream_delta(Value raw, Value state);
  static Value openai_normalize_embed_response(Value raw);
  // BEGIN AXIR CORE EMITTED DECLARATIONS
  static Value parse_signature(Value signature);
  static Value validate_signature(Value signature);
  static Value _signature_parse_impl(Value signature);
  static Value _signature_parse_fields_impl(Value text, Value output);
  static Value _signature_parse_field_impl(Value raw, Value output);
  static Value _signature_validate_field_shape_impl(Value field, Value output, Value nested);
  static Value _signature_validate_impl(Value signature);
  static Value validate_fields(Value fields, Value values, Value context);
  static Value to_json_schema(Value fields, Value schema_title, Value options);
  static Value _schema_required_impl(Value field, Value options);
  static Value validate_output(Value fields, Value values);
  static Value validate_value(Value field, Value value, Value path);
  static Value _schema_flexible_json_as_string_impl(Value typ, Value options);
  static Value strip_internal(Value fields, Value values);
  static Value _validate_fields_impl(Value fields, Value values, Value context);
  static Value _schema_json_type_impl(Value type_name);
  static Value _validate_output_impl(Value fields, Value values);
  static Value _schema_enhance_description_impl(Value base, Value typ);
  static Value _validate_string_constraints_impl(Value value, Value field);
  static Value _validate_number_constraints_impl(Value value, Value field);
  static Value _schema_apply_constraints_impl(Value schema, Value typ);
  static Value _validate_value_impl(Value field, Value value, Value path);
  static Value _schema_nullable_optional_impl(Value schema, Value field, Value options);
  static Value _schema_object_from_fields_impl(Value fields_map, Value is_nested, Value options);
  static Value _schema_field_schema_impl(Value field, Value is_nested, Value options);
  static Value _strip_internal_fields_impl(Value fields, Value values);
  static Value _schema_to_json_schema_impl(Value fields, Value schema_title, Value options);
  static Value render_template_content(Value template_, Value vars, Value context);
  static Value collect_template_variable_names(Value source, Value context);
  static Value validate_prompt_template_syntax(Value source, Value context, Value required_variables);
  static Value _template_parse_impl(Value template_, Value context);
  static Value _template_render_tree_impl(Value nodes, Value vars, Value source, Value context);
  static Value _template_collect_vars_impl(Value nodes);
  static Value _template_validate_impl(Value source, Value context, Value required_variables);
  static Value render_prompt(Value signature, Value values, Value functions, Value options);
  static Value _prompt_structured_impl(Value signature, Value values, Value functions, Value options);
  static Value _prompt_user_content_impl(Value signature, Value values);
  static Value _prompt_messages_impl(Value system, Value user);
  static Value openai_build_chat_request(Value request);
  static Value merge_model_config(Value base, Value override, Value options);
  static Value validate_chat_request(Value request);
  static Value _openai_apply_model_config_impl(Value payload, Value model_config);
  static Value build_chat_request(Value service, Value request, Value options);
  static Value _openai_copy_config_key_impl(Value payload, Value model_config, Value source, Value target);
  static Value normalize_chat_response(Value raw);
  static Value normalize_stream_delta(Value raw, Value state);
  static Value _openai_message_impl(Value message);
  static Value build_embed_request(Value service, Value request, Value options);
  static Value normalize_embed_response(Value raw);
  static Value normalize_token_usage(Value usage);
  static Value _ai_model_usage_impl(Value ai_name, Value model, Value usage);
  static Value _openai_content_part_impl(Value part);
  static Value chat_response_to_completion(Value response);
  static Value _openai_tool_call_to_provider_impl(Value call);
  static Value _openai_tool_spec_impl(Value fn);
  static Value openai_build_embed_request(Value request);
  static Value openai_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value _openai_normalize_choice_impl(Value choice, Value raw);
  static Value _openai_normalize_tool_calls_impl(Value calls);
  static Value _openai_finish_reason_impl(Value value);
  static Value openai_normalize_embed_response(Value raw, Value ai_name, Value model);
  static Value openai_normalize_stream_delta(Value raw, Value state, Value ai_name, Value model);
  static Value _openai_stream_choice_impl(Value choice, Value index_ids);
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
  static Value _provider_realtime_audio_descriptor(Value profile);
  static Value provider_realtime_ws_url(Value profile, Value model, Value api_key);
  static Value provider_should_use_realtime(Value profile, Value model, Value request);
  static Value provider_build_realtime_audio_setup(Value profile, Value request);
  static Value provider_build_realtime_audio_input(Value profile, Value request);
  static Value _openai_realtime_compatible_build_setup(Value descriptor, Value request);
  static Value _openai_realtime_compatible_build_input(Value descriptor, Value request);
  static Value _gemini_live_bidi_build_setup(Value descriptor, Value request);
  static Value _gemini_live_bidi_build_input(Value descriptor, Value request);
  static Value _realtime_request_system_instruction_impl(Value request);
  static Value _realtime_request_user_messages_impl(Value request);
  static Value _openai_realtime_content_parts_impl(Value content);
  static Value provider_build_chat_request(Value profile, Value request);
  static Value _provider_apply_openai_compatible_profile_quirks(Value profile, Value payload, Value request);
  static Value _provider_apply_deepseek_chat_quirks(Value payload, Value model_config);
  static Value _provider_apply_mistral_chat_quirks(Value payload);
  static Value _provider_apply_grok_chat_quirks(Value payload, Value request, Value model_config);
  static Value provider_build_embed_request(Value profile, Value request);
  static Value provider_normalize_chat_response(Value profile, Value raw, Value ai_name, Value model);
  static Value provider_normalize_stream_delta(Value profile, Value raw, Value state, Value ai_name, Value model);
  static Value provider_classify_stream_error_status(Value profile, Value event);
  static Value is_retryable_status(Value status);
  static Value default_retry_config();
  static Value retry_opt_value(Value map, Value camel, Value snake, Value fallback);
  static Value resolve_stream_retry(Value options);
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
  static Value _grok_build_transcribe_request(Value request);
  static Value _grok_build_speak_request(Value request);
  static Value _gemini_build_transcribe_request(Value request);
  static Value _gemini_build_speak_request(Value request);
  static Value _gemini_normalize_transcribe_response(Value raw);
  static Value _gemini_normalize_speak_response(Value raw, Value request);
  static Value openai_responses_normalize_realtime_event(Value event, Value state, Value ai_name, Value model);
  static Value _gemini_live_bidi_normalize_realtime_event(Value event, Value state, Value ai_name, Value model);
  static Value _gemini_build_chat_request(Value request);
  static Value _gemini_apply_model_config_impl(Value payload, Value model_config);
  static Value _gemini_message_impl(Value message);
  static Value _gemini_content_parts_impl(Value content);
  static Value _gemini_content_part_impl(Value part);
  static Value _gemini_function_declaration_impl(Value fn);
  static Value _gemini_tool_config_impl(Value request);
  static Value _gemini_build_embed_request(Value request);
  static Value _gemini_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value _gemini_merge_response_part_impl(Value result, Value text_parts, Value function_calls, Value part);
  static Value _gemini_extract_citations_impl(Value candidate);
  static Value _gemini_usage_impl(Value usage);
  static Value _gemini_normalize_embed_response(Value raw, Value ai_name, Value model);
  static Value _anthropic_build_chat_request(Value request);
  static Value _anthropic_apply_model_config_impl(Value payload, Value model_config, Value model);
  static Value _anthropic_thinking_config_impl(Value model, Value level);
  static Value _anthropic_message_impl(Value message);
  static Value _anthropic_content_parts_impl(Value content);
  static Value _anthropic_content_part_impl(Value part);
  static Value _anthropic_tool_spec_impl(Value fn);
  static Value _anthropic_tool_choice_impl(Value request);
  static Value _anthropic_error_type_to_status(Value type);
  static Value _anthropic_map_error_event(Value error, Value raw);
  static Value _anthropic_normalize_chat_response(Value raw, Value ai_name, Value model);
  static Value _anthropic_merge_response_block_impl(Value text_parts, Value function_calls, Value thought_parts, Value thought_blocks, Value citations, Value block);
  static Value _anthropic_append_citations_impl(Value out, Value block);
  static Value _anthropic_finish_reason_impl(Value reason);
  static Value _anthropic_usage_impl(Value usage);
  static Value _anthropic_normalize_stream_delta(Value event, Value state, Value ai_name, Value model);
  static Value _build_gen_chat_request(Value gen, Value messages, Value options);
  static Value fold_stream(Value events);
  static Value _execute_tool_call(Value functions, Value call);
  static Value _stream_event_content_parts_impl(Value event);
  static Value _validate_optimization_component_value(Value component, Value value);
  static Value _forward_impl(Value gen, Value client, Value values, Value options);
  static Value _validate_optimization_component_map(Value components, Value component_map);
  static Value _validate_optimized_artifact_provenance(Value artifact, Value components);
  static Value _validate_optimized_artifact(Value artifact, Value components);
  static Value _set_examples(Value gen, Value examples);
  static Value _set_demos(Value gen, Value demos);
  static Value _render_examples(Value gen);
  static Value _render_demos(Value gen);
  static Value _serialize_optimized_artifact(Value artifact);
  static Value _apply_field_processors(Value gen, Value output);
  static Value _deserialize_optimized_artifact(Value text, Value components);
  static Value _run_assertions(Value gen, Value output);
  static Value _optimization_changed_components(Value components, Value component_map);
  static Value _append_assertion_retry_messages(Value messages, Value response, Value error);
  static Value _record_trace(Value gen, Value input, Value output, Value status);
  static Value _optimization_component_current_map(Value components);
  static Value _should_continue_steps(Value gen, Value calls);
  static Value _normalize_optimization_dataset(Value dataset);
  static Value _complete_with_retries_impl(Value client, Value request, Value retries);
  static Value _normalize_optimization_metric_scores(Value raw);
  static Value _parse_output_impl(Value content);
  static Value _scalarize_optimization_scores(Value scores, Value options);
  static Value _is_flexible_json_field(Value typ);
  static Value _optimization_action_name_matches(Value expected, Value call);
  static Value _parse_json_string_value(Value value);
  static Value _adjust_optimization_score_for_actions(Value score, Value task, Value prediction);
  static Value _parse_json_string_for_field(Value field, Value value);
  static Value _parse_json_string_fields(Value output_fields, Value values);
  static Value _parse_json_string_for_fields(Value fields_map, Value values);
  static Value _build_optimization_eval_row(Value task, Value prediction, Value scores, Value scalar, Value trace, Value error);
  static Value _tool_spec_impl(Value fn);
  static Value _build_optimization_eval_result(Value rows, Value candidate_map, Value phase);
  static Value _function_call_mode_impl(Value mode);
  static Value _response_function_calls_impl(Value response);
  static Value _filter_optimization_components(Value components, Value target);
  static Value _append_tool_call_messages_impl(Value messages, Value response, Value calls);
  static Value _completion_call_to_chat_impl(Value call);
  static Value _tool_result_message_impl(Value call, Value result);
  static Value _build_optimizer_request(Value program_kind, Value components, Value dataset, Value options, Value trace);
  static Value _tool_error_message_impl(Value call, Value error);
  static Value _append_validation_retry_messages_impl(Value messages, Value response, Value error);
  static Value _prepare_optimizer_run(Value program_kind, Value components, Value dataset, Value options, Value trace, Value evaluator_available);
  static Value _normalize_optimizer_engine_response(Value response, Value engine_name, Value engine_version, Value components);
  static Value _build_optimizer_evidence_batch(Value eval_result, Value components);
  static Value _ace_estimate_token_count(Value text);
  static Value _ace_recompute_playbook_stats(Value playbook);
  static Value _ace_empty_playbook(Value description, Value now);
  static Value _ace_render_playbook(Value playbook);
  static Value _ace_update_bullet_feedback(Value playbook, Value bullet_id, Value tag, Value now);
  static Value _ace_dedupe_playbook(Value playbook);
  static Value _ace_prune_section_for_addition(Value section, Value protected_ids);
  static Value _ace_apply_curator_operations(Value playbook, Value operations, Value options, Value now);
  static Value _ace_is_noop_acknowledgment(Value content);
  static Value _ace_normalize_curator_operations(Value operations);
  static Value _ace_locate_bullet_section(Value playbook, Value bullet_id);
  static Value _ace_resolve_curator_operation_targets(Value operations, Value playbook, Value reflection, Value generator_output);
  static Value _ace_dequeue_section_candidate(Value section_queues, Value section, Value used_ids, Value playbook);
  static Value _agent_factory(Value signature, Value options);
  static Value _optimization_component(Value id, Value owner, Value kind, Value current, Value description, Value constraints, Value depends_on, Value preserve, Value format, Value validation);
  static Value _optimized_artifact(Value optimizer_name, Value optimizer_version, Value component_map, Value metadata);
  static Value _agent_reserved_runtime_names();
  static Value _agent_runtime_language_tokens(Value language);
  static Value _agent_runtime_language_alias_key(Value tokens);
  static Value _agent_runtime_is_javascript_alias(Value alias_key);
  static Value _agent_runtime_code_field_name(Value tokens, Value is_javascript);
  static Value _agent_runtime_code_fence_language(Value tokens, Value alias_key, Value is_javascript);
  static Value _normalize_agent_runtime(Value options);
  static Value _normalize_agent_policy(Value options);
  static Value _resolve_agent_auto_upgrade(Value options);
  static Value _map_optimization_judge_quality_to_score(Value quality);
  static Value _build_optimization_judge_payload(Value task, Value prediction, Value criteria);
  static Value _agent_discoverable_doc_chars(Value callable_split);
  static Value _agent_has_discover_namespace(Value callable_split);
  static Value _agent_policy_flags(Value options, Value callable_split, Value auto_upgrade);
  static Value _agent_policy_action(Value id, Value category, Value kind, Value stages, Value availability, Value effect, Value host_boundary, Value actor_visible);
  static Value _agent_policy_vocabulary_registry();
  static Value _build_agent_eval_prediction(Value output, Value action_log, Value usage, Value trace);
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
  static Value _rlm_flag_enabled(Value flags, Value flag);
  static Value _rlm_any_flag_enabled(Value flags, Value flag_names);
  static Value _rlm_entry_enabled(Value entry, Value flags);
  static Value _render_runtime_primitive(Value primitive, Value flags);
  static Value _render_actor_primitives_list(Value stage, Value flags);
  static Value _build_rlm_flags(Value state);
  static Value _rlm_context_var_list(Value context_fields);
  static Value _rlm_context_var_summary(Value context_fields);
  static Value _render_agent_inline_functions_list(Value callable_split);
  static Value _render_agent_modules_list(Value callable_split);
  static Value _render_agent_skills_catalog_list(Value skills_catalog);
  static Value _rlm_render_template(Value template_, Value vars, Value context);
  static Value _render_rlm_executor_description(Value state, Value options);
  static Value _render_rlm_responder_description(Value state, Value options);
  static Value _render_rlm_distiller_description(Value state, Value options);
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
  static Value _agent_apply_llm_tombstone_summary(Value state, Value client, Value options);
  static Value _agent_working_code_state(Value entries, Value turns);
  static Value _agent_refresh_checkpoint_state(Value state);
  static Value _agent_build_action_log_parts(Value state, Value hygiene_mode);
  static Value _agent_render_runtime_state_summary(Value state, Value policy);
  static Value _agent_auto_promoted_fields(Value state);
  static Value _agent_prepare_actor_context(Value state);
  static Value _agent_build_action_evidence_summary(Value state);
  static Value _agent_sanitize_action_log_entries(Value entries);
  static Value _agent_context_fixture_result(Value state, Value fixture);
  static Value _normalize_agent_callable(Value raw, Value namespace_);
  static Value _normalize_agent_group(Value raw);
  static Value _normalize_agent_callable_inventory(Value options);
  static Value _split_agent_callable_inventory(Value inventory);
  static Value _render_agent_discovery_catalog(Value split);
  static Value _normalize_agent_string_list(Value value, Value label);
  static Value _normalize_agent_discover_request(Value state, Value request);
  static Value _agent_append_unique_by_field(Value items, Value item, Value field);
  static Value _agent_render_discovered_tool_docs(Value docs);
  static Value _agent_render_loaded_skills(Value skills);
  static Value _agent_discover(Value state, Value request);
  static Value _normalize_agent_recall_request(Value state, Value request);
  static Value _agent_merge_memory_results(Value existing, Value incoming);
  static Value _agent_recall(Value state, Value request);
  static Value _normalize_agent_used_request(Value request, Value default_stage);
  static Value _agent_used(Value state, Value request, Value stage);
  static Value _normalize_agent_guidance_payload(Value value, Value triggered_by);
  static Value _agent_append_guidance(Value state, Value payload);
  static Value _agent_execute_callable(Value state, Value request, Value options);
  static Value _normalize_agent_final_payload(Value value);
  static Value _normalize_agent_respond_payload(Value value);
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
  static Value _agent_runtime_refresh_state_summary(Value state, Value session, Value options);
  static Value _agent_runtime_restore_session_state(Value state, Value session, Value snapshot, Value options);
  static Value _agent_runtime_close_session(Value state, Value session);
  static Value _agent_reserved_auto_promotion_fields();
  static Value _agent_value_kind(Value value);
  static Value _agent_take_strings(Value items, Value limit);
  static Value _agent_object_keys_sample(Value value, Value limit);
  static Value _agent_evidence_entry_descriptor(Value key, Value value);
  static Value _agent_build_evidence_descriptor(Value evidence);
  static Value _agent_render_evidence_descriptor(Value descriptor);
  static Value _agent_relevance_tokens(Value text);
  static Value _agent_relevance_score(Value tokens, Value text);
  static Value _agent_relevance_has_id(Value items, Value field, Value id);
  static Value _agent_rank_relevance_modules(Value state, Value task);
  static Value _agent_rank_relevance_skills(Value state, Value task);
  static Value _agent_rank_relevance_memories(Value state, Value task);
  static Value _agent_render_relevance_hints(Value hints);
  static Value _agent_rank_task_text(Value values, Value executor_request);
  static Value _agent_build_relevance_hints(Value state, Value values, Value executor_request);
  static Value _agent_runtime_test(Value state, Value runtime, Value code, Value values, Value options);
  static Value _split_context_values(Value state, Value values);
  static Value _agent_render_context_metadata(Value context);
  static Value _build_distiller_inputs(Value state, Value values);
  static Value _build_executor_inputs(Value state, Value values, Value distiller_payload);
  static Value _build_responder_inputs(Value state, Value values, Value executor_payload);
  static Value _agent_render_field_token(Value field);
  static Value _build_responder_signature(Value sig, Value context_fields);
  static Value _normalize_agent_completion_payload(Value output);
  static Value _throw_agent_clarification(Value payload, Value state);
  static Value _merge_agent_chat_log(Value state, Value distiller, Value executor, Value responder);
  static Value _merge_agent_usage(Value state);
  static Value _agent_get_state(Value state);
  static Value _agent_set_state(Value state, Value runtime_state);
  static Value _agent_stage_options(Value state, Value stage, Value forward_options);
  static Value _extract_agent_runtime_code(Value state, Value executor_output);
  static Value _agent_apply_llm_checkpoint_summary(Value state, Value client, Value options);
  static Value _context_map_sections();
  static Value _context_map_parse_items(Value text);
  static Value _context_map_render_items(Value items);
  static Value _context_map_update_scores(Value scores, Value item_tags);
  static Value _context_map_apply_operations(Value items, Value operations, Value next_id);
  static Value _context_map_evict_to_budget(Value items, Value scores, Value max_chars);
  static Value _format_context_map_trajectory(Value state);
  static Value _context_map_complete(Value client, Value system, Value user);
  static Value _context_map_parse_json(Value content);
  static Value _agent_evolve_context_map(Value state, Value client, Value options);
  static Value _agent_transcribe_one_audio(Value client, Value audio, Value transcribe_opts, Value options);
  static Value _agent_transcribe_audio_inputs(Value state, Value client, Value values, Value options);
  static Value _agent_run_llm_query_one(Value sub_gen, Value client, Value item);
  static Value _agent_run_llm_query(Value sub_gen, Value client, Value params);
  static Value _agent_forward(Value state, Value distiller, Value executor, Value responder, Value client, Value values, Value options);
  static Value _flow_factory(Value options);
  static Value _program_descriptor(Value kind, Value id, Value metadata);
  static Value _program_trace_event(Value program_id, Value kind, Value payload);
  static Value _flow_step(Value kind, Value name, Value program, Value options);
  static Value _program_child_component_prefix(Value owner, Value node);
  static Value _program_prefix_component(Value component, Value owner, Value node);
  static Value _program_slice_component_map(Value component_map, Value prefix);
  static Value _flow_add_step(Value flow, Value step);
  static Value _flow_set_returns(Value flow, Value returns);
  static Value _flow_plan_entry(Value step, Value step_index);
  static Value _flow_plan_can_share_group(Value group, Value candidate);
  static Value _flow_plan(Value flow);
  static Value _flow_cache_key(Value values);
  static Value _flow_cache_read_write(Value flow, Value values, Value options, Value mode, Value cached_value);
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
  static Value _flow_get_optimizable_components(Value flow);
  static Value _flow_apply_optimized_components(Value flow, Value component_map);
  static Value _flow_snapshot_components(Value flow);
  static Value _flow_restore_components(Value flow, Value snapshot);
  static Value _flow_evaluate_optimization(Value flow, Value client, Value dataset, Value candidate_map, Value options);
  static Value _flow_optimize_with(Value flow, Value dataset, Value options, Value evaluator_available);
  static Value ucp_negotiate_profile(Value profile, Value supportedVersions, Value requestedServices);
  static Value ucp_normalize_outcome(Value operation, Value response);
  static Value mcp_execution_context_descriptor(Value namespaces, Value inheritance);
  static Value mcp_protocol_constants();
  static Value mcp_jsonrpc_request(Value id, Value method, Value params);
  static Value mcp_jsonrpc_notification(Value method, Value params);
  static Value mcp_normalize_error(Value response);
  // END AXIR CORE EMITTED DECLARATIONS

};

class AIClient {
 public:
  virtual ~AIClient() = default;
  virtual Value complete(Value request) = 0;
  virtual Value chat(Value request);
  // Default so intrinsic.agent.transcribe can call transcribe through an AIClient* (the agent's
  // scripted client extends the base AIClient). AxAIService and the scripted client override it.
  virtual Value transcribe(Value request, Value options) {
    (void)request;
    (void)options;
    return Value::object();
  }
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
  virtual Value transcribe(Value request) = 0;
  virtual Value transcribe(Value request, Value options);
  virtual Value speak(Value request) = 0;
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
  Value get_model_list() override;
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
  std::vector<Value> stream(Value request);
  Value embed(Value request, Value options = Value::object());
  Value transcribe(Value request, Value options = Value::object());
  Value speak(Value request, Value options = Value::object());

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

class HttpTransport : public Transport {
 public:
  Value call(Value request) override;
};

// Transport seam for the realtime turn driver: ScriptedRealtimeTransport for
// deterministic offline turns, plus a WebSocket-backed transport (compiled only
// when AXLLM_ENABLE_REALTIME is defined) for live turns.
class RealtimeTransport {
 public:
  virtual ~RealtimeTransport() = default;
  virtual void send(const Value& event) = 0;
  virtual bool recv(Value& out) = 0;
  virtual void close() {}
};

class ScriptedRealtimeTransport : public RealtimeTransport {
 public:
  explicit ScriptedRealtimeTransport(std::vector<Value> inbound);
  void send(const Value& event) override;
  bool recv(Value& out) override;
  std::vector<Value> sent;

 private:
  std::vector<Value> inbound_;
  std::size_t index_ = 0;
};

class OpenAICompatibleClient : public AxBaseAI {
 public:
  explicit OpenAICompatibleClient(Value options = Value::object(), Transport* transport = nullptr);
  std::vector<Value> stream(Value request) override;
  Value transcribe(Value request) override;
  Value speak(Value request) override;
  std::vector<Value> realtime(Value events);
  Value realtime_audio_setup(Value request);
  Value realtime_audio_input(Value request);
  Value realtime_chat(Value request, RealtimeTransport* transport = nullptr);

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
  std::unique_ptr<Transport> owned_transport_;
  Transport* transport_;
  Value request_json(const std::string& endpoint, Value payload, bool stream);
  Value request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key);
  Value request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key, bool binary_response);
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
  AxGen& add_assert(Value assertion);
  AxGen& add_assert(std::function<Value(Value)> assertion);
  AxGen& add_streaming_assert(Value assertion);
  AxGen& add_streaming_assert(std::string field, std::string not_contains, std::string message = "");
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
  // Register a host callable under `name`. Default no-op so runtimes that do
  // not host callables are unaffected; the embedded JS engines override it so
  // the agent wrapper can wire the built-in `llmQuery` primitive.
  virtual void register_host_callable(std::string /*name*/, std::function<Value(Value)> /*callable*/) {}
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

class AxBootstrapFewShot : public OptimizerEngine {
 public:
  explicit AxBootstrapFewShot(Value options = Value::object());
  std::string name() const override;
  std::string version() const override;
  Value optimize(Value request) override;
  Value optimize(Value request, OptimizerEvaluator* evaluator) override;

 private:
  Value options_;
};

// AxACE is the Agentic Context Engineering optimizer (Generator -> Reflector ->
// Curator). Deterministic playbook mutations reuse the Core-owned _ace_* ops;
// the LLM-orchestrated reflect/curate steps are delegated to injected callables
// so the loop is reproducible under conformance with scripted responses.
class AxACE {
 public:
  using AceCallable = std::function<Value(const Value&)>;

  explicit AxACE(Value options = Value::object());
  void set_callables(AceCallable reflector, AceCallable curator, AceCallable generator);
  std::string name() const;
  std::string version() const;
  void reset();
  void configure_auto(const std::string& level);
  void hydrate(const Value& state);
  Value get_playbook() const;
  Value get_artifact() const;
  Value compile(const std::vector<Value>& examples, const AceCallable& metric_fn, Value options = Value::object());
  Value apply_online_update(Value args);

 private:
  AceCallable reflector_;
  AceCallable curator_;
  AceCallable generator_;
  Value config_;
  Value initial_playbook_;
  std::string now_;
  Value playbook_;
  std::vector<Value> generator_history_;
  std::vector<Value> delta_history_;
  Value last_prediction_;
  bool has_generator_ = false;

  Value empty_playbook() const;
  int int_config(const std::string& key, int fallback) const;
  std::string render_playbook() const;
  Value generator_output(const Value& prediction) const;
  Value run_reflection_rounds(const Value& example, const Value& generator_output, const Value& feedback);
  Value run_reflector(const Value& example, const Value& generator_output, const Value& feedback, const Value& previous_reflection);
  Value run_curator(const Value& example, const Value& reflection);
  std::vector<Value> normalize_and_resolve(const Value& raw_curator, const Value& generator_output, const Value& reflection);
  std::vector<Value> apply_operations(std::vector<Value>& resolved, Value& curator_result);
  void apply_bullet_tags(const Value& reflection);
};

// AxPlaybook is a live, evolving context playbook bound to a program. It mirrors
// the TypeScript AxPlaybook: grow it offline from examples (evolve), keep it
// growing online from live feedback (update), render it into the program context
// (apply_to), and persist/restore it (to_json/load). The evolution engine (ACE)
// is an implementation detail of this surface, just as optimize() hides GEPA.
class AxPlaybook {
 public:
  using MetricFn = std::function<Value(const Value&)>;

  AxPlaybook(AxGen& program, AIClient& student, AIClient* teacher = nullptr, Value options = Value::object());
  Value evolve(const std::vector<Value>& examples, const MetricFn& metric_fn, Value options = Value::object());
  Value update(Value args);
  void apply_to(AxGen* program = nullptr);
  std::string render() const;
  Value get_state() const;
  Value to_json() const;
  AxPlaybook& load(Value snapshot);
  void configure_auto(const std::string& level);
  void reset();
  void set_apply_hook(std::function<void(const std::string&)> hook);

 private:
  AxGen* program_;
  AxACE engine_;
  AIClient* student_;
  AIClient* teacher_;
  bool verbose_;
  std::string base_instruction_;
  bool started_ = false;
  Value last_prediction_;
  std::unique_ptr<AxGen> reflector_program_;
  std::unique_ptr<AxGen> curator_program_;
  std::function<void(const std::string&)> apply_hook_;

  Value run_generator(const Value& example);
  Value run_reflector(const Value& payload);
  Value run_curator(const Value& payload);
  void bind_callables();
  void inject();
};

class AxAgent : public AxProgram {
 public:
  explicit AxAgent(Value signature, Value options = Value::object());
  AxAgent& set_signature(Value signature);
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
  AxAgent& add_tool_module(std::string name, const std::vector<Tool>& tools);
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
  AxPlaybook playbook(AIClient& student, Value options = Value::object());

 private:
  Value state_;
  std::unique_ptr<AxGen> distiller_;
  std::unique_ptr<AxGen> executor_;
  std::unique_ptr<AxGen> responder_;
  std::unique_ptr<AxGen> llm_query_;
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
// Register a native host search callback and return a marker to place in the agent options
// under "onMemoriesSearch"/"onSkillsSearch". The callbacks run host-side when the actor calls
// recall()/discover(); their presence auto-enables the memory/skill subsystems. Callbacks take
// and return Value: memories (searches, alreadyLoaded) -> results, skills (searches) -> results.
Value register_memories_search(std::function<Value(Value, Value)> fn);
Value register_skills_search(std::function<Value(Value)> fn);
AxFlow flow(Value options = Value::object());
Value optimize(AxGen& program, AIClient& student, Value dataset, Value options = Value::object(), AIClient* teacher = nullptr);
Value optimize(AxFlow& program, AIClient& student, Value dataset, Value options = Value::object(), AIClient* teacher = nullptr);
Value optimize(AxAgent& program, AIClient& student, Value dataset, Value options = Value::object(), AIClient* teacher = nullptr);
AxPlaybook playbook(AxGen& program, AIClient& student, Value options = Value::object(), AIClient* teacher = nullptr);
std::shared_ptr<AxAIService> ai(const std::string& provider, Value options = Value::object());
std::shared_ptr<AxAIService> ai(const char* provider, Value options = Value::object());
Value to_json_schema(Value fields, const std::string& title = "Schema", Value options = Value::object());
Value validate_output(Value fields, Value values);
Value strip_internal(Value fields, Value values);
Value render_prompt(Value signature, Value values, Value functions = Value::array(), Value options = Value::object());
Value fold_stream(Value events);

}  // namespace axllm
