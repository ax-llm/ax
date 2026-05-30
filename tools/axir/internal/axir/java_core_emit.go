package axir

import (
	"fmt"
	"strconv"
	"strings"
)

type javaCoreFuncSpec struct {
	Symbol string
	Name   string
}

var javaCoreFuncs = []javaCoreFuncSpec{
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
	{Symbol: "build_agent_eval_prediction", Name: "_build_agent_eval_prediction"},
	{Symbol: "program_descriptor", Name: "_program_descriptor"},
	{Symbol: "program_trace_event", Name: "_program_trace_event"},
	{Symbol: "flow_factory", Name: "_flow_factory"},
	{Symbol: "flow_step", Name: "_flow_step"},
	{Symbol: "flow_add_step", Name: "_flow_add_step"},
	{Symbol: "flow_set_returns", Name: "_flow_set_returns"},
	{Symbol: "flow_plan_entry", Name: "_flow_plan_entry"},
	{Symbol: "flow_plan_can_share_group", Name: "_flow_plan_can_share_group"},
	{Symbol: "flow_plan", Name: "_flow_plan"},
	{Symbol: "flow_cache_key", Name: "_flow_cache_key"},
	{Symbol: "flow_forward", Name: "_flow_forward"},
}

var javaCoreFuncNames = func() map[string]string {
	out := map[string]string{}
	for _, spec := range javaCoreFuncs {
		out[spec.Symbol] = spec.Name
	}
	return out
}()

