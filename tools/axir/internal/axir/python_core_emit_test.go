package axir

import (
	"reflect"
	"strings"
	"testing"
)

// TestPythonModuleMissingHelpers exercises the codegen-time guard that prevents
// a generated Python module from calling an underscore helper it never defines
// or imports (which would otherwise be a runtime NameError, since Python has no
// compile-time reference checking). buildPythonCoreModule fails generation when
// this returns a non-empty slice.
func TestPythonModuleMissingHelpers(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []string
	}{
		{
			name: "defined locally",
			text: "def _core_and(a, b):\n    return a and b\n\ndef use(x, y):\n    return _core_and(x, y)\n",
		},
		{
			name: "missing def is reported",
			text: "def use(x, y):\n    return _core_and(x, y)\n",
			want: []string{"_core_and"},
		},
		{
			name: "imported from sibling",
			text: "from .schema import (\n    _core_and,\n)\n\ndef use(x, y):\n    return _core_and(x, y)\n",
		},
		{
			name: "bound at module scope",
			text: "_core_and = staticmethod(op)\n\ndef use(x, y):\n    return _core_and(x, y)\n",
		},
		{
			name: "transitive reference inside a helper body",
			text: "def _core_fields_from_map(fields):\n    return [_nested_field(n, i) for n, i in fields.items()]\n",
			want: []string{"_nested_field"},
		},
		{
			name: "method calls are not helper calls",
			text: "def use(obj, x):\n    return obj._core_and(x)\n",
		},
		{
			name: "multiple missing are sorted and deduped",
			text: "def use(x):\n    _core_b(x)\n    _core_a(x)\n    _core_b(x)\n",
			want: []string{"_core_a", "_core_b"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := pythonModuleMissingHelpers(tc.text)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("pythonModuleMissingHelpers = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestBuildPythonCoreModuleRejectsMissingHelper drives the real generator with a
// template that is missing one helper def and asserts codegen fails loudly,
// naming the helper — the regression that previously only surfaced as a runtime
// NameError after regeneration.
func TestBuildPythonCoreModuleRejectsMissingHelper(t *testing.T) {
	_, model := buildAxCoreRegistry(t)
	const marker = "# AXIR_CORE_GEN_FUNCTIONS\n"
	if _, err := buildPythonCoreModule(model, "gen", pyGen, marker); err != nil {
		t.Fatalf("baseline gen build should succeed, got: %v", err)
	}
	broken := strings.Replace(pyGen, "def _core_get(", "def _core_getx(", 1)
	if broken == pyGen {
		t.Fatal("could not find the _core_get def to remove from the pyGen template")
	}
	_, err := buildPythonCoreModule(model, "gen", broken, marker)
	if err == nil {
		t.Fatal("expected codegen to fail when the gen module is missing a helper def")
	}
	if !strings.Contains(err.Error(), "_core_get") {
		t.Fatalf("codegen error should name the missing helper, got: %v", err)
	}
}
