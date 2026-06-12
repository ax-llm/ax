package axir

import (
	"fmt"
	"strconv"
	"strings"
)

func BuildJavaCore(model AxRuntimeModel) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	body, err := emitJavaCoreFunctions(model, specs, CoreFuncNames(specs))
	if err != nil {
		return "", err
	}
	return mustInject(javaCore, "// AXIR_CORE_JAVA_FUNCTIONS\n", body, "javaCore")
}

func emitJavaCoreFunctions(model AxRuntimeModel, specs []CoreFuncSpec, names map[string]string) (string, error) {
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
		text, err := emitJavaCoreFunction(names, op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	b.WriteString("  // END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitJavaCoreFunction(names map[string]string, op Operation, name string) (string, error) {
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
	fmt.Fprintf(&b, "    axirCoverageMark(%q);\n", name)
	for _, stmt := range block.Stmts {
		lines, err := emitJavaCoreStmt(names, stmt, declared)
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

func emitJavaCoreStmt(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"break;"}, nil
	case "continue":
		return []string{"continue;"}, nil
	case "call":
		callee := javaCallee(names, stmt.Callee)
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
		return emitJavaFor(names, stmt, declared)
	case "if":
		return emitJavaIf(names, stmt, declared)
	case "loop":
		return emitJavaLoop(names, stmt, declared)
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
		return emitJavaTry(names, stmt, declared)
	default:
		return nil, fmt.Errorf("unsupported Java Core op %q", stmt.Op.Name)
	}
}

func emitJavaFor(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
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
		childLines, err := emitJavaCoreBlock(names, body, childDeclared)
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

func emitJavaIf(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	cond := javaLiteral(stmt.Cond)
	lines := []string{fmt.Sprintf("if (Core.truthy(%s)) {", cond)}
	thenLines, err := emitJavaRegionBlock(names, firstBodyBlock(stmt), copyJavaScope(declared))
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
		elseLines, err := emitJavaRegionBlock(names, elseBlock, copyJavaScope(declared))
		if err != nil {
			return nil, err
		}
		lines = append(lines, elseLines...)
		lines = append(lines, "}")
	}
	return lines, nil
}

func emitJavaLoop(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	lines := []string{"while (Core.truthy(Boolean.TRUE)) {"}
	body := firstBodyBlock(stmt)
	childLines, err := emitJavaRegionBlock(names, body, copyJavaScope(declared))
	if err != nil {
		return nil, err
	}
	lines = append(lines, childLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitJavaTry(names map[string]string, stmt CoreStmt, declared map[string]bool) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must contain exactly try and catch regions")
	}
	errorRef := AttrString(stmt.Op, "error")
	if errorRef == "" {
		return nil, fmt.Errorf("core.try missing error binding")
	}
	lines := []string{"try {"}
	tryLines, err := emitJavaRegionBlock(names, firstBodyBlock(stmt), copyJavaScope(declared))
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
	catchLines, err := emitJavaRegionBlock(names, catchBlock, catchDeclared)
	if err != nil {
		return nil, err
	}
	lines = append(lines, catchLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitJavaRegionBlock(names map[string]string, block CoreBlock, declared map[string]bool) ([]string, error) {
	if len(block.Stmts) == 0 {
		return []string{"  // empty"}, nil
	}
	lines, err := emitJavaCoreBlock(names, block, declared)
	if err != nil {
		return nil, err
	}
	for i := range lines {
		lines[i] = "  " + lines[i]
	}
	return lines, nil
}

func emitJavaCoreBlock(names map[string]string, block CoreBlock, declared map[string]bool) ([]string, error) {
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitJavaCoreStmt(names, child, declared)
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

func javaCallee(names map[string]string, callee string) string {
	if strings.HasPrefix(callee, "@") {
		if name, ok := names[Symbol(callee)]; ok {
			return "Core." + name
		}
		return "Core._" + Symbol(callee)
	}
	if target, ok := coreIntrinsicJava[CoreIntrinsic(callee)]; ok {
		return target
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
	IntrinsicProgramComponents:      "Core.programComponents",
	IntrinsicProgramApplyComponents: "Core.programApplyComponents",
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
	IntrinsicAgentStageUsage:        "Core.agentStageUsage",
	IntrinsicAgentStageTraces:       "Core.agentStageTraces",
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
		return javaStringLiteral(v)
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

func javaStringLiteral(value string) string {
	const maxChunk = 12000
	if len(value) <= maxChunk {
		return strconv.Quote(value)
	}
	parts := make([]string, 0, (len(value)/maxChunk)+1)
	for start := 0; start < len(value); start += maxChunk {
		end := start + maxChunk
		if end > len(value) {
			end = len(value)
		}
		parts = append(parts, strconv.Quote(value[start:end]))
	}
	return "String.join(\"\", new String[] {\n        " + strings.Join(parts, ",\n        ") + "\n      })"
}

func javaName(value string) string {
	return strings.TrimPrefix(value, "%")
}