func BuildJavaCore(model AxRuntimeModel) (string, error) {
	body, err := emitJavaCoreFunctions(model, javaCoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(javaCore, "// AXIR_CORE_JAVA_FUNCTIONS\n", body, 1), nil
}

func emitJavaCoreFunctions(model AxRuntimeModel, specs []javaCoreFuncSpec) (string, error) {
	var b strings.Builder
	b.WriteString("  // BEGIN AXIR CORE EMITTED FUNCTIONS\n")
	for _, spec := range specs {
		op, ok := model.Symbols[spec.Symbol]
		if !ok {
			return "", fmt.Errorf("missing Core function @%s", spec.Symbol)
		}
		if model.BodySources[spec.Symbol] != "core" {
			return "", fmt.Errorf("Core function @%s is missing body_source=core", spec.Symbol)
		}
		text, err := emitJavaCoreFunction(op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	b.WriteString("  // END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitJavaCoreFunction(op Operation, name string) (string, error) {
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
		argName := javaName("%" + arg.Name)
		declared[argName] = true
		args = append(args, "Object "+argName)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "  static Object %s(%s) {\n", name, strings.Join(args, ", "))
	for _, stmt := range block.Stmts {
		lines, err := emitJavaCoreStmt(stmt, declared)
		if err != nil {
			return "", fmt.Errorf("@%s: %w", op.Symbol, err)
		}
		for _, line := range lines {
			fmt.Fprintf(&b, "    %s\n", line)
		}
	}
	b.WriteString("  }\n")
	return b.String(), nil
}

func emitJavaCoreStmt(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"break;"}, nil
	case "continue":
		return []string{"continue;"}, nil
	case "call":
		callee := javaCallee(stmt.Callee)
		args := make([]string, 0, len(stmt.Args))
		for _, arg := range stmt.Args {
			args = append(args, javaLiteral(arg))
		}
		call := fmt.Sprintf("%s(%s)", callee, strings.Join(args, ", "))
		if stmt.Result != "" {
			return []string{javaAssign(javaName(stmt.Result), call, declared)}, nil
		}
		return []string{call + ";"}, nil
	case "const", "let":
		if stmt.Result == "" {
			return nil, fmt.Errorf("core.%s missing result", stmt.Kind)
		}
		return []string{javaAssign(javaName(stmt.Result), javaAttrValue(stmt.Op, "value"), declared)}, nil
	case "get":
		if stmt.Result == "" || stmt.Target == "" || stmt.Key == "" {
			return nil, fmt.Errorf("core.get missing result, target, or key")
		}
		defaultValue := "null"
		if _, ok := Attr(stmt.Op, "default"); ok {
			defaultValue = javaAttrValue(stmt.Op, "default")
		}
		return []string{javaAssign(javaName(stmt.Result), fmt.Sprintf("Core.get(%s, %s, %s)", javaLiteral(stmt.Target), javaLiteral(stmt.Key), defaultValue), declared)}, nil
	case "map":
		return []string{javaAssign(javaName(stmt.Result), "new java.util.LinkedHashMap<String, Object>()", declared)}, nil
	case "list":
		return []string{javaAssign(javaName(stmt.Result), "new java.util.ArrayList<Object>()", declared)}, nil
	case "append":
		return []string{fmt.Sprintf("Core.append(%s, %s);", javaLiteral(stmt.Target), javaLiteral(stmt.Value))}, nil
	case "regex_match":
		return []string{javaAssign(javaName(stmt.Result), fmt.Sprintf("Core.regexMatch(%s, %s)", javaAttrValue(stmt.Op, "pattern"), javaLiteral(stmt.Value)), declared)}, nil
	case "string_join":
		return []string{javaAssign(javaName(stmt.Result), fmt.Sprintf("Core.stringJoin(%s, %s)", javaAttrValue(stmt.Op, "sep"), javaLiteral(stmt.Value)), declared)}, nil
	case "string_trim":
		return []string{javaAssign(javaName(stmt.Result), fmt.Sprintf("Core.stringTrim(%s)", javaLiteral(stmt.Value)), declared)}, nil
	case "type_is":
		return []string{javaAssign(javaName(stmt.Result), fmt.Sprintf("Core.typeIs(%s, %s)", javaLiteral(stmt.Value), javaAttrValue(stmt.Op, "type")), declared)}, nil
	case "set":
		return []string{fmt.Sprintf("Core.set(%s, %s, %s);", javaLiteral(stmt.Target), javaLiteral(stmt.Key), javaLiteral(stmt.Value))}, nil
	case "for":
		return emitJavaFor(stmt, declared)
	case "if":
		return emitJavaIf(stmt, declared)
	case "loop":
		return emitJavaLoop(stmt, declared)
	case "return":
		if _, ok := Attr(stmt.Op, "value"); !ok {
			return []string{"return null;"}, nil
		}
		return []string{fmt.Sprintf("return %s;", javaAttrValue(stmt.Op, "value"))}, nil
	case "raise":
		if _, ok := Attr(stmt.Op, "error"); ok {
			return []string{fmt.Sprintf("throw Core.asRuntime(%s);", javaAttrValue(stmt.Op, "error"))}, nil
		}
		return []string{fmt.Sprintf("throw new RuntimeException(%s);", strconv.Quote(stmt.Message))}, nil
	case "try":
		return emitJavaTry(stmt, declared)
	default:
		return nil, fmt.Errorf("unsupported Java Core op %q", stmt.Op.Name)
	}
}

func emitJavaFor(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Item == "" || stmt.Iter == "" {
		return nil, fmt.Errorf("core.for missing item or in")
	}
	item := javaName(stmt.Item)
	lines := []string{fmt.Sprintf("for (Object %s : Core.iter(%s)) {", item, javaLiteral(stmt.Iter))}
	childDeclared := copyJavaScope(declared)
	childDeclared[item] = true
	body := firstBodyBlock(stmt)
	if len(body.Stmts) == 0 {
		lines = append(lines, "  // empty")
	} else {
		childLines, err := emitJavaCoreBlock(body, childDeclared)
		if err != nil {
			return nil, err
		}
		for _, line := range childLines {
			lines = append(lines, "  "+line)
		}
	}
	lines = append(lines, "}")
	return lines, nil
}

func emitJavaIf(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	cond := javaLiteral(stmt.Cond)
	lines := []string{fmt.Sprintf("if (Core.truthy(%s)) {", cond)}
	thenLines, err := emitJavaRegionBlock(firstBodyBlock(stmt), copyJavaScope(declared))
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
		lines = append(lines, fmt.Sprintf("if (!Core.truthy(%s)) {", cond))
		elseLines, err := emitJavaRegionBlock(elseBlock, copyJavaScope(declared))
		if err != nil {
			return nil, err
		}
		lines = append(lines, elseLines...)
		lines = append(lines, "}")
	}
	return lines, nil
}

