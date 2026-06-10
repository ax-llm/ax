package axir

import (
	"fmt"
	"strconv"
	"strings"
)

func BuildCppCore(model AxRuntimeModel) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	core, err := emitCppCoreFunctions(model, specs, CoreFuncNames(specs))
	if err != nil {
		return "", err
	}
	return mustInject(cppRuntime, "// AXIR_CORE_CPP_FUNCTIONS\n", core, "cppRuntime")
}

// BuildCppHeader injects the emitted Core function declarations into the
// public header so the hand-maintained declaration list cannot drift from
// the registry.
func BuildCppHeader(model AxRuntimeModel) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	decls, err := emitCppCoreDeclarations(model, specs)
	if err != nil {
		return "", err
	}
	return mustInject(cppHeader, "  // AXIR_CORE_CPP_DECLARATIONS\n", decls, "cppHeader")
}

func emitCppCoreDeclarations(model AxRuntimeModel, specs []CoreFuncSpec) (string, error) {
	var b strings.Builder
	b.WriteString("  // BEGIN AXIR CORE EMITTED DECLARATIONS\n")
	for _, spec := range specs {
		body, err := BuildCoreBody(model.Symbols[spec.Symbol])
		if err != nil {
			return "", fmt.Errorf("@%s: %w", spec.Symbol, err)
		}
		if len(body.Blocks) == 0 {
			return "", fmt.Errorf("@%s has no Core body blocks", spec.Symbol)
		}
		var args []string
		for _, arg := range body.Blocks[0].Args {
			args = append(args, "Value "+cppName("%"+arg.Name))
		}
		fmt.Fprintf(&b, "  static Value %s(%s);\n", spec.Name, strings.Join(args, ", "))
	}
	b.WriteString("  // END AXIR CORE EMITTED DECLARATIONS\n")
	return b.String(), nil
}

func emitCppCoreFunctions(model AxRuntimeModel, specs []CoreFuncSpec, names map[string]string) (string, error) {
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
		text, err := emitCppCoreFunction(names, op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	b.WriteString("// END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitCppCoreFunction(names map[string]string, op Operation, name string) (string, error) {
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
		lines, err := emitCppCoreStmt(names, stmt, declared)
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

func emitCppCoreStmt(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"break;"}, nil
	case "continue":
		return []string{"continue;"}, nil
	case "call":
		callee := cppCallee(names, stmt.Callee)
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
		return emitCppFor(names, stmt, declared)
	case "if":
		return emitCppIf(names, stmt, declared)
	case "loop":
		return emitCppLoop(names, stmt, declared)
	case "try":
		return emitCppTry(names, stmt, declared)
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

func emitCppFor(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Item == "" || stmt.Iter == "" {
		return nil, fmt.Errorf("core.for missing item or in")
	}
	item := cppName(stmt.Item)
	lines := []string{fmt.Sprintf("for (auto %s : Core::iter(%s)) {", item, cppLiteral(stmt.Iter))}
	childDeclared := copyCppScope(declared)
	childDeclared[item] = true
	body := firstBodyBlock(stmt)
	childLines, err := emitCppRegionBlock(names, body, childDeclared)
	if err != nil {
		return nil, err
	}
	lines = append(lines, childLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitCppIf(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	cond := cppLiteral(stmt.Cond)
	lines := []string{fmt.Sprintf("if (Core::truthy(%s)) {", cond)}
	thenLines, err := emitCppRegionBlock(names, firstBodyBlock(stmt), copyCppScope(declared))
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
		elseLines, err := emitCppRegionBlock(names, elseBlock, copyCppScope(declared))
		if err != nil {
			return nil, err
		}
		lines = append(lines, elseLines...)
		lines = append(lines, "}")
	}
	return lines, nil
}

func emitCppLoop(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	body := firstBodyBlock(stmt)
	lines := []string{"while (true) {"}
	bodyLines, err := emitCppRegionBlock(names, body, copyCppScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, bodyLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitCppTry(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
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
	tryLines, err := emitCppRegionBlock(names, tryBlock, copyCppScope(declared))
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
	catchLines, err := emitCppRegionBlock(names, catchBlock, catchDeclared)
	if err != nil {
		return nil, err
	}
	lines = append(lines, catchLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitCppRegionBlock(names map[string]string, block CoreBlock, declared map[string]bool) ([]string, error) {
	if len(block.Stmts) == 0 {
		return []string{"  // empty"}, nil
	}
	lines, err := emitCppCoreBlock(names, block, declared)
	if err != nil {
		return nil, err
	}
	for i := range lines {
		lines[i] = "  " + lines[i]
	}
	return lines, nil
}

func emitCppCoreBlock(names map[string]string, block CoreBlock, declared map[string]bool) ([]string, error) {
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitCppCoreStmt(names, child, declared)
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

func cppCallee(names map[string]string, callee string) string {
	if strings.HasPrefix(callee, "@") {
		if name, ok := names[Symbol(callee)]; ok {
			return "Core::" + name
		}
		return "Core::_" + Symbol(callee)
	}
	if target, ok := coreIntrinsicCpp[CoreIntrinsic(callee)]; ok {
		return target
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
