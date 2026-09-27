package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func main() {
	// G1 antidote gate: register the real goja engine for agent_runtime_real fixtures.
	// This binary is package main and can import goja without the package-ax import cycle.
	ax.RegisterConformanceRealRuntime("javascript", func(options map[string]ax.Value) (ax.CodeRuntime, error) {
		return axgoja.NewRuntime(), nil
	})
	if len(os.Args) < 2 {
		fmt.Println("go-conformance-ok")
		return
	}
	for _, root := range os.Args[1:] {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") { return nil }
			data, err := os.ReadFile(path)
			if err != nil { panic(err) }
			fixture := ax.ParseJSON(string(data))
			name := strings.TrimSuffix(filepath.Base(path), ".json")
			if reason := ax.ConformanceSkipReason(fixture); reason != "" {
				fmt.Printf("skip %s: %s\n", name, reason)
				return nil
			}
			if err := ax.RunConformanceFixture(fixture); err != nil { panic(err) }
			fmt.Println("ok", name)
			return nil
		})
	}
}
