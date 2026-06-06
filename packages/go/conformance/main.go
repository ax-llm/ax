package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	ax "github.com/ax-llm/ax/go"
)

func main() {
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
			if err := ax.RunConformanceFixture(fixture); err != nil { panic(err) }
			name := strings.TrimSuffix(filepath.Base(path), ".json")
			fmt.Println("ok", name)
			return nil
		})
	}
}