func emitJavaLoop(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	lines := []string{"while (Core.truthy(Boolean.TRUE)) {"}
	body := firstBodyBlock(stmt)
	childLines, err := emitJavaRegionBlock(body, copyJavaScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, childLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitJavaTry(stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must contain exactly try and catch regions")
	}
	errorRef := AttrString(stmt.Op, "error")
	if errorRef == "" {
		return nil, fmt.Errorf("core.try missing error binding")
	}
	lines := []string{"try {"}
	tryLines, err := emitJavaRegionBlock(firstBodyBlock(stmt), copyJavaScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, tryLines...)
	lines = append(lines, "} catch (RuntimeException "+javaName(errorRef)+") {")
	catchDeclared := copyJavaScope(declared)
	catchDeclared[javaName(errorRef)] = true
	catchBlock := CoreBlock{}
	if len(stmt.Regions[1].Blocks) > 0 {
		catchBlock = stmt.Regions[1].Blocks[0]
	}
	catchLines, err := emitJavaRegionBlock(catchBlock, catchDeclared)
	if err != nil {
		return nil, err
	}
	lines = append(lines, catchLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitJavaRegionBlock(block CoreBlock, declared map[string]bool) ([]string, error) {
	if len(block.Stmts) == 0 {
		return []string{"  // empty"}, nil
	}
	lines, err := emitJavaCoreBlock(block, declared)
	if err != nil {
		return nil, err
	}
	for i := range lines {
		lines[i] = "  " + lines[i]
	}
	return lines, nil
}

func emitJavaCoreBlock(block CoreBlock, declared map[string]bool) ([]string, error) {
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitJavaCoreStmt(child, declared)
		if err != nil {
			return nil, err
		}
		lines = append(lines, childLines...)
	}
	return lines, nil
}

func javaAssign(name, expr string, declared map[string]bool) string {
	if declared[name] {
		return fmt.Sprintf("%s = %s;", name, expr)
	}
	declared[name] = true
	return fmt.Sprintf("Object %s = %s;", name, expr)
}

func copyJavaScope(in map[string]bool) map[string]bool {
	out := map[string]bool{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func javaCallee(callee string) string {
	if strings.HasPrefix(callee, "@") {
		if name, ok := javaCoreFuncNames[Symbol(callee)]; ok {
			return "Core." + name
		}
		return "Core._" + Symbol(callee)
	}
	if target, ok := coreIntrinsicJava[CoreIntrinsic(callee)]; ok {
		return target
	}
	if name, ok := javaCoreFuncNames[callee]; ok {
		return "Core." + name
	}
	return "Core." + callee
}

var coreIntrinsicJava = map[CoreIntrinsic]string{
	IntrinsicNot:                    "Core.not",
	IntrinsicAnd:                    "Core.and",
	IntrinsicOr:                     "Core.or",
	IntrinsicEq:                     "Core.eq",
	IntrinsicNe:                     "Core.ne",
	IntrinsicLT:                     "Core.lt",
	IntrinsicLTE:                    "Core.lte",
	IntrinsicGT:                     "Core.gt",
	IntrinsicGTE:                    "Core.gte",
	IntrinsicAdd:                    "Core.add",
	IntrinsicMul:                    "Core.mul",
	IntrinsicDiv:                    "Core.div",
	IntrinsicContains:               "Core.contains",
	IntrinsicLen:                    "Core.len",
	IntrinsicTruthy:                 "Core.truthyValue",
	IntrinsicIsNone:                 "Core.isNone",
	IntrinsicIsNotNone:              "Core.isNotNone",
	IntrinsicNone:                   "Core.none",
	IntrinsicCoalesce:               "Core.coalesce",
	IntrinsicMapMerge:               "Core.mapMerge",
	IntrinsicMapContains:            "Core.mapContains",
	IntrinsicMapGet:                 "Core.mapGet",
	IntrinsicMapDelete:              "Core.mapDelete",
	IntrinsicMapUpdate:              "Core.mapUpdate",
	IntrinsicMapKeys:                "Core.mapKeys",
	IntrinsicMapValues:              "Core.mapValues",
	IntrinsicRecordNew:              "Core.recordNew",
	IntrinsicObjectCallMethod:       "Core.objectCallMethod",
	IntrinsicAICompleteOnce:         "Core.aiCompleteOnce",
	IntrinsicRetrySleep:             "Core.retrySleep",
	IntrinsicExceptionMessage:       "Core.exceptionMessage",
	IntrinsicRuntimeError:           "Core.runtimeError",
	IntrinsicJSONParse:              "Core.jsonParse",
	IntrinsicJSONStringify:          "Core.jsonStringify",
	IntrinsicJSONStableStringify:    "Core.jsonStableStringify",
	IntrinsicToolInvoke:             "Core.toolInvoke",
	IntrinsicAIErrorResponse:        "Core.aiErrorResponse",
	IntrinsicAIErrorRefusal:         "Core.aiErrorRefusal",
	IntrinsicAIErrorStream:          "Core.aiErrorStream",
	IntrinsicAIErrorUnsupported:     "Core.aiErrorUnsupported",
	IntrinsicAIErrorAuth:            "Core.aiErrorAuth",
	IntrinsicAIErrorTimeout:         "Core.aiErrorTimeout",
	IntrinsicAIErrorStatus:          "Core.aiErrorStatus",
	IntrinsicStringEndsWith:         "Core.stringEndsWith",
	IntrinsicStringJoin:             "Core.stringJoin",
	IntrinsicStringLower:            "Core.stringLower",
	IntrinsicStringLowerCamel:       "Core.stringLowerCamel",
	IntrinsicStringTitleFromCamel:   "Core.stringTitleFromCamel",
	IntrinsicStringFormat:           "Core.stringFormat",
	IntrinsicStringSlice:            "Core.stringSlice",
	IntrinsicStringReplace:          "Core.stringReplace",
	IntrinsicStringRemoveSuf:        "Core.stringRemoveSuffix",
	IntrinsicStringWords:            "Core.stringWords",
	IntrinsicStringDefault:          "Core.stringDefaultIfEmpty",
	IntrinsicStringSplitOnce:        "Core.stringSplitOnce",
	IntrinsicStringSplitTrim:        "Core.stringSplitTrimNonEmpty",
	IntrinsicStringFindQuoted:       "Core.stringFindOutsideQuotes",
	IntrinsicStringSplitQuoted:      "Core.stringSplitOutsideQuotes",
	IntrinsicStringConsumeOpt:       "Core.stringConsumeOptionalQuotedPrefix",
	IntrinsicStringExtractSuf:       "Core.stringExtractQuotedSuffix",
	IntrinsicStringSplit:            "Core.stringSplit",
	IntrinsicStringStartsWith:       "Core.stringStartsWith",
	IntrinsicStringStr:              "Core.stringStr",
	IntrinsicRegexReplace:           "Core.regexReplace",
	IntrinsicSortedStrings:          "Core.sortedStrings",
	IntrinsicJSONPretty:             "Core.jsonPretty",
	IntrinsicTemplateParse:          "Core.templateParse",
	IntrinsicTemplateRender:         "Core.templateRenderTree",
	IntrinsicTemplateCollect:        "Core.templateCollectVars",
	IntrinsicTemplateValidate:       "Core.templateValidate",
	IntrinsicPromptStructured:       "Core.promptStructured",
	IntrinsicPromptUserContent:      "Core.promptUserContent",
	IntrinsicAxGenRenderExamples:    "Core.axgenRenderExamples",
	IntrinsicAxGenRenderDemos:       "Core.axgenRenderDemos",
	IntrinsicAxGenApplyProcessors:   "Core.axgenApplyFieldProcessors",
	IntrinsicAxGenRunAssertions:     "Core.axgenRunAssertions",
	IntrinsicAxGenRecordTrace:       "Core.axgenRecordTrace",
	IntrinsicAxGenShouldContinue:    "Core.axgenShouldContinueSteps",
	IntrinsicAxGenApplyCache:        "Core.axgenApplyContextCache",
	IntrinsicAxGenMemoryRequest:     "Core.axgenMemoryAddRequest",
	IntrinsicAxGenMemoryResponse:    "Core.axgenMemoryAddResponse",
	IntrinsicAxGenMemoryFunction:    "Core.axgenMemoryAddFunctionResult",
	IntrinsicAxGenMemoryCorrection:  "Core.axgenMemoryAddCorrection",
	IntrinsicAxGenCleanupCorrection: "Core.axgenMemoryCleanupCorrections",
	IntrinsicAxGenRecordChatLog:     "Core.axgenRecordChatLog",
	IntrinsicAxGenRecordFunction:    "Core.axgenRecordFunctionCall",
	IntrinsicAgentStageForward:      "Core.agentStageForward",
	IntrinsicAgentStageChatLog:      "Core.agentStageChatLog",
	IntrinsicAgentClarificationErr:  "Core.agentClarificationError",
	IntrinsicAgentRuntimeCreate:     "Core.agentRuntimeCreateSession",
	IntrinsicAgentRuntimeExecute:    "Core.agentRuntimeExecute",
	IntrinsicAgentRuntimeInspect:    "Core.agentRuntimeInspect",
	IntrinsicAgentRuntimeExport:     "Core.agentRuntimeExportState",
	IntrinsicAgentRuntimeRestore:    "Core.agentRuntimeRestoreState",
	IntrinsicAgentRuntimeClose:      "Core.agentRuntimeClose",
	IntrinsicAgentMemorySearch:      "Core.agentMemorySearch",
	IntrinsicAgentSkillSearch:       "Core.agentSkillSearch",
	IntrinsicAgentCallableInvoke:    "Core.agentCallableInvoke",
	IntrinsicStreamEventParts:       "Core.streamEventContentParts",
	IntrinsicDescriptionAppend:      "Core.descriptionAppend",
	IntrinsicURLValid:               "Core.urlValid",
	IntrinsicSignatureError:         "Core.signatureError",
	IntrinsicValidationError:        "Core.validationError",
	IntrinsicListGet:                "Core.listGet",
	IntrinsicFieldItem:              "Core.fieldItem",
	IntrinsicNestedFields:           "Core.fieldsFromMap",
	IntrinsicValidImage:             "Core.validImage",
	IntrinsicValidAudio:             "Core.validAudio",
	IntrinsicValidFile:              "Core.validFile",
	IntrinsicValidURLShape:          "Core.validUrlShape",
}

func javaAttrValue(op Operation, name string) string {
	attr, ok := Attr(op, name)
	if !ok {
		return "null"
	}
	return javaLiteral(attr.Value)
}

func javaLiteral(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case string:
		if strings.HasPrefix(v, "%") {
			return javaName(v)
		}
		return strconv.Quote(v)
	case bool:
		if v {
			return "Boolean.TRUE"
		}
		return "Boolean.FALSE"
	case int:
		return strconv.Itoa(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return strconv.Quote(fmt.Sprint(v))
	}
}

func javaName(value string) string {
	return strings.TrimPrefix(value, "%")
}
