package axir

import (
	"fmt"
	"strings"
)

type CoreBody struct {
	FuncSymbol string
	Blocks     []CoreBlock
}

type CoreBlock struct {
	Name  string
	Args  []Value
	Stmts []CoreStmt
	Line  int
}

type CoreStmt struct {
	Op      Operation
	Kind    string
	Result  string
	Callee  string
	Args    []interface{}
	Value   interface{}
	Target  string
	Key     string
	Default interface{}
	Item    string
	Iter    string
	Cond    string
	Message string
	Regions []CoreBody
	Line    int
}

type CoreIntrinsic string

const (
	IntrinsicNot                    CoreIntrinsic = "intrinsic.not"
	IntrinsicAnd                    CoreIntrinsic = "intrinsic.and"
	IntrinsicOr                     CoreIntrinsic = "intrinsic.or"
	IntrinsicEq                     CoreIntrinsic = "intrinsic.eq"
	IntrinsicNe                     CoreIntrinsic = "intrinsic.ne"
	IntrinsicLT                     CoreIntrinsic = "intrinsic.lt"
	IntrinsicLTE                    CoreIntrinsic = "intrinsic.lte"
	IntrinsicGT                     CoreIntrinsic = "intrinsic.gt"
	IntrinsicGTE                    CoreIntrinsic = "intrinsic.gte"
	IntrinsicAdd                    CoreIntrinsic = "intrinsic.add"
	IntrinsicContains               CoreIntrinsic = "intrinsic.contains"
	IntrinsicLen                    CoreIntrinsic = "intrinsic.len"
	IntrinsicTruthy                 CoreIntrinsic = "intrinsic.truthy"
	IntrinsicIsNone                 CoreIntrinsic = "intrinsic.is_none"
	IntrinsicIsNotNone              CoreIntrinsic = "intrinsic.is_not_none"
	IntrinsicNone                   CoreIntrinsic = "intrinsic.none"
	IntrinsicCoalesce               CoreIntrinsic = "intrinsic.coalesce"
	IntrinsicMapMerge               CoreIntrinsic = "intrinsic.map.merge"
	IntrinsicMapContains            CoreIntrinsic = "intrinsic.map.contains"
	IntrinsicMapGet                 CoreIntrinsic = "intrinsic.map.get"
	IntrinsicMapUpdate              CoreIntrinsic = "intrinsic.map.update"
	IntrinsicMapValues              CoreIntrinsic = "intrinsic.map.values"
	IntrinsicRecordNew              CoreIntrinsic = "intrinsic.record.new"
	IntrinsicObjectCallMethod       CoreIntrinsic = "intrinsic.object.call_method"
	IntrinsicAICompleteOnce         CoreIntrinsic = "intrinsic.ai.complete_once"
	IntrinsicRetrySleep             CoreIntrinsic = "intrinsic.retry.sleep"
	IntrinsicExceptionMessage       CoreIntrinsic = "intrinsic.exception.message"
	IntrinsicRuntimeError           CoreIntrinsic = "intrinsic.error.runtime"
	IntrinsicJSONParse              CoreIntrinsic = "intrinsic.json.parse"
	IntrinsicJSONStringify          CoreIntrinsic = "intrinsic.json.stringify"
	IntrinsicToolInvoke             CoreIntrinsic = "intrinsic.tool.invoke"
	IntrinsicAIErrorResponse        CoreIntrinsic = "intrinsic.ai.error.response"
	IntrinsicAIErrorRefusal         CoreIntrinsic = "intrinsic.ai.error.refusal"
	IntrinsicAIErrorStream          CoreIntrinsic = "intrinsic.ai.error.stream"
	IntrinsicAIErrorUnsupported     CoreIntrinsic = "intrinsic.ai.error.unsupported"
	IntrinsicAIErrorAuth            CoreIntrinsic = "intrinsic.ai.error.auth"
	IntrinsicAIErrorTimeout         CoreIntrinsic = "intrinsic.ai.error.timeout"
	IntrinsicAIErrorStatus          CoreIntrinsic = "intrinsic.ai.error.status"
	IntrinsicStringEndsWith         CoreIntrinsic = "intrinsic.string.ends_with"
	IntrinsicStringJoin             CoreIntrinsic = "intrinsic.string.join"
	IntrinsicStringFormat           CoreIntrinsic = "intrinsic.string.format"
	IntrinsicStringSlice            CoreIntrinsic = "intrinsic.string.slice"
	IntrinsicStringReplace          CoreIntrinsic = "intrinsic.string.replace"
	IntrinsicStringRemoveSuf        CoreIntrinsic = "intrinsic.string.remove_suffix"
	IntrinsicStringWords            CoreIntrinsic = "intrinsic.string.words"
	IntrinsicStringDefault          CoreIntrinsic = "intrinsic.string.default_if_empty"
	IntrinsicStringSplitOnce        CoreIntrinsic = "intrinsic.string.split_once"
	IntrinsicStringSplitTrim        CoreIntrinsic = "intrinsic.string.split_trim_nonempty"
	IntrinsicStringFindQuoted       CoreIntrinsic = "intrinsic.string.find_outside_quotes"
	IntrinsicStringSplitQuoted      CoreIntrinsic = "intrinsic.string.split_outside_quotes"
	IntrinsicStringConsumeOpt       CoreIntrinsic = "intrinsic.string.consume_optional_quoted_prefix"
	IntrinsicStringExtractSuf       CoreIntrinsic = "intrinsic.string.extract_quoted_suffix"
	IntrinsicStringSplit            CoreIntrinsic = "intrinsic.string.split"
	IntrinsicStringStartsWith       CoreIntrinsic = "intrinsic.string.starts_with"
	IntrinsicStringStr              CoreIntrinsic = "intrinsic.string.str"
	IntrinsicRegexReplace           CoreIntrinsic = "intrinsic.regex.replace"
	IntrinsicSortedStrings          CoreIntrinsic = "intrinsic.list.sorted_strings"
	IntrinsicJSONPretty             CoreIntrinsic = "intrinsic.json.pretty"
	IntrinsicTemplateParse          CoreIntrinsic = "intrinsic.template.parse"
	IntrinsicTemplateRender         CoreIntrinsic = "intrinsic.template.render_tree"
	IntrinsicTemplateCollect        CoreIntrinsic = "intrinsic.template.collect_vars"
	IntrinsicTemplateValidate       CoreIntrinsic = "intrinsic.template.validate"
	IntrinsicPromptStructured       CoreIntrinsic = "intrinsic.prompt.structured"
	IntrinsicPromptUserContent      CoreIntrinsic = "intrinsic.prompt.user_content"
	IntrinsicAxGenRenderExamples    CoreIntrinsic = "intrinsic.axgen.render_examples"
	IntrinsicAxGenRenderDemos       CoreIntrinsic = "intrinsic.axgen.render_demos"
	IntrinsicAxGenApplyProcessors   CoreIntrinsic = "intrinsic.axgen.apply_field_processors"
	IntrinsicAxGenRunAssertions     CoreIntrinsic = "intrinsic.axgen.run_assertions"
	IntrinsicAxGenRecordTrace       CoreIntrinsic = "intrinsic.axgen.record_trace"
	IntrinsicAxGenShouldContinue    CoreIntrinsic = "intrinsic.axgen.should_continue_steps"
	IntrinsicAxGenApplyCache        CoreIntrinsic = "intrinsic.axgen.apply_context_cache"
	IntrinsicAxGenMemoryRequest     CoreIntrinsic = "intrinsic.axgen.memory_add_request"
	IntrinsicAxGenMemoryResponse    CoreIntrinsic = "intrinsic.axgen.memory_add_response"
	IntrinsicAxGenMemoryFunction    CoreIntrinsic = "intrinsic.axgen.memory_add_function_result"
	IntrinsicAxGenMemoryCorrection  CoreIntrinsic = "intrinsic.axgen.memory_add_correction"
	IntrinsicAxGenCleanupCorrection CoreIntrinsic = "intrinsic.axgen.memory_cleanup_corrections"
	IntrinsicAxGenRecordChatLog     CoreIntrinsic = "intrinsic.axgen.record_chat_log"
	IntrinsicAxGenRecordFunction    CoreIntrinsic = "intrinsic.axgen.record_function_call"
	IntrinsicStreamEventParts       CoreIntrinsic = "intrinsic.stream.event_content_parts"
	IntrinsicDescriptionAppend      CoreIntrinsic = "intrinsic.description.append"
	IntrinsicURLValid               CoreIntrinsic = "intrinsic.url.valid"
	IntrinsicSignatureError         CoreIntrinsic = "intrinsic.error.signature"
	IntrinsicValidationError        CoreIntrinsic = "intrinsic.error.validation"
	IntrinsicListGet                CoreIntrinsic = "intrinsic.list.get"
	IntrinsicFieldItem              CoreIntrinsic = "intrinsic.field.item"
	IntrinsicNestedFields           CoreIntrinsic = "intrinsic.fields.from_map"
	IntrinsicValidImage             CoreIntrinsic = "intrinsic.media.valid_image"
	IntrinsicValidAudio             CoreIntrinsic = "intrinsic.media.valid_audio"
	IntrinsicValidFile              CoreIntrinsic = "intrinsic.media.valid_file"
	IntrinsicValidURLShape          CoreIntrinsic = "intrinsic.media.valid_url_shape"
)

