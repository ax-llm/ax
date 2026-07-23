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
	IntrinsicMul                    CoreIntrinsic = "intrinsic.mul"
	IntrinsicDiv                    CoreIntrinsic = "intrinsic.div"
	IntrinsicMathAbs                CoreIntrinsic = "intrinsic.math.abs"
	IntrinsicMathLog                CoreIntrinsic = "intrinsic.math.log"
	IntrinsicMathExp                CoreIntrinsic = "intrinsic.math.exp"
	IntrinsicMathSqrt               CoreIntrinsic = "intrinsic.math.sqrt"
	IntrinsicMathCos                CoreIntrinsic = "intrinsic.math.cos"
	IntrinsicMathPow                CoreIntrinsic = "intrinsic.math.pow"
	IntrinsicMathRandom             CoreIntrinsic = "intrinsic.math.random"
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
	IntrinsicMapDelete              CoreIntrinsic = "intrinsic.map.delete"
	IntrinsicMapUpdate              CoreIntrinsic = "intrinsic.map.update"
	IntrinsicMapKeys                CoreIntrinsic = "intrinsic.map.keys"
	IntrinsicMapValues              CoreIntrinsic = "intrinsic.map.values"
	IntrinsicRecordNew              CoreIntrinsic = "intrinsic.record.new"
	IntrinsicObjectCallMethod       CoreIntrinsic = "intrinsic.object.call_method"
	IntrinsicProgramComponents      CoreIntrinsic = "intrinsic.program.components"
	IntrinsicProgramApplyComponents CoreIntrinsic = "intrinsic.program.apply_components"
	IntrinsicAICompleteOnce         CoreIntrinsic = "intrinsic.ai.complete_once"
	IntrinsicRetrySleep             CoreIntrinsic = "intrinsic.retry.sleep"
	IntrinsicExceptionMessage       CoreIntrinsic = "intrinsic.exception.message"
	IntrinsicRuntimeError           CoreIntrinsic = "intrinsic.error.runtime"
	IntrinsicJSONParse              CoreIntrinsic = "intrinsic.json.parse"
	IntrinsicJSONStringify          CoreIntrinsic = "intrinsic.json.stringify"
	IntrinsicJSONStableStringify    CoreIntrinsic = "intrinsic.json.stable_stringify"
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
	IntrinsicStringLower            CoreIntrinsic = "intrinsic.string.lower"
	IntrinsicStringLowerCamel       CoreIntrinsic = "intrinsic.string.lower_camel"
	IntrinsicStringTitleFromCamel   CoreIntrinsic = "intrinsic.string.title_from_camel"
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
	IntrinsicStringSplitTopLevel    CoreIntrinsic = "intrinsic.string.split_top_level"
	IntrinsicStringExtractGroup     CoreIntrinsic = "intrinsic.string.extract_leading_group"
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
	IntrinsicAgentStageForward      CoreIntrinsic = "intrinsic.agent.stage_forward"
	IntrinsicAgentStageChatLog      CoreIntrinsic = "intrinsic.agent.stage_chat_log"
	IntrinsicAgentStageUsage        CoreIntrinsic = "intrinsic.agent.stage_usage"
	IntrinsicAgentStageTraces       CoreIntrinsic = "intrinsic.agent.stage_traces"
	IntrinsicAgentClarificationErr  CoreIntrinsic = "intrinsic.agent.clarification_error"
	IntrinsicAgentRuntimeCreate     CoreIntrinsic = "intrinsic.agent.runtime.create_session"
	IntrinsicAgentRuntimeExecute    CoreIntrinsic = "intrinsic.agent.runtime.execute"
	IntrinsicAgentRuntimeInspect    CoreIntrinsic = "intrinsic.agent.runtime.inspect"
	IntrinsicAgentRuntimeExport     CoreIntrinsic = "intrinsic.agent.runtime.export_state"
	IntrinsicAgentRuntimeRestore    CoreIntrinsic = "intrinsic.agent.runtime.restore_state"
	IntrinsicAgentRuntimeClose      CoreIntrinsic = "intrinsic.agent.runtime.close"
	IntrinsicAgentMemorySearch      CoreIntrinsic = "intrinsic.agent.memory_search"
	IntrinsicAgentSkillSearch       CoreIntrinsic = "intrinsic.agent.skill_search"
	IntrinsicAgentObserverNotify    CoreIntrinsic = "intrinsic.agent.observer.notify"
	IntrinsicAgentTranscribe        CoreIntrinsic = "intrinsic.agent.transcribe"
	IntrinsicAgentCallableInvoke    CoreIntrinsic = "intrinsic.agent.callable.invoke"
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
	IntrinsicMul:                    "_core_mul",
	IntrinsicDiv:                    "_core_div",
	IntrinsicMathAbs:                "_core_math_abs",
	IntrinsicMathLog:                "_core_math_log",
	IntrinsicMathExp:                "_core_math_exp",
	IntrinsicMathSqrt:               "_core_math_sqrt",
	IntrinsicMathCos:                "_core_math_cos",
	IntrinsicMathPow:                "_core_math_pow",
	IntrinsicMathRandom:             "_core_math_random",
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
	IntrinsicMapDelete:              "_core_map_delete",
	IntrinsicMapUpdate:              "_core_map_update",
	IntrinsicMapKeys:                "_core_map_keys",
	IntrinsicMapValues:              "_core_map_values",
	IntrinsicRecordNew:              "_core_record_new",
	IntrinsicObjectCallMethod:       "_core_object_call_method",
	IntrinsicProgramComponents:      "_core_program_components",
	IntrinsicProgramApplyComponents: "_core_program_apply_components",
	IntrinsicAICompleteOnce:         "_core_ai_complete_once",
	IntrinsicRetrySleep:             "_core_retry_sleep",
	IntrinsicExceptionMessage:       "_core_exception_message",
	IntrinsicRuntimeError:           "_core_runtime_error",
	IntrinsicJSONParse:              "_core_json_parse",
	IntrinsicJSONStringify:          "_core_json_stringify",
	IntrinsicJSONStableStringify:    "_core_json_stable_stringify",
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
	IntrinsicStringLower:            "_core_string_lower",
	IntrinsicStringLowerCamel:       "_core_string_lower_camel",
	IntrinsicStringTitleFromCamel:   "_core_string_title_from_camel",
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
	IntrinsicStringSplitTopLevel:    "_core_string_split_top_level",
	IntrinsicStringExtractGroup:     "_core_string_extract_leading_group",
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
	IntrinsicAgentStageForward:      "_core_agent_stage_forward",
	IntrinsicAgentStageChatLog:      "_core_agent_stage_chat_log",
	IntrinsicAgentStageUsage:        "_core_agent_stage_usage",
	IntrinsicAgentStageTraces:       "_core_agent_stage_traces",
	IntrinsicAgentClarificationErr:  "_core_agent_clarification_error",
	IntrinsicAgentRuntimeCreate:     "_core_agent_runtime_create_session",
	IntrinsicAgentRuntimeExecute:    "_core_agent_runtime_execute",
	IntrinsicAgentRuntimeInspect:    "_core_agent_runtime_inspect",
	IntrinsicAgentRuntimeExport:     "_core_agent_runtime_export_state",
	IntrinsicAgentRuntimeRestore:    "_core_agent_runtime_restore_state",
	IntrinsicAgentRuntimeClose:      "_core_agent_runtime_close",
	IntrinsicAgentMemorySearch:      "_core_agent_memory_search",
	IntrinsicAgentSkillSearch:       "_core_agent_skill_search",
	IntrinsicAgentObserverNotify:    "_core_agent_observer_notify",
	IntrinsicAgentTranscribe:        "_core_agent_transcribe",
	IntrinsicAgentCallableInvoke:    "_core_agent_callable_invoke",
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
	"intrinsic.mul":                                   true,
	"intrinsic.div":                                   true,
	"intrinsic.math.abs":                              true,
	"intrinsic.math.log":                              true,
	"intrinsic.math.exp":                              true,
	"intrinsic.math.sqrt":                             true,
	"intrinsic.math.cos":                              true,
	"intrinsic.math.pow":                              true,
	"intrinsic.math.random":                           true,
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
	"intrinsic.map.delete":                            true,
	"intrinsic.map.update":                            true,
	"intrinsic.map.keys":                              true,
	"intrinsic.map.values":                            true,
	"intrinsic.object.call_method":                    true,
	"intrinsic.program.components":                    true,
	"intrinsic.program.apply_components":              true,
	"intrinsic.ai.complete_once":                      true,
	"intrinsic.retry.sleep":                           true,
	"intrinsic.exception.message":                     true,
	"intrinsic.error.runtime":                         true,
	"intrinsic.json.parse":                            true,
	"intrinsic.json.stringify":                        true,
	"intrinsic.json.stable_stringify":                 true,
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
	"intrinsic.string.lower_camel":                    true,
	"intrinsic.string.title_from_camel":               true,
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
	"intrinsic.string.split_top_level":                true,
	"intrinsic.string.extract_leading_group":          true,
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
	"intrinsic.agent.stage_forward":                   true,
	"intrinsic.agent.stage_chat_log":                  true,
	"intrinsic.agent.stage_usage":                     true,
	"intrinsic.agent.stage_traces":                    true,
	"intrinsic.agent.clarification_error":             true,
	"intrinsic.agent.runtime.create_session":          true,
	"intrinsic.agent.runtime.execute":                 true,
	"intrinsic.agent.runtime.inspect":                 true,
	"intrinsic.agent.runtime.export_state":            true,
	"intrinsic.agent.runtime.restore_state":           true,
	"intrinsic.agent.runtime.close":                   true,
	"intrinsic.agent.memory_search":                   true,
	"intrinsic.agent.skill_search":                    true,
	"intrinsic.agent.observer.notify":                 true,
	"intrinsic.agent.transcribe":                      true,
	"intrinsic.agent.callable.invoke":                 true,
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
	if attr, ok := Attr(op, "args"); ok {
		stmt.Args = append([]interface{}(nil), attr.Values...)
	}
	if err := validateCoreOpAttrs(op, stmt.Kind); err != nil {
		return stmt, err
	}
	if stmt.Kind == "call" {
		if stmt.Callee == "" {
			return stmt, fmt.Errorf("core.call missing callee")
		}
		if strings.HasPrefix(stmt.Callee, "_axir_") {
			return stmt, fmt.Errorf("core.call callee %q uses forbidden backend helper escape", stmt.Callee)
		}
		if strings.HasPrefix(stmt.Callee, "intrinsic.") && !knownCoreIntrinsics[stmt.Callee] {
			return stmt, unknownCoreIntrinsicError(stmt.Callee)
		}
		if strings.HasPrefix(stmt.Callee, "intrinsic.") {
			if err := validateCoreIntrinsicArgs(stmt.Callee, len(stmt.Args)); err != nil {
				return stmt, err
			}
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

func validateCoreOpAttrs(op Operation, kind string) error {
	allowed, ok := coreOpAllowedAttrs[kind]
	if !ok {
		return nil
	}
	for _, attr := range op.Attributes {
		if !allowed[attr.Name] {
			return fmt.Errorf("core.%s has unknown attr %q; allowed attrs are %s", kind, attr.Name, strings.Join(sortedKeys(allowed), ", "))
		}
	}
	return nil
}

var coreOpAllowedAttrs = map[string]map[string]bool{
	"append":       attrSet("target", "value"),
	"break":        attrSet(),
	"call":         attrSet("args", "callee", "result"),
	"const":        attrSet("result", "value"),
	"continue":     attrSet(),
	"for":          attrSet("in", "item"),
	"get":          attrSet("default", "key", "result", "target"),
	"if":           attrSet("condition"),
	"let":          attrSet("result", "value"),
	"list":         attrSet("result"),
	"loop":         attrSet(),
	"map":          attrSet("result"),
	"raise":        attrSet("error", "message"),
	"regex_match":  attrSet("pattern", "result", "value"),
	"return":       attrSet("value"),
	"set":          attrSet("key", "target", "value"),
	"string_join":  attrSet("result", "sep", "value"),
	"string_split": attrSet("result", "sep", "value"),
	"string_trim":  attrSet("result", "value"),
	"switch":       nil,
	"try":          attrSet("error"),
	"type_is":      attrSet("result", "type", "value"),
}

func attrSet(names ...string) map[string]bool {
	out := map[string]bool{}
	for _, name := range names {
		out[name] = true
	}
	return out
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
		if !strings.HasPrefix(stmt.Target, "%") {
			return fmt.Errorf("core.get target must be a value ref like %%target")
		}
	case "if":
		if stmt.Cond == "" {
			return fmt.Errorf("core.if missing condition")
		}
		if !strings.HasPrefix(stmt.Cond, "%") {
			return fmt.Errorf("core.if condition must be a value ref like %%condition")
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

type CoreIntrinsicInfo struct {
	Name         string
	MinArgs      int
	MaxArgs      int
	HostBoundary bool
	ReturnKind   string
}

var coreIntrinsicInfo = map[string]CoreIntrinsicInfo{
	"intrinsic.not":                          intrinsicInfo("intrinsic.not", 1, 1, false, "bool"),
	"intrinsic.and":                          intrinsicInfo("intrinsic.and", 2, 2, false, "bool"),
	"intrinsic.or":                           intrinsicInfo("intrinsic.or", 2, 2, false, "bool"),
	"intrinsic.eq":                           intrinsicInfo("intrinsic.eq", 2, 2, false, "bool"),
	"intrinsic.ne":                           intrinsicInfo("intrinsic.ne", 2, 2, false, "bool"),
	"intrinsic.lt":                           intrinsicInfo("intrinsic.lt", 2, 2, false, "bool"),
	"intrinsic.lte":                          intrinsicInfo("intrinsic.lte", 2, 2, false, "bool"),
	"intrinsic.gt":                           intrinsicInfo("intrinsic.gt", 2, 2, false, "bool"),
	"intrinsic.gte":                          intrinsicInfo("intrinsic.gte", 2, 2, false, "bool"),
	"intrinsic.mul":                          intrinsicInfo("intrinsic.mul", 2, 2, false, "f64"),
	"intrinsic.div":                          intrinsicInfo("intrinsic.div", 2, 2, false, "f64"),
	"intrinsic.math.abs":                     intrinsicInfo("intrinsic.math.abs", 1, 1, false, "f64"),
	"intrinsic.math.log":                     intrinsicInfo("intrinsic.math.log", 1, 1, false, "f64"),
	"intrinsic.math.exp":                     intrinsicInfo("intrinsic.math.exp", 1, 1, false, "f64"),
	"intrinsic.math.sqrt":                    intrinsicInfo("intrinsic.math.sqrt", 1, 1, false, "f64"),
	"intrinsic.math.cos":                     intrinsicInfo("intrinsic.math.cos", 1, 1, false, "f64"),
	"intrinsic.math.pow":                     intrinsicInfo("intrinsic.math.pow", 2, 2, false, "f64"),
	"intrinsic.math.random":                  intrinsicInfo("intrinsic.math.random", 0, 0, true, "f64"),
	"intrinsic.len":                          intrinsicInfo("intrinsic.len", 1, 1, false, "i64"),
	"intrinsic.contains":                     intrinsicInfo("intrinsic.contains", 2, 2, false, "bool"),
	"intrinsic.is_none":                      intrinsicInfo("intrinsic.is_none", 1, 1, false, "bool"),
	"intrinsic.is_not_none":                  intrinsicInfo("intrinsic.is_not_none", 1, 1, false, "bool"),
	"intrinsic.none":                         intrinsicInfo("intrinsic.none", 0, 0, false, "json"),
	"intrinsic.coalesce":                     intrinsicInfo("intrinsic.coalesce", 2, 2, false, "json"),
	"intrinsic.map.contains":                 intrinsicInfo("intrinsic.map.contains", 2, 2, false, "bool"),
	"intrinsic.map.get":                      intrinsicInfo("intrinsic.map.get", 2, 3, false, "json"),
	"intrinsic.map.delete":                   intrinsicInfo("intrinsic.map.delete", 2, 2, false, "json"),
	"intrinsic.map.keys":                     intrinsicInfo("intrinsic.map.keys", 1, 1, false, "list<string>"),
	"intrinsic.json.parse":                   intrinsicInfo("intrinsic.json.parse", 1, 1, false, "json"),
	"intrinsic.json.stringify":               intrinsicInfo("intrinsic.json.stringify", 1, 1, false, "string"),
	"intrinsic.json.stable_stringify":        intrinsicInfo("intrinsic.json.stable_stringify", 1, 1, false, "string"),
	"intrinsic.tool.invoke":                  intrinsicInfo("intrinsic.tool.invoke", 2, 2, true, "json"),
	"intrinsic.agent.stage_forward":          intrinsicInfo("intrinsic.agent.stage_forward", 4, 4, true, "json"),
	"intrinsic.agent.stage_chat_log":         intrinsicInfo("intrinsic.agent.stage_chat_log", 1, 1, true, "list<json>"),
	"intrinsic.agent.stage_usage":            intrinsicInfo("intrinsic.agent.stage_usage", 1, 1, true, "json"),
	"intrinsic.agent.stage_traces":           intrinsicInfo("intrinsic.agent.stage_traces", 1, 1, true, "list<json>"),
	"intrinsic.agent.clarification_error":    intrinsicInfo("intrinsic.agent.clarification_error", 2, 2, true, "error"),
	"intrinsic.agent.runtime.create_session": intrinsicInfo("intrinsic.agent.runtime.create_session", 3, 3, true, "json"),
	"intrinsic.agent.runtime.execute":        intrinsicInfo("intrinsic.agent.runtime.execute", 3, 3, true, "json"),
	"intrinsic.agent.runtime.inspect":        intrinsicInfo("intrinsic.agent.runtime.inspect", 2, 2, true, "json"),
	"intrinsic.agent.runtime.export_state":   intrinsicInfo("intrinsic.agent.runtime.export_state", 2, 2, true, "json"),
	"intrinsic.agent.runtime.restore_state":  intrinsicInfo("intrinsic.agent.runtime.restore_state", 3, 3, true, "json"),
	"intrinsic.agent.runtime.close":          intrinsicInfo("intrinsic.agent.runtime.close", 1, 1, true, "json"),
	"intrinsic.agent.memory_search":          intrinsicInfo("intrinsic.agent.memory_search", 3, 3, true, "json"),
	"intrinsic.agent.skill_search":           intrinsicInfo("intrinsic.agent.skill_search", 2, 2, true, "json"),
	"intrinsic.agent.observer.notify":        intrinsicInfo("intrinsic.agent.observer.notify", 4, 4, true, "json"),
	"intrinsic.agent.transcribe":             intrinsicInfo("intrinsic.agent.transcribe", 3, 3, true, "json"),
	"intrinsic.agent.callable.invoke":        intrinsicInfo("intrinsic.agent.callable.invoke", 3, 3, true, "json"),
	"intrinsic.object.call_method":           intrinsicInfo("intrinsic.object.call_method", 2, -1, true, "json"),
	"intrinsic.program.components":           intrinsicInfo("intrinsic.program.components", 1, 1, true, "list<json>"),
	"intrinsic.program.apply_components":     intrinsicInfo("intrinsic.program.apply_components", 2, 2, true, "json"),
	"intrinsic.ai.complete_once":             intrinsicInfo("intrinsic.ai.complete_once", 3, 3, true, "json"),
	"intrinsic.retry.sleep":                  intrinsicInfo("intrinsic.retry.sleep", 1, 1, true, "void"),
	"intrinsic.exception.message":            intrinsicInfo("intrinsic.exception.message", 1, 1, true, "string"),
	"intrinsic.string.format":                intrinsicInfo("intrinsic.string.format", 1, -1, false, "string"),
	"intrinsic.string.join":                  intrinsicInfo("intrinsic.string.join", 2, 2, false, "string"),
	"intrinsic.string.slice":                 intrinsicInfo("intrinsic.string.slice", 2, 3, false, "string"),
	"intrinsic.string.replace":               intrinsicInfo("intrinsic.string.replace", 3, 3, false, "string"),
	"intrinsic.string.split":                 intrinsicInfo("intrinsic.string.split", 2, 2, false, "list<string>"),
	"intrinsic.string.split_top_level":       intrinsicInfo("intrinsic.string.split_top_level", 2, 2, false, "list<string>"),
	"intrinsic.string.extract_leading_group": intrinsicInfo("intrinsic.string.extract_leading_group", 3, 3, false, "json"),
	"intrinsic.url.valid":                    intrinsicInfo("intrinsic.url.valid", 1, 1, false, "bool"),
	"intrinsic.stream.event_content_parts":   intrinsicInfo("intrinsic.stream.event_content_parts", 1, 1, false, "list<string>"),
}

func intrinsicInfo(name string, minArgs, maxArgs int, hostBoundary bool, returnKind string) CoreIntrinsicInfo {
	return CoreIntrinsicInfo{Name: name, MinArgs: minArgs, MaxArgs: maxArgs, HostBoundary: hostBoundary, ReturnKind: returnKind}
}

func validateCoreIntrinsicArgs(name string, got int) error {
	info, ok := coreIntrinsicInfo[name]
	if !ok {
		return nil
	}
	if got < info.MinArgs || (info.MaxArgs >= 0 && got > info.MaxArgs) {
		if info.MinArgs == info.MaxArgs {
			return fmt.Errorf("%s expects %d args, got %d", name, info.MinArgs, got)
		}
		if info.MaxArgs < 0 {
			return fmt.Errorf("%s expects at least %d args, got %d", name, info.MinArgs, got)
		}
		return fmt.Errorf("%s expects %d-%d args, got %d", name, info.MinArgs, info.MaxArgs, got)
	}
	return nil
}

func unknownCoreIntrinsicError(name string) error {
	if suggestion := closestString(name, sortedKnownIntrinsics()); suggestion != "" {
		return fmt.Errorf("unknown Core intrinsic %q; did you mean %q?", name, suggestion)
	}
	return fmt.Errorf("unknown Core intrinsic %q", name)
}

func sortedKnownIntrinsics() []string {
	keys := make([]string, 0, len(knownCoreIntrinsics))
	for key := range knownCoreIntrinsics {
		keys = append(keys, key)
	}
	return sortedStrings(keys)
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
