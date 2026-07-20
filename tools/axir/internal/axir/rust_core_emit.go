package axir

import (
	"fmt"
	"strconv"
	"strings"
)

// coreIntrinsicRust maps intrinsic names to the Rust helper functions defined
// in the CoreValue runtime section of the rust template. Unlike the other
// targets, an unmapped intrinsic is a compile-time error so a module
// migration cannot silently emit calls to helpers that do not exist.
var coreIntrinsicRust = map[CoreIntrinsic]string{
	"intrinsic.not":         "core_not",
	"intrinsic.and":         "core_and",
	"intrinsic.or":          "core_or",
	"intrinsic.eq":          "core_eq",
	"intrinsic.ne":          "core_ne",
	"intrinsic.lt":          "core_lt",
	"intrinsic.lte":         "core_lte",
	"intrinsic.gt":          "core_gt",
	"intrinsic.gte":         "core_gte",
	"intrinsic.add":         "core_add",
	"intrinsic.len":         "core_len",
	"intrinsic.truthy":      "core_truthy_value",
	"intrinsic.is_none":     "core_is_none",
	"intrinsic.is_not_none": "core_is_not_none",
	"intrinsic.none":        "core_none",
	"intrinsic.coalesce":    "core_coalesce",
	"intrinsic.contains":    "core_contains",
	"intrinsic.list.get":    "core_list_get",
	"intrinsic.record.new":  "core_record_new",

	"intrinsic.error.signature":  "core_signature_error",
	"intrinsic.error.runtime":    "core_runtime_error",
	"intrinsic.error.validation": "core_validation_error",

	"intrinsic.string.format":                         "core_string_format",
	"intrinsic.string.replace":                        "core_string_replace",
	"intrinsic.string.slice":                          "core_string_slice",
	"intrinsic.string.default_if_empty":               "core_string_default_if_empty",
	"intrinsic.string.words":                          "core_string_words",
	"intrinsic.string.split_trim_nonempty":            "core_string_split_trim_nonempty",
	"intrinsic.string.split_outside_quotes":           "core_string_split_outside_quotes",
	"intrinsic.string.split_top_level":                 "core_string_split_top_level",
	"intrinsic.string.extract_leading_group":           "core_string_extract_leading_group",
	"intrinsic.string.split_once":                     "core_string_split_once",
	"intrinsic.string.remove_suffix":                  "core_string_remove_suffix",
	"intrinsic.string.find_outside_quotes":            "core_string_find_outside_quotes",
	"intrinsic.string.extract_quoted_suffix":          "core_string_extract_quoted_suffix",
	"intrinsic.string.consume_optional_quoted_prefix": "core_string_consume_optional_quoted_prefix",
	"intrinsic.fields.from_map":                       "core_fields_from_map",
	"intrinsic.description.append":                    "core_description_append",
	"intrinsic.field.item":                            "core_field_item",
	"intrinsic.map.contains":                          "core_map_contains",
	"intrinsic.map.get":                               "core_map_get",
	"intrinsic.map.update":                            "core_map_update",
	"intrinsic.media.valid_image":                     "core_media_valid_image",
	"intrinsic.media.valid_audio":                     "core_media_valid_audio",
	"intrinsic.media.valid_file":                      "core_media_valid_file",
	"intrinsic.media.valid_url_shape":                 "core_media_valid_url_shape",
	"intrinsic.url.valid":                             "core_url_valid",
	"intrinsic.template.parse":                        "core_template_parse",
	"intrinsic.template.render_tree":                  "core_template_render_tree",
	"intrinsic.template.collect_vars":                 "core_template_collect_vars",
	"intrinsic.template.validate":                     "core_template_validate",
	"intrinsic.prompt.structured":                     "core_prompt_structured",
	"intrinsic.prompt.user_content":                   "core_prompt_user_content",
	"intrinsic.json.parse":                            "core_json_parse",
	"intrinsic.json.stringify":                        "core_json_stringify",
	"intrinsic.map.delete":                            "core_map_delete",
	"intrinsic.map.merge":                             "core_map_merge",
	"intrinsic.mul":                                   "core_mul",
	"intrinsic.string.lower":                          "core_string_lower",
	"intrinsic.string.starts_with":                    "core_string_starts_with",
	"intrinsic.string.ends_with":                      "core_string_ends_with",
	"intrinsic.string.str":                            "core_string_str",
	"intrinsic.string.join":                           "core_string_join_intrinsic",
	"intrinsic.ai.error.auth":                         "core_ai_error_auth",
	"intrinsic.ai.error.refusal":                      "core_ai_error_refusal",
	"intrinsic.ai.error.response":                     "core_ai_error_response",
	"intrinsic.ai.error.status":                       "core_ai_error_status",
	"intrinsic.ai.error.stream":                       "core_ai_error_stream",
	"intrinsic.ai.error.timeout":                      "core_ai_error_timeout",
	"intrinsic.ai.error.unsupported":                  "core_ai_error_unsupported",
	"intrinsic.stream.event_content_parts":            "core_stream_event_content_parts",
	"intrinsic.agent.stage_chat_log":                  "core_agent_stage_chat_log",
	"intrinsic.agent.stage_forward":                   "core_agent_stage_forward",
	"intrinsic.agent.stage_traces":                    "core_agent_stage_traces",
	"intrinsic.agent.stage_usage":                     "core_agent_stage_usage",
	"intrinsic.json.stable_stringify":                 "core_json_stable_stringify",
	"intrinsic.program.apply_components":              "core_program_apply_components",
	"intrinsic.program.components":                    "core_program_components",
	"intrinsic.string.split":                          "core_string_split",
	"intrinsic.agent.callable.invoke":                 "core_agent_callable_invoke",
	"intrinsic.agent.clarification_error":             "core_agent_clarification_error",
	"intrinsic.agent.memory_search":                   "core_agent_memory_search",
	"intrinsic.agent.skill_search":                    "core_agent_skill_search",
	"intrinsic.agent.transcribe":                      "core_agent_transcribe",
	"intrinsic.agent.runtime.create_session":          "core_agent_runtime_create_session",
	"intrinsic.agent.runtime.execute":                 "core_agent_runtime_execute",
	"intrinsic.agent.runtime.inspect":                 "core_agent_runtime_inspect",
	"intrinsic.agent.runtime.export_state":            "core_agent_runtime_export_state",
	"intrinsic.agent.runtime.restore_state":           "core_agent_runtime_restore_state",
	"intrinsic.agent.runtime.close":                   "core_agent_runtime_close",
	"intrinsic.json.pretty":                           "core_json_pretty",
	"intrinsic.regex.replace":                         "core_regex_replace",
	"intrinsic.string.lower_camel":                    "core_string_lower_camel",
	"intrinsic.string.title_from_camel":               "core_string_title_from_camel",
	"intrinsic.div":                                   "core_div",
	"intrinsic.exception.message":                     "core_exception_message",
	"intrinsic.map.keys":                              "core_map_keys",
	"intrinsic.map.values":                            "core_map_values",
	"intrinsic.retry.sleep":                           "core_retry_sleep",
	"intrinsic.object.call_method":                    "core_object_call_method",
	"intrinsic.tool.invoke":                           "core_tool_invoke",
	"intrinsic.ai.complete_once":                      "core_ai_complete_once",
	"intrinsic.axgen.apply_context_cache":             "core_axgen_apply_context_cache",
	"intrinsic.axgen.apply_field_processors":          "core_axgen_apply_field_processors",
	"intrinsic.axgen.memory_add_correction":           "core_axgen_memory_add_correction",
	"intrinsic.axgen.memory_add_function_result":      "core_axgen_memory_add_function_result",
	"intrinsic.axgen.memory_add_request":              "core_axgen_memory_add_request",
	"intrinsic.axgen.memory_add_response":             "core_axgen_memory_add_response",
	"intrinsic.axgen.memory_cleanup_corrections":      "core_axgen_memory_cleanup_corrections",
	"intrinsic.axgen.record_chat_log":                 "core_axgen_record_chat_log",
	"intrinsic.axgen.record_function_call":            "core_axgen_record_function_call",
	"intrinsic.axgen.record_trace":                    "core_axgen_record_trace",
	"intrinsic.axgen.render_demos":                    "core_axgen_render_demos",
	"intrinsic.axgen.render_examples":                 "core_axgen_render_examples",
	"intrinsic.axgen.run_assertions":                  "core_axgen_run_assertions",
	"intrinsic.axgen.run_streaming_assertions":        "core_axgen_run_streaming_assertions",
	"intrinsic.axgen.should_continue_steps":           "core_axgen_should_continue_steps",
}

