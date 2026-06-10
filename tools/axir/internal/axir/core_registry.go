package axir

import (
	"fmt"
	"sort"
	"strings"
)

// CoreFuncSpec describes one Core-bodied function that every backend must
// emit from the IR. The registry is derived from the runtime model so a
// Core-bodied symbol can never be silently dropped from a target the way
// the old hand-maintained per-target spec arrays allowed.
type CoreFuncSpec struct {
	Symbol  string
	Name    string
	Module  string
	Private bool
	Line    int
}

// coreModuleRank orders emit modules by dependency depth. Generated code in
// a module may only call core functions at the same or lower rank, which
// keeps cross-module imports in module-per-file targets (python) acyclic:
// signature loads first, mcp last.
var coreModuleRank = map[string]int{
	"signature": 0,
	"schema":    1,
	"prompt":    2,
	"ai":        3,
	"gen":       4,
	"agent":     5,
	"program":   6,
	"flow":      6,
	"mcp":       7,
}

// pythonCoreModuleFile maps an emit module to the python module hosting it;
// program-level and flow-level functions share flow.py.
func pythonCoreModuleFile(module string) string {
	if module == "program" {
		return "flow"
	}
	return module
}

func nativeCoreFuncName(sym string, op Operation, private bool) string {
	if name := AttrString(op, "emit_name"); name != "" {
		return name
	}
	if private {
		return "_" + sym
	}
	return sym
}

// BuildCoreFuncRegistry derives the shared emission registry from the
// runtime model: every symbol with a Core-owned body, its single native
// name (identical across targets), and its emit module. It fails when a
// Core-bodied symbol lacks routing, when two symbols would collide on a
// native name, and when a body calls into a higher-rank module.
func BuildCoreFuncRegistry(model AxRuntimeModel) ([]CoreFuncSpec, error) {
	byName := map[string]string{}
	var specs []CoreFuncSpec
	for sym, source := range model.BodySources {
		if source != "core" {
			continue
		}
		op, ok := model.Symbols[sym]
		if !ok {
			return nil, fmt.Errorf("core function @%s missing from symbol table", sym)
		}
		module := model.EmitModules[sym]
		if module == "" {
			return nil, fmt.Errorf("core function @%s has no emit_module; every Core-bodied symbol must declare one", sym)
		}
		if _, known := coreModuleRank[module]; !known {
			return nil, fmt.Errorf("core function @%s has unknown emit_module %q", sym, module)
		}
		private := model.PrivateSymbols[sym]
		name := nativeCoreFuncName(sym, op, private)
		if prev, dup := byName[name]; dup {
			return nil, fmt.Errorf("core functions @%s and @%s both emit native name %q", prev, sym, name)
		}
		byName[name] = sym
		specs = append(specs, CoreFuncSpec{Symbol: sym, Name: name, Module: module, Private: private, Line: op.Line})
	}
	sort.Slice(specs, func(i, j int) bool {
		ri, rj := coreModuleRank[specs[i].Module], coreModuleRank[specs[j].Module]
		if ri != rj {
			return ri < rj
		}
		if specs[i].Line != specs[j].Line {
			return specs[i].Line < specs[j].Line
		}
		return specs[i].Symbol < specs[j].Symbol
	})
	if err := checkCoreModuleRanks(model, specs); err != nil {
		return nil, err
	}
	return specs, nil
}

// CoreFuncNames returns symbol -> native name for callee resolution.
func CoreFuncNames(specs []CoreFuncSpec) map[string]string {
	names := make(map[string]string, len(specs))
	for _, spec := range specs {
		names[spec.Symbol] = spec.Name
	}
	return names
}

func checkCoreModuleRanks(model AxRuntimeModel, specs []CoreFuncSpec) error {
	moduleOf := make(map[string]string, len(specs))
	symOfName := make(map[string]string, len(specs))
	for _, spec := range specs {
		moduleOf[spec.Symbol] = spec.Module
		symOfName[spec.Name] = spec.Symbol
	}
	for _, spec := range specs {
		body, err := BuildCoreBody(model.Symbols[spec.Symbol])
		if err != nil {
			return fmt.Errorf("core function @%s: %w", spec.Symbol, err)
		}
		callees := map[string]bool{}
		for _, block := range body.Blocks {
			collectCoreCallees(block.Stmts, callees)
		}
		for callee := range callees {
			if _, ok := moduleOf[callee]; !ok {
				resolved, byEmittedName := symOfName[callee]
				if !byEmittedName {
					continue // intrinsics and host names are validated by the checker
				}
				callee = resolved
			}
			calleeModule := moduleOf[callee]
			if coreModuleRank[calleeModule] > coreModuleRank[spec.Module] {
				return fmt.Errorf("core function @%s (module %s) calls @%s (module %s); calls must stay within same-or-lower-rank modules so generated imports remain acyclic",
					spec.Symbol, spec.Module, callee, calleeModule)
			}
		}
	}
	return nil
}

func collectCoreCallees(stmts []CoreStmt, out map[string]bool) {
	for _, stmt := range stmts {
		if strings.HasPrefix(stmt.Callee, "@") {
			out[Symbol(stmt.Callee)] = true
		} else if stmt.Callee != "" && !strings.HasPrefix(stmt.Callee, "intrinsic.") {
			// emitted-name string callees resolve like @refs so they cannot
			// bypass the rank rule
			out[stmt.Callee] = true
		}
		for _, region := range stmt.Regions {
			for _, block := range region.Blocks {
				collectCoreCallees(block.Stmts, out)
			}
		}
	}
}
