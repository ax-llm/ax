package axir

import (
	"strings"
	"testing"
)

func parseTypeFixture(t *testing.T, src string) (Bundle, map[string]Operation) {
	t.Helper()
	module, err := ParseModule(src, "fixture.axir")
	if err != nil {
		t.Fatal(err)
	}
	bundle := Bundle{Root: "fixture", Modules: []Module{module}}
	symbols := map[string]Operation{}
	for _, op := range module.Ops {
		if op.Symbol != "" {
			symbols[op.Symbol] = op
		}
	}
	return bundle, symbols
}

func typeFixture(body string) string {
	return "module @fixture version \"0.1\" {\n  dialect @core version \"0.1\"\n\n" + body + "\n}\n"
}

func diagnosticsContaining(t *testing.T, ds Diagnostics, severity, fragment string) int {
	t.Helper()
	count := 0
	for _, d := range ds {
		if d.Severity == severity && strings.Contains(d.Message, fragment) {
			count++
		}
	}
	return count
}

func TestCheckTypesDiagnostics(t *testing.T) {
	bundle, symbols := parseTypeFixture(t, typeFixture(`  op core.func @broken_sig {
    type signature = "(json -> json"
  }

  op core.func @unknown_named {
    type signature = "(json) -> NotDeclared"
  }

  op core.func @config_in_type_slot {
    type endpoint = "https://example.com"
  }

  op core.record @Declared {
    type fields = "name:string"
  }

  op core.func @uses_declared {
    type signature = "(Declared) -> json"
  }`))
	ds := CheckTypes(bundle, symbols)
	if got := diagnosticsContaining(t, ds, "error", "broken_sig"); got != 1 {
		t.Fatalf("broken signature diagnostics = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "error", `unknown type "NotDeclared"`); got != 1 {
		t.Fatalf("unknown named type diagnostics = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "error", "config values belong in attr slots"); got != 1 {
		t.Fatalf("type-slot abuse diagnostics = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "error", "uses_declared"); got != 0 {
		t.Fatalf("declared type should resolve cleanly, got %v", ds)
	}
}

const typeUsageFixture = `  op core.func @thrower {
    type signature = "(json) -> json throws"
    region @body {
      block @entry(%value: json) {
        op core.return {
          attr value = %value
        }
      }
    }
  }

  op core.func @bad_arity {
    type signature = "(json) -> json throws"
    body @entry(%value: json) {
      %out = core.call @thrower(%value, %value)
      core.return %out
    }
  }

  op core.func @unguarded_caller {
    type signature = "(json) -> json"
    body @entry(%value: json) {
      %out = core.call @thrower(%value)
      core.return %out
    }
  }

  op core.func @guarded_caller {
    type signature = "(json) -> json"
    body @entry(%value: json) {
      %fallback = core.let %value
      core.try {
        %out = core.call @thrower(%value)
        core.return %out
      } catch %err {
        core.return %fallback
      }
    }
  }

  op core.func @silent_raiser {
    type signature = "(json) -> json"
    body @entry(%value: json) {
      %is_bad = core.call intrinsic.is_none(%value)
      core.if %is_bad {
        %err = core.call intrinsic.error.runtime("bad value")
        core.raise %err
      } else {
      }
      core.return %value
    }
  }

  op core.func @kind_misuse {
    type signature = "(json) -> string"
    body @entry(%value: json) {
      %text = core.string_trim %value
      core.append %text, %value
      %joined = core.string_join %text sep ""
      core.return %joined
    }
  }

  op core.func @rebinder {
    type signature = "(json) -> json"
    body @entry(%value: json) {
      %thing = core.list
      %thing = core.map
      core.return %thing
    }
  }`

func TestCheckTypeUsageDiagnostics(t *testing.T) {
	bundle, symbols := parseTypeFixture(t, typeFixture(typeUsageFixture))
	ds := CheckTypeUsage(bundle, symbols, CheckOptions{})
	if got := diagnosticsContaining(t, ds, "error", "@bad_arity: calls @thrower with 2"); got != 1 {
		t.Fatalf("arity diagnostics = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "error", "@unguarded_caller: calls @thrower which throws"); got != 1 {
		t.Fatalf("unguarded throws diagnostics = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "error", "@guarded_caller"); got != 0 {
		t.Fatalf("core.try-guarded call should pass, got %v", ds)
	}
	if got := diagnosticsContaining(t, ds, "error", "@silent_raiser: raises but does not declare throws"); got != 1 {
		t.Fatalf("raise diagnostics = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "warning", "core.append target is %text"); got != 1 {
		t.Fatalf("kind warning = %d, want 1 (%v)", got, ds)
	}
	if got := diagnosticsContaining(t, ds, "warning", "rebinds"); got != 0 {
		t.Fatalf("rebind warning should require strict mode, got %v", ds)
	}

	strict := CheckTypeUsage(bundle, symbols, CheckOptions{StrictTypes: true})
	if got := diagnosticsContaining(t, strict, "warning", "rebinds %thing from list to map"); got != 1 {
		t.Fatalf("strict rebind warning = %d, want 1 (%v)", got, strict)
	}
}