// BuildRustCore emits every Core function into the rust template.
func BuildRustCore(model AxRuntimeModel) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	names := CoreFuncNames(specs)
	var b strings.Builder
	b.WriteString("// BEGIN AXIR CORE EMITTED FUNCTIONS\n")
	emitted := 0
	for _, spec := range specs {
		text, err := emitRustCoreFunction(names, model.Symbols[spec.Symbol], spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
		b.WriteByte('\n')
		emitted++
	}
	fmt.Fprintf(&b, "// END AXIR CORE EMITTED FUNCTIONS (%d of %d core functions)\n", emitted, len(specs))
	return mustInject(rustLib, "// AXIR_CORE_RUST_FUNCTIONS\n", b.String(), "rustLib")
}

type rustEmitCtx struct {
	names map[string]string
	// closureDepth > 0 means statements are inside a core.try closure, where
	// non-local exits travel through CoreFlow instead of plain return.
	closureDepth int
	// loopInClosure reports whether the innermost loop (if any) is inside the
	// current closure; break/continue inside it stay native.
	loopInClosure []bool
}

func (ctx *rustEmitCtx) inClosure() bool { return ctx.closureDepth > 0 }

func (ctx *rustEmitCtx) loopIsLocal() bool {
	if len(ctx.loopInClosure) == 0 {
		return false
	}
	return ctx.loopInClosure[len(ctx.loopInClosure)-1]
}

