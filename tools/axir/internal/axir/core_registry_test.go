package axir

import (
	"reflect"
	"strings"
	"testing"
)

func buildAxCoreRegistry(t *testing.T) ([]CoreFuncSpec, AxRuntimeModel) {
	t.Helper()
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	core := LowerToCore(bundle)
	model, err := BuildRuntimeModel(core)
	if err != nil {
		t.Fatal(err)
	}
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		t.Fatal(err)
	}
	return specs, model
}

func TestCoreFuncRegistryFromAxCore(t *testing.T) {
	specs, model := buildAxCoreRegistry(t)

	bodyCore := 0
	for _, source := range model.BodySources {
		if source == "core" {
			bodyCore++
		}
	}
	if len(specs) != bodyCore {
		t.Fatalf("registry has %d specs, want one per Core-bodied symbol (%d)", len(specs), bodyCore)
	}

	names := CoreFuncNames(specs)
	for sym, want := range map[string]string{
		"parse_signature":              "parse_signature",
		"agent_factory":                "_agent_factory",
		"forward":                      "_forward_impl",
		"strip_internal_fields":        "strip_internal",
		"normalize_token_usage":        "normalize_token_usage",
		"anthropic_build_chat_request": "_anthropic_build_chat_request",
		"mcp_protocol_constants":       "mcp_protocol_constants",
	} {
		if got := names[sym]; got != want {
			t.Fatalf("registry name for @%s = %q, want %q", sym, got, want)
		}
	}

	byModule := map[string]int{}
	for _, spec := range specs {
		byModule[spec.Module]++
	}
	if byModule["mcp"] != 4 {
		t.Fatalf("expected the 4 MCP core functions in the registry, got %d", byModule["mcp"])
	}
	if byModule[""] != 0 {
		t.Fatal("registry contains specs without emit_module")
	}

	// Determinism: building twice yields the identical ordered slice.
	again, err := BuildCoreFuncRegistry(model)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(specs, again) {
		t.Fatal("registry order is not deterministic")
	}

	// Each python file's specs land in exactly one module file.
	for _, spec := range specs {
		if pythonCoreModuleFile(spec.Module) == "" {
			t.Fatalf("spec %s maps to empty python module", spec.Symbol)
		}
	}
}

func registryFixtureModel() AxRuntimeModel {
	op := func(sym string, attrs ...Attribute) Operation {
		return Operation{
			Name:       "core.func",
			Symbol:     sym,
			Attributes: attrs,
			Regions: []Region{{
				Name: "body",
				Blocks: []Block{{
					Name: "entry",
					Ops: []Operation{{
						Name: "core.return",
					}},
				}},
			}},
		}
	}
	return AxRuntimeModel{
		Symbols: map[string]Operation{
			"alpha": op("alpha"),
			"beta":  op("beta"),
		},
		BodySources:    map[string]string{"alpha": "core", "beta": "core"},
		EmitModules:    map[string]string{"alpha": "signature", "beta": "schema"},
		PrivateSymbols: map[string]bool{},
	}
}

func TestCoreFuncRegistryRejectsMissingEmitModule(t *testing.T) {
	model := registryFixtureModel()
	delete(model.EmitModules, "beta")
	_, err := BuildCoreFuncRegistry(model)
	if err == nil || !strings.Contains(err.Error(), "no emit_module") {
		t.Fatalf("expected missing emit_module error, got %v", err)
	}
}

func TestCoreFuncRegistryRejectsUnknownModule(t *testing.T) {
	model := registryFixtureModel()
	model.EmitModules["beta"] = "nonsense"
	_, err := BuildCoreFuncRegistry(model)
	if err == nil || !strings.Contains(err.Error(), "unknown emit_module") {
		t.Fatalf("expected unknown emit_module error, got %v", err)
	}
}

func TestCoreFuncRegistryRejectsNativeNameCollision(t *testing.T) {
	model := registryFixtureModel()
	alpha := model.Symbols["alpha"]
	alpha.Attributes = append(alpha.Attributes, Attribute{Kind: "attr", Name: "emit_name", Value: "beta"})
	model.Symbols["alpha"] = alpha
	_, err := BuildCoreFuncRegistry(model)
	if err == nil || !strings.Contains(err.Error(), "both emit native name") {
		t.Fatalf("expected native-name collision error, got %v", err)
	}
}

func TestCoreFuncRegistryRejectsRankViolation(t *testing.T) {
	model := registryFixtureModel()
	// alpha (signature, rank 0) calls beta (schema, rank 1): forbidden.
	alpha := model.Symbols["alpha"]
	alpha.Regions = []Region{{
		Name: "body",
		Blocks: []Block{{
			Name: "entry",
			Ops: []Operation{
				{
					Name: "core.call",
					Attributes: []Attribute{
						{Kind: "attr", Name: "callee", Value: "@beta"},
						{Kind: "attr", Name: "result", Value: "%out"},
					},
				},
				{
					Name:       "core.return",
					Attributes: []Attribute{{Kind: "attr", Name: "value", Value: "%out"}},
				},
			},
		}},
	}}
	model.Symbols["alpha"] = alpha
	_, err := BuildCoreFuncRegistry(model)
	if err == nil || !strings.Contains(err.Error(), "same-or-lower-rank") {
		t.Fatalf("expected rank violation error, got %v", err)
	}
}
