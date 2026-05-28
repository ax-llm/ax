package axir

import (
	"fmt"
	"strconv"
	"strings"
)

type pythonCoreFuncSpec struct {
	Symbol string
	Name   string
}

var pythonSignatureCoreFuncs = []pythonCoreFuncSpec{
	{Symbol: "signature_parse_fields_impl", Name: "_signature_parse_fields_impl"},
	{Symbol: "signature_validate_field_shape_impl", Name: "_signature_validate_field_shape_impl"},
	{Symbol: "signature_parse_field_impl", Name: "_signature_parse_field_impl"},
	{Symbol: "signature_parse_impl", Name: "_signature_parse_impl"},
	{Symbol: "signature_validate_impl", Name: "_signature_validate_impl"},
	{Symbol: "parse_signature", Name: "parse_signature"},
	{Symbol: "validate_signature", Name: "validate_signature"},
}

var pythonSchemaCoreFuncs = []pythonCoreFuncSpec{
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
}

var pythonPromptCoreFuncs = []pythonCoreFuncSpec{
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
}

var pythonAICoreFuncs = []pythonCoreFuncSpec{
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
}

var pythonGenCoreFuncs = []pythonCoreFuncSpec{
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
}

var pythonAgentCoreFuncs = []pythonCoreFuncSpec{
	{Symbol: "agent_reserved_runtime_names", Name: "_agent_reserved_runtime_names"},
	{Symbol: "normalize_agent_runtime", Name: "_normalize_agent_runtime"},
	{Symbol: "normalize_agent_policy", Name: "_normalize_agent_policy"},
	{Symbol: "normalize_agent_callable", Name: "_normalize_agent_callable"},
	{Symbol: "normalize_agent_group", Name: "_normalize_agent_group"},
	{Symbol: "normalize_agent_callable_inventory", Name: "_normalize_agent_callable_inventory"},
	{Symbol: "split_agent_callable_inventory", Name: "_split_agent_callable_inventory"},
	{Symbol: "render_agent_discovery_catalog", Name: "_render_agent_discovery_catalog"},
	{Symbol: "agent_discover", Name: "_agent_discover"},
	{Symbol: "normalize_agent_final_payload", Name: "_normalize_agent_final_payload"},
	{Symbol: "normalize_agent_clarification_payload", Name: "_normalize_agent_clarification_payload"},
	{Symbol: "agent_optimizer_metadata", Name: "_agent_optimizer_metadata"},
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
	{Symbol: "agent_forward", Name: "_agent_forward"},
}