var coreIntrinsicPython = map[CoreIntrinsic]string{
	IntrinsicNot:                    "_core_not",
	IntrinsicAnd:                    "_core_and",
	IntrinsicOr:                     "_core_or",
	IntrinsicEq:                     "_core_eq",
	IntrinsicNe:                     "_core_ne",
	IntrinsicLT:                     "_core_lt",
	IntrinsicLTE:                    "_core_lte",
	IntrinsicGT:                     "_core_gt",
	IntrinsicGTE:                    "_core_gte",
	IntrinsicAdd:                    "_core_add",
	IntrinsicContains:               "_core_contains",
	IntrinsicLen:                    "_core_len",
	IntrinsicTruthy:                 "_core_truthy",
	IntrinsicIsNone:                 "_core_is_none",
	IntrinsicIsNotNone:              "_core_is_not_none",
	IntrinsicNone:                   "_core_none",
	IntrinsicCoalesce:               "_core_coalesce",
	IntrinsicMapMerge:               "_core_map_merge",
	IntrinsicMapContains:            "_core_map_contains",
	IntrinsicMapGet:                 "_core_map_get",
	IntrinsicMapUpdate:              "_core_map_update",
	IntrinsicMapValues:              "_core_map_values",
	IntrinsicRecordNew:              "_core_record_new",
	IntrinsicObjectCallMethod:       "_core_object_call_method",
	IntrinsicAICompleteOnce:         "_core_ai_complete_once",
	IntrinsicRetrySleep:             "_core_retry_sleep",
	IntrinsicExceptionMessage:       "_core_exception_message",
	IntrinsicRuntimeError:           "_core_runtime_error",
	IntrinsicJSONParse:              "_core_json_parse",
	IntrinsicJSONStringify:          "_core_json_stringify",
	IntrinsicToolInvoke:             "_core_tool_invoke",
	IntrinsicAIErrorResponse:        "_core_ai_error_response",
	IntrinsicAIErrorRefusal:         "_core_ai_error_refusal",
	IntrinsicAIErrorStream:          "_core_ai_error_stream",
	IntrinsicAIErrorUnsupported:     "_core_ai_error_unsupported",
	IntrinsicAIErrorAuth:            "_core_ai_error_auth",
	IntrinsicAIErrorTimeout:         "_core_ai_error_timeout",
	IntrinsicAIErrorStatus:          "_core_ai_error_status",
	IntrinsicStringEndsWith:         "_core_string_ends_with",
	IntrinsicStringJoin:             "_core_string_join",
	IntrinsicStringFormat:           "_core_string_format",
	IntrinsicStringSlice:            "_core_string_slice",
	IntrinsicStringReplace:          "_core_string_replace",
	IntrinsicStringRemoveSuf:        "_core_string_remove_suffix",
	IntrinsicStringWords:            "_core_string_words",
	IntrinsicStringDefault:          "_core_string_default_if_empty",
	IntrinsicStringSplitOnce:        "_core_string_split_once",
	IntrinsicStringSplitTrim:        "_core_string_split_trim_nonempty",
	IntrinsicStringFindQuoted:       "_core_string_find_outside_quotes",
	IntrinsicStringSplitQuoted:      "_core_string_split_outside_quotes",
	IntrinsicStringConsumeOpt:       "_core_string_consume_optional_quoted_prefix",
	IntrinsicStringExtractSuf:       "_core_string_extract_quoted_suffix",
	IntrinsicStringSplit:            "_core_string_split",
	IntrinsicStringStartsWith:       "_core_string_starts_with",
	IntrinsicStringStr:              "_core_string_str",
	IntrinsicRegexReplace:           "_core_regex_replace",
	IntrinsicSortedStrings:          "_core_sorted_strings",
	IntrinsicJSONPretty:             "_core_json_pretty",
	IntrinsicTemplateParse:          "_core_template_parse",
	IntrinsicTemplateRender:         "_core_template_render_tree",
	IntrinsicTemplateCollect:        "_core_template_collect_vars",
	IntrinsicTemplateValidate:       "_core_template_validate",
	IntrinsicPromptStructured:       "_core_prompt_structured",
	IntrinsicPromptUserContent:      "_core_prompt_user_content",
	IntrinsicAxGenRenderExamples:    "_core_axgen_render_examples",
	IntrinsicAxGenRenderDemos:       "_core_axgen_render_demos",
	IntrinsicAxGenApplyProcessors:   "_core_axgen_apply_field_processors",
	IntrinsicAxGenRunAssertions:     "_core_axgen_run_assertions",
	IntrinsicAxGenRecordTrace:       "_core_axgen_record_trace",
	IntrinsicAxGenShouldContinue:    "_core_axgen_should_continue_steps",
	IntrinsicAxGenApplyCache:        "_core_axgen_apply_context_cache",
	IntrinsicAxGenMemoryRequest:     "_core_axgen_memory_add_request",
	IntrinsicAxGenMemoryResponse:    "_core_axgen_memory_add_response",
	IntrinsicAxGenMemoryFunction:    "_core_axgen_memory_add_function_result",
	IntrinsicAxGenMemoryCorrection:  "_core_axgen_memory_add_correction",
	IntrinsicAxGenCleanupCorrection: "_core_axgen_memory_cleanup_corrections",
	IntrinsicAxGenRecordChatLog:     "_core_axgen_record_chat_log",
	IntrinsicAxGenRecordFunction:    "_core_axgen_record_function_call",
	IntrinsicStreamEventParts:       "_core_stream_event_content_parts",
	IntrinsicDescriptionAppend:      "_core_description_append",
	IntrinsicURLValid:               "_core_url_valid",
	IntrinsicSignatureError:         "_core_signature_error",
	IntrinsicValidationError:        "_core_validation_error",
	IntrinsicListGet:                "_core_list_get",
	IntrinsicFieldItem:              "_core_field_item",
	IntrinsicNestedFields:           "_core_fields_from_map",
	IntrinsicValidImage:             "_valid_image",
	IntrinsicValidAudio:             "_valid_audio",
	IntrinsicValidFile:              "_valid_file",
	IntrinsicValidURLShape:          "_valid_url_shape",
}

