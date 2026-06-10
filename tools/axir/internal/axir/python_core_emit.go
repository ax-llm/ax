package axir

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// pythonEmitState carries the registry context for one python module
// emission: the global symbol->name map, each symbol's host module, the
// module being emitted, and the cross-module names referenced so far (which
// become generated import statements).
type pythonEmitState struct {
	names    map[string]string
	moduleOf map[string]string
	module   string
	imports  map[string]map[string]bool
}

func (st *pythonEmitState) calleeName(callee string) string {
	if strings.HasPrefix(callee, "@") {
		symbol := Symbol(callee)
		if name, ok := st.names[symbol]; ok {
			if module := st.moduleOf[symbol]; module != "" && module != st.module {
				set := st.imports[module]
				if set == nil {
					set = map[string]bool{}
					st.imports[module] = set
				}
				set[name] = true
			}
			return name
		}
		return "_" + symbol
	}
	if target, ok := coreIntrinsicPython[CoreIntrinsic(callee)]; ok {
		return target
	}
	return callee
}

func buildPythonCoreModule(model AxRuntimeModel, module, template, marker string) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	names := CoreFuncNames(specs)
	moduleOf := make(map[string]string, len(specs))
	var moduleSpecs []CoreFuncSpec
	for _, spec := range specs {
		file := pythonCoreModuleFile(spec.Module)
		moduleOf[spec.Symbol] = file
		if file == module {
			moduleSpecs = append(moduleSpecs, spec)
		}
	}
	st := &pythonEmitState{names: names, moduleOf: moduleOf, module: module, imports: map[string]map[string]bool{}}
	body, err := emitPythonCoreFunctions(st, model, moduleSpecs)
	if err != nil {
		return "", err
	}
	out, err := mustInject(template, marker, body, "python "+module)
	if err != nil {
		return "", err
	}
	return mustInject(out, "# AXIR_CORE_IMPORTS\n", renderPythonCoreImports(st.imports, template), "python "+module)
}

// renderPythonCoreImports renders the generated cross-module imports,
// skipping names the template already imports by hand.
func renderPythonCoreImports(imports map[string]map[string]bool, template string) string {
	hand := pythonTemplateImports(template)
	var modules []string
	for module := range imports {
		modules = append(modules, module)
	}
	sort.Strings(modules)
	var b strings.Builder
	for _, module := range modules {
		var names []string
		for name := range imports[module] {
			if hand[module][name] {
				continue
			}
			names = append(names, name)
		}
		if len(names) == 0 {
			continue
		}
		sort.Strings(names)
		fmt.Fprintf(&b, "from .%s import (\n", module)
		for _, name := range names {
			fmt.Fprintf(&b, "    %s,\n", name)
		}
		b.WriteString(")\n")
	}
	return b.String()
}

