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
	"AnthropicClient",
	"GoogleGeminiClient",
	"OpenAICompatibleClient",
	"OpenAIResponsesClient",
	"ProcessCodeRuntime",
	"ProcessCodeSession",
	"RuntimeProtocolClient",
	"RuntimeTransport",
	"agent",
	"flow",
}

var generatedRuntimePublicSymbols = []string{
	"AxBalancer",
	"AxGEPA",
	"MultiServiceRouter",
	"ProviderRouter",
	"get_supported_ai_models",
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
	for _, symbol := range generatedRuntimePublicSymbols {
		if !containsRuntimeSymbol(publicSymbols, symbol) {
			publicSymbols = append(publicSymbols, symbol)
		}
	}
	sort.Strings(publicSymbols)

	return AxRuntimeModel{
		PackageName:   "ax",
		PublicSymbols: publicSymbols,
		SemanticOps:   semanticOps,
		Features: map[string]bool{
			"custom_prompt_template":                     true,
			"default_prompt":                             true,
			"prompt_conformance":                         true,
			"schema_conformance":                         true,
			"signature_conformance":                      true,
			"template_engine":                            true,
			"validation_conformance":                     true,
			"axgen_examples":                             true,
			"axgen_demos":                                true,
			"axgen_assertions":                           true,
			"axgen_field_processors":                     true,
			"axgen_memory":                               true,
			"axgen_chat_log":                             true,
			"axgen_examples_exact":                       true,
			"axgen_context_cache":                        true,
			"axgen_callbacks":                            true,
			"axgen_function_trace":                       true,
			"axgen_trace":                                true,
			"axgen_stop_functions":                       true,
			"cache_aware_prompt_inputs":                  true,
			"axagent_pipeline":                           true,
			"axagent_context_fields":                     true,
			"axagent_clarification":                      true,
			"axagent_chat_log":                           true,
			"axagent_state_alpha":                        true,
			"axagent_runtime_contract":                   true,
			"axagent_discovery_policy":                   true,
			"axagent_delegation_policy":                  true,
			"axagent_optimizer_metadata":                 true,
			"axagent_runtime_session":                    true,
			"axagent_agent_test":                         true,
			"axagent_runtime_state_restore":              true,
			"axagent_runtime_host_boundary":              true,
			"axagent_runtime_error_envelopes":            true,
			"axagent_runtime_state_contract":             true,
			"axagent_runtime_restart_policy":             true,
			"axagent_runtime_trace_events":               true,
			"axagent_runtime_adapter_helpers":            true,
			"axagent_runtime_adapter_examples":           true,
			"axagent_runtime_capability_negotiation":     true,
			"axagent_runtime_protocol":                   true,
			"axagent_runtime_protocol_conformance":       true,
			"axagent_runtime_process_error_handling":     true,
			"axagent_runtime_lifecycle_beta":             true,
			"axagent_runtime_cancellation_contract":      true,
			"axagent_runtime_restart_once":               true,
			"axagent_runtime_process_diagnostics":        true,
			"axagent_runtime_profile_javascript_quickjs": true,
			"axagent_runtime_quickjs_session_state":      true,
			"axagent_runtime_profile_python_pyodide":     true,
			"axagent_runtime_pyodide_session_state":      true,
			"axagent_runtime_pyodide_host_calls":         true,
			"axagent_runtime_pyodide_diagnostics":        true,
			"axagent_axjs_reference_adapter":             true,
			"axagent_process_runtime_helpers":            true,
			"axagent_actor_step_alpha":                   true,
			"axagent_runtime_language":                   true,
			"axagent_actor_prompt_cache":                 true,
			"axagent_context_cache_precedence":           true,
			"axagent_context_budget":                     true,
			"axagent_checkpointing":                      true,
			"axagent_action_log_compaction":              true,
			"axagent_runtime_state_summary":              true,
			"axagent_context_events":                     true,
			"axagent_executor_model_policy":              true,
			"axagent_policy_registry":                    true,
			"axagent_policy_vocabulary_registry":         true,
			"axagent_context_policy_registry":            true,
			"axagent_policy_versioning":                  true,
			"axagent_dynamic_primitives":                 true,
			"axagent_host_boundaries":                    true,
			"axagent_policy_trace":                       true,
			"axagent_policy_execution":                   true,
			"axagent_tool_discovery":                     true,
			"axagent_skill_discovery":                    true,
			"axagent_memory_recall":                      true,
			"axagent_usage_tracking":                     true,
			"axagent_child_delegation":                   true,
			"axagent_guidance_protocol":                  true,
			"axagent_trace_export":                       true,
			"axagent_deterministic_replay":               true,
			"axagent_host_boundary_contract":             true,
			"axagent_optimizer_trace_artifact":           true,
			"axoptimize_contract":                        true,
			"axoptimize_engine_boundary":                 true,
			"axoptimize_artifacts":                       true,
			"axoptimize_agent_eval":                      true,
			"axoptimize_prompt_components":               true,
			"axoptimize_evaluator_boundary":              true,
			"axoptimize_candidate_rollouts":              true,
			"axoptimize_metric_scoring":                  true,
			"axoptimize_judge_payloads":                  true,
			"axoptimize_state_isolation":                 true,
			"axoptimize_engine_interop":                  true,
			"axoptimize_shared_program_contract":         true,
			"axoptimize_evidence_batches":                true,
			"axoptimize_gepa_adapter_contract":           true,
			"axoptimize_gepa_engine":                     true,
			"axoptimize_gepa_reflection":                 true,
			"axoptimize_gepa_pareto":                     true,
			"axoptimize_gepa_bootstrap":                  true,
			"axoptimize_gepa_selector_state":             true,
			"axoptimize_runtime_beta_contract":           true,
			"axoptimize_artifact_lifecycle":              true,
			"axprogram_contract":                         true,
			"axprogram_trace_events":                     true,
			"axflow_program_graph":                       true,
			"axflow_program_contract":                    true,
			"axflow_shared_executor":                     true,
			"axflow_auto_parallel_barriers":              true,
			"axflow_actual_input_cache_key":              true,
			"axflow_optimizer_components":                true,
			"axflow_execution_runtime":                   true,
			"axflow_child_program_aggregation":           true,
			"axflow_cache_runtime":                       true,
			"axflow_dynamic_options":                     true,
			"axflow_abort_boundary":                      true,
			"axflow_control_flow_runtime":                true,
			"axflow_feedback_loop":                       true,
			"axflow_branch_runtime":                      true,
			"axflow_node_extension_helpers":              true,
			"axflow_streaming_cache":                     true,
			"axflow_stop_inflight":                       true,
			"axflow_parallel_merge_errors":               true,
			"axflow_optimization_components":             true,
			"axflow_optimization_apply":                  true,
			"axflow_optimization_evaluation":             true,
			"axflow_nested_component_paths":              true,
			"axflow_optimization_rollback":               true,
			"axai_provider_descriptor_registry":          true,
			"axai_provider_alias_registry":               true,
			"axai_model_catalog_audit":                   true,
			"axai_provider_routing_audit":                true,
			"axai_model_catalog_runtime_api":             true,
			"axai_multi_service_routing":                 true,
			"axai_provider_routing_analysis":             true,
			"axai_balancer_runtime":                      true,
			"axai_balancer_retry_policy":                 true,
			"axai_balancer_metrics":                      true,
			"axai_host_processing_callbacks":             true,
			"google_gemini_provider_mapping":             true,
			"gemini_media_content_mapping":               true,
			"gemini_tool_schema_mapping":                 true,
			"gemini_stream_folding":                      true,
			"gemini_usage_normalization":                 true,
			"gemini_embeddings_normalization":            true,
			"anthropic_provider_mapping":                 true,
			"anthropic_cache_control_mapping":            true,
			"anthropic_thinking_normalization":           true,
			"anthropic_stream_folding":                   true,
			"anthropic_usage_normalization":              true,
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

func containsRuntimeSymbol(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