var knownCoreIntrinsics = map[string]bool{
	"intrinsic.eq":                                    true,
	"intrinsic.ne":                                    true,
	"intrinsic.not":                                   true,
	"intrinsic.and":                                   true,
	"intrinsic.or":                                    true,
	"intrinsic.lt":                                    true,
	"intrinsic.lte":                                   true,
	"intrinsic.gt":                                    true,
	"intrinsic.gte":                                   true,
	"intrinsic.add":                                   true,
	"intrinsic.len":                                   true,
	"intrinsic.contains":                              true,
	"intrinsic.truthy":                                true,
	"intrinsic.is_none":                               true,
	"intrinsic.is_not_none":                           true,
	"intrinsic.none":                                  true,
	"intrinsic.coalesce":                              true,
	"intrinsic.map.merge":                             true,
	"intrinsic.map.contains":                          true,
	"intrinsic.map.get":                               true,
	"intrinsic.map.update":                            true,
	"intrinsic.map.values":                            true,
	"intrinsic.object.call_method":                    true,
	"intrinsic.ai.complete_once":                      true,
	"intrinsic.retry.sleep":                           true,
	"intrinsic.exception.message":                     true,
	"intrinsic.error.runtime":                         true,
	"intrinsic.json.parse":                            true,
	"intrinsic.json.stringify":                        true,
	"intrinsic.tool.invoke":                           true,
	"intrinsic.ai.error.response":                     true,
	"intrinsic.ai.error.refusal":                      true,
	"intrinsic.ai.error.stream":                       true,
	"intrinsic.ai.error.unsupported":                  true,
	"intrinsic.ai.error.auth":                         true,
	"intrinsic.ai.error.timeout":                      true,
	"intrinsic.ai.error.status":                       true,
	"intrinsic.description.append":                    true,
	"intrinsic.error.signature":                       true,
	"intrinsic.error.validation":                      true,
	"intrinsic.list.get":                              true,
	"intrinsic.field.item":                            true,
	"intrinsic.fields.from_map":                       true,
	"intrinsic.media.valid_audio":                     true,
	"intrinsic.media.valid_file":                      true,
	"intrinsic.media.valid_image":                     true,
	"intrinsic.media.valid_url_shape":                 true,
	"intrinsic.string.lower":                          true,
	"intrinsic.string.replace":                        true,
	"intrinsic.string.join":                           true,
	"intrinsic.string.slice":                          true,
	"intrinsic.string.ends_with":                      true,
	"intrinsic.string.format":                         true,
	"intrinsic.string.remove_suffix":                  true,
	"intrinsic.string.words":                          true,
	"intrinsic.string.default_if_empty":               true,
	"intrinsic.string.split_once":                     true,
	"intrinsic.string.split_trim_nonempty":            true,
	"intrinsic.string.find_outside_quotes":            true,
	"intrinsic.string.split_outside_quotes":           true,
	"intrinsic.string.consume_optional_quoted_prefix": true,
	"intrinsic.string.extract_quoted_suffix":          true,
	"intrinsic.string.split":                          true,
	"intrinsic.string.starts_with":                    true,
	"intrinsic.string.str":                            true,
	"intrinsic.regex.replace":                         true,
	"intrinsic.list.sorted_strings":                   true,
	"intrinsic.json.pretty":                           true,
	"intrinsic.template.parse":                        true,
	"intrinsic.template.render_tree":                  true,
	"intrinsic.template.collect_vars":                 true,
	"intrinsic.template.validate":                     true,
	"intrinsic.prompt.structured":                     true,
	"intrinsic.prompt.user_content":                   true,
	"intrinsic.axgen.render_examples":                 true,
	"intrinsic.axgen.render_demos":                    true,
	"intrinsic.axgen.apply_field_processors":          true,
	"intrinsic.axgen.run_assertions":                  true,
	"intrinsic.axgen.record_trace":                    true,
	"intrinsic.axgen.should_continue_steps":           true,
	"intrinsic.axgen.apply_context_cache":             true,
	"intrinsic.axgen.memory_add_request":              true,
	"intrinsic.axgen.memory_add_response":             true,
	"intrinsic.axgen.memory_add_function_result":      true,
	"intrinsic.axgen.memory_add_correction":           true,
	"intrinsic.axgen.memory_cleanup_corrections":      true,
	"intrinsic.axgen.record_chat_log":                 true,
	"intrinsic.axgen.record_function_call":            true,
	"intrinsic.stream.event_content_parts":            true,
	"intrinsic.url.valid":                             true,
	"intrinsic.type.is_json":                          true,
	"intrinsic.record.new":                            true,
}

