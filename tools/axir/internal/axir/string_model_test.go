package axir

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// Fixtures marked requires_lone_surrogates split a surrogate pair across
// stream chunks, which only runners whose strings can hold a lone surrogate
// represent: UTF-16 units (Java), code points (Python), WTF-8 bytes (C++ and
// Go, whose JSON decoding keeps a lone surrogate escape as its 3 WTF-8
// bytes), or Rust's private-use mark for one (a Rust string is strict UTF-8).
// A runner that can't would skip them. Each runner declares its string model
// once, and this test keeps that flag from silently skipping anywhere: every
// runner declares the model it has, and all five run those fixtures.
func TestLoneSurrogateFixturesHaveARunner(t *testing.T) {
	declarations := []struct {
		template string
		pattern  string
		want     string
	}{
		{"templates/python/pyConformance.py", `SUPPORTS_LONE_SURROGATES = (True|False)\b`, "True"},
		{"templates/java/javaConformance.java", `SUPPORTS_LONE_SURROGATES = (true|false);`, "true"},
		{"templates/go/goRuntime.go.txt", `supportsLoneSurrogates = (true|false)\b`, "true"},
		{"templates/rust/rustLib.rs", `SUPPORTS_LONE_SURROGATES: bool = (true|false);`, "true"},
		{"templates/cpp/cppConformance.cpp", `kSupportsLoneSurrogates = (true|false);`, "true"},
	}
	for _, declaration := range declarations {
		source, err := os.ReadFile(declaration.template)
		if err != nil {
			t.Fatalf("read %s: %v", declaration.template, err)
		}
		match := regexp.MustCompile(declaration.pattern).FindSubmatch(source)
		if match == nil {
			t.Errorf("%s does not declare its string model (%s)", declaration.template, declaration.pattern)
			continue
		}
		if got := string(match[1]); got != declaration.want {
			t.Errorf("%s declares lone-surrogate support %s, want %s", declaration.template, got, declaration.want)
		}
	}

	paths, err := filepath.Glob(filepath.Join(repoRootPath(), "ir", "conformance", "*", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	flagged := 0
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		var fixture map[string]any
		if err := json.Unmarshal(raw, &fixture); err != nil {
			continue
		}
		if required, _ := fixture["requires_lone_surrogates"].(bool); required {
			flagged++
		}
	}
	if flagged == 0 {
		t.Fatal("no fixture requires lone surrogates; drop this test or the runner declarations together")
	}
}
