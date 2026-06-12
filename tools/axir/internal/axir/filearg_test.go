package axir

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFileArgModule(t *testing.T, dir, dataRel, dataContent string) string {
	t.Helper()
	if dataContent != "" {
		dataPath := filepath.Join(dir, dataRel)
		if err := os.MkdirAll(filepath.Dir(dataPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(dataPath, []byte(dataContent), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	src := `module @filearg version "0.1" {
  dialect @core version "0.1"

  op core.func @demo {
    type signature = "() -> json"
    body @entry() {
      %parsed = core.call intrinsic.json.parse(file "` + dataRel + `")
      core.return %parsed
    }
  }
}
`
	path := filepath.Join(dir, "root.axir")
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFileArgLoadSubstitutesContent(t *testing.T) {
	dir := t.TempDir()
	root := writeFileArgModule(t, dir, "data/values.json", `{"alpha":1}`)
	bundle, err := LoadBundle(root)
	if err != nil {
		t.Fatal(err)
	}
	op := bundle.Modules[0].Ops[0].Regions[0].Blocks[0].Ops[0]
	attr, ok := Attr(op, "args")
	if !ok || len(attr.Values) != 1 {
		t.Fatalf("expected one call arg, got %#v", op.Attributes)
	}
	if attr.Values[0] != `{"alpha":1}` {
		t.Fatalf("file arg not substituted: %#v", attr.Values[0])
	}
}

func TestFileArgFormatRoundTrip(t *testing.T) {
	dir := t.TempDir()
	root := writeFileArgModule(t, dir, "data/values.json", `{"alpha":1}`)
	raw, err := os.ReadFile(root)
	if err != nil {
		t.Fatal(err)
	}
	mod, err := ParseModule(string(raw), root)
	if err != nil {
		t.Fatal(err)
	}
	text := FormatModuleCompact(mod)
	if !strings.Contains(text, `core.call intrinsic.json.parse(file "data/values.json")`) {
		t.Fatalf("file arg lost in formatting:\n%s", text)
	}
	if _, err := ParseModule(text, root); err != nil {
		t.Fatal(err)
	}
}

func TestFileArgMissingFileErrors(t *testing.T) {
	dir := t.TempDir()
	root := writeFileArgModule(t, dir, "data/missing.json", "")
	_, err := LoadBundle(root)
	if err == nil || !strings.Contains(err.Error(), "data/missing.json") {
		t.Fatalf("expected missing-file error, got %v", err)
	}
}

func TestFileArgInvalidJSONErrors(t *testing.T) {
	dir := t.TempDir()
	root := writeFileArgModule(t, dir, "data/bad.json", "{not json")
	_, err := LoadBundle(root)
	if err == nil || !strings.Contains(err.Error(), "not valid JSON") {
		t.Fatalf("expected invalid-JSON error, got %v", err)
	}
}
