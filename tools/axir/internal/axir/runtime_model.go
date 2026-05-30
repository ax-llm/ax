package axir

import (
	"fmt"
	"sort"
	"strings"
)

type AxRuntimeModel struct {
	PackageName     string                 `json:"packageName"`
	PublicSymbols   []string               `json:"publicSymbols"`
	SemanticOps     []string               `json:"semanticOps"`
	Features        map[string]bool        `json:"features"`
	TargetIdioms    map[string]TargetIdiom `json:"targetIdioms"`
	Symbols         map[string]Operation   `json:"-"`
	BodySources     map[string]string      `json:"bodySources"`
	EmitModules     map[string]string      `json:"emitModules"`
	PrivateSymbols  map[string]bool        `json:"privateSymbols"`
	RequiredSymbols []string               `json:"requiredSymbols"`
}

type TargetIdiom struct {
	ModuleNaming     string `json:"moduleNaming"`
	MethodNaming     string `json:"methodNaming"`
	AsyncPolicy      string `json:"asyncPolicy"`
	CollectionPolicy string `json:"collectionPolicy"`
	ErrorPolicy      string `json:"errorPolicy"`
}

var betaRuntimeSymbols = []string{
	"ai",
	"ax",
	"f",
	"fn",
	"s",
	"AIClient",
	"AxAIService",
	"AxAIServiceOptions",
	"AxAgent",
	"AxAgentClarificationError",
	"AxCodeRuntime",
	"AxCodeSession",
	"AxBaseAI",
	"AxFlow",
	"AxChatRequest",
	"AxChatResponse",
	"AxEmbedRequest",
	"AxEmbedResponse",
	"AxGen",
	"AxMemory",
	"AxModelConfig",
	"AxSignature",
	"OpenAICompatibleClient",
	"agent",
	"flow",
}

