package axir

import (
	"fmt"
	"strconv"
	"strings"
)

// coreIntrinsicGoRaising lists the intrinsics whose Go helpers return
// (Value, error) because the operation can raise. Everything else in
// coreIntrinsicPython stays a plain Value helper. This mirrors the Rust
// emitter where raising helpers return Result and pure helpers are total;
// in Go the split keeps the hot pure path free of error plumbing.
var coreIntrinsicGoRaising = map[CoreIntrinsic]bool{
	IntrinsicToolInvoke:          true,
	IntrinsicAICompleteOnce:      true,
	IntrinsicObjectCallMethod:    true,
	IntrinsicJSONParse:           true,
	IntrinsicAxGenRunAssertions:  true,
	IntrinsicAgentStageForward:   true,
	IntrinsicAgentRuntimeCreate:  true,
	IntrinsicAgentRuntimeExecute: true,
	IntrinsicAgentRuntimeInspect: true,
	IntrinsicAgentRuntimeExport:  true,
	IntrinsicAgentRuntimeRestore: true,
	IntrinsicPromptStructured:    true,
	IntrinsicStringFindQuoted:    true,
	IntrinsicStringSplitQuoted:   true,
	IntrinsicStringConsumeOpt:    true,
	IntrinsicStringExtractSuf:    true,
}

func BuildGoCore(model AxRuntimeModel) (string, error) {
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return "", err
	}
	body, err := emitGoCoreFunctions(model, specs, CoreFuncNames(specs))
	if err != nil {
		return "", err
	}
	return mustInject(goRuntime, "// AXIR_CORE_GO_FUNCTIONS\n", body, "goRuntime")
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

// goEmitCtx tracks lexical position the same way rustEmitCtx does:
// closureDepth > 0 means statements live inside a core.try closure where
// non-local exits travel through coreFlow values instead of plain control
// flow; loopInClosure records, per enclosing loop, whether that loop began
// inside the current closure (break/continue inside it stay native).
type goEmitCtx struct {
	names         map[string]string
	closureDepth  int
	loopInClosure []bool
}

func (ctx *goEmitCtx) inClosure() bool { return ctx.closureDepth > 0 }

func (ctx *goEmitCtx) loopIsLocal() bool {
	if len(ctx.loopInClosure) == 0 {
		return false
	}
	return ctx.loopInClosure[len(ctx.loopInClosure)-1]
}

