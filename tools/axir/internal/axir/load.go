package axir

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func LoadBundle(root string) (Bundle, error) {
	seen := map[string]bool{}
	var modules []Module
	var load func(string) error
	load = func(file string) error {
		clean := filepath.Clean(file)
		if seen[clean] {
			return nil
		}
		seen[clean] = true
		data, err := os.ReadFile(clean)
		if err != nil {
			return err
		}
		mod, err := ParseModule(string(data), clean)
		if err != nil {
			return err
		}
		dir := filepath.Dir(clean)
		if err := resolveFileArgs(&mod, dir); err != nil {
			return err
		}
		modules = append(modules, mod)
		for _, imp := range mod.Imports {
			if err := load(filepath.Join(dir, imp.Path)); err != nil {
				return err
			}
		}
		return nil
	}
	if err := load(root); err != nil {
		return Bundle{}, err
	}
	return Bundle{Root: modules[0].Name, Modules: modules}, nil
}

// resolveFileArgs replaces file-backed compact-call arguments with the file
// content so lowering and emission see plain literals. Content must be valid
// JSON; paths resolve relative to the module.
func resolveFileArgs(mod *Module, dir string) error {
	var walk func(ops []Operation) error
	walk = func(ops []Operation) error {
		for i := range ops {
			op := &ops[i]
			for a := range op.Attributes {
				attr := &op.Attributes[a]
				values := attr.Values
				if len(values) == 0 {
					continue
				}
				for v := range values {
					fileArg, ok := values[v].(FileArg)
					if !ok {
						continue
					}
					path := filepath.Join(dir, fileArg.Path)
					data, err := os.ReadFile(path)
					if err != nil {
						return fmt.Errorf("%s:%d: file argument %q: %w", mod.File, op.Line, fileArg.Path, err)
					}
					if !json.Valid(data) {
						return fmt.Errorf("%s:%d: file argument %q is not valid JSON", mod.File, op.Line, fileArg.Path)
					}
					values[v] = string(data)
				}
			}
			if err := walk(op.Ops); err != nil {
				return err
			}
			for _, region := range op.Regions {
				for _, block := range region.Blocks {
					if err := walk(block.Ops); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	return walk(mod.Ops)
}