func emitRustCoreFunction(names map[string]string, op Operation, name string) (string, error) {
	body, err := BuildCoreBody(op)
	if err != nil {
		return "", fmt.Errorf("@%s: %w", op.Symbol, err)
	}
	if len(body.Blocks) == 0 {
		return "", fmt.Errorf("@%s has no Core body blocks", op.Symbol)
	}
	block := body.Blocks[0]
	locals := map[string]bool{}
	collectGoLocals(block, locals)
	var b strings.Builder
	b.WriteString("#[allow(unused_variables, unused_assignments, unused_mut, unreachable_code, clippy::all)]\n")
	fmt.Fprintf(&b, "fn %s(args: &[CoreValue]) -> Result<CoreValue, AxError> {\n", name)
	fmt.Fprintf(&b, "    axir_coverage_mark(%q);\n", name)
	declared := map[string]bool{}
	for i, arg := range block.Args {
		argName := rustName("%" + arg.Name)
		declared[argName] = true
		fmt.Fprintf(&b, "    let mut %s = core_arg(args, %d);\n", argName, i)
	}
	for _, local := range sortedKeys(locals) {
		if declared[local] {
			continue
		}
		fmt.Fprintf(&b, "    let mut %s = CoreValue::Null;\n", local)
	}
	ctx := &rustEmitCtx{names: names}
	for _, stmt := range block.Stmts {
		lines, err := emitRustCoreStmt(ctx, stmt)
		if err != nil {
			return "", fmt.Errorf("@%s: %w", op.Symbol, err)
		}
		for _, line := range lines {
			fmt.Fprintf(&b, "    %s\n", line)
		}
	}
	b.WriteString("}\n")
	return b.String(), nil
}

