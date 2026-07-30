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
		"parse_signature":                      "parse_signature",
		"agent_factory":                        "_agent_factory",
		"forward":                              "_forward_impl",
		"strip_internal_fields":                "strip_internal",
		"normalize_token_usage":                "normalize_token_usage",
		"anthropic_build_chat_request":         "_anthropic_build_chat_request",
		"mcp_protocol_constants":               "mcp_protocol_constants",
		"mcp_modern_request_headers":           "mcp_modern_request_headers",
		"mcp_classify_discovery_result":        "mcp_classify_discovery_result",
		"mcp_resolve_known_era":                "mcp_resolve_known_era",
		"mcp_select_mutual_version":            "mcp_select_mutual_version",
		"mcp_build_request_meta":               "mcp_build_request_meta",
		"mcp_client_capabilities":              "mcp_client_capabilities",
		"mcp_negotiate_extensions":             "mcp_negotiate_extensions",
		"mcp_request_name":                     "mcp_request_name",
		"mcp_header_value_plan":                "mcp_header_value_plan",
		"mcp_param_header_bindings":            "mcp_param_header_bindings",
		"mcp_param_header_values":              "mcp_param_header_values",
		"mcp_fold_cache_info":                  "mcp_fold_cache_info",
		"mcp_cache_freshness":                  "mcp_cache_freshness",
		"mcp_validate_modern_task":             "mcp_validate_modern_task",
		"mcp_task_terminal_outcome":            "mcp_task_terminal_outcome",
		"mcp_mrtr_plan_round":                  "mcp_mrtr_plan_round",
		"mcp_mrtr_fulfill_roots":               "mcp_mrtr_fulfill_roots",
		"mcp_mrtr_next_params":                 "mcp_mrtr_next_params",
		"event_runtime_descriptor":             "event_runtime_descriptor",
		"event_retry_transition":               "event_retry_transition",
		"event_resolve_path":                   "event_resolve_path",
		"event_map_input":                      "event_map_input",
		"event_normalize_input":                "event_normalize_input",
		"event_delivery_due":                   "event_delivery_due",
		"event_strict_delivery_eligible":       "event_strict_delivery_eligible",
		"event_capacity_transition":            "event_capacity_transition",
		"event_debounce_transition":            "event_debounce_transition",
		"mcp_resource_subscription_selection":  "mcp_resource_subscription_selection",
		"mcp_resource_subscription_plan":       "mcp_resource_subscription_plan",
		"mcp_resource_subscription_ownership":  "mcp_resource_subscription_ownership",
		"mcp_listen_interests":                 "mcp_listen_interests",
		"mcp_notification_subscription_filter": "mcp_notification_subscription_filter",
		"mcp_oauth_validate_issuer":            "mcp_oauth_validate_issuer",
	} {
		if got := names[sym]; got != want {
			t.Fatalf("registry name for @%s = %q, want %q", sym, got, want)
		}
	}

	byModule := map[string]int{}
	for _, spec := range specs {
		byModule[spec.Module]++
	}
	if byModule["mcp"] != 43 {
		t.Fatalf("expected the 43 MCP/UCP/event core functions in the registry, got %d", byModule["mcp"])
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