func BuildPythonSignature(model AxRuntimeModel) (string, error) {
	body, err := emitPythonCoreFunctions(model, pythonSignatureCoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(pySignature, "# AXIR_CORE_SIGNATURE_FUNCTIONS\n", body, 1), nil
}

func BuildPythonSchema(model AxRuntimeModel) (string, error) {
	body, err := emitPythonCoreFunctions(model, pythonSchemaCoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(pySchema, "# AXIR_CORE_SCHEMA_FUNCTIONS\n", body, 1), nil
}

func BuildPythonPrompt(model AxRuntimeModel) (string, error) {
	body, err := emitPythonCoreFunctions(model, pythonPromptCoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(pyPrompt, "# AXIR_CORE_PROMPT_FUNCTIONS\n", body, 1), nil
}

func BuildPythonAI(model AxRuntimeModel) (string, error) {
	body, err := emitPythonCoreFunctions(model, pythonAICoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(pyAI, "# AXIR_CORE_AI_FUNCTIONS\n", body, 1), nil
}

func BuildPythonGen(model AxRuntimeModel) (string, error) {
	body, err := emitPythonCoreFunctions(model, pythonGenCoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(pyGen, "# AXIR_CORE_GEN_FUNCTIONS\n", body, 1), nil
}

func BuildPythonAgent(model AxRuntimeModel) (string, error) {
	body, err := emitPythonCoreFunctions(model, pythonAgentCoreFuncs)
	if err != nil {
		return "", err
	}
	return strings.Replace(pyAgent, "# AXIR_CORE_AGENT_FUNCTIONS\n", body, 1), nil
}

func emitPythonCoreFunctions(model AxRuntimeModel, specs []pythonCoreFuncSpec) (string, error) {
	var b strings.Builder
	b.WriteString("# BEGIN AXIR CORE EMITTED FUNCTIONS\n")
	for i, spec := range specs {
		if i > 0 {
			b.WriteByte('\n')
		}
		op, ok := model.Symbols[spec.Symbol]
		if !ok {
			return "", fmt.Errorf("missing Core function @%s", spec.Symbol)
		}
		if model.BodySources[spec.Symbol] != "core" {
			return "", fmt.Errorf("Core function @%s is missing body_source=core", spec.Symbol)
		}
		text, err := emitPythonCoreFunction(op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
	}
	b.WriteString("# END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitPythonCoreFunction(op Operation, name string) (string, error) {
	body, err := BuildCoreBody(op)
	if err != nil {
		return "", fmt.Errorf("@%s: %w", op.Symbol, err)
	}
	if len(body.Blocks) == 0 {
		return "", fmt.Errorf("@%s has no Core body blocks", op.Symbol)
	}
	block := body.Blocks[0]
	var args []string
	for _, arg := range block.Args {
		argName := pyName("%" + arg.Name)
		defaultValue := pythonArgDefault(name, argName)
		if defaultValue != "" {
			args = append(args, fmt.Sprintf("%s: %s = %s", argName, pythonType(arg.Type), defaultValue))
		} else {
			args = append(args, fmt.Sprintf("%s: %s", argName, pythonType(arg.Type)))
		}
	}
	ret := pythonReturnType(AttrString(op, "signature"))
	var b strings.Builder
	fmt.Fprintf(&b, "def %s(%s) -> %s:\n", name, strings.Join(args, ", "), ret)
	for _, stmt := range block.Stmts {
		lines, err := emitPythonCoreStmt(stmt)
		if err != nil {
			return "", fmt.Errorf("@%s: %w", op.Symbol, err)
		}
		for _, line := range lines {
			fmt.Fprintf(&b, "    %s\n", line)
		}
	}
	b.WriteByte('\n')
	return b.String(), nil
}

func emitPythonCoreStmt(stmt CoreStmt) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"break"}, nil
	case "call":
		callee := pythonCallee(stmt.Callee)
		args := make([]string, 0, len(stmt.Args))
		for _, arg := range stmt.Args {
			args = append(args, pythonLiteral(arg))
		}
		call := fmt.Sprintf("%s(%s)", callee, strings.Join(args, ", "))
		if result := stmt.Result; result != "" {
			return []string{fmt.Sprintf("%s = %s", pyName(result), call)}, nil
		}
		return []string{call}, nil
	case "continue":
		return []string{"continue"}, nil
	case "const", "let":
		result := stmt.Result
		if result == "" {
			return nil, fmt.Errorf("core.%s missing result", stmt.Kind)
		}
		return []string{fmt.Sprintf("%s = %s", pyName(result), pythonAttrValue(stmt.Op, "value"))}, nil
	case "get":
		return emitPythonGet(stmt)
	case "map":
		result := stmt.Result
		if result == "" {
			return nil, fmt.Errorf("core.map missing result")
		}
		return []string{fmt.Sprintf("%s = {}", pyName(result))}, nil
	case "list":
		result := stmt.Result
		if result == "" {
			return nil, fmt.Errorf("core.list missing result")
		}
		return []string{fmt.Sprintf("%s = []", pyName(result))}, nil
	case "append":
		return []string{fmt.Sprintf("%s.append(%s)", pythonLiteral(stmt.Target), pythonLiteral(stmt.Value))}, nil
	case "regex_match":
		return emitPythonRegexMatch(stmt)
	case "string_join":
		return emitPythonStringJoin(stmt)
	case "string_trim":
		return []string{fmt.Sprintf("%s = str(%s).strip()", pyName(stmt.Result), pythonLiteral(stmt.Value))}, nil
	case "type_is":
		return []string{fmt.Sprintf("%s = _core_type_is(%s, %s)", pyName(stmt.Result), pythonLiteral(stmt.Value), pythonAttrValue(stmt.Op, "type"))}, nil
	case "set":
		return []string{fmt.Sprintf("%s[%s] = %s", pythonLiteral(stmt.Target), pythonLiteral(stmt.Key), pythonLiteral(stmt.Value))}, nil
	case "for":
		return emitPythonFor(stmt)
	case "if":
		return emitPythonIf(stmt)
	case "loop":
		return emitPythonLoop(stmt)
	case "return":
		if _, ok := Attr(stmt.Op, "value"); !ok {
			return []string{"return None"}, nil
		}
		return []string{fmt.Sprintf("return %s", pythonAttrValue(stmt.Op, "value"))}, nil
	case "raise":
		if _, ok := Attr(stmt.Op, "error"); ok {
			return []string{fmt.Sprintf("raise %s", pythonAttrValue(stmt.Op, "error"))}, nil
		}
		return []string{fmt.Sprintf("raise RuntimeError(%s)", strconv.Quote(stmt.Message))}, nil
	case "try":
		return emitPythonTry(stmt)
	default:
		return nil, fmt.Errorf("unsupported Python Core op %q", stmt.Op.Name)
	}
}

func emitPythonGet(stmt CoreStmt) ([]string, error) {
	if stmt.Result == "" || stmt.Target == "" || stmt.Key == "" {
		return nil, fmt.Errorf("core.get missing result, target, or key")
	}
	defaultValue := "None"
	if _, ok := Attr(stmt.Op, "default"); ok {
		defaultValue = pythonAttrValue(stmt.Op, "default")
	}
	return []string{fmt.Sprintf("%s = _core_get(%s, %s, %s)", pyName(stmt.Result), pythonLiteral(stmt.Target), pythonLiteral(stmt.Key), defaultValue)}, nil
}

func emitPythonRegexMatch(stmt CoreStmt) ([]string, error) {
	if stmt.Result == "" {
		return nil, fmt.Errorf("core.regex_match missing result")
	}
	return []string{fmt.Sprintf("%s = _core_regex_match(%s, %s)", pyName(stmt.Result), pythonAttrValue(stmt.Op, "pattern"), pythonLiteral(stmt.Value))}, nil
}

func emitPythonStringJoin(stmt CoreStmt) ([]string, error) {
	if stmt.Result == "" {
		return nil, fmt.Errorf("core.string_join missing result")
	}
	return []string{fmt.Sprintf("%s = _core_string_join(%s, %s)", pyName(stmt.Result), pythonAttrValue(stmt.Op, "sep"), pythonLiteral(stmt.Value))}, nil
}

func emitPythonFor(stmt CoreStmt) ([]string, error) {
	if stmt.Item == "" || stmt.Iter == "" {
		return nil, fmt.Errorf("core.for missing item or in")
	}
	var lines []string
	lines = append(lines, fmt.Sprintf("for %s in %s:", pyName(stmt.Item), pythonLiteral(stmt.Iter)))
	body := firstBodyBlock(stmt)
	if len(body.Stmts) == 0 {
		lines = append(lines, "    pass")
		return lines, nil
	}
	for _, child := range body.Stmts {
		childLines, err := emitPythonCoreStmt(child)
		if err != nil {
			return nil, err
		}
		for _, line := range childLines {
			lines = append(lines, "    "+line)
		}
	}
	return lines, nil
}

func emitPythonLoop(stmt CoreStmt) ([]string, error) {
	var lines []string
	lines = append(lines, "while True:")
	body := firstBodyBlock(stmt)
	if len(body.Stmts) == 0 {
		lines = append(lines, "    pass")
		return lines, nil
	}
	childLines, err := emitPythonCoreBlock(body)
	if err != nil {
		return nil, err
	}
	for _, line := range childLines {
		lines = append(lines, "    "+line)
	}
	return lines, nil
}

func emitPythonIf(stmt CoreStmt) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	lines := []string{fmt.Sprintf("if %s:", pythonLiteral(stmt.Cond))}
	thenBlock := firstBodyBlock(stmt)
	if len(thenBlock.Stmts) == 0 {
		lines = append(lines, "    pass")
	} else {
		for _, child := range thenBlock.Stmts {
			childLines, err := emitPythonCoreStmt(child)
			if err != nil {
				return nil, err
			}
			for _, line := range childLines {
				lines = append(lines, "    "+line)
			}
		}
	}
	lines = append(lines, "else:")
	elseBlock := CoreBlock{}
	if len(stmt.Regions) > 1 && len(stmt.Regions[1].Blocks) > 0 {
		elseBlock = stmt.Regions[1].Blocks[0]
	}
	if len(elseBlock.Stmts) == 0 {
		lines = append(lines, "    pass")
	} else {
		for _, child := range elseBlock.Stmts {
			childLines, err := emitPythonCoreStmt(child)
			if err != nil {
				return nil, err
			}
			for _, line := range childLines {
				lines = append(lines, "    "+line)
			}
		}
	}
	return lines, nil
}

func emitPythonTry(stmt CoreStmt) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must contain exactly try and catch regions")
	}
	errorRef := AttrString(stmt.Op, "error")
	if errorRef == "" {
		return nil, fmt.Errorf("core.try missing error binding")
	}
	var lines []string
	lines = append(lines, "try:")
	tryBlock := firstBodyBlock(stmt)
	if len(tryBlock.Stmts) == 0 {
		lines = append(lines, "    pass")
	} else {
		tryLines, err := emitPythonCoreBlock(tryBlock)
		if err != nil {
			return nil, err
		}
		for _, line := range tryLines {
			lines = append(lines, "    "+line)
		}
	}
	lines = append(lines, fmt.Sprintf("except Exception as %s:", pyName(errorRef)))
	catchBlock := CoreBlock{}
	if len(stmt.Regions[1].Blocks) > 0 {
		catchBlock = stmt.Regions[1].Blocks[0]
	}
	if len(catchBlock.Stmts) == 0 {
		lines = append(lines, "    pass")
	} else {
		catchLines, err := emitPythonCoreBlock(catchBlock)
		if err != nil {
			return nil, err
		}
		for _, line := range catchLines {
			lines = append(lines, "    "+line)
		}
	}
	return lines, nil
}

func emitPythonCoreBlock(block CoreBlock) ([]string, error) {
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitPythonCoreStmt(child)
		if err != nil {
			return nil, err
		}
		lines = append(lines, childLines...)
	}
	return lines, nil
}

