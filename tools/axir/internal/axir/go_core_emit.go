package axir

import (
	"fmt"
	"strconv"
	"strings"
)

func BuildGoCore(model AxRuntimeModel) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	body, err := emitGoCoreFunctions(model, specs, CoreFuncNames(specs))
	if err != nil {
		return "", err
	}
	return strings.Replace(goRuntime, "// AXIR_CORE_GO_FUNCTIONS\n", body, 1), nil
}

func emitGoCoreFunctions(model AxRuntimeModel, specs []CoreFuncSpec, names map[string]string) (string, error) {
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
		text, err := emitGoCoreFunction(names, op, spec.Name)
		if err != nil {
			return "", err
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	b.WriteString("// END AXIR CORE EMITTED FUNCTIONS\n")
	return b.String(), nil
}

func emitGoCoreFunction(names map[string]string, op Operation, name string) (string, error) {
	body, err := BuildCoreBody(op)
	if err != nil {
		return "", fmt.Errorf("@%s: %w", op.Symbol, err)
	}
	if len(body.Blocks) == 0 {
		return "", fmt.Errorf("@%s has no Core body blocks", op.Symbol)
	}
	block := body.Blocks[0]
	argNames := map[string]bool{}
	for _, arg := range block.Args {
		argName := goName("%" + arg.Name)
		argNames[argName] = true
	}
	locals := map[string]bool{}
	collectGoLocals(block, locals)
	var localNames []string
	for _, name := range sortedKeys(locals) {
		if !argNames[name] {
			localNames = append(localNames, name)
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "func %s(args ...Value) (ret Value) {\n", name)
	b.WriteString("	defer catchCoreReturn(&ret)\n")
	for _, arg := range block.Args {
		fmt.Fprintf(&b, "	var %s Value\n", goName("%"+arg.Name))
	}
	for _, local := range localNames {
		fmt.Fprintf(&b, "	var %s Value\n", local)
	}
	for i, arg := range block.Args {
		fmt.Fprintf(&b, "	if len(args) > %d { %s = args[%d] }\n", i, goName("%"+arg.Name), i)
		fmt.Fprintf(&b, "	_ = %s\n", goName("%"+arg.Name))
	}
	for _, local := range localNames {
		fmt.Fprintf(&b, "	_ = %s\n", local)
	}
	emittedTerminal := false
	for _, stmt := range block.Stmts {
		lines, err := emitGoCoreStmt(names, stmt)
		if err != nil {
			return "", fmt.Errorf("@%s: %w", op.Symbol, err)
		}
		for _, line := range lines {
			fmt.Fprintf(&b, "	%s\n", line)
		}
		if goStmtIsTerminal(stmt) {
			emittedTerminal = true
			break
		}
	}
	if !emittedTerminal {
		b.WriteString("	return nil\n")
	}
	b.WriteString("}\n")
	return b.String(), nil
}

func collectGoLocals(block CoreBlock, locals map[string]bool) {
	for _, stmt := range block.Stmts {
		if stmt.Result != "" {
			locals[goName(stmt.Result)] = true
		}
		if stmt.Item != "" {
			locals[goName(stmt.Item)] = true
		}
		if stmt.Kind == "try" {
			if errorRef := AttrString(stmt.Op, "error"); errorRef != "" {
				locals[goName(errorRef)] = true
			}
		}
		for _, region := range stmt.Regions {
			for _, child := range region.Blocks {
				collectGoLocals(child, locals)
			}
		}
	}
}

func emitGoCoreStmt(names map[string]string, stmt CoreStmt) ([]string, error) {
	switch stmt.Kind {
	case "break":
		return []string{"panic(coreBreak{})"}, nil
	case "continue":
		return []string{"panic(coreContinue{})"}, nil
	case "call":
		callee := goCallee(names, stmt.Callee)
		args := make([]string, 0, len(stmt.Args))
		for _, arg := range stmt.Args {
			args = append(args, goLiteral(arg))
		}
		call := fmt.Sprintf("%s(%s)", callee, strings.Join(args, ", "))
		if stmt.Result != "" {
			return []string{fmt.Sprintf("%s = %s", goName(stmt.Result), call)}, nil
		}
		return []string{call}, nil
	case "const", "let":
		return []string{fmt.Sprintf("%s = %s", goName(stmt.Result), goAttrValue(stmt.Op, "value"))}, nil
	case "get":
		defaultValue := "nil"
		if _, ok := Attr(stmt.Op, "default"); ok {
			defaultValue = goAttrValue(stmt.Op, "default")
		}
		return []string{fmt.Sprintf("%s = coreGet(%s, %s, %s)", goName(stmt.Result), goLiteral(stmt.Target), goLiteral(stmt.Key), defaultValue)}, nil
	case "map":
		return []string{fmt.Sprintf("%s = Object()", goName(stmt.Result))}, nil
	case "list":
		return []string{fmt.Sprintf("%s = MutableArray()", goName(stmt.Result))}, nil
	case "append":
		return []string{fmt.Sprintf("%s = coreAppend(%s, %s)", goLiteral(stmt.Target), goLiteral(stmt.Target), goLiteral(stmt.Value))}, nil
	case "regex_match":
		return []string{fmt.Sprintf("%s = coreRegexMatch(%s, %s)", goName(stmt.Result), goAttrValue(stmt.Op, "pattern"), goLiteral(stmt.Value))}, nil
	case "string_join":
		return []string{fmt.Sprintf("%s = _core_string_join(%s, %s)", goName(stmt.Result), goAttrValue(stmt.Op, "sep"), goLiteral(stmt.Value))}, nil
	case "string_trim":
		return []string{fmt.Sprintf("%s = coreStringTrim(%s)", goName(stmt.Result), goLiteral(stmt.Value))}, nil
	case "type_is":
		return []string{fmt.Sprintf("%s = coreTypeIs(%s, %s)", goName(stmt.Result), goLiteral(stmt.Value), goAttrValue(stmt.Op, "type"))}, nil
	case "set":
		return []string{fmt.Sprintf("coreSet(%s, %s, %s)", goLiteral(stmt.Target), goLiteral(stmt.Key), goLiteral(stmt.Value))}, nil
	case "for":
		return emitGoFor(names, stmt)
	case "if":
		return emitGoIf(names, stmt)
	case "loop":
		return emitGoLoop(names, stmt)
	case "return":
		if _, ok := Attr(stmt.Op, "value"); !ok {
			return []string{"panic(coreReturn{value: nil})"}, nil
		}
		return []string{fmt.Sprintf("panic(coreReturn{value: %s})", goAttrValue(stmt.Op, "value"))}, nil
	case "raise":
		if _, ok := Attr(stmt.Op, "error"); ok {
			return []string{fmt.Sprintf("panic(asAxError(%s))", goAttrValue(stmt.Op, "error"))}, nil
		}
		return []string{fmt.Sprintf("panic(AxError{Category: \"runtime\", Message: %s})", strconv.Quote(stmt.Message))}, nil
	case "try":
		return emitGoTry(names, stmt)
	default:
		return nil, fmt.Errorf("unsupported Go Core op %q", stmt.Op.Name)
	}
}

func emitGoFor(names map[string]string, stmt CoreStmt) ([]string, error) {
	lines := []string{fmt.Sprintf("for _, %s = range coreIter(%s) {", goName(stmt.Item), goLiteral(stmt.Iter)), "	var coreLoopSignal any", "	func() {", "		defer func() {", "			if r := recover(); r != nil {", "				switch r.(type) {", "				case coreBreak, coreContinue:", "					coreLoopSignal = r", "				default:", "					panic(r)", "				}", "			}", "		}()"}
	bodyLines, err := emitGoRegionBlock(names, firstBodyBlock(stmt))
	if err != nil {
		return nil, err
	}
	for _, line := range bodyLines {
		lines = append(lines, "	"+line)
	}
	lines = append(lines, "	}()", "	if _, ok := coreLoopSignal.(coreBreak); ok { break }", "	if _, ok := coreLoopSignal.(coreContinue); ok { continue }", "}")
	return lines, nil
}

func emitGoIf(names map[string]string, stmt CoreStmt) ([]string, error) {
	cond := goLiteral(stmt.Cond)
	lines := []string{fmt.Sprintf("if coreTruthy(%s) {", cond)}
	thenLines, err := emitGoRegionBlock(names, firstBodyBlock(stmt))
	if err != nil {
		return nil, err
	}
	lines = append(lines, thenLines...)
	lines = append(lines, "} else {")
	elseBlock := CoreBlock{}
	if len(stmt.Regions) > 1 && len(stmt.Regions[1].Blocks) > 0 {
		elseBlock = stmt.Regions[1].Blocks[0]
	}
	elseLines, err := emitGoRegionBlock(names, elseBlock)
	if err != nil {
		return nil, err
	}
	lines = append(lines, elseLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitGoLoop(names map[string]string, stmt CoreStmt) ([]string, error) {
	lines := []string{"for {", "	var coreLoopSignal any", "	func() {", "		defer func() {", "			if r := recover(); r != nil {", "				switch r.(type) {", "				case coreBreak, coreContinue:", "					coreLoopSignal = r", "				default:", "					panic(r)", "				}", "			}", "		}()"}
	bodyLines, err := emitGoRegionBlock(names, firstBodyBlock(stmt))
	if err != nil {
		return nil, err
	}
	for _, line := range bodyLines {
		lines = append(lines, "	"+line)
	}
	lines = append(lines, "	}()", "	if _, ok := coreLoopSignal.(coreBreak); ok { break }", "	if _, ok := coreLoopSignal.(coreContinue); ok { continue }", "}")
	return lines, nil
}

func emitGoTry(names map[string]string, stmt CoreStmt) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must contain exactly try and catch regions")
	}
	errorRef := AttrString(stmt.Op, "error")
	if errorRef == "" {
		return nil, fmt.Errorf("core.try missing error binding")
	}
	lines := []string{"func() {", "	var coreCaught any", "	func() {", "		defer func() {", "			if r := recover(); r != nil {", "				switch r.(type) {", "				case coreReturn, coreBreak, coreContinue:", "					panic(r)", "				default:", "					coreCaught = r", "				}", "			}", "		}()"}
	tryLines, err := emitGoRegionBlock(names, firstBodyBlock(stmt))
	if err != nil {
		return nil, err
	}
	for _, line := range tryLines {
		lines = append(lines, "	"+line)
	}
	lines = append(lines, "	}()", "	if coreCaught != nil {", fmt.Sprintf("		%s = errorValue(coreCaught)", goName(errorRef)))
	catchBlock := CoreBlock{}
	if len(stmt.Regions[1].Blocks) > 0 {
		catchBlock = stmt.Regions[1].Blocks[0]
	}
	catchLines, err := emitGoRegionBlock(names, catchBlock)
	if err != nil {
		return nil, err
	}
	for _, line := range catchLines {
		lines = append(lines, "	"+line)
	}
	lines = append(lines, "	}", "}()")
	return lines, nil
}

func emitGoRegionBlock(names map[string]string, block CoreBlock) ([]string, error) {
	if len(block.Stmts) == 0 {
		return []string{"// empty"}, nil
	}
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitGoCoreStmt(names, child)
		if err != nil {
			return nil, err
		}
		for _, line := range childLines {
			lines = append(lines, "	"+line)
		}
		if goStmtIsTerminal(child) {
			break
		}
	}
	return lines, nil
}

func goStmtIsTerminal(stmt CoreStmt) bool {
	switch stmt.Kind {
	case "return", "raise", "break", "continue":
		return true
	case "if":
		if len(stmt.Regions) != 2 {
			return false
		}
		return goBodyIsTerminal(stmt.Regions[0]) && goBodyIsTerminal(stmt.Regions[1])
	default:
		return false
	}
}

func goBodyIsTerminal(body CoreBody) bool {
	if len(body.Blocks) == 0 {
		return false
	}
	block := body.Blocks[0]
	if len(block.Stmts) == 0 {
		return false
	}
	return goStmtIsTerminal(block.Stmts[len(block.Stmts)-1])
}

func goCallee(names map[string]string, callee string) string {
	if strings.HasPrefix(callee, "@") {
		symbol := Symbol(callee)
		if name, ok := names[symbol]; ok {
			return name
		}
		return "_" + symbol
	}
	if target, ok := coreIntrinsicPython[CoreIntrinsic(callee)]; ok {
		return target
	}
	return callee
}

func goAttrValue(op Operation, name string) string {
	attr, ok := Attr(op, name)
	if !ok {
		return "nil"
	}
	return goLiteral(attr.Value)
}

func goLiteral(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return "nil"
	case string:
		if strings.HasPrefix(v, "%") {
			return goName(v)
		}
		return strconv.Quote(v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return strconv.Quote(fmt.Sprint(v))
	}
}

func goName(value string) string {
	name := strings.TrimPrefix(value, "%")
	name = strings.ReplaceAll(name, "-", "_")
	switch name {
	case "type", "map", "func", "range", "var", "return", "default", "case", "switch", "defer", "go", "select":
		return "v_" + name
	default:
		return "v_" + name
	}
}