func emitRustCoreStmt(ctx *rustEmitCtx, stmt CoreStmt) ([]string, error) {
	switch stmt.Kind {
	case "break":
		if ctx.inClosure() && !ctx.loopIsLocal() {
			return []string{"return Ok(CoreFlow::Break);"}, nil
		}
		return []string{"break;"}, nil
	case "continue":
		if ctx.inClosure() && !ctx.loopIsLocal() {
			return []string{"return Ok(CoreFlow::Continue);"}, nil
		}
		return []string{"continue;"}, nil
	case "call":
		callExpr, err := rustCallExpr(ctx, stmt)
		if err != nil {
			return nil, err
		}
		if stmt.Result != "" {
			return []string{fmt.Sprintf("%s = %s;", rustName(stmt.Result), callExpr)}, nil
		}
		return []string{callExpr + ";"}, nil
	case "const", "let":
		return []string{fmt.Sprintf("%s = %s;", rustName(stmt.Result), rustAttrValue(stmt.Op, "value"))}, nil
	case "get":
		defaultValue := "CoreValue::Null"
		if _, ok := Attr(stmt.Op, "default"); ok {
			defaultValue = rustAttrValue(stmt.Op, "default")
		}
		return []string{fmt.Sprintf("%s = core_get(&%s, &%s, %s);",
			rustName(stmt.Result), rustName(stmt.Target), rustLiteral(stmt.Key), defaultValue)}, nil
	case "map":
		return []string{fmt.Sprintf("%s = CoreValue::new_map();", rustName(stmt.Result))}, nil
	case "list":
		return []string{fmt.Sprintf("%s = CoreValue::new_list();", rustName(stmt.Result))}, nil
	case "append":
		return []string{fmt.Sprintf("core_append(&%s, %s)?;", rustName(stmt.Target), rustLiteral(stmt.Value))}, nil
	case "regex_match":
		return []string{fmt.Sprintf("%s = core_regex_match(%s, &%s)?;",
			rustName(stmt.Result), rustAttrValue(stmt.Op, "pattern"), rustName(valueRef(stmt.Value)))}, nil
	case "string_join":
		return []string{fmt.Sprintf("%s = core_string_join(&%s, &%s)?;",
			rustName(stmt.Result), rustAttrValue(stmt.Op, "sep"), rustName(valueRef(stmt.Value)))}, nil
	case "string_trim":
		return []string{fmt.Sprintf("%s = core_string_trim(&%s);", rustName(stmt.Result), rustName(valueRef(stmt.Value)))}, nil
	case "type_is":
		return []string{fmt.Sprintf("%s = core_type_is(&%s, %s);",
			rustName(stmt.Result), rustName(valueRef(stmt.Value)), rustAttrValue(stmt.Op, "type"))}, nil
	case "set":
		return []string{fmt.Sprintf("core_set(&%s, %s, %s)?;",
			rustName(stmt.Target), rustLiteral(stmt.Key), rustLiteral(stmt.Value))}, nil
	case "for":
		return emitRustFor(ctx, stmt)
	case "if":
		return emitRustIf(ctx, stmt)
	case "loop":
		return emitRustLoop(ctx, stmt)
	case "return":
		value := "CoreValue::Null"
		if _, ok := Attr(stmt.Op, "value"); ok {
			value = rustAttrValue(stmt.Op, "value")
		}
		if ctx.inClosure() {
			return []string{fmt.Sprintf("return Ok(CoreFlow::Return(%s));", value)}, nil
		}
		return []string{fmt.Sprintf("return Ok(%s);", value)}, nil
	case "raise":
		if _, ok := Attr(stmt.Op, "error"); ok {
			return []string{fmt.Sprintf("return Err(core_as_error(&%s));", rustName(valueRef(rawAttr(stmt.Op, "error"))))}, nil
		}
		return []string{fmt.Sprintf("return Err(AxError::runtime(%s));", rustStringLiteral(stmt.Message))}, nil
	case "try":
		return emitRustTry(ctx, stmt)
	default:
		return nil, fmt.Errorf("unsupported Rust Core op %q", stmt.Op.Name)
	}
}