func firstBodyBlock(stmt CoreStmt) CoreBlock {
	if len(stmt.Regions) == 0 || len(stmt.Regions[0].Blocks) == 0 {
		return CoreBlock{}
	}
	return stmt.Regions[0].Blocks[0]
}

func pythonCallee(callee string) string {
	if strings.HasPrefix(callee, "@") {
		return "_" + Symbol(callee)
	}
	if target, ok := coreIntrinsicPython[CoreIntrinsic(callee)]; ok {
		return target
	}
	return callee
}

func findRegion(op Operation, name string) (Region, bool) {
	for _, region := range op.Regions {
		if region.Name == name {
			return region, true
		}
	}
	return Region{}, false
}

func pythonAttrValues(op Operation, name string) []string {
	attr, ok := Attr(op, name)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(attr.Values))
	for _, value := range attr.Values {
		out = append(out, pythonLiteral(value))
	}
	return out
}

func pythonAttrValue(op Operation, name string) string {
	attr, ok := Attr(op, name)
	if !ok {
		return "None"
	}
	return pythonLiteral(attr.Value)
}

func pythonLiteral(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return "None"
	case string:
		if strings.HasPrefix(v, "%") {
			return pyName(v)
		}
		return strconv.Quote(v)
	case bool:
		if v {
			return "True"
		}
		return "False"
	case int:
		return strconv.Itoa(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return strconv.Quote(fmt.Sprint(v))
	}
}

