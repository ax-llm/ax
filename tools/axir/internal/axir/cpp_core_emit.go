package axir

import (
	"fmt"
	"strconv"
	"strings"
)

type cppCoreFuncSpec struct {
	Symbol string
	Name   string
}

var cppCoreFuncs = []cppCoreFuncSpec{
	{Symbol: "signature_parse_fields_impl", Name: "_signature_parse_fields_impl"},
	{Symbol: "signature_validate_field_shape_impl", Name: "_signature_validate_field_shape_impl"},
	{Symbol: "signature_parse_field_impl", Name: "_signature_parse_field_impl"},
	{Symbol: "signature_parse_impl", Name: "_signature_parse_impl"},
	{Symbol: "signature_validate_impl", Name: "_signature_validate_impl"},
	{Symbol: "parse_signature", Name: "parse_signature"},
	{Symbol: "validate_signature", Name: "validate_signature"},
	{Symbol: "schema_required_impl", Name: "_schema_required_impl"},
	{Symbol: "schema_flexible_json_as_string_impl", Name: "_schema_flexible_json_as_string_impl"},
	{Symbol: "schema_json_type_impl", Name: "_schema_json_type_impl"},
	{Symbol: "schema_enhance_description_impl", Name: "_schema_enhance_description_impl"},
	{Symbol: "schema_apply_constraints_impl", Name: "_schema_apply_constraints_impl"},
	{Symbol: "schema_nullable_optional_impl", Name: "_schema_nullable_optional_impl"},
	{Symbol: "schema_object_from_fields_impl", Name: "_schema_object_from_fields_impl"},
	{Symbol: "schema_field_schema_impl", Name: "_schema_field_schema_impl"},
	{Symbol: "schema_to_json_schema_impl", Name: "_schema_to_json_schema_impl"},
	{Symbol: "validate_string_constraints_impl", Name: "_validate_string_constraints_impl"},
	{Symbol: "validate_number_constraints_impl", Name: "_validate_number_constraints_impl"},
	{Symbol: "validate_fields_impl", Name: "_validate_fields_impl"},
	{Symbol: "validate_output_impl", Name: "_validate_output_impl"},
	{Symbol: "validate_value_impl", Name: "_validate_value_impl"},
	{Symbol: "strip_internal_fields_impl", Name: "_strip_internal_fields_impl"},
	{Symbol: "to_json_schema", Name: "to_json_schema"},
	{Symbol: "validate_fields", Name: "validate_fields"},
	{Symbol: "validate_output", Name: "validate_output"},
	{Symbol: "validate_value", Name: "validate_value"},
	{Symbol: "strip_internal_fields", Name: "strip_internal"},
	{Symbol: "template_parse_impl", Name: "_template_parse_impl"},
	{Symbol: "template_render_tree_impl", Name: "_template_render_tree_impl"},
	{Symbol: "template_collect_vars_impl", Name: "_template_collect_vars_impl"},
	{Symbol: "template_validate_impl", Name: "_template_validate_impl"},
	{Symbol: "prompt_structured_impl", Name: "_prompt_structured_impl"},
	{Symbol: "prompt_user_content_impl", Name: "_prompt_user_content_impl"},
	{Symbol: "prompt_messages_impl", Name: "_prompt_messages_impl"},
	{Symbol: "render_template_content", Name: "render_template_content"},
	{Symbol: "collect_template_variable_names", Name: "collect_template_variable_names"},
	{Symbol: "validate_prompt_template_syntax", Name: "validate_prompt_template_syntax"},
	{Symbol: "render_prompt", Name: "render_prompt"},
	{Symbol: "tool_spec_impl", Name: "_tool_spec_impl"},
	{Symbol: "function_call_mode_impl", Name: "_function_call_mode_impl"},
	{Symbol: "build_gen_chat_request", Name: "_build_gen_chat_request"},
	{Symbol: "complete_with_retries_impl", Name: "_complete_with_retries_impl"},
	{Symbol: "parse_output_impl", Name: "_parse_output_impl"},
	{Symbol: "set_examples", Name: "_set_examples"},
	{Symbol: "set_demos", Name: "_set_demos"},
	{Symbol: "render_examples", Name: "_render_examples"},
	{Symbol: "render_demos", Name: "_render_demos"},
	{Symbol: "apply_field_processors", Name: "_apply_field_processors"},
	{Symbol: "run_assertions", Name: "_run_assertions"},
	{Symbol: "append_assertion_retry_messages", Name: "_append_assertion_retry_messages"},
	{Symbol: "record_trace", Name: "_record_trace"},
	{Symbol: "should_continue_steps", Name: "_should_continue_steps"},
	{Symbol: "response_function_calls_impl", Name: "_response_function_calls_impl"},
	{Symbol: "completion_call_to_chat_impl", Name: "_completion_call_to_chat_impl"},
	{Symbol: "append_tool_call_messages_impl", Name: "_append_tool_call_messages_impl"},
	{Symbol: "tool_result_message_impl", Name: "_tool_result_message_impl"},
	{Symbol: "tool_error_message_impl", Name: "_tool_error_message_impl"},
	{Symbol: "append_validation_retry_messages_impl", Name: "_append_validation_retry_messages_impl"},
	{Symbol: "execute_tool_call", Name: "_execute_tool_call"},
	{Symbol: "forward", Name: "_forward_impl"},
	{Symbol: "stream_event_content_parts_impl", Name: "_stream_event_content_parts_impl"},
	{Symbol: "fold_stream", Name: "fold_stream"},
	{Symbol: "normalize_token_usage", Name: "normalize_token_usage"},
	{Symbol: "ai_model_usage_impl", Name: "_ai_model_usage_impl"},
	{Symbol: "merge_model_config", Name: "merge_model_config"},
	{Symbol: "validate_chat_request", Name: "validate_chat_request"},
	{Symbol: "chat_response_to_completion", Name: "chat_response_to_completion"},
	{Symbol: "openai_finish_reason_impl", Name: "_openai_finish_reason_impl"},
	{Symbol: "openai_tool_call_to_provider_impl", Name: "_openai_tool_call_to_provider_impl"},
	{Symbol: "openai_content_part_impl", Name: "_openai_content_part_impl"},
	{Symbol: "openai_message_impl", Name: "_openai_message_impl"},
	{Symbol: "openai_tool_spec_impl", Name: "_openai_tool_spec_impl"},
	{Symbol: "openai_copy_config_key_impl", Name: "_openai_copy_config_key_impl"},
	{Symbol: "openai_apply_model_config_impl", Name: "_openai_apply_model_config_impl"},
	{Symbol: "openai_normalize_tool_calls_impl", Name: "_openai_normalize_tool_calls_impl"},
	{Symbol: "openai_normalize_choice_impl", Name: "_openai_normalize_choice_impl"},
	{Symbol: "openai_stream_choice_impl", Name: "_openai_stream_choice_impl"},
	{Symbol: "openai_build_chat_request", Name: "openai_build_chat_request"},
	{Symbol: "openai_build_embed_request", Name: "openai_build_embed_request"},
	{Symbol: "openai_normalize_chat_response", Name: "openai_normalize_chat_response"},
	{Symbol: "openai_normalize_stream_delta", Name: "openai_normalize_stream_delta"},
	{Symbol: "openai_normalize_embed_response", Name: "openai_normalize_embed_response"},
	{Symbol: "openai_normalize_error", Name: "openai_normalize_error"},
	{Symbol: "build_chat_request", Name: "build_chat_request"},
	{Symbol: "normalize_chat_response", Name: "normalize_chat_response"},
	{Symbol: "normalize_stream_delta", Name: "normalize_stream_delta"},
	{Symbol: "build_embed_request", Name: "build_embed_request"},
	{Symbol: "normalize_embed_response", Name: "normalize_embed_response"},
	{Symbol: "agent_reserved_runtime_names", Name: "_agent_reserved_runtime_names"},
	{Symbol: "agent_runtime_language_tokens", Name: "_agent_runtime_language_tokens"},
	{Symbol: "agent_runtime_language_alias_key", Name: "_agent_runtime_language_alias_key"},
	{Symbol: "agent_runtime_is_javascript_alias", Name: "_agent_runtime_is_javascript_alias"},
	{Symbol: "agent_runtime_code_field_name", Name: "_agent_runtime_code_field_name"},
	{Symbol: "agent_runtime_code_fence_language", Name: "_agent_runtime_code_fence_language"},
	{Symbol: "normalize_agent_runtime", Name: "_normalize_agent_runtime"},
	{Symbol: "normalize_agent_policy", Name: "_normalize_agent_policy"},
	{Symbol: "agent_policy_flags", Name: "_agent_policy_flags"},
	{Symbol: "agent_policy_action", Name: "_agent_policy_action"},
	{Symbol: "agent_policy_registry", Name: "_agent_policy_registry"},
	{Symbol: "policy_flag_enabled", Name: "_policy_flag_enabled"},
	{Symbol: "select_actor_primitives", Name: "_select_actor_primitives"},
	{Symbol: "select_protocol_actions", Name: "_select_protocol_actions"},
	{Symbol: "select_runtime_globals", Name: "_select_runtime_globals"},
	{Symbol: "validate_policy_reserved_names", Name: "_validate_policy_reserved_names"},
	{Symbol: "render_actor_primitive_guidance", Name: "_render_actor_primitive_guidance"},
	{Symbol: "record_policy_event", Name: "_record_policy_event"},
	{Symbol: "normalize_policy_action_result", Name: "_normalize_policy_action_result"},
	{Symbol: "build_agent_actor_prompt_policy", Name: "_build_agent_actor_prompt_policy"},
	{Symbol: "normalize_agent_callable", Name: "_normalize_agent_callable"},
	{Symbol: "normalize_agent_group", Name: "_normalize_agent_group"},
	{Symbol: "normalize_agent_callable_inventory", Name: "_normalize_agent_callable_inventory"},
	{Symbol: "split_agent_callable_inventory", Name: "_split_agent_callable_inventory"},
	{Symbol: "render_agent_discovery_catalog", Name: "_render_agent_discovery_catalog"},
	{Symbol: "normalize_agent_string_list", Name: "_normalize_agent_string_list"},
	{Symbol: "normalize_agent_discover_request", Name: "_normalize_agent_discover_request"},
	{Symbol: "agent_append_unique_by_field", Name: "_agent_append_unique_by_field"},
	{Symbol: "agent_render_discovered_tool_docs", Name: "_agent_render_discovered_tool_docs"},
	{Symbol: "agent_render_loaded_skills", Name: "_agent_render_loaded_skills"},
	{Symbol: "agent_discover", Name: "_agent_discover"},
	{Symbol: "normalize_agent_recall_request", Name: "_normalize_agent_recall_request"},
	{Symbol: "agent_merge_memory_results", Name: "_agent_merge_memory_results"},
	{Symbol: "agent_recall", Name: "_agent_recall"},
	{Symbol: "normalize_agent_used_request", Name: "_normalize_agent_used_request"},
	{Symbol: "agent_used", Name: "_agent_used"},
	{Symbol: "normalize_agent_guidance_payload", Name: "_normalize_agent_guidance_payload"},
	{Symbol: "agent_append_guidance", Name: "_agent_append_guidance"},
	{Symbol: "agent_execute_callable", Name: "_agent_execute_callable"},
	{Symbol: "normalize_agent_final_payload", Name: "_normalize_agent_final_payload"},
	{Symbol: "normalize_agent_clarification_payload", Name: "_normalize_agent_clarification_payload"},
	{Symbol: "agent_optimizer_metadata", Name: "_agent_optimizer_metadata"},
	{Symbol: "agent_begin_trace", Name: "_agent_begin_trace"},
	{Symbol: "agent_record_trace_event", Name: "_agent_record_trace_event"},
	{Symbol: "agent_normalize_host_boundary_event", Name: "_agent_normalize_host_boundary_event"},
	{Symbol: "agent_finalize_trace", Name: "_agent_finalize_trace"},
	{Symbol: "agent_export_trace", Name: "_agent_export_trace"},
	{Symbol: "agent_replay_trace", Name: "_agent_replay_trace"},
	{Symbol: "agent_export_runtime_state", Name: "_agent_export_runtime_state"},
	{Symbol: "agent_restore_runtime_state", Name: "_agent_restore_runtime_state"},
	{Symbol: "agent_runtime_build_globals", Name: "_agent_runtime_build_globals"},
	{Symbol: "agent_runtime_append_action_log", Name: "_agent_runtime_append_action_log"},
	{Symbol: "normalize_agent_runtime_step_result", Name: "_normalize_agent_runtime_step_result"},
	{Symbol: "agent_runtime_create_session", Name: "_agent_runtime_create_session"},
	{Symbol: "agent_runtime_execute_step", Name: "_agent_runtime_execute_step"},
	{Symbol: "agent_runtime_inspect_state", Name: "_agent_runtime_inspect_state"},
	{Symbol: "agent_runtime_export_session_state", Name: "_agent_runtime_export_session_state"},
	{Symbol: "agent_runtime_restore_session_state", Name: "_agent_runtime_restore_session_state"},
	{Symbol: "agent_runtime_close_session", Name: "_agent_runtime_close_session"},
	{Symbol: "agent_runtime_test", Name: "_agent_runtime_test"},
	{Symbol: "agent_factory", Name: "_agent_factory"},
	{Symbol: "split_context_values", Name: "_split_context_values"},
	{Symbol: "build_distiller_inputs", Name: "_build_distiller_inputs"},
	{Symbol: "build_executor_inputs", Name: "_build_executor_inputs"},
	{Symbol: "build_responder_inputs", Name: "_build_responder_inputs"},
	{Symbol: "normalize_agent_completion_payload", Name: "_normalize_agent_completion_payload"},
	{Symbol: "throw_agent_clarification", Name: "_throw_agent_clarification"},
	{Symbol: "merge_agent_chat_log", Name: "_merge_agent_chat_log"},
	{Symbol: "merge_agent_usage", Name: "_merge_agent_usage"},
	{Symbol: "agent_get_state", Name: "_agent_get_state"},
	{Symbol: "agent_set_state", Name: "_agent_set_state"},
	{Symbol: "agent_stage_options", Name: "_agent_stage_options"},
	{Symbol: "extract_agent_runtime_code", Name: "_extract_agent_runtime_code"},
	{Symbol: "agent_forward", Name: "_agent_forward"},
	{Symbol: "optimization_component", Name: "_optimization_component"},
	{Symbol: "optimized_artifact", Name: "_optimized_artifact"},
	{Symbol: "validate_optimization_component_map", Name: "_validate_optimization_component_map"},
	{Symbol: "validate_optimized_artifact", Name: "_validate_optimized_artifact"},
	{Symbol: "serialize_optimized_artifact", Name: "_serialize_optimized_artifact"},
	{Symbol: "deserialize_optimized_artifact", Name: "_deserialize_optimized_artifact"},
	{Symbol: "optimization_changed_components", Name: "_optimization_changed_components"},
	{Symbol: "optimization_component_current_map", Name: "_optimization_component_current_map"},
	{Symbol: "normalize_optimization_dataset", Name: "_normalize_optimization_dataset"},
	{Symbol: "normalize_optimization_metric_scores", Name: "_normalize_optimization_metric_scores"},
	{Symbol: "scalarize_optimization_scores", Name: "_scalarize_optimization_scores"},
	{Symbol: "optimization_action_name_matches", Name: "_optimization_action_name_matches"},
	{Symbol: "adjust_optimization_score_for_actions", Name: "_adjust_optimization_score_for_actions"},
	{Symbol: "map_optimization_judge_quality_to_score", Name: "_map_optimization_judge_quality_to_score"},
	{Symbol: "build_optimization_judge_payload", Name: "_build_optimization_judge_payload"},
	{Symbol: "build_optimization_eval_row", Name: "_build_optimization_eval_row"},
	{Symbol: "build_optimization_eval_result", Name: "_build_optimization_eval_result"},
	{Symbol: "filter_optimization_components", Name: "_filter_optimization_components"},
	{Symbol: "build_optimizer_request", Name: "_build_optimizer_request"},
	{Symbol: "prepare_optimizer_run", Name: "_prepare_optimizer_run"},
	{Symbol: "normalize_optimizer_engine_response", Name: "_normalize_optimizer_engine_response"},
	{Symbol: "build_optimizer_evidence_batch", Name: "_build_optimizer_evidence_batch"},
	{Symbol: "build_agent_eval_prediction", Name: "_build_agent_eval_prediction"},
	{Symbol: "program_descriptor", Name: "_program_descriptor"},
	{Symbol: "program_trace_event", Name: "_program_trace_event"},
	{Symbol: "program_child_component_prefix", Name: "_program_child_component_prefix"},
	{Symbol: "program_prefix_component", Name: "_program_prefix_component"},
	{Symbol: "program_slice_component_map", Name: "_program_slice_component_map"},
	{Symbol: "flow_factory", Name: "_flow_factory"},
	{Symbol: "flow_step", Name: "_flow_step"},
	{Symbol: "flow_add_step", Name: "_flow_add_step"},
	{Symbol: "flow_set_returns", Name: "_flow_set_returns"},
	{Symbol: "flow_plan_entry", Name: "_flow_plan_entry"},
	{Symbol: "flow_plan_can_share_group", Name: "_flow_plan_can_share_group"},
	{Symbol: "flow_plan", Name: "_flow_plan"},
	{Symbol: "flow_cache_key", Name: "_flow_cache_key"},
	{Symbol: "flow_get_optimizable_components", Name: "_flow_get_optimizable_components"},
	{Symbol: "flow_apply_optimized_components", Name: "_flow_apply_optimized_components"},
	{Symbol: "flow_snapshot_components", Name: "_flow_snapshot_components"},
	{Symbol: "flow_restore_components", Name: "_flow_restore_components"},
	{Symbol: "flow_evaluate_optimization", Name: "_flow_evaluate_optimization"},
	{Symbol: "flow_optimize_with", Name: "_flow_optimize_with"},
	{Symbol: "flow_cache_read_write", Name: "_flow_cache_read_write"},
	{Symbol: "flow_check_abort", Name: "_flow_check_abort"},
	{Symbol: "flow_project_returns", Name: "_flow_project_returns"},
	{Symbol: "flow_record_child_chat_log", Name: "_flow_record_child_chat_log"},
	{Symbol: "flow_record_child_usage", Name: "_flow_record_child_usage"},
	{Symbol: "flow_record_child_traces", Name: "_flow_record_child_traces"},
	{Symbol: "flow_execute_program_node", Name: "_flow_execute_program_node"},
	{Symbol: "flow_execute_step", Name: "_flow_execute_step"},
	{Symbol: "flow_merge_parallel_results", Name: "_flow_merge_parallel_results"},
	{Symbol: "flow_execute_steps", Name: "_flow_execute_steps"},
	{Symbol: "flow_forward", Name: "_flow_forward"},
}