func emitRustRegion(ctx *rustEmitCtx, body CoreBody) ([]string, error) {
	var lines []string
	for _, block := range body.Blocks {
		for _, stmt := range block.Stmts {
			stmtLines, err := emitRustCoreStmt(ctx, stmt)
			if err != nil {
				return nil, err
			}
			for _, line := range stmtLines {
				lines = append(lines, "    "+line)
			}
		}
	}
	return lines, nil
}

func emitRustFor(ctx *rustEmitCtx, stmt CoreStmt) ([]string, error) {
	if stmt.Item == "" || stmt.Iter == "" {
		return nil, fmt.Errorf("core.for missing item or in")
	}
	item := rustName(stmt.Item)
	lines := []string{fmt.Sprintf("for %s in core_iter(&%s)? {", item, rustName(stmt.Iter))}
	lines = append(lines, fmt.Sprintf("    let mut %s = %s;", item, item))
	ctx.loopInClosure = append(ctx.loopInClosure, ctx.inClosure())
	body, err := emitRustRegion(ctx, firstRegionBody(stmt))
	ctx.loopInClosure = ctx.loopInClosure[:len(ctx.loopInClosure)-1]
	if err != nil {
		return nil, err
	}
	lines = append(lines, body...)
	lines = append(lines, "}")
	return lines, nil
}

func emitRustLoop(ctx *rustEmitCtx, stmt CoreStmt) ([]string, error) {
	lines := []string{"loop {"}
	ctx.loopInClosure = append(ctx.loopInClosure, ctx.inClosure())
	body, err := emitRustRegion(ctx, firstRegionBody(stmt))
	ctx.loopInClosure = ctx.loopInClosure[:len(ctx.loopInClosure)-1]
	if err != nil {
		return nil, err
	}
	lines = append(lines, body...)
	lines = append(lines, "}")
	return lines, nil
}

func emitRustIf(ctx *rustEmitCtx, stmt CoreStmt) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.if must have then and else regions")
	}
	lines := []string{fmt.Sprintf("if core_truthy(&%s) {", rustName(stmt.Cond))}
	thenLines, err := emitRustRegion(ctx, stmt.Regions[0])
	if err != nil {
		return nil, err
	}
	lines = append(lines, thenLines...)
	elseLines, err := emitRustRegion(ctx, stmt.Regions[1])
	if err != nil {
		return nil, err
	}
	if len(elseLines) > 0 {
		lines = append(lines, "} else {")
		lines = append(lines, elseLines...)
	}
	lines = append(lines, "}")
	return lines, nil
}