func pyName(value string) string {
	return strings.TrimPrefix(value, "%")
}

func pythonType(typ Type) string {
	switch typ.Name {
	case "string":
		return "str"
	case "bool":
		return "bool"
	case "i64":
		return "int"
	case "f64":
		return "float"
	case "json":
		return "Any"
	case "void":
		return "None"
	case "list":
		return "list[Any]"
	case "map":
		return "dict[str, Any]"
	default:
		return typ.Name
	}
}

func pythonArgDefault(funcName, argName string) string {
	switch funcName {
	case "to_json_schema":
		if argName == "schema_title" {
			return strconv.Quote("Schema")
		}
		if argName == "options" {
			return "None"
		}
	case "validate_fields":
		if argName == "context" {
			return strconv.Quote("value")
		}
	case "validate_value":
		if argName == "path" {
			return "None"
		}
	case "render_template_content":
		if argName == "vars" {
			return "None"
		}
		if argName == "context" {
			return strconv.Quote("inline-template")
		}
	case "collect_template_variable_names":
		if argName == "context" {
			return strconv.Quote("template-vars")
		}
	case "validate_prompt_template_syntax":
		if argName == "context" {
			return strconv.Quote("template-validate")
		}
		if argName == "required_variables" {
			return "None"
		}
	case "render_prompt":
		if argName == "options" {
			return "None"
		}
	case "merge_model_config":
		if argName == "override" || argName == "options" {
			return "None"
		}
	case "openai_normalize_chat_response", "openai_normalize_embed_response":
		if argName == "ai_name" {
			return strconv.Quote("openai")
		}
		if argName == "model" {
			return "None"
		}
	case "openai_normalize_stream_delta":
		if argName == "ai_name" {
			return strconv.Quote("openai")
		}
		if argName == "model" {
			return "None"
		}
	case "openai_normalize_error":
		if argName == "request" {
			return "None"
		}
	case "build_chat_request", "build_embed_request":
		if argName == "options" {
			return "None"
		}
	}
	return ""
}

func pythonReturnType(signature string) string {
	idx := strings.LastIndex(signature, "->")
	if idx < 0 {
		return "Any"
	}
	ret := strings.TrimSpace(signature[idx+2:])
	ret = strings.TrimSuffix(ret, " throws")
	ret = strings.TrimSpace(ret)
	switch {
	case ret == "void":
		return "None"
	case ret == "string":
		return "str"
	case ret == "bool":
		return "bool"
	case ret == "json":
		return "Any"
	case ret == "AxFunctionJSONSchema":
		return "dict[str, Any]"
	case strings.HasPrefix(ret, "list<"):
		return "list[Any]"
	default:
		return ret
	}
}