func BuildRuntimeModel(core Module) (AxRuntimeModel, error) {
	symbols := map[string]Operation{}
	bodySources := map[string]string{}
	emitModules := map[string]string{}
	privateSymbols := map[string]bool{}
	var publicSymbols []string
	var semanticOps []string
	for _, op := range core.Ops {
		if op.Symbol == "" {
			continue
		}
		symbols[op.Symbol] = op
		if AttrString(op, "public") == "true" {
			publicSymbols = append(publicSymbols, op.Symbol)
		}
		if strings.Contains(op.Name, ".semantic") || strings.HasSuffix(op.Name, ".func") || strings.HasSuffix(op.Name, ".method") {
			semanticOps = append(semanticOps, op.Symbol)
		}
		if source := AttrString(op, "body_source"); source != "" {
			bodySources[op.Symbol] = source
		}
		if module := AttrString(op, "emit_module"); module != "" {
			emitModules[op.Symbol] = module
		}
		if AttrString(op, "private") == "true" {
			privateSymbols[op.Symbol] = true
		}
	}
	sort.Strings(publicSymbols)
	sort.Strings(semanticOps)

	var missing []string
	for _, symbol := range betaRuntimeSymbols {
		if _, ok := symbols[symbol]; !ok {
			missing = append(missing, "@"+symbol)
		}
	}
	if len(missing) > 0 {
		return AxRuntimeModel{}, fmt.Errorf("lowered core module missing beta runtime symbols: %s", strings.Join(missing, ", "))
	}

	return AxRuntimeModel{
		PackageName:   "ax",
		PublicSymbols: publicSymbols,
		SemanticOps:   semanticOps,
		Features: map[string]bool{
			"custom_prompt_template":             true,
			"default_prompt":                     true,
			"prompt_conformance":                 true,
			"schema_conformance":                 true,
			"signature_conformance":              true,
			"template_engine":                    true,
			"validation_conformance":             true,
			"axgen_examples":                     true,
			"axgen_demos":                        true,
			"axgen_assertions":                   true,
			"axgen_field_processors":             true,
			"axgen_memory":                       true,
			"axgen_chat_log":                     true,
			"axgen_examples_exact":               true,
			"axgen_context_cache":                true,
			"axgen_callbacks":                    true,
			"axgen_function_trace":               true,
			"axgen_trace":                        true,
			"axgen_stop_functions":               true,
			"cache_aware_prompt_inputs":          true,
			"axagent_pipeline":                   true,
			"axagent_context_fields":             true,
			"axagent_clarification":              true,
			"axagent_chat_log":                   true,
			"axagent_state_alpha":                true,
			"axagent_runtime_contract":           true,
			"axagent_discovery_policy":           true,
			"axagent_delegation_policy":          true,
			"axagent_optimizer_metadata":         true,
			"axagent_runtime_session":            true,
			"axagent_agent_test":                 true,
			"axagent_runtime_state_restore":      true,
			"axagent_actor_step_alpha":           true,
			"axagent_runtime_language":           true,
			"axagent_actor_prompt_cache":         true,
			"axagent_context_cache_precedence":   true,
			"axagent_policy_registry":            true,
			"axagent_policy_versioning":          true,
			"axagent_dynamic_primitives":         true,
			"axagent_host_boundaries":            true,
			"axagent_policy_trace":               true,
			"axagent_policy_execution":           true,
			"axagent_tool_discovery":             true,
			"axagent_skill_discovery":            true,
			"axagent_memory_recall":              true,
			"axagent_usage_tracking":             true,
			"axagent_child_delegation":           true,
			"axagent_guidance_protocol":          true,
			"axagent_trace_export":               true,
			"axagent_deterministic_replay":       true,
			"axagent_host_boundary_contract":     true,
			"axagent_optimizer_trace_artifact":   true,
			"axoptimize_contract":                true,
			"axoptimize_engine_boundary":         true,
			"axoptimize_artifacts":               true,
			"axoptimize_agent_eval":              true,
			"axoptimize_prompt_components":       true,
			"axoptimize_evaluator_boundary":      true,
			"axoptimize_candidate_rollouts":      true,
			"axoptimize_metric_scoring":          true,
			"axoptimize_judge_payloads":          true,
			"axoptimize_state_isolation":         true,
			"axoptimize_engine_interop":          true,
			"axoptimize_shared_program_contract": true,
			"axoptimize_evidence_batches":        true,
			"axoptimize_gepa_adapter_contract":   true,
			"axoptimize_runtime_beta_contract":   true,
			"axoptimize_artifact_lifecycle":      true,
			"axprogram_contract":                 true,
			"axprogram_trace_events":             true,
			"axflow_program_graph":               true,
			"axflow_program_contract":            true,
			"axflow_shared_executor":             true,
			"axflow_auto_parallel_barriers":      true,
			"axflow_actual_input_cache_key":      true,
			"axflow_optimizer_components":        true,
			"axflow_execution_runtime":           true,
			"axflow_child_program_aggregation":   true,
			"axflow_cache_runtime":               true,
			"axflow_dynamic_options":             true,
			"axflow_abort_boundary":              true,
			"axflow_optimization_components":     true,
			"axflow_optimization_apply":          true,
			"axflow_optimization_evaluation":     true,
			"axflow_nested_component_paths":      true,
			"axflow_optimization_rollback":       true,
		},
		RequiredSymbols: append([]string(nil), betaRuntimeSymbols...),
		Symbols:         symbols,
		BodySources:     bodySources,
		EmitModules:     emitModules,
		PrivateSymbols:  privateSymbols,
		TargetIdioms: map[string]TargetIdiom{
			"python": {
				ModuleNaming:     "snake_case",
				MethodNaming:     "snake_case",
				AsyncPolicy:      "sync-first",
				CollectionPolicy: "dict-list-at-dynamic-boundaries",
				ErrorPolicy:      "standard-exception-hierarchy",
			},
			"java": {
				ModuleNaming:     "packages-and-classes",
				MethodNaming:     "camelCase",
				AsyncPolicy:      "blocking-first",
				CollectionPolicy: "records-builders-maps-at-dynamic-boundaries",
				ErrorPolicy:      "checked-runtime-exception-boundary",
			},
			"cpp": {
				ModuleNaming:     "namespaces",
				MethodNaming:     "lower_snake_or_project_style",
				AsyncPolicy:      "sync-first-with-future-extension",
				CollectionPolicy: "value-types-standard-containers",
				ErrorPolicy:      "explicit-errors-and-raii",
			},
		},
	}, nil
}