func emitRustTry(ctx *rustEmitCtx, stmt CoreStmt) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must have body and catch regions")
	}
	errName := rustName(AttrString(stmt.Op, "error"))
	var lines []string
	if errName == "" {
		errName = "v_core_err"
		lines = append(lines, "let mut v_core_err = CoreValue::Null;", "let _ = &v_core_err;")
	}
	lines = append(lines, "let __core_try: Result<CoreFlow, AxError> = (|| {")
	ctx.closureDepth++
	body, err := emitRustRegion(ctx, stmt.Regions[0])
	ctx.closureDepth--
	if err != nil {
		return nil, err
	}
	lines = append(lines, body...)
	lines = append(lines, "    Ok(CoreFlow::Normal)")
	lines = append(lines, "})();")
	lines = append(lines, "match __core_try {")
	lines = append(lines, "    Ok(CoreFlow::Normal) => {}")
	if ctx.inClosure() {
		lines = append(lines, "    Ok(CoreFlow::Return(value)) => return Ok(CoreFlow::Return(value)),")
		lines = append(lines, "    Ok(CoreFlow::Break) => return Ok(CoreFlow::Break),")
		lines = append(lines, "    Ok(CoreFlow::Continue) => return Ok(CoreFlow::Continue),")
	} else {
		lines = append(lines, "    Ok(CoreFlow::Return(value)) => return Ok(value),")
		breakLine := "    Ok(CoreFlow::Break) => break,"
		continueLine := "    Ok(CoreFlow::Continue) => continue,"
		if len(ctx.loopInClosure) == 0 {
			breakLine = "    Ok(CoreFlow::Break) => unreachable!(\"break outside loop\"),"
			continueLine = "    Ok(CoreFlow::Continue) => unreachable!(\"continue outside loop\"),"
		}
		lines = append(lines, breakLine, continueLine)
	}
	lines = append(lines, "    Err(__core_caught) => {")
	lines = append(lines, fmt.Sprintf("        %s = CoreValue::Error(std::rc::Rc::new(__core_caught));", errName))
	catch, err := emitRustRegion(ctx, stmt.Regions[1])
	if err != nil {
		return nil, err
	}
	for _, line := range catch {
		lines = append(lines, "    "+line)
	}
	lines = append(lines, "    }")
	lines = append(lines, "}")
	return lines, nil
}

func rustCallExpr(ctx *rustEmitCtx, stmt CoreStmt) (string, error) {
	args := make([]string, 0, len(stmt.Args))
	for _, arg := range stmt.Args {
		args = append(args, rustLiteral(arg))
	}
	argList := "&[" + strings.Join(args, ", ") + "]"
	callee := stmt.Callee
	if strings.HasPrefix(callee, "@") {
		symbol := Symbol(callee)
		name, ok := ctx.names[symbol]
		if !ok {
			return "", fmt.Errorf("call to unknown core symbol @%s", symbol)
		}
		return fmt.Sprintf("%s(%s)?", name, argList), nil
	}
	if strings.HasPrefix(callee, "intrinsic.") {
		helper, ok := coreIntrinsicRust[CoreIntrinsic(callee)]
		if !ok {
			return "", fmt.Errorf("intrinsic %q has no Rust helper yet; add it to coreIntrinsicRust and the CoreValue runtime", callee)
		}
		return fmt.Sprintf("%s(%s)?", helper, argList), nil
	}
	return "", fmt.Errorf("unsupported Rust callee %q", callee)
}

func firstRegionBody(stmt CoreStmt) CoreBody {
	if len(stmt.Regions) > 0 {
		return stmt.Regions[0]
	}
	return CoreBody{}
}

func valueRef(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func rawAttr(op Operation, name string) interface{} {
	attr, ok := Attr(op, name)
	if !ok {
		return nil
	}
	return attr.Value
}

func rustAttrValue(op Operation, name string) string {
	attr, ok := Attr(op, name)
	if !ok {
		return "CoreValue::Null"
	}
	return rustLiteral(attr.Value)
}

func rustLiteral(value interface{}) string {
	switch v := value.(type) {
	case string:
		if strings.HasPrefix(v, "%") {
			return rustName(v) + ".clone()"
		}
		return fmt.Sprintf("CoreValue::from(%s)", rustStringLiteral(v))
	case bool:
		return fmt.Sprintf("CoreValue::Bool(%t)", v)
	case float64:
		return fmt.Sprintf("CoreValue::Num(%sf64)", strconv.FormatFloat(v, 'g', -1, 64))
	case int:
		return fmt.Sprintf("CoreValue::Num(%df64)", v)
	case int64:
		return fmt.Sprintf("CoreValue::Num(%df64)", v)
	case nil:
		return "CoreValue::Null"
	default:
		return "CoreValue::Null"
	}
}

func rustStringLiteral(value string) string {
	return strconv.Quote(value)
}

func rustName(value string) string {
	if value == "" {
		return ""
	}
	return "v_" + strings.TrimPrefix(value, "%")
}