var cppCoreFuncNames = func() map[string]string {
	out := map[string]string{}
	for _, spec := range cppCoreFuncs {
		out[spec.Symbol] = spec.Name
	}
	return out
}()

func BuildCppCore(model AxRuntimeModel) (string, error) {
	return emitCppCoreFunctions(model, cppCoreFuncs)
}

func emitCppCoreFunctions(model AxRuntimeModel, specs []cppCoreFuncSpec) (string, error) {
	var b strings.Builder
	b.WriteString("// BEGIN AXIR CORE EMITTED FUNCTIONS\n")
	for _, spec := range specs {
		op, ok := model.Symbols[spec.Symbol]
		if !ok {
			return "", fmt.Errorf("missing Core function @%s", spec.Symbol)
		}
		if model.BodySources[spec.Symbol] != "core" {
			return "", fmt.Errorf("Core function @%s is missing body_source=core", spec.Symbol)
		}
		text, err := emitCppCoreFunction(op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	b.WriteString("// END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitCppCoreFunction(op Operation, name string) (string, error) {
	body, err := BuildCoreBody(op)
	if err != nil {
		return "", fmt.Errorf("@%s: %w", op.Symbol, err)
	}
	if len(body.Blocks) == 0 {
		return "", fmt.Errorf("@%s has no Core body blocks", op.Symbol)
	}
	block := body.Blocks[0]
	var args []string
	declared := map[string]bool{}
	for _, arg := range block.Args {
		argName := cppName("%" + arg.Name)
		declared[argName] = true
		args = append(args, "Value "+argName)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Value Core::%s(%s) {\n", name, strings.Join(args, ", "))
	for _, stmt := range block.Stmts {
		lines, err := emitCppCoreStmt(stmt, declared)
		if err != nil {
			return "", fmt.Errorf("@%s: %w", op.Symbol, err)
		}
		for _, line := range lines {
			fmt.Fprintf(&b, "  %s\n", line)
		}
	}
	b.WriteString("}\n")
	return b.String(), nil
}

func emitCppCoreStmt(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"break;"}, nil
	case "continue":
		return []string{"continue;"}, nil
	case "call":
		callee := cppCallee(stmt.Callee)
		args := make([]string, 0, len(stmt.Args))
		for _, arg := range stmt.Args {
			args = append(args, cppLiteral(arg))
		}
		call := fmt.Sprintf("%s(%s)", callee, strings.Join(args, ", "))
		if stmt.Result != "" {
			return []string{cppAssign(cppName(stmt.Result), call, declared)}, nil
		}
		return []string{call + ";"}, nil
	case "const", "let":
		if stmt.Result == "" {
			return nil, fmt.Errorf("core.%s missing result", stmt.Kind)
		}
		return []string{cppAssign(cppName(stmt.Result), cppAttrValue(stmt.Op, "value"), declared)}, nil
	case "get":
		if stmt.Result == "" || stmt.Target == "" || stmt.Key == "" {
			return nil, fmt.Errorf("core.get missing result, target, or key")
		}
		defaultValue := "Value()"
		if _, ok := Attr(stmt.Op, "default"); ok {
			defaultValue = cppAttrValue(stmt.Op, "default")
		}
		return []string{cppAssign(cppName(stmt.Result), fmt.Sprintf("Core::get(%s, %s, %s)", cppLiteral(stmt.Target), cppLiteral(stmt.Key), defaultValue), declared)}, nil
	case "map":
		return []string{cppAssign(cppName(stmt.Result), "Value::object()", declared)}, nil
	case "list":
		return []string{cppAssign(cppName(stmt.Result), "Value::array()", declared)}, nil
	case "append":
		return []string{fmt.Sprintf("Core::append(%s, %s);", cppLiteral(stmt.Target), cppLiteral(stmt.Value))}, nil
	case "regex_match":
		return []string{cppAssign(cppName(stmt.Result), fmt.Sprintf("Core::regex_match(%s, %s)", cppAttrValue(stmt.Op, "pattern"), cppLiteral(stmt.Value)), declared)}, nil
	case "string_join":
		return []string{cppAssign(cppName(stmt.Result), fmt.Sprintf("Core::string_join(%s, %s)", cppAttrValue(stmt.Op, "sep"), cppLiteral(stmt.Value)), declared)}, nil
	case "string_trim":
		return []string{cppAssign(cppName(stmt.Result), fmt.Sprintf("Core::string_trim(%s)", cppLiteral(stmt.Value)), declared)}, nil
	case "type_is":
		return []string{cppAssign(cppName(stmt.Result), fmt.Sprintf("Core::type_is(%s, %s)", cppLiteral(stmt.Value), cppAttrValue(stmt.Op, "type")), declared)}, nil
	case "set":
		return []string{fmt.Sprintf("Core::set(%s, %s, %s);", cppLiteral(stmt.Target), cppLiteral(stmt.Key), cppLiteral(stmt.Value))}, nil
	case "for":
		return emitCppFor(stmt, declared)
	case "if":
		return emitCppIf(stmt, declared)
	case "loop":
		return emitCppLoop(stmt, declared)
	case "try":
		return emitCppTry(stmt, declared)
	case "return":
		if _, ok := Attr(stmt.Op, "value"); !ok {
			return []string{"return Value();"}, nil
		}
		return []string{fmt.Sprintf("return %s;", cppAttrValue(stmt.Op, "value"))}, nil
	case "raise":
		if _, ok := Attr(stmt.Op, "error"); ok {
			return []string{fmt.Sprintf("throw Core::as_error(%s);", cppAttrValue(stmt.Op, "error"))}, nil
		}
		return []string{fmt.Sprintf("throw AxError(\"runtime\", %s);", strconv.Quote(stmt.Message))}, nil
	default:
		return nil, fmt.Errorf("unsupported C++ Core op %q", stmt.Op.Name)
	}
}

func emitCppFor(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Item == "" || stmt.Iter == "" {
		return nil, fmt.Errorf("core.for missing item or in")
	}
	item := cppName(stmt.Item)
	lines := []string{fmt.Sprintf("for (auto %s : Core::iter(%s)) {", item, cppLiteral(stmt.Iter))}
	childDeclared := copyCppScope(declared)
	childDeclared[item] = true
	body := firstBodyBlock(stmt)
	childLines, err := emitCppRegionBlock(body, childDeclared)
	if err != nil {
		return nil, err
	}
	lines = append(lines, childLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitCppIf(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	cond := cppLiteral(stmt.Cond)
	lines := []string{fmt.Sprintf("if (Core::truthy(%s)) {", cond)}
	thenLines, err := emitCppRegionBlock(firstBodyBlock(stmt), copyCppScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, thenLines...)
	lines = append(lines, "}")
	elseBlock := CoreBlock{}
	if len(stmt.Regions) > 1 && len(stmt.Regions[1].Blocks) > 0 {
		elseBlock = stmt.Regions[1].Blocks[0]
	}
	if len(elseBlock.Stmts) > 0 {
		lines = append(lines, fmt.Sprintf("if (!Core::truthy(%s)) {", cond))
		elseLines, err := emitCppRegionBlock(elseBlock, copyCppScope(declared))
		if err != nil {
			return nil, err
		}
		lines = append(lines, elseLines...)
		lines = append(lines, "}")
	}
	return lines, nil
}

func emitCppLoop(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	body := firstBodyBlock(stmt)
	lines := []string{"while (true) {"}
	bodyLines, err := emitCppRegionBlock(body, copyCppScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, bodyLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitCppTry(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must contain exactly try and catch regions")
	}
	errorRef, ok := Attr(stmt.Op, "error")
	if !ok {
		return nil, fmt.Errorf("core.try missing error binding")
	}
	errorName, ok := errorRef.Value.(string)
	if !ok || !strings.HasPrefix(errorName, "%") {
		return nil, fmt.Errorf("core.try error binding must be a value ref")
	}
	lines := []string{"try {"}
	tryBlock := CoreBlock{}
	if len(stmt.Regions[0].Blocks) > 0 {
		tryBlock = stmt.Regions[0].Blocks[0]
	}
	tryLines, err := emitCppRegionBlock(tryBlock, copyCppScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, tryLines...)
	lines = append(lines, "} catch (const std::exception& e) {")
	catchDeclared := copyCppScope(declared)
	catchDeclared[cppName(errorName)] = true
	lines = append(lines, "  Value "+cppName(errorName)+" = Core::exception_value(e);")
	catchBlock := CoreBlock{}
	if len(stmt.Regions[1].Blocks) > 0 {
		catchBlock = stmt.Regions[1].Blocks[0]
	}
	catchLines, err := emitCppRegionBlock(catchBlock, catchDeclared)
	if err != nil {
		return nil, err
	}
	lines = append(lines, catchLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitCppRegionBlock(block CoreBlock, declared map[string]bool) ([]string, error) {
	if len(block.Stmts) == 0 {
		return []string{"  // empty"}, nil
	}
	lines, err := emitCppCoreBlock(block, declared)
	if err != nil {
		return nil, err
	}
	for i := range lines {
		lines[i] = "  " + lines[i]
	}
	return lines, nil
}

func emitCppCoreBlock(block CoreBlock, declared map[string]bool) ([]string, error) {
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitCppCoreStmt(child, declared)
		if err != nil {
			return nil, err
		}
		lines = append(lines, childLines...)
	}
	return lines, nil
}

func cppAssign(name, expr string, declared map[string]bool) string {
	if declared[name] {
		return fmt.Sprintf("%s = %s;", name, expr)
	}
	declared[name] = true
	return fmt.Sprintf("Value %s = %s;", name, expr)
}

func copyCppScope(in map[string]bool) map[string]bool {
	out := map[string]bool{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func cppCallee(callee string) string {
	if strings.HasPrefix(callee, "@") {
		if name, ok := cppCoreFuncNames[Symbol(callee)]; ok {
			return "Core::" + name
		}
		return "Core::_" + Symbol(callee)
	}
	if target, ok := coreIntrinsicCpp[CoreIntrinsic(callee)]; ok {
		return target
	}
	if name, ok := cppCoreFuncNames[callee]; ok {
		return "Core::" + name
	}
	return "Core::" + callee
}

var coreIntrinsicCpp = map[CoreIntrinsic]string{
	IntrinsicNot:                    "Core::not_",
	IntrinsicAnd:                    "Core::and_",
	IntrinsicOr:                     "Core::or_",
	IntrinsicEq:                     "Core::eq",
	IntrinsicNe:                     "Core::ne",
	IntrinsicLT:                     "Core::lt",
	IntrinsicLTE:                    "Core::lte",
	IntrinsicGT:                     "Core::gt",
	IntrinsicGTE:                    "Core::gte",
	IntrinsicAdd:                    "Core::add",
	IntrinsicMul:                    "Core::mul",
	IntrinsicDiv:                    "Core::div",
	IntrinsicContains:               "Core::contains",
	IntrinsicLen:                    "Core::len",
	IntrinsicTruthy:                 "Core::truthy_value",
	IntrinsicIsNone:                 "Core::is_none",
	IntrinsicIsNotNone:              "Core::is_not_none",
	IntrinsicNone:                   "Core::none",
	IntrinsicCoalesce:               "Core::coalesce",
	IntrinsicMapMerge:               "Core::map_merge",
	IntrinsicMapContains:            "Core::map_contains",
	IntrinsicMapGet:                 "Core::map_get",
	IntrinsicMapDelete:              "Core::map_delete",
	IntrinsicMapUpdate:              "Core::map_update",
	IntrinsicMapKeys:                "Core::map_keys",
	IntrinsicMapValues:              "Core::map_values",
	IntrinsicRecordNew:              "Core::record_new",
	IntrinsicObjectCallMethod:       "Core::object_call_method",
	IntrinsicProgramComponents:      "Core::program_components",
	IntrinsicProgramApplyComponents: "Core::program_apply_components",
	IntrinsicAICompleteOnce:         "Core::ai_complete_once",
	IntrinsicRetrySleep:             "Core::retry_sleep",
	IntrinsicExceptionMessage:       "Core::exception_message",
	IntrinsicRuntimeError:           "Core::runtime_error",
	IntrinsicJSONParse:              "Core::json_parse",
	IntrinsicJSONStringify:          "Core::json_stringify",
	IntrinsicJSONStableStringify:    "Core::json_stable_stringify",
	IntrinsicToolInvoke:             "Core::tool_invoke",
	IntrinsicAIErrorResponse:        "Core::ai_error_response",
	IntrinsicAIErrorRefusal:         "Core::ai_error_refusal",
	IntrinsicAIErrorStream:          "Core::ai_error_stream",
	IntrinsicAIErrorUnsupported:     "Core::ai_error_unsupported",
	IntrinsicAIErrorAuth:            "Core::ai_error_auth",
	IntrinsicAIErrorTimeout:         "Core::ai_error_timeout",
	IntrinsicAIErrorStatus:          "Core::ai_error_status",
	IntrinsicStringEndsWith:         "Core::string_ends_with",
	IntrinsicStringJoin:             "Core::string_join",
	IntrinsicStringLower:            "Core::string_lower",
	IntrinsicStringLowerCamel:       "Core::string_lower_camel",
	IntrinsicStringTitleFromCamel:   "Core::string_title_from_camel",
	IntrinsicStringFormat:           "Core::string_format",
	IntrinsicStringSlice:            "Core::string_slice",
	IntrinsicStringReplace:          "Core::string_replace",
	IntrinsicStringRemoveSuf:        "Core::string_remove_suffix",
	IntrinsicStringWords:            "Core::string_words",
	IntrinsicStringDefault:          "Core::string_default_if_empty",
	IntrinsicStringSplitOnce:        "Core::string_split_once",
	IntrinsicStringSplitTrim:        "Core::string_split_trim_nonempty",
	IntrinsicStringFindQuoted:       "Core::string_find_outside_quotes",
	IntrinsicStringSplitQuoted:      "Core::string_split_outside_quotes",
	IntrinsicStringConsumeOpt:       "Core::string_consume_optional_quoted_prefix",
	IntrinsicStringExtractSuf:       "Core::string_extract_quoted_suffix",
	IntrinsicStringSplit:            "Core::string_split",
	IntrinsicStringStartsWith:       "Core::string_starts_with",
	IntrinsicStringStr:              "Core::string_str",
	IntrinsicRegexReplace:           "Core::regex_replace",
	IntrinsicSortedStrings:          "Core::sorted_strings",
	IntrinsicJSONPretty:             "Core::json_pretty",
	IntrinsicTemplateParse:          "Core::template_parse",
	IntrinsicTemplateRender:         "Core::template_render_tree",
	IntrinsicTemplateCollect:        "Core::template_collect_vars",
	IntrinsicTemplateValidate:       "Core::template_validate",
	IntrinsicPromptStructured:       "Core::prompt_structured",
	IntrinsicPromptUserContent:      "Core::prompt_user_content",
	IntrinsicAxGenRenderExamples:    "Core::axgen_render_examples",
	IntrinsicAxGenRenderDemos:       "Core::axgen_render_demos",
	IntrinsicAxGenApplyProcessors:   "Core::axgen_apply_field_processors",
	IntrinsicAxGenRunAssertions:     "Core::axgen_run_assertions",
	IntrinsicAxGenRecordTrace:       "Core::axgen_record_trace",
	IntrinsicAxGenShouldContinue:    "Core::axgen_should_continue_steps",
	IntrinsicAxGenApplyCache:        "Core::axgen_apply_context_cache",
	IntrinsicAxGenMemoryRequest:     "Core::axgen_memory_add_request",
	IntrinsicAxGenMemoryResponse:    "Core::axgen_memory_add_response",
	IntrinsicAxGenMemoryFunction:    "Core::axgen_memory_add_function_result",
	IntrinsicAxGenMemoryCorrection:  "Core::axgen_memory_add_correction",
	IntrinsicAxGenCleanupCorrection: "Core::axgen_memory_cleanup_corrections",
	IntrinsicAxGenRecordChatLog:     "Core::axgen_record_chat_log",
	IntrinsicAxGenRecordFunction:    "Core::axgen_record_function_call",
	IntrinsicAgentStageForward:      "Core::agent_stage_forward",
	IntrinsicAgentStageChatLog:      "Core::agent_stage_chat_log",
	IntrinsicAgentStageUsage:        "Core::agent_stage_usage",
	IntrinsicAgentStageTraces:       "Core::agent_stage_traces",
	IntrinsicAgentClarificationErr:  "Core::agent_clarification_error",
	IntrinsicAgentRuntimeCreate:     "Core::agent_runtime_create_session",
	IntrinsicAgentRuntimeExecute:    "Core::agent_runtime_execute",
	IntrinsicAgentRuntimeInspect:    "Core::agent_runtime_inspect",
	IntrinsicAgentRuntimeExport:     "Core::agent_runtime_export_state",
	IntrinsicAgentRuntimeRestore:    "Core::agent_runtime_restore_state",
	IntrinsicAgentRuntimeClose:      "Core::agent_runtime_close",
	IntrinsicAgentMemorySearch:      "Core::agent_memory_search",
	IntrinsicAgentSkillSearch:       "Core::agent_skill_search",
	IntrinsicAgentCallableInvoke:    "Core::agent_callable_invoke",
	IntrinsicStreamEventParts:       "Core::stream_event_content_parts",
	IntrinsicDescriptionAppend:      "Core::description_append",
	IntrinsicURLValid:               "Core::url_valid",
	IntrinsicSignatureError:         "Core::signature_error",
	IntrinsicValidationError:        "Core::validation_error",
	IntrinsicListGet:                "Core::list_get",
	IntrinsicFieldItem:              "Core::field_item",
	IntrinsicNestedFields:           "Core::fields_from_map",
	IntrinsicValidImage:             "Core::valid_image",
	IntrinsicValidAudio:             "Core::valid_audio",
	IntrinsicValidFile:              "Core::valid_file",
	IntrinsicValidURLShape:          "Core::valid_url_shape",
}

func cppAttrValue(op Operation, name string) string {
	attr, ok := Attr(op, name)
	if !ok {
		return "Value()"
	}
	return cppLiteral(attr.Value)
}

func cppLiteral(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return "Value()"
	case string:
		if strings.HasPrefix(v, "%") {
			return cppName(v)
		}
		return "Value(" + strconv.Quote(v) + ")"
	case bool:
		if v {
			return "Value(true)"
		}
		return "Value(false)"
	case int:
		return fmt.Sprintf("Value(%d)", v)
	case float64:
		return "Value(" + strconv.FormatFloat(v, 'f', -1, 64) + ")"
	default:
		return "Value(" + strconv.Quote(fmt.Sprint(v)) + ")"
	}
}

func cppName(value string) string {
	name := strings.TrimPrefix(value, "%")
	switch name {
	case "template", "class", "typename", "namespace", "operator", "return", "for", "if", "else", "inline":
		return name + "_"
	default:
		return name
	}
}