// errReturn is the statement used to propagate an error from the current
// lexical scope: emitted functions return (Value, error) and try closures
// return (coreFlow, error).
func (ctx *goEmitCtx) errReturn() string {
	if ctx.inClosure() {
		return "return coreFlow{}, err"
	}
	return "return nil, err"
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
	fmt.Fprintf(&b, "func %s(args ...Value) (Value, error) {\n", name)
	fmt.Fprintf(&b, "\taxirCoverageMark(%q)\n", name)
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
	ctx := &goEmitCtx{names: names}
	emittedTerminal := false
	for _, stmt := range block.Stmts {
		lines, err := emitGoCoreStmt(ctx, stmt)
		if err != nil {
			return "", fmt.Errorf("@%s: %w", op.Symbol, err)
		}
		for _, line := range lines {
			fmt.Fprintf(&b, "	%s\n", line)
		}
		if goStmtIsTerminal(ctx, stmt) {
			emittedTerminal = true
			break
		}
	}
	if !emittedTerminal {
		b.WriteString("	return nil, nil\n")
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

func emitGoCoreStmt(ctx *goEmitCtx, stmt CoreStmt) ([]string, error) {
	switch stmt.Kind {
	case "break":
		if ctx.inClosure() && !ctx.loopIsLocal() {
			return []string{"return coreFlow{kind: coreFlowBreak}, nil"}, nil
		}
		return []string{"break"}, nil
	case "continue":
		if ctx.inClosure() && !ctx.loopIsLocal() {
			return []string{"return coreFlow{kind: coreFlowContinue}, nil"}, nil
		}
		return []string{"continue"}, nil
	case "call":
		return emitGoCall(ctx, stmt)
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
		return []string{fmt.Sprintf("if err := coreSet(%s, %s, %s); err != nil { %s }",
			goLiteral(stmt.Target), goLiteral(stmt.Key), goLiteral(stmt.Value), ctx.errReturn())}, nil
	case "for":
		return emitGoFor(ctx, stmt)
	case "if":
		return emitGoIf(ctx, stmt)
	case "loop":
		return emitGoLoop(ctx, stmt)
	case "return":
		value := "nil"
		if _, ok := Attr(stmt.Op, "value"); ok {
			value = goAttrValue(stmt.Op, "value")
		}
		if ctx.inClosure() {
			return []string{fmt.Sprintf("return coreFlow{kind: coreFlowReturn, value: %s}, nil", value)}, nil
		}
		return []string{fmt.Sprintf("return %s, nil", value)}, nil
	case "raise":
		errExpr := fmt.Sprintf("AxError{Category: \"runtime\", Message: %s}", strconv.Quote(stmt.Message))
		if _, ok := Attr(stmt.Op, "error"); ok {
			errExpr = fmt.Sprintf("asAxError(%s)", goAttrValue(stmt.Op, "error"))
		}
		if ctx.inClosure() {
			return []string{fmt.Sprintf("return coreFlow{}, %s", errExpr)}, nil
		}
		return []string{fmt.Sprintf("return nil, %s", errExpr)}, nil
	case "try":
		return emitGoTry(ctx, stmt)
	default:
		return nil, fmt.Errorf("unsupported Go Core op %q", stmt.Op.Name)
	}
}

func emitGoCall(ctx *goEmitCtx, stmt CoreStmt) ([]string, error) {
	callee, raising, err := goCallee(ctx.names, stmt.Callee)
	if err != nil {
		return nil, err
	}
	args := make([]string, 0, len(stmt.Args))
	for _, arg := range stmt.Args {
		args = append(args, goLiteral(arg))
	}
	call := fmt.Sprintf("%s(%s)", callee, strings.Join(args, ", "))
	if raising {
		if stmt.Result != "" {
			return []string{fmt.Sprintf("{ v, err := %s; if err != nil { %s }; %s = v }", call, ctx.errReturn(), goName(stmt.Result))}, nil
		}
		return []string{fmt.Sprintf("if _, err := %s; err != nil { %s }", call, ctx.errReturn())}, nil
	}
	if stmt.Result != "" {
		return []string{fmt.Sprintf("%s = %s", goName(stmt.Result), call)}, nil
	}
	return []string{call}, nil
}

func emitGoFor(ctx *goEmitCtx, stmt CoreStmt) ([]string, error) {
	if stmt.Item == "" || stmt.Iter == "" {
		return nil, fmt.Errorf("core.for missing item or in")
	}
	lines := []string{fmt.Sprintf("for _, %s = range coreIter(%s) {", goName(stmt.Item), goLiteral(stmt.Iter))}
	ctx.loopInClosure = append(ctx.loopInClosure, ctx.inClosure())
	bodyLines, err := emitGoRegionBlock(ctx, firstBodyBlock(stmt))
	ctx.loopInClosure = ctx.loopInClosure[:len(ctx.loopInClosure)-1]
	if err != nil {
		return nil, err
	}
	lines = append(lines, bodyLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitGoLoop(ctx *goEmitCtx, stmt CoreStmt) ([]string, error) {
	lines := []string{"for {"}
	ctx.loopInClosure = append(ctx.loopInClosure, ctx.inClosure())
	bodyLines, err := emitGoRegionBlock(ctx, firstBodyBlock(stmt))
	ctx.loopInClosure = ctx.loopInClosure[:len(ctx.loopInClosure)-1]
	if err != nil {
		return nil, err
	}
	lines = append(lines, bodyLines...)
	lines = append(lines, "}")
	return lines, nil
}

func emitGoIf(ctx *goEmitCtx, stmt CoreStmt) ([]string, error) {
	cond := goLiteral(stmt.Cond)
	lines := []string{fmt.Sprintf("if coreTruthy(%s) {", cond)}
	thenLines, err := emitGoRegionBlock(ctx, firstBodyBlock(stmt))
	if err != nil {
		return nil, err
	}
	lines = append(lines, thenLines...)
	lines = append(lines, "} else {")
	elseBlock := CoreBlock{}
	if len(stmt.Regions) > 1 && len(stmt.Regions[1].Blocks) > 0 {
		elseBlock = stmt.Regions[1].Blocks[0]
	}
	elseLines, err := emitGoRegionBlock(ctx, elseBlock)
	if err != nil {
		return nil, err
	}
	lines = append(lines, elseLines...)
	lines = append(lines, "}")
	return lines, nil
}

// emitGoTry lowers core.try to an immediately-invoked closure returning
// (coreFlow, error), mirroring the Rust emitter's closures returning
// Result<CoreFlow, AxError>. The raised error arrives as the closure's
// error; non-local exits (return/break/continue crossing the closure)
// arrive as coreFlow values and are re-dispatched in the enclosing scope.
func emitGoTry(ctx *goEmitCtx, stmt CoreStmt) ([]string, error) {
	if len(stmt.Regions) != 2 {
		return nil, fmt.Errorf("core.try must contain exactly try and catch regions")
	}
	errorRef := AttrString(stmt.Op, "error")
	if errorRef == "" {
		return nil, fmt.Errorf("core.try missing error binding")
	}
	lines := []string{"{", "	__flow, __err := func() (coreFlow, error) {"}
	ctx.closureDepth++
	tryLines, err := emitGoRegionBlock(ctx, firstBodyBlock(stmt))
	bodyTerminal := goBlockIsTerminal(ctx, firstBodyBlock(stmt))
	ctx.closureDepth--
	if err != nil {
		return nil, err
	}
	for _, line := range tryLines {
		lines = append(lines, "	"+line)
	}
	if !bodyTerminal {
		lines = append(lines, "		return coreFlow{}, nil")
	}
	lines = append(lines, "	}()")
	if ctx.inClosure() {
		lines = append(lines, "	if __err == nil && __flow.kind != coreFlowNormal { return __flow, nil }")
	} else {
		lines = append(lines, "	if __err == nil && __flow.kind == coreFlowReturn { return __flow.value, nil }")
		// Break/continue arms are emitted only when the try body can produce
		// that flow kind; an always-present break arm would make enclosing
		// `for {}` loops syntactically breakable and break the terminating-
		// statement analysis shared with goStmtIsTerminal.
		if len(ctx.loopInClosure) > 0 {
			if goRegionHasExit(stmt.Regions[0], "break") {
				lines = append(lines, "	if __err == nil && __flow.kind == coreFlowBreak { break }")
			}
			if goRegionHasExit(stmt.Regions[0], "continue") {
				lines = append(lines, "	if __err == nil && __flow.kind == coreFlowContinue { continue }")
			}
		}
	}
	lines = append(lines, "	if __err != nil {")
	lines = append(lines, fmt.Sprintf("		%s = errorValue(__err)", goName(errorRef)))
	catchBlock := CoreBlock{}
	if len(stmt.Regions[1].Blocks) > 0 {
		catchBlock = stmt.Regions[1].Blocks[0]
	}
	catchLines, err := emitGoRegionBlock(ctx, catchBlock)
	if err != nil {
		return nil, err
	}
	for _, line := range catchLines {
		lines = append(lines, "	"+line)
	}
	lines = append(lines, "	}", "}")
	return lines, nil
}

func emitGoRegionBlock(ctx *goEmitCtx, block CoreBlock) ([]string, error) {
	if len(block.Stmts) == 0 {
		return []string{"// empty"}, nil
	}
	var lines []string
	for _, child := range block.Stmts {
		childLines, err := emitGoCoreStmt(ctx, child)
		if err != nil {
			return nil, err
		}
		for _, line := range childLines {
			lines = append(lines, "	"+line)
		}
		if goStmtIsTerminal(ctx, child) {
			break
		}
	}
	return lines, nil
}

func goStmtIsTerminal(ctx *goEmitCtx, stmt CoreStmt) bool {
	switch stmt.Kind {
	case "return", "raise", "break", "continue":
		return true
	case "if":
		if len(stmt.Regions) != 2 {
			return false
		}
		return goBodyIsTerminal(ctx, stmt.Regions[0]) && goBodyIsTerminal(ctx, stmt.Regions[1])
	case "loop":
		// A core.loop without a break emits `for { ... }`, which is a Go
		// terminating statement: anything after it would trip go vet's
		// unreachable check, and a function ending with it needs no return.
		return !goLoopHasBreak(firstRegionBody(stmt))
	default:
		return false
	}
}

// goLoopHasBreak reports whether a loop body contains a break bound to that
// loop. Breaks inside nested loops bind the inner loop; breaks inside
// core.try bodies surface as a native break at the try's flow dispatch, so
// try regions are searched.
func goLoopHasBreak(body CoreBody) bool {
	return goRegionHasExit(body, "break")
}

// goRegionHasExit reports whether a region contains a break/continue that
// escapes it (i.e. one not bound to a loop nested inside the region).
func goRegionHasExit(body CoreBody, kind string) bool {
	for _, block := range body.Blocks {
		for _, stmt := range block.Stmts {
			switch stmt.Kind {
			case kind:
				return true
			case "for", "loop":
				continue
			default:
				for _, region := range stmt.Regions {
					if goRegionHasExit(region, kind) {
						return true
					}
				}
			}
		}
	}
	return false
}

func goBodyIsTerminal(ctx *goEmitCtx, body CoreBody) bool {
	if len(body.Blocks) == 0 {
		return false
	}
	return goBlockIsTerminal(ctx, body.Blocks[0])
}

func goBlockIsTerminal(ctx *goEmitCtx, block CoreBlock) bool {
	if len(block.Stmts) == 0 {
		return false
	}
	return goStmtIsTerminal(ctx, block.Stmts[len(block.Stmts)-1])
}

func goCallee(names map[string]string, callee string) (string, bool, error) {
	if strings.HasPrefix(callee, "@") {
		symbol := Symbol(callee)
		name, ok := names[symbol]
		if !ok {
			return "", false, fmt.Errorf("call to unknown core symbol @%s", symbol)
		}
		return name, true, nil
	}
	if target, ok := coreIntrinsicPython[CoreIntrinsic(callee)]; ok {
		return target, coreIntrinsicGoRaising[CoreIntrinsic(callee)], nil
	}
	return "", false, fmt.Errorf("intrinsic %q has no Go helper yet; add it to coreIntrinsicPython and the Go runtime", callee)
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