func BuildCoreBody(op Operation) (CoreBody, error) {
	region, ok := findRegion(op, "body")
	if !ok {
		return CoreBody{}, fmt.Errorf("@%s has no body region", op.Symbol)
	}
	body := CoreBody{FuncSymbol: op.Symbol}
	for _, block := range region.Blocks {
		coreBlock := CoreBlock{Name: block.Name, Args: append([]Value(nil), block.Args...), Line: block.Line}
		for _, raw := range block.Ops {
			stmt, err := parseCoreStmt(raw)
			if err != nil {
				return body, err
			}
			coreBlock.Stmts = append(coreBlock.Stmts, stmt)
		}
		if err := validateCoreBlock(coreBlock, nil, 0); err != nil {
			return body, err
		}
		body.Blocks = append(body.Blocks, coreBlock)
	}
	return body, nil
}

func parseCoreStmt(op Operation) (CoreStmt, error) {
	if !coreBodyOps[op.Name] {
		return CoreStmt{}, fmt.Errorf("unsupported Core body op %q", op.Name)
	}
	stmt := CoreStmt{
		Op:      op,
		Kind:    strings.TrimPrefix(op.Name, "core."),
		Result:  AttrString(op, "result"),
		Callee:  AttrString(op, "callee"),
		Target:  AttrString(op, "target"),
		Key:     AttrString(op, "key"),
		Item:    AttrString(op, "item"),
		Iter:    AttrString(op, "in"),
		Cond:    AttrString(op, "condition"),
		Message: AttrString(op, "message"),
		Line:    op.Line,
	}
	if attr, ok := Attr(op, "value"); ok {
		stmt.Value = attr.Value
	}
	if attr, ok := Attr(op, "default"); ok {
		stmt.Default = attr.Value
	}
	if stmt.Kind == "call" {
		if stmt.Callee == "" {
			return stmt, fmt.Errorf("core.call missing callee")
		}
		if strings.HasPrefix(stmt.Callee, "_axir_") {
			return stmt, fmt.Errorf("core.call callee %q uses forbidden backend helper escape", stmt.Callee)
		}
		if strings.HasPrefix(stmt.Callee, "intrinsic.") && !knownCoreIntrinsics[stmt.Callee] {
			return stmt, fmt.Errorf("unknown Core intrinsic %q", stmt.Callee)
		}
	}
	switch stmt.Kind {
	case "if":
		if len(op.Regions) != 2 {
			return stmt, fmt.Errorf("core.if must contain exactly then and else regions")
		}
	case "loop":
		if len(op.Regions) != 1 {
			return stmt, fmt.Errorf("core.loop must contain exactly one body region")
		}
	case "try":
		if len(op.Regions) != 2 {
			return stmt, fmt.Errorf("core.try must contain exactly try and catch regions")
		}
	}
	if attr, ok := Attr(op, "args"); ok {
		stmt.Args = append([]interface{}(nil), attr.Values...)
	}
	if err := validateCoreStmtShape(stmt); err != nil {
		return stmt, err
	}
	for _, region := range op.Regions {
		body := CoreBody{}
		for _, block := range region.Blocks {
			coreBlock := CoreBlock{Name: block.Name, Args: append([]Value(nil), block.Args...), Line: block.Line}
			for _, raw := range block.Ops {
				child, err := parseCoreStmt(raw)
				if err != nil {
					return stmt, err
				}
				coreBlock.Stmts = append(coreBlock.Stmts, child)
			}
			body.Blocks = append(body.Blocks, coreBlock)
		}
		stmt.Regions = append(stmt.Regions, body)
	}
	return stmt, nil
}