var pythonImportLineRe = regexp.MustCompile(`(?m)^from \.([a-z_]+) import ([^(\n]+)$`)
var pythonImportBlockRe = regexp.MustCompile(`(?s)from \.([a-z_]+) import \(([^)]*)\)`)
var pythonImportNameRe = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]*`)

func pythonTemplateImports(template string) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	add := func(module, body string) {
		set := out[module]
		if set == nil {
			set = map[string]bool{}
			out[module] = set
		}
		for _, name := range pythonImportNameRe.FindAllString(body, -1) {
			set[name] = true
		}
	}
	for _, m := range pythonImportLineRe.FindAllStringSubmatch(template, -1) {
		add(m[1], m[2])
	}
	for _, m := range pythonImportBlockRe.FindAllStringSubmatch(template, -1) {
		add(m[1], m[2])
	}
	return out
}

func BuildPythonSignature(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "signature", pySignature, "# AXIR_CORE_SIGNATURE_FUNCTIONS\n")
}

func BuildPythonSchema(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "schema", pySchema, "# AXIR_CORE_SCHEMA_FUNCTIONS\n")
}

func BuildPythonPrompt(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "prompt", pyPrompt, "# AXIR_CORE_PROMPT_FUNCTIONS\n")
}

func BuildPythonAI(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "ai", pyAI, "# AXIR_CORE_AI_FUNCTIONS\n")
}

func BuildPythonGen(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "gen", pyGen, "# AXIR_CORE_GEN_FUNCTIONS\n")
}

func BuildPythonAgent(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "agent", pyAgent, "# AXIR_CORE_AGENT_FUNCTIONS\n")
}

func BuildPythonFlow(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "flow", pyFlow, "# AXIR_CORE_FLOW_FUNCTIONS\n")
}

func BuildPythonMCP(model AxRuntimeModel) (string, error) {
	return buildPythonCoreModule(model, "mcp", pyMCP, "# AXIR_CORE_MCP_FUNCTIONS\n")
}

func emitPythonCoreFunctions(st *pythonEmitState, model AxRuntimeModel, specs []CoreFuncSpec) (string, error) {
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
		text, err := emitPythonCoreFunction(st, op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
	}
	b.WriteString("# END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitPythonCoreFunction(st *pythonEmitState, op Operation, name string) (string, error) {
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
		lines, err := emitPythonCoreStmt(st, stmt)
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

func emitPythonCoreStmt(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"break"}, nil
	case "call":
		callee := st.calleeName(stmt.Callee)
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
		return emitPythonGet(st, stmt)
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
		return emitPythonRegexMatch(st, stmt)
	case "string_join":
		return emitPythonStringJoin(st, stmt)
	case "string_trim":
		return []string{fmt.Sprintf("%s = str(%s).strip()", pyName(stmt.Result), pythonLiteral(stmt.Value))}, nil
	case "type_is":
		return []string{fmt.Sprintf("%s = _core_type_is(%s, %s)", pyName(stmt.Result), pythonLiteral(stmt.Value), pythonAttrValue(stmt.Op, "type"))}, nil
	case "set":
		return []string{fmt.Sprintf("%s[%s] = %s", pythonLiteral(stmt.Target), pythonLiteral(stmt.Key), pythonLiteral(stmt.Value))}, nil
	case "for":
		return emitPythonFor(st, stmt)
	case "if":
		return emitPythonIf(st, stmt)
	case "loop":
		return emitPythonLoop(st, stmt)
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
		return emitPythonTry(st, stmt)
	default:
		return nil, fmt.Errorf("unsupported Python Core op %q", stmt.Op.Name)
	}
}

func emitPythonGet(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
	if stmt.Result == "" || stmt.Target == "" || stmt.Key == "" {
		return nil, fmt.Errorf("core.get missing result, target, or key")
	}
	defaultValue := "None"
	if _, ok := Attr(stmt.Op, "default"); ok {
		defaultValue = pythonAttrValue(stmt.Op, "default")
	}
	return []string{fmt.Sprintf("%s = _core_get(%s, %s, %s)", pyName(stmt.Result), pythonLiteral(stmt.Target), pythonLiteral(stmt.Key), defaultValue)}, nil
}

func emitPythonRegexMatch(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
	if stmt.Result == "" {
		return nil, fmt.Errorf("core.regex_match missing result")
	}
	return []string{fmt.Sprintf("%s = _core_regex_match(%s, %s)", pyName(stmt.Result), pythonAttrValue(stmt.Op, "pattern"), pythonLiteral(stmt.Value))}, nil
}

func emitPythonStringJoin(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
	if stmt.Result == "" {
		return nil, fmt.Errorf("core.string_join missing result")
	}
	return []string{fmt.Sprintf("%s = _core_string_join(%s, %s)", pyName(stmt.Result), pythonAttrValue(stmt.Op, "sep"), pythonLiteral(stmt.Value))}, nil
}

func emitPythonFor(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
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
		childLines, err := emitPythonCoreStmt(st, child)
		if err != nil {
			return nil, err
		}
		for _, line := range childLines {
			lines = append(lines, "    "+line)
		}
	}
	return lines, nil
}

func emitPythonLoop(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
	var lines []string
	lines = append(lines, "while True:")
	body := firstBodyBlock(stmt)
	if len(body.Stmts) == 0 {
		lines = append(lines, "    pass")
		return lines, nil
	}
	childLines, err := emitPythonCoreBlock(st, body)
	if err != nil {
		return nil, err
	}
	for _, line := range childLines {
		lines = append(lines, "    "+line)
	}
	return lines, nil
}

func emitPythonIf(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
	if stmt.Cond == "" {
		return nil, fmt.Errorf("core.if missing condition")
	}
	lines := []string{fmt.Sprintf("if %s:", pythonLiteral(stmt.Cond))}
	thenBlock := firstBodyBlock(stmt)
	if len(thenBlock.Stmts) == 0 {
		lines = append(lines, "    pass")
	} else {
		for _, child := range thenBlock.Stmts {
			childLines, err := emitPythonCoreStmt(st, child)
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
			childLines, err := emitPythonCoreStmt(st, child)
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

func emitPythonTry(st *pythonEmitState, stmt CoreStmt) ([]string, error) {
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
		tryLines, err := emitPythonCoreBlock(st, tryBlock)
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
		catchLines, err := emitPythonCoreBlock(st, catchBlock)
		if err != nil {
			return nil, err
		}
		for _, line := range catchLines {
			lines = append(lines, "    "+line)
		}
	}
	return lines, nil
}

func emitPythonCoreBlock(st *pythonEmitState, block CoreBlock) ([]string, error) {
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitPythonCoreStmt(st, child)
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
