package axir

import (
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
		modules = append(modules, mod)
		dir := filepath.Dir(clean)
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