func validateCoreStmtShape(stmt CoreStmt) error {
	switch stmt.Kind {
	case "append":
		if stmt.Target == "" || stmt.Value == nil {
			return fmt.Errorf("core.append missing target or value")
		}
		if !strings.HasPrefix(stmt.Target, "%") {
			return fmt.Errorf("core.append target must be a value ref")
		}
	case "break", "continue":
	case "call":
		if stmt.Callee == "" {
			return fmt.Errorf("core.call missing callee")
		}
	case "const", "let", "list", "map", "regex_match", "string_join", "string_trim", "type_is":
		if stmt.Result == "" {
			return fmt.Errorf("core.%s missing result", stmt.Kind)
		}
		if (stmt.Kind == "const" || stmt.Kind == "let" || stmt.Kind == "regex_match" || stmt.Kind == "string_join" || stmt.Kind == "string_trim" || stmt.Kind == "type_is") && stmt.Value == nil {
			return fmt.Errorf("core.%s missing value", stmt.Kind)
		}
	case "for":
		if stmt.Item == "" || stmt.Iter == "" {
			return fmt.Errorf("core.for missing item or in")
		}
		if !strings.HasPrefix(stmt.Item, "%") {
			return fmt.Errorf("core.for item must be a value binding")
		}
		if !strings.HasPrefix(stmt.Iter, "%") {
			return fmt.Errorf("core.for in must be a value ref")
		}
	case "get":
		if stmt.Result == "" || stmt.Target == "" || stmt.Key == "" {
			return fmt.Errorf("core.get missing result, target, or key")
		}
	case "if":
		if stmt.Cond == "" {
			return fmt.Errorf("core.if missing condition")
		}
	case "loop":
	case "try":
		errorRef := AttrString(stmt.Op, "error")
		if errorRef == "" || !strings.HasPrefix(errorRef, "%") {
			return fmt.Errorf("core.try missing error binding")
		}
	case "raise":
		if stmt.Message == "" {
			if _, ok := Attr(stmt.Op, "error"); !ok {
				return fmt.Errorf("core.raise missing message or error")
			}
		}
	case "return":
	case "set":
		if stmt.Target == "" || stmt.Key == "" || stmt.Value == nil {
			return fmt.Errorf("core.set missing target, key, or value")
		}
		if !strings.HasPrefix(stmt.Target, "%") {
			return fmt.Errorf("core.set target must be a value ref")
		}
	}
	return nil
}

