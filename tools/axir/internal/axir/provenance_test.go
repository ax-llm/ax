package axir

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMustInject(t *testing.T) {
	out, err := mustInject("a\nMARKER\nb\n", "MARKER\n", "body\n", "tpl")
	if err != nil || out != "a\nbody\nb\n" {
		t.Fatalf("unexpected inject result %q, %v", out, err)
	}
	if _, err := mustInject("a\nb\n", "MARKER\n", "body\n", "tpl"); err == nil || !strings.Contains(err.Error(), "missing marker") {
		t.Fatalf("expected missing-marker error, got %v", err)
	}
	if _, err := mustInject("MARKER\nMARKER\n", "MARKER\n", "body\n", "tpl"); err == nil || !strings.Contains(err.Error(), "2 times") {
		t.Fatalf("expected duplicate-marker error, got %v", err)
	}
}

func emitFilesForAudit(t *testing.T, model AxRuntimeModel, target string, emit func(AxRuntimeModel, string) error) map[string]string {
	t.Helper()
	dir := t.TempDir()
	if err := emit(model, dir); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		switch filepath.Ext(path) {
		case ".py", ".go", ".java", ".cpp", ".hpp", ".rs":
			rel, _ := filepath.Rel(dir, path)
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files[filepath.ToSlash(rel)] = string(content)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func auditModel(t *testing.T) AxRuntimeModel {
	t.Helper()
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	model, err := BuildRuntimeModel(LowerToCore(bundle))
	if err != nil {
		t.Fatal(err)
	}
	return model
}

func TestAuditProvenanceCleanOnAxCore(t *testing.T) {
	model := auditModel(t)
	for target, emit := range map[string]func(AxRuntimeModel, string) error{
		"python": EmitPython,
		"java":   EmitJava,
		"cpp":    EmitCpp,
		"go":     EmitGo,
	} {
		files := emitFilesForAudit(t, model, target, emit)
		report, err := AuditProvenance(model, target, files)
		if err != nil {
			t.Fatalf("%s: %v", target, err)
		}
		if len(report.Violations) != 0 {
			t.Fatalf("%s: unexpected violations: %v", target, report.Violations)
		}
		if report.EmittedFunctions == 0 {
			t.Fatalf("%s: audit found no emitted functions", target)
		}
	}
}

func TestAuditProvenanceCatchesShadowDefinition(t *testing.T) {
	model := auditModel(t)
	files := emitFilesForAudit(t, model, "python", EmitPython)
	files["axllm/tool.py"] += "\ndef parse_signature(raw):\n    return None\n"
	report, err := AuditProvenance(model, "python", files)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, violation := range report.Violations {
		if strings.Contains(violation, "parse_signature") && strings.Contains(violation, "axllm/tool.py") {
			found = true
		}
	}
	if !found {
		t.Fatalf("shadow definition not detected: %v", report.Violations)
	}
}

func TestAuditProvenanceCatchesMissingDefinition(t *testing.T) {
	model := auditModel(t)
	files := emitFilesForAudit(t, model, "python", EmitPython)
	content := files["axllm/signature.py"]
	if !strings.Contains(content, "def parse_signature(") {
		t.Fatal("fixture assumption broken: parse_signature not in signature.py")
	}
	files["axllm/signature.py"] = strings.Replace(content, "def parse_signature(", "def parse_signature_renamed(", 1)
	report, err := AuditProvenance(model, "python", files)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, violation := range report.Violations {
		if strings.Contains(violation, "parse_signature defined 0 times") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing definition not detected: %v", report.Violations)
	}
}

func TestAuditProvenanceCatchesBrokenRegion(t *testing.T) {
	model := auditModel(t)
	files := emitFilesForAudit(t, model, "go", EmitGo)
	files["axllm.go"] = strings.Replace(files["axllm.go"], "// END AXIR CORE EMITTED FUNCTIONS", "// gone", 1)
	report, err := AuditProvenance(model, "go", files)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Violations) == 0 || !strings.Contains(report.Violations[0], "region") {
		t.Fatalf("broken region not detected: %v", report.Violations)
	}
}