func validateCoreBlock(block CoreBlock, parentScope map[string]bool, loopDepth int) error {
	scope := map[string]bool{}
	for key, value := range parentScope {
		scope[key] = value
	}
	for _, arg := range block.Args {
		scope["%"+arg.Name] = true
	}
	terminated := false
	for _, stmt := range block.Stmts {
		if terminated {
			return fmt.Errorf("unreachable Core op %q after terminator", stmt.Op.Name)
		}
		if (stmt.Kind == "break" || stmt.Kind == "continue") && loopDepth == 0 {
			return fmt.Errorf("core.%s outside loop", stmt.Kind)
		}
		for _, ref := range stmt.ValueRefs() {
			if !scope[ref] {
				return fmt.Errorf("unknown value ref %s", ref)
			}
		}
		for regionIndex, regionBody := range stmt.Regions {
			for _, childBlock := range regionBody.Blocks {
				childScope := scope
				if stmt.Kind == "for" && strings.HasPrefix(stmt.Item, "%") {
					childScope = map[string]bool{}
					for key, value := range scope {
						childScope[key] = value
					}
					childScope[stmt.Item] = true
				}
				if stmt.Kind == "try" && regionIndex == 1 {
					childScope = map[string]bool{}
					for key, value := range scope {
						childScope[key] = value
					}
					childScope[AttrString(stmt.Op, "error")] = true
				}
				childLoopDepth := loopDepth
				if stmt.Kind == "for" || stmt.Kind == "loop" {
					childLoopDepth++
				}
				if err := validateCoreBlock(childBlock, childScope, childLoopDepth); err != nil {
					return err
				}
			}
		}
		if stmt.Result != "" {
			scope[stmt.Result] = true
		}
		if stmt.Kind == "return" || stmt.Kind == "raise" || stmt.Kind == "break" || stmt.Kind == "continue" {
			terminated = true
		}
	}
	return nil
}

func (s CoreStmt) ValueRefs() []string {
	var out []string
	for _, value := range s.Args {
		if ref, ok := value.(string); ok && strings.HasPrefix(ref, "%") {
			out = append(out, ref)
		}
	}
	if value, ok := s.Value.(string); ok && strings.HasPrefix(value, "%") {
		out = append(out, value)
	}
	for _, value := range []string{s.Target, s.Key, s.Iter, s.Cond} {
		if strings.HasPrefix(value, "%") {
			out = append(out, value)
		}
	}
	for _, attrName := range []string{"default", "error", "pattern", "sep"} {
		if s.Kind == "try" && attrName == "error" {
			continue
		}
		if attr, ok := Attr(s.Op, attrName); ok {
			if value, ok := attr.Value.(string); ok && strings.HasPrefix(value, "%") {
				out = append(out, value)
			}
		}
	}
	return out
}
