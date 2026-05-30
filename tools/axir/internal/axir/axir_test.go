package axir

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func rootPath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "axcore", "root.axir")
}

func axgenConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "axgen")
}

func axaiConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "axai")
}

func axagentConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "axagent")
}

func axoptimizeConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "axoptimize")
}

func promptConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "prompt")
}

func signatureConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "signature")
}

func schemaConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "schema")
}

func validationConformancePath() string {
	return filepath.Join("..", "..", "..", "..", "ir", "conformance", "validation")
}

func TestLoadCheckLowerAxCore(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Modules) < 10 {
		t.Fatalf("expected imported AxCore modules, got %d", len(bundle.Modules))
	}
	if ds := Check(bundle); ds.HasErrors() {
		t.Fatal(ds.Error())
	}
	core := LowerToCore(bundle)
	text := FormatModule(core)
	for _, want := range []string{
		"op core.func @s",
		"op core.func @ax",
		"op core.record @AxSignature",
		"op core.interface @AIClient",
		"op core.record @OpenAICompatibleClient",
		"op core.func @execute_tool_call",
		"op core.func @build_gen_chat_request",
		"op core.method @forward",
		"op core.func @complete_with_retries_impl",
		"op core.func @fold_stream",
		"op core.func @stream_event_content_parts_impl",
		"op core.func @ai",
		"op core.func @ai_factory",
		"op core.func @merge_model_config",
		"op core.func @normalize_chat_response",
		"op core.func @chat_response_to_completion",
		"op core.func @openai_build_chat_request",
		"op core.func @openai_normalize_chat_response",
		"op core.func @openai_normalize_stream_delta",
		"op core.func @openai_normalize_error",
		"op core.func @agent",
		"op core.record @AxAgent",
		"op core.error @AxAgentClarificationError",
		"op core.interface @AxCodeRuntime",
		"op core.interface @AxCodeSession",
		"op core.func @agent_factory",
		"op core.func @agent_forward",
		"op core.func @normalize_agent_runtime",
		"op core.func @normalize_agent_policy",
		"op core.func @agent_policy_registry",
		"op core.func @select_actor_primitives",
		"op core.func @render_actor_primitive_guidance",
		"op core.func @normalize_agent_callable_inventory",
		"op core.func @agent_discover",
		"op core.func @agent_recall",
		"op core.func @agent_used",
		"op core.func @agent_execute_callable",
		"op core.func @agent_append_guidance",
		"op core.func @agent_optimizer_metadata",
		"op core.func @agent_begin_trace",
		"op core.func @agent_record_trace_event",
		"op core.func @agent_export_trace",
		"op core.func @agent_replay_trace",
		"op core.func @optimization_component",
		"op core.func @optimized_artifact",
		"op core.func @validate_optimized_artifact",
		"op core.func @filter_optimization_components",
		"op core.func @build_optimizer_request",
		"op core.func @prepare_optimizer_run",
		"op core.func @normalize_optimizer_engine_response",
		"op core.func @build_optimizer_evidence_batch",
		"op core.func @normalize_optimization_dataset",
		"op core.func @build_optimization_eval_result",
		"op core.func @build_optimization_judge_payload",
		"op core.func @build_agent_eval_prediction",
		"op core.interface @AxProgram",
		"op core.func @program_descriptor",
		"op core.func @program_trace_event",
		"op core.record @AxFlow",
		"op core.func @flow",
		"op core.func @flow_factory",
		"op core.func @flow_plan",
		"op core.func @flow_forward",
		"op core.func @agent_runtime_test",
		"op core.func @agent_runtime_execute_step",
		"op core.func @normalize_agent_runtime_step_result",
		"op core.func @split_context_values",
		"op core.func @normalize_agent_completion_payload",
		"op core.func @merge_agent_chat_log",
		"op core.func @validate_output",
		"op core.func @render_prompt",
		"op core.func @render_template_content",
		"op core.func @validate_prompt_template_syntax",
		"op core.func @collect_template_variable_names",
		"op core.interface @AxAIService",
		"op core.record @AxBaseAI",
		"op core.record @AxChatRequest",
		"op core.record @AxEmbedResponse",
		"attr body_source = \"core\"",
		"op core.func @parse_signature",
		"op core.call",
		"op core.for",
		"op core.get",
		"op core.append",
		"op core.loop",
		"op core.try",
		"op core.continue",
		"op core.return",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("lowered core missing %s:\n%s", want, text)
		}
	}
	for _, forbidden := range []string{
		"intrinsic.validate.fields",
		"intrinsic.validate.output",
		"intrinsic.validate.value",
		"intrinsic.schema.to_json_schema",
		"intrinsic.signature.parse",
		"intrinsic.signature.validate",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("lowered core still contains migrated semantic intrinsic %q", forbidden)
		}
	}
}

func TestBuildRuntimeModel(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	core := LowerToCore(bundle)
	model, err := BuildRuntimeModel(core)
	if err != nil {
		t.Fatal(err)
	}
	if model.PackageName != "ax" {
		t.Fatalf("unexpected package name %q", model.PackageName)
	}
	if model.TargetIdioms["python"].MethodNaming != "snake_case" {
		t.Fatalf("missing Python idiom contract: %#v", model.TargetIdioms["python"])
	}
	for _, feature := range []string{
		"template_engine",
		"default_prompt",
		"custom_prompt_template",
		"prompt_conformance",
		"schema_conformance",
		"signature_conformance",
		"validation_conformance",
		"axgen_examples",
		"axgen_demos",
		"axgen_assertions",
		"axgen_field_processors",
		"axgen_trace",
		"axgen_stop_functions",
		"cache_aware_prompt_inputs",
		"axagent_pipeline",
		"axagent_context_fields",
		"axagent_clarification",
		"axagent_chat_log",
		"axagent_state_alpha",
		"axagent_runtime_contract",
		"axagent_discovery_policy",
		"axagent_delegation_policy",
		"axagent_optimizer_metadata",
		"axagent_runtime_session",
		"axagent_agent_test",
		"axagent_runtime_state_restore",
		"axagent_actor_step_alpha",
		"axagent_runtime_language",
		"axagent_actor_prompt_cache",
		"axagent_context_cache_precedence",
		"axagent_policy_registry",
		"axagent_policy_versioning",
		"axagent_dynamic_primitives",
		"axagent_host_boundaries",
		"axagent_policy_trace",
		"axagent_policy_execution",
		"axagent_tool_discovery",
		"axagent_skill_discovery",
		"axagent_memory_recall",
		"axagent_usage_tracking",
		"axagent_child_delegation",
		"axagent_guidance_protocol",
		"axagent_trace_export",
		"axagent_deterministic_replay",
		"axagent_host_boundary_contract",
		"axagent_optimizer_trace_artifact",
		"axoptimize_contract",
		"axoptimize_engine_boundary",
		"axoptimize_artifacts",
		"axoptimize_agent_eval",
		"axoptimize_prompt_components",
		"axoptimize_evaluator_boundary",
		"axoptimize_candidate_rollouts",
		"axoptimize_metric_scoring",
		"axoptimize_judge_payloads",
		"axoptimize_state_isolation",
		"axoptimize_engine_interop",
		"axoptimize_shared_program_contract",
		"axoptimize_evidence_batches",
		"axoptimize_gepa_adapter_contract",
		"axprogram_contract",
		"axprogram_trace_events",
		"axflow_program_graph",
		"axflow_program_contract",
		"axflow_shared_executor",
		"axflow_auto_parallel_barriers",
		"axflow_actual_input_cache_key",
		"axflow_optimizer_components",
		"axflow_execution_runtime",
		"axflow_child_program_aggregation",
		"axflow_cache_runtime",
		"axflow_dynamic_options",
		"axflow_abort_boundary",
		"axflow_optimization_components",
		"axflow_optimization_apply",
		"axflow_optimization_evaluation",
		"axflow_nested_component_paths",
		"axflow_optimization_rollback",
	} {
		if !model.Features[feature] {
			t.Fatalf("runtime model missing prompt feature flag %s: %#v", feature, model.Features)
		}
	}
	for _, want := range []string{"ai", "AxAIService", "AxBaseAI", "OpenAICompatibleClient", "agent", "AxAgent", "AxAgentClarificationError", "flow", "AxFlow", "AxProgram"} {
		if _, ok := model.Symbols[want]; !ok {
			t.Fatalf("runtime model missing symbol %s", want)
		}
	}
	for _, want := range []string{
		"parse_signature",
		"to_json_schema",
		"validate_output",
		"strip_internal_fields",
		"render_prompt",
		"render_template_content",
		"validate_prompt_template_syntax",
		"fold_stream",
		"build_gen_chat_request",
		"render_examples",
		"render_demos",
		"apply_field_processors",
		"run_assertions",
		"append_assertion_retry_messages",
		"record_trace",
		"should_continue_steps",
		"execute_tool_call",
		"forward",
		"merge_model_config",
		"validate_chat_request",
		"chat_response_to_completion",
		"openai_build_chat_request",
		"openai_normalize_chat_response",
		"openai_normalize_stream_delta",
		"openai_normalize_error",
		"agent_factory",
		"normalize_agent_runtime",
		"normalize_agent_policy",
		"normalize_agent_callable_inventory",
		"split_agent_callable_inventory",
		"render_agent_discovery_catalog",
		"agent_discover",
		"agent_recall",
		"agent_used",
		"agent_execute_callable",
		"agent_append_guidance",
		"normalize_agent_final_payload",
		"normalize_agent_clarification_payload",
		"agent_optimizer_metadata",
		"agent_begin_trace",
		"agent_record_trace_event",
		"agent_normalize_host_boundary_event",
		"agent_finalize_trace",
		"agent_export_trace",
		"agent_replay_trace",
		"agent_export_runtime_state",
		"agent_restore_runtime_state",
		"split_context_values",
		"build_distiller_inputs",
		"build_executor_inputs",
		"build_responder_inputs",
		"normalize_agent_completion_payload",
		"throw_agent_clarification",
		"merge_agent_chat_log",
		"merge_agent_usage",
		"agent_get_state",
		"agent_set_state",
		"agent_forward",
		"program_descriptor",
		"program_trace_event",
		"flow_factory",
		"flow_step",
		"flow_add_step",
		"flow_set_returns",
		"flow_plan",
		"flow_cache_key",
		"flow_forward",
	} {
		if model.BodySources[want] != "core" {
			t.Fatalf("runtime model missing core body source for %s: %#v", want, model.BodySources)
		}
	}
	for _, want := range []string{"signature_parse_impl", "schema_to_json_schema_impl", "validate_value_impl", "template_parse_impl", "prompt_messages_impl", "complete_with_retries_impl", "parse_output_impl", "tool_spec_impl", "ai_model_usage_impl", "openai_message_impl", "openai_stream_choice_impl", "stream_event_content_parts_impl"} {
		if model.BodySources[want] != "core" || !model.PrivateSymbols[want] {
			t.Fatalf("runtime model missing private core helper %s: body=%#v private=%#v", want, model.BodySources, model.PrivateSymbols)
		}
	}
	if model.EmitModules["signature_parse_impl"] != "signature" || model.EmitModules["validate_value_impl"] != "schema" || model.EmitModules["render_prompt"] != "prompt" || model.EmitModules["fold_stream"] != "gen" || model.EmitModules["forward"] != "gen" || model.EmitModules["execute_tool_call"] != "gen" || model.EmitModules["openai_build_chat_request"] != "ai" || model.EmitModules["agent_forward"] != "agent" || model.EmitModules["normalize_agent_runtime"] != "agent" || model.EmitModules["agent_discover"] != "agent" || model.EmitModules["agent_recall"] != "agent" || model.EmitModules["agent_used"] != "agent" || model.EmitModules["agent_export_trace"] != "agent" || model.EmitModules["agent_replay_trace"] != "agent" || model.EmitModules["flow_forward"] != "flow" || model.EmitModules["program_trace_event"] != "program" {
		t.Fatalf("runtime model missing emit module hints: %#v", model.EmitModules)
	}
}

func TestCapabilityManifestsAndGeneratedPackageShape(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		target     string
		wantFiles  []string
		wantReadme string
	}{
		{
			target: "python",
			wantFiles: []string{
				"README.md",
				"axir-capabilities.json",
				"ax/__init__.py",
				"ax/ai.py",
				"ax/agent.py",
				"ax/flow.py",
				"ax/gen.py",
				"ax/conformance.py",
				"examples/signature_schema.py",
				"examples/axgen_fake_client_tool.py",
				"examples/axai_fake_transport.py",
				"examples/axagent_pipeline.py",
				"examples/axflow_program_graph.py",
			},
			wantReadme: "Generated Ax PYTHON Library",
		},
		{
			target: "java",
			wantFiles: []string{
				"README.md",
				"axir-capabilities.json",
				"dev/ax/Ax.java",
				"dev/ax/AxProgram.java",
				"dev/ax/Core.java",
				"dev/ax/AxAgent.java",
				"dev/ax/AxFlow.java",
				"dev/ax/AxAgentClarificationException.java",
				"dev/ax/AxCodeRuntime.java",
				"dev/ax/AxCodeSession.java",
				"dev/ax/OptimizerEngine.java",
				"dev/ax/OptimizerEvaluator.java",
				"dev/ax/OpenAICompatibleClient.java",
				"dev/ax/Conformance.java",
				"examples/SignatureSchemaExample.java",
				"examples/AxGenFakeClientToolExample.java",
				"examples/AxAIFakeTransportExample.java",
				"examples/AxAgentPipelineExample.java",
				"examples/AxFlowProgramGraphExample.java",
			},
			wantReadme: "Generated Ax JAVA Library",
		},
		{
			target: "cpp",
			wantFiles: []string{
				"README.md",
				"axir-capabilities.json",
				"ax/ax.hpp",
				"ax/ax.cpp",
				"conformance.cpp",
				"examples/signature_schema.cpp",
				"examples/axgen_fake_client_tool.cpp",
				"examples/axai_fake_transport.cpp",
				"examples/axagent_pipeline.cpp",
				"examples/axflow_program_graph.cpp",
			},
			wantReadme: "Generated Ax CPP Library",
		},
	} {
		t.Run(tc.target, func(t *testing.T) {
			dir := t.TempDir()
			if err := Compile(bundle, tc.target, dir); err != nil {
				t.Fatal(err)
			}
			files := listRelativeFiles(t, dir)
			for _, want := range tc.wantFiles {
				if !containsString(files, want) {
					t.Fatalf("generated %s package missing %s; files=%v", tc.target, want, files)
				}
			}
			manifestData, err := os.ReadFile(filepath.Join(dir, "axir-capabilities.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest CapabilityManifest
			if err := json.Unmarshal(manifestData, &manifest); err != nil {
				t.Fatal(err)
			}
			if manifest.Target != tc.target || manifest.ProviderMode != "openai-compatible-mapping" || !manifest.FakeTransportSupport {
				t.Fatalf("bad manifest for %s: %#v", tc.target, manifest)
			}
			if tc.target == "cpp" && manifest.RealNetworkSupport {
				t.Fatalf("C++ manifest should not claim real network support: %#v", manifest)
			}
			for _, want := range []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow"} {
				if !containsString(manifest.SupportedSuites, want) {
					t.Fatalf("manifest missing suite %s: %#v", want, manifest.SupportedSuites)
				}
			}
			for _, want := range []string{"AxGen", "AxSignature", "OpenAICompatibleClient", "AxAgent", "AxFlow", "AxProgram", "OptimizerEngine", "OptimizerEvaluator"} {
				if !containsString(manifest.PublicSymbols, want) {
					t.Fatalf("manifest missing public symbol %s: %#v", want, manifest.PublicSymbols)
				}
			}
			readme, err := os.ReadFile(filepath.Join(dir, "README.md"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(readme), tc.wantReadme) || !strings.Contains(string(readme), "Core-owned") {
				t.Fatalf("generated README missing contract text:\n%s", readme)
			}
		})
	}
}

func TestFlowGoldensExtractorUsesTSReference(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	extractorPath := filepath.Join(root, "tools", "axir", "extractors", "flow-goldens.ts")
	data, err := os.ReadFile(extractorPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		"../../../src/ax/flow/flow.js",
		"../../../src/ax/flow/steps.js",
		"../../../src/ax/flow/executor.js",
		"../../../src/ax/flow/executionPlanner.js",
		"createFlowStep",
		"executeFlowSteps",
		"AxFlowExecutionPlanner",
		"flow<",
		"getExecutionPlan()",
		"forward(",
		"tsDerived: true",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("flow extractor no longer exercises TS Flow reference; missing %q", want)
		}
	}
	fixturePaths, err := filepath.Glob(filepath.Join(root, "ir", "conformance", "axflow", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(fixturePaths) == 0 {
		t.Fatal("expected AxFlow fixtures")
	}
	for _, path := range fixturePaths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var fixture map[string]any
		if err := json.Unmarshal(data, &fixture); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		source, ok := fixture["source"].(map[string]any)
		if !ok || source["tsDerived"] != true {
			t.Fatalf("%s missing TS-derived source metadata", path)
		}
	}
}

func listRelativeFiles(t *testing.T, root string) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	return files
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func TestCoreBodyParseFormatRoundTrip(t *testing.T) {
	src := `module @bodytest version "0.1" {
  dialect @core version "0.1"

  op core.func @demo {
    type signature = "(string) -> string"
    region @body {
      block @entry(%input: string) {
        op core.call {
          attr args = [%input]
          attr callee = "_demo"
          attr result = %out
        }
        op core.return {
          attr value = %out
        }
      }
    }
  }
}
`
	mod, err := ParseModule(src, "bodytest.axir")
	if err != nil {
		t.Fatal(err)
	}
	text := FormatModule(mod)
	again, err := ParseModule(text, "bodytest.axir")
	if err != nil {
		t.Fatalf("formatted Core body did not parse:\n%s\n%v", text, err)
	}
	if len(again.Ops) != 1 || len(again.Ops[0].Regions) != 1 {
		t.Fatalf("round trip lost body region: %#v", again.Ops)
	}
}

func TestCompactCoreBodyParseFormatRoundTrip(t *testing.T) {
	src := `module @bodytest version "0.1" {
  dialect @core version "0.1"

  op core.func @demo {
    type signature = "(string) -> string throws"
    body @entry(%input: string) {
      %items = core.list
      %ok = core.call intrinsic.is_not_none(%input)
      core.if %ok {
        core.append %items, %input
      } else {
        %fallback = core.let "fallback"
        core.append %items, %fallback
      }
      %out = core.string_join %items sep ""
      core.return %out
    }
  }
}
`
	mod, err := ParseModule(src, "compact.axir")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := BuildCoreBody(mod.Ops[0]); err != nil {
		t.Fatal(err)
	}
	text := FormatModuleCompact(mod)
	for _, want := range []string{
		"body @entry(%input: string) {",
		"%items = core.list",
		"%ok = core.call intrinsic.is_not_none(%input)",
		"core.if %ok {",
		"core.append %items, %input",
		"%out = core.string_join %items sep \"\"",
		"core.return %out",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("compact format missing %q:\n%s", want, text)
		}
	}
	again, err := ParseModule(text, "compact.axir")
	if err != nil {
		t.Fatalf("compact formatted Core body did not parse:\n%s\n%v", text, err)
	}
	if _, err := BuildCoreBody(again.Ops[0]); err != nil {
		t.Fatal(err)
	}
}

func TestCheckerDiagnostics(t *testing.T) {
	bundle := Bundle{
		Root: "bad",
		Modules: []Module{{
			Name:    "bad",
			Version: Version,
			File:    "bad.axir",
			Dialects: []Dialect{{
				Name: "ax.nope",
				Line: 2,
			}},
			Ops: []Operation{{
				Name:   "ax.nope.thing",
				Symbol: "s",
				Line:   3,
				Attributes: []Attribute{{
					Kind:  "ref",
					Name:  "missing",
					Value: "@not_here",
					Line:  4,
				}},
			}},
		}},
	}
	ds := Check(bundle)
	if !ds.HasErrors() {
		t.Fatal("expected errors")
	}
	text := ds.Error()
	for _, want := range []string{"unknown dialect", "missing ref @not_here", "required Ax API symbol @f"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
}

func TestCoreBodyCheckerDiagnostics(t *testing.T) {
	cases := []struct {
		name string
		op   Operation
		want string
	}{
		{
			name: "unknown op",
			op:   badBodyOp([]Operation{{Name: "core.nope", Line: 4}, {Name: "core.return", Line: 5}}),
			want: "unsupported Core body op",
		},
		{
			name: "missing terminator",
			op: badBodyOp([]Operation{{
				Name: "core.call",
				Attributes: []Attribute{
					{Kind: "attr", Name: "callee", Value: "_demo", Line: 4},
				},
				Line: 4,
			}}),
			want: "missing terminator",
		},
		{
			name: "unknown value",
			op: badBodyOp([]Operation{{
				Name:       "core.return",
				Attributes: []Attribute{{Kind: "attr", Name: "value", Value: "%missing", Line: 4}},
				Line:       4,
			}}),
			want: "unknown value ref %missing",
		},
		{
			name: "invalid if",
			op:   badBodyOp([]Operation{{Name: "core.if", Line: 4}, {Name: "core.return", Line: 5}}),
			want: "core.if must contain exactly then and else regions",
		},
		{
			name: "missing op attrs",
			op:   badBodyOp([]Operation{{Name: "core.get", Line: 4}, {Name: "core.return", Line: 5}}),
			want: "core.get missing result, target, or key",
		},
		{
			name: "unknown op attr",
			op: badBodyOp([]Operation{{
				Name: "core.get",
				Attributes: []Attribute{
					{Kind: "attr", Name: "target", Value: "%input", Line: 4},
					{Kind: "attr", Name: "key", Value: "x", Line: 4},
					{Kind: "attr", Name: "result", Value: "%out", Line: 4},
					{Kind: "attr", Name: "typo", Value: "x", Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Attributes: []Attribute{{Kind: "attr", Name: "value", Value: "%out", Line: 5}}, Line: 5}}),
			want: "unknown attr \"typo\"",
		},
		{
			name: "invalid loop binding",
			op: badBodyOp([]Operation{{
				Name: "core.for",
				Attributes: []Attribute{
					{Kind: "attr", Name: "item", Value: "item", Line: 4},
					{Kind: "attr", Name: "in", Value: "%input", Line: 4},
				},
				Line: 4,
				Regions: []Region{{
					Name: "body",
					Blocks: []Block{{
						Name: "each",
						Ops:  []Operation{},
					}},
				}},
			}, {Name: "core.return", Line: 5}}),
			want: "core.for item must be a value binding",
		},
		{
			name: "invalid assignment target",
			op: badBodyOp([]Operation{{
				Name: "core.set",
				Attributes: []Attribute{
					{Kind: "attr", Name: "target", Value: "out", Line: 4},
					{Kind: "attr", Name: "key", Value: "key", Line: 4},
					{Kind: "attr", Name: "value", Value: "%input", Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Line: 5}}),
			want: "core.set target must be a value ref",
		},
		{
			name: "break outside loop",
			op: badBodyOp([]Operation{
				{Name: "core.break", Line: 4},
				{Name: "core.return", Line: 5},
			}),
			want: "core.break outside loop",
		},
		{
			name: "continue outside loop",
			op: badBodyOp([]Operation{
				{Name: "core.continue", Line: 4},
				{Name: "core.return", Line: 5},
			}),
			want: "core.continue outside loop",
		},
		{
			name: "missing try regions",
			op: badBodyOp([]Operation{
				{Name: "core.try", Attributes: []Attribute{{Kind: "attr", Name: "error", Value: "%err", Line: 4}}, Line: 4},
				{Name: "core.return", Line: 5},
			}),
			want: "core.try must contain exactly try and catch regions",
		},
		{
			name: "bad try error binding",
			op: badBodyOp([]Operation{{
				Name:       "core.try",
				Attributes: []Attribute{{Kind: "attr", Name: "error", Value: "err", Line: 4}},
				Line:       4,
				Regions: []Region{
					{Name: "try", Blocks: []Block{{Name: "try"}}},
					{Name: "catch", Blocks: []Block{{Name: "catch"}}},
				},
			}, {Name: "core.return", Line: 5}}),
			want: "core.try missing error binding",
		},
		{
			name: "unreachable after terminator",
			op: badBodyOp([]Operation{
				{Name: "core.return", Line: 4},
				{Name: "core.call", Attributes: []Attribute{{Kind: "attr", Name: "callee", Value: "_later", Line: 5}}, Line: 5},
			}),
			want: "unreachable Core op",
		},
		{
			name: "forbidden backend helper",
			op: badBodyOp([]Operation{{
				Name: "core.call",
				Attributes: []Attribute{
					{Kind: "attr", Name: "callee", Value: "_axir_forbidden", Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Line: 5}}),
			want: "forbidden backend helper escape",
		},
		{
			name: "forbidden migrated intrinsic",
			op: badBodyOp([]Operation{{
				Name: "core.call",
				Attributes: []Attribute{
					{Kind: "attr", Name: "callee", Value: "intrinsic.validate.value", Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Line: 5}}),
			want: "unknown Core intrinsic",
		},
		{
			name: "unknown intrinsic suggestion",
			op: badBodyOp([]Operation{{
				Name: "core.call",
				Attributes: []Attribute{
					{Kind: "attr", Name: "callee", Value: "intrinsic.is_nonne", Line: 4},
					{Kind: "attr", Name: "args", Values: []interface{}{"%input"}, Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Line: 5}}),
			want: "did you mean \"intrinsic.is_none\"",
		},
		{
			name: "intrinsic arg count",
			op: badBodyOp([]Operation{{
				Name: "core.call",
				Attributes: []Attribute{
					{Kind: "attr", Name: "callee", Value: "intrinsic.eq", Line: 4},
					{Kind: "attr", Name: "args", Values: []interface{}{"%input"}, Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Line: 5}}),
			want: "intrinsic.eq expects 2 args",
		},
		{
			name: "forbidden signature intrinsic",
			op: badBodyOp([]Operation{{
				Name: "core.call",
				Attributes: []Attribute{
					{Kind: "attr", Name: "callee", Value: "intrinsic.signature.parse", Line: 4},
				},
				Line: 4,
			}, {Name: "core.return", Line: 5}}),
			want: "unknown Core intrinsic",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bundle := runtimeSymbolBundle(tc.op)
			ds := Check(bundle)
			if !ds.HasErrors() {
				t.Fatal("expected checker errors")
			}
			if !strings.Contains(ds.Error(), tc.want) {
				t.Fatalf("missing %q in:\n%s", tc.want, ds.Error())
			}
		})
	}
}

func badBodyOp(ops []Operation) Operation {
	return Operation{
		Name:   "core.func",
		Symbol: "bad_body",
		Line:   3,
		Regions: []Region{{
			Name: "body",
			Line: 3,
			Blocks: []Block{{
				Name: "entry",
				Args: []Value{{
					Name: "input",
					Type: Type{Name: "string"},
				}},
				Ops:  ops,
				Line: 3,
			}},
		}},
	}
}

func runtimeSymbolBundle(extra Operation) Bundle {
	ops := []Operation{extra}
	for _, symbol := range betaRuntimeSymbols {
		ops = append(ops, Operation{Name: "core.func", Symbol: symbol})
	}
	return Bundle{
		Root: "bodytest",
		Modules: []Module{{
			Name:     "bodytest",
			Version:  Version,
			File:     "bodytest.axir",
			Dialects: []Dialect{{Name: "core", Version: Version}},
			Ops:      ops,
		}},
	}
}

func TestDumpJSON(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	out, err := DumpJSON(bundle)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"root": "ax.root"`, `"modules"`, `"dialects"`} {
		if !strings.Contains(string(out), want) {
			t.Fatalf("JSON missing %s:\n%s", want, out)
		}
	}
}

func TestExplainSymbol(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	out, err := Explain(bundle, "fold_stream")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"symbol @fold_stream",
		"operation core.func",
		"body_source core",
		"calls",
		"@stream_event_content_parts_impl",
		"normalized_core",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("explain output missing %q:\n%s", want, out)
		}
	}
}

func TestLintLLMCoreProfile(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	ds := Lint(bundle, "llm-core")
	if ds.HasErrors() {
		t.Fatal(ds.Error())
	}
	if bad := Lint(bundle, "unknown"); !bad.HasErrors() {
		t.Fatal("expected unknown lint profile to be an error")
	}
}

func TestPromptConformanceFixturesLoad(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(promptConformancePath(), "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 10 {
		t.Fatalf("expected prompt fixtures, got %d", len(files))
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var fixture map[string]any
		if err := json.Unmarshal(data, &fixture); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if fixture["name"] == "" || fixture["kind"] == "" {
			t.Fatalf("%s missing name/kind", file)
		}
		switch fixture["kind"] {
		case "prompt":
			if _, ok := fixture["expected_messages"]; !ok {
				t.Fatalf("%s missing expected_messages", file)
			}
		case "template":
			if _, ok := fixture["expected_output"]; !ok {
				t.Fatalf("%s missing expected_output", file)
			}
		case "template_error":
			if _, ok := fixture["expected_error_contains"]; !ok {
				t.Fatalf("%s missing expected_error_contains", file)
			}
		case "template_validate":
			if _, ok := fixture["expected_result"]; !ok {
				t.Fatalf("%s missing expected_result", file)
			}
		default:
			t.Fatalf("%s has unknown prompt kind %v", file, fixture["kind"])
		}
	}
}

func TestAxAgentConformanceFixturesLoad(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(axagentConformancePath(), "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 6 {
		t.Fatalf("expected axagent fixtures, got %d", len(files))
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var fixture map[string]any
		if err := json.Unmarshal(data, &fixture); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if fixture["name"] == "" {
			t.Fatalf("%s missing name", file)
		}
		kind := fmt.Sprint(fixture["kind"])
		switch kind {
		case "agent_forward":
			if _, ok := fixture["signature"]; !ok {
				t.Fatalf("%s missing signature", file)
			}
			if _, ok := fixture["input"]; !ok {
				t.Fatalf("%s missing input", file)
			}
			if _, ok := fixture["expected_output"]; !ok {
				if _, ok := fixture["expected_error_contains"]; !ok {
					t.Fatalf("%s missing expected output or expected error", file)
				}
			}
		case "agent_runtime_policy":
			hasExpectation := false
			for _, key := range []string{
				"expected_runtime_contract_subset",
				"expected_policy_subset",
				"expected_policy_registry_subset",
				"expected_actor_primitives_subset",
				"expected_protocol_actions_subset",
				"expected_runtime_globals_subset",
				"expected_host_boundaries_subset",
				"expected_callable_inventory_subset",
				"expected_discovery_catalog_subset",
				"expected_discovered_tool_docs_subset",
				"expected_loaded_skill_docs_subset",
				"expected_loaded_memories_subset",
				"expected_used_memories_subset",
				"expected_used_skills_subset",
				"expected_guidance_log_subset",
				"expected_function_call_traces_subset",
				"expected_final_payload",
				"expected_clarification_payload",
				"expected_exported_state_subset",
				"expected_optimizer_metadata_subset",
				"expected_trace_subset",
				"expected_trace_event_kinds",
				"expected_replay_result_subset",
				"expected_error_contains",
			} {
				if _, ok := fixture[key]; ok {
					hasExpectation = true
					break
				}
			}
			if !hasExpectation {
				t.Fatalf("%s missing runtime policy expectation", file)
			}
		case "agent_runtime_session":
			if _, ok := fixture["runtime_script"]; !ok {
				t.Fatalf("%s missing runtime_script", file)
			}
			if _, ok := fixture["expected_result_subset"]; !ok {
				if _, ok := fixture["expected_action_log_subset"]; !ok {
					if _, ok := fixture["expected_exported_state_subset"]; !ok {
						if _, ok := fixture["expected_trace_subset"]; !ok {
							if _, ok := fixture["expected_error_contains"]; !ok {
								t.Fatalf("%s missing runtime session expectation", file)
							}
						}
					}
				}
			}
		default:
			t.Fatalf("%s has unknown axagent kind %v", file, fixture["kind"])
		}
	}
}

func TestAxOptimizeConformanceFixturesLoad(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(axoptimizeConformancePath(), "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 6 {
		t.Fatalf("expected axoptimize fixtures, got %d", len(files))
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var fixture map[string]any
		if err := json.Unmarshal(data, &fixture); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if fixture["name"] == "" || fixture["kind"] != "optimize" {
			t.Fatalf("%s missing optimize name/kind", file)
		}
		switch fixture["operation"] {
		case "components":
			if _, ok := fixture["expected_components_subset"]; !ok {
				if _, ok := fixture["expected_component_ids"]; !ok {
					t.Fatalf("%s missing component expectation", file)
				}
			}
		case "filter":
			if _, ok := fixture["expected_component_ids"]; !ok {
				t.Fatalf("%s missing expected_component_ids", file)
			}
		case "apply":
			if _, ok := fixture["component_map"]; !ok {
				t.Fatalf("%s missing component_map", file)
			}
		case "artifact":
			if _, ok := fixture["component_map"]; !ok {
				t.Fatalf("%s missing component_map", file)
			}
		case "dataset":
			if _, ok := fixture["expected_dataset"]; !ok {
				t.Fatalf("%s missing expected_dataset", file)
			}
		case "score":
			if _, ok := fixture["expected_scalar"]; !ok {
				t.Fatalf("%s missing expected_scalar", file)
			}
		case "judge_payload":
			if _, ok := fixture["expected_judge_payload_subset"]; !ok {
				t.Fatalf("%s missing expected_judge_payload_subset", file)
			}
		case "evidence":
			if _, ok := fixture["expected_evidence_subset"]; !ok {
				t.Fatalf("%s missing expected_evidence_subset", file)
			}
		case "evaluate":
			if _, ok := fixture["dataset"]; !ok {
				t.Fatalf("%s missing dataset", file)
			}
		case "engine":
			if _, ok := fixture["engine_response"]; !ok {
				t.Fatalf("%s missing engine_response", file)
			}
		case "eval":
			if _, ok := fixture["responses"]; !ok {
				t.Fatalf("%s missing responses", file)
			}
		default:
			t.Fatalf("%s has unknown axoptimize operation %v", file, fixture["operation"])
		}
	}
}

func TestSignatureSchemaValidationConformanceFixturesLoad(t *testing.T) {
	cases := []struct {
		dir      string
		minFiles int
		check    func(t *testing.T, file string, fixture map[string]any)
	}{
		{
			dir:      signatureConformancePath(),
			minFiles: 10,
			check: func(t *testing.T, file string, fixture map[string]any) {
				switch fixture["kind"] {
				case "signature":
					if _, ok := fixture["expected_signature"]; !ok {
						t.Fatalf("%s missing expected_signature", file)
					}
				case "signature_error":
					if _, ok := fixture["expected_error_contains"]; !ok {
						t.Fatalf("%s missing expected_error_contains", file)
					}
				default:
					t.Fatalf("%s has unknown signature kind %v", file, fixture["kind"])
				}
			},
		},
		{
			dir:      schemaConformancePath(),
			minFiles: 8,
			check: func(t *testing.T, file string, fixture map[string]any) {
				if fixture["kind"] != "json_schema" {
					t.Fatalf("%s has unknown schema kind %v", file, fixture["kind"])
				}
				if _, ok := fixture["expected_schema"]; !ok {
					t.Fatalf("%s missing expected_schema", file)
				}
			},
		},
		{
			dir:      validationConformancePath(),
			minFiles: 8,
			check: func(t *testing.T, file string, fixture map[string]any) {
				switch fixture["kind"] {
				case "validate_value":
					if _, ok := fixture["field"]; !ok {
						t.Fatalf("%s missing field", file)
					}
				case "validate_output":
					if _, ok := fixture["signature_spec"]; !ok {
						t.Fatalf("%s missing signature_spec", file)
					}
				case "strip_internal":
					if _, ok := fixture["expected_output"]; !ok {
						t.Fatalf("%s missing expected_output", file)
					}
				default:
					t.Fatalf("%s has unknown validation kind %v", file, fixture["kind"])
				}
			},
		},
	}
	for _, tc := range cases {
		files, err := filepath.Glob(filepath.Join(tc.dir, "*.json"))
		if err != nil {
			t.Fatal(err)
		}
		if len(files) < tc.minFiles {
			t.Fatalf("expected fixtures in %s, got %d", tc.dir, len(files))
		}
		for _, file := range files {
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var fixture map[string]any
			if err := json.Unmarshal(data, &fixture); err != nil {
				t.Fatalf("%s: %v", file, err)
			}
			if fixture["name"] == "" || fixture["kind"] == "" {
				t.Fatalf("%s missing name/kind", file)
			}
			tc.check(t, file, fixture)
		}
	}
}

func TestCompilePythonGeneratedAxLibrary(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "smoke.py")
	err = os.WriteFile(script, []byte(`import sys
sys.path.insert(0, sys.argv[1])
from ax import AIClient, AxBaseAI, OpenAICompatibleClient, agent, ai, ax, f, fn, s

sig = s('question:string -> answer:string')
assert sig.get_input_fields()[0].name == 'question'
class_sig = s('text:string -> sentiment:class "positive, negative"')
assert class_sig.get_output_fields()[0].type.options == ['positive', 'negative']

nested = f().input('document', f.string().cache()).output(
    'profile',
    f.object({
        'displayName': f.string().min(1),
        'email': f.string().email().optional(),
    }),
).output('notes', f.string().internal()).build()
assert nested.has_complex_fields()

search = fn('search').description('Search docs').arg('query', f.string().min(1)).handler(lambda args: {'title': 'Docs'}).build()

class Fake(AIClient):
    def __init__(self):
        self.calls = 0
    def complete(self, request):
        self.calls += 1
        if self.calls == 1:
            return {'content': '', 'function_calls': [{'id': 'c1', 'name': 'search', 'params': {'query': 'q'}}]}
        if self.calls == 2:
            return {'content': '{}'}
        return {'content': '{"answer": "done"}'}

gen = ax('query:string -> answer:string', {'functions': [search], 'validation_retries': 2})
out = gen.forward(Fake(), {'query': 'q'})
assert out == {'answer': 'done'}, out

class AgentFake(AIClient):
    def __init__(self):
        self.calls = 0
    def complete(self, request):
        self.calls += 1
        if self.calls == 1:
            return {'content': '{"completion":{"type":"final","args":["Answer",{}]}}'}
        if self.calls == 2:
            return {'content': '{"completion":{"type":"final","args":["Answer",{"answer":"done"}]}}'}
        return {'content': '{"answer": "done"}'}

ag = agent('question:string -> answer:string', {'contextFields': []})
agent_out = ag.forward(AgentFake(), {'question': 'q'})
assert agent_out == {'answer': 'done'}, agent_out
assert len(ag.get_chat_log()) == 3

service = ai('openai', api_key='test', transport=lambda req: {
    'status': 200,
    'json': {
        'id': 'chatcmpl_smoke',
        'model': 'gpt-4.1-mini',
        'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'content': 'ok'}}],
    },
})
assert isinstance(service, OpenAICompatibleClient)
chat = service.chat({'chat_prompt': [{'role': 'user', 'content': 'hello'}], 'model_config': {'stream': False}})
assert chat['results'][0]['content'] == 'ok', chat
assert service.get_last_used_chat_model() == 'gpt-4.1-mini'
assert AxBaseAI
print('python-ok')
`), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("python3", script, dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python generated library failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "python-ok") {
		t.Fatalf("unexpected python output: %s", out)
	}
}

func TestPythonPromptConformanceFixtures(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("python3", "-m", "ax.conformance", promptConformancePath())
	cmd.Env = append(os.Environ(), "PYTHONPATH="+dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python prompt conformance fixtures failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok default-basic") || !strings.Contains(string(out), "ok template-string-equality") {
		t.Fatalf("unexpected prompt conformance output: %s", out)
	}
}

func TestPythonAxGenConformanceFixtures(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("python3", "-m", "ax.conformance", axgenConformancePath())
	cmd.Env = append(os.Environ(), "PYTHONPATH="+dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python conformance fixtures failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok simple-forward") {
		t.Fatalf("unexpected conformance output: %s", out)
	}
}

func TestPythonAxAIConformanceFixtures(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("python3", "-m", "ax.conformance", axaiConformancePath())
	cmd.Env = append(os.Environ(), "PYTHONPATH="+dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python AxAI conformance fixtures failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok simple-chat") {
		t.Fatalf("unexpected AxAI conformance output: %s", out)
	}
}

func TestPythonAxAgentConformanceFixtures(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("python3", "-m", "ax.conformance", axagentConformancePath())
	cmd.Env = append(os.Environ(), "PYTHONPATH="+dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python AxAgent conformance fixtures failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok simple-pipeline") {
		t.Fatalf("unexpected AxAgent conformance output: %s", out)
	}
}

func TestPythonAxOptimizeConformanceFixtures(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("python3", "-m", "ax.conformance", axoptimizeConformancePath())
	cmd.Env = append(os.Environ(), "PYTHONPATH="+dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python AxOptimize conformance fixtures failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok axgen-component-inventory") {
		t.Fatalf("unexpected AxOptimize conformance output: %s", out)
	}
}

func TestPythonSignatureSchemaValidationConformanceFixtures(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		path string
		want string
	}{
		{name: "signature", path: signatureConformancePath(), want: "ok default-string-type"},
		{name: "schema", path: schemaConformancePath(), want: "ok primitive-and-class-output"},
		{name: "validation", path: validationConformancePath(), want: "ok output-valid-nested"},
	} {
		cmd := exec.Command("python3", "-m", "ax.conformance", tc.path)
		cmd.Env = append(os.Environ(), "PYTHONPATH="+dir)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("python %s conformance fixtures failed: %v\n%s", tc.name, err, out)
		}
		if !strings.Contains(string(out), tc.want) {
			t.Fatalf("unexpected %s conformance output: %s", tc.name, out)
		}
	}
}

func TestPythonGeneratedIdioms(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	aiFile, err := os.ReadFile(filepath.Join(dir, "ax", "ai.py"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(aiFile)
	for _, want := range []string{
		"def get_last_used_chat_model",
		"def get_last_used_embed_model",
		"chat_prompt",
		"model_config",
		"class AxBaseAI",
		"class OpenAICompatibleClient",
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def validate_chat_request(",
		"def merge_model_config(",
		"def chat_response_to_completion(",
		"def openai_build_chat_request(",
		"def openai_normalize_chat_response(",
		"def openai_normalize_stream_delta(",
		"def openai_normalize_error(",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("generated Python missing idiom marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"def openai_build_chat_request(request: dict[str, Any]):",
		"def openai_normalize_chat_response(raw: dict[str, Any], ai_name: str = \"openai\", model: str | None = None):",
		"def _to_openai_message(",
		"def _to_openai_content_part(",
		"def _normalize_openai_tool_calls(",
		"def _map_finish_reason(",
		"def _model_usage(",
		"def chat_response_to_completion(response: dict[str, Any]):",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("generated Python AI runtime still contains old hand-authored provider body %q", forbidden)
		}
	}
	promptFile, err := os.ReadFile(filepath.Join(dir, "ax", "prompt.py"))
	if err != nil {
		t.Fatal(err)
	}
	promptText := string(promptFile)
	for _, want := range []string{
		"PROMPT_FEATURES",
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def _template_parse_impl(",
		"def _template_render_tree_impl(",
		"def _prompt_structured_impl(",
		"def _prompt_messages_impl(",
		"def render_template_content(",
		"def validate_prompt_template_syntax(",
		"def render_prompt(",
		"return render_prompt(self.signature",
		"<identity>",
	} {
		if !strings.Contains(promptText, want) {
			t.Fatalf("generated Python prompt runtime missing marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"def _parse_nodes",
		"def _render_nodes",
		"def render_template_content(template: str, vars: dict[str, Any] | None = None",
		"def _build_structured_prompt",
		"def _render_input_fields_for_values",
	} {
		if strings.Contains(promptText, forbidden) {
			t.Fatalf("generated Python prompt runtime still contains old hand-authored prompt body %q", forbidden)
		}
	}
	genFile, err := os.ReadFile(filepath.Join(dir, "ax", "gen.py"))
	if err != nil {
		t.Fatal(err)
	}
	genText := string(genFile)
	for _, want := range []string{
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def _build_gen_chat_request(",
		"def _complete_with_retries_impl(",
		"def _parse_output_impl(",
		"def _render_examples(",
		"def _render_demos(",
		"def _apply_field_processors(",
		"def _run_assertions(",
		"def _record_trace(",
		"def _should_continue_steps(",
		"def _execute_tool_call(",
		"def _forward_impl(",
		"return _forward_impl(self, client, values, options)",
		"while True:",
		"try:",
		"except Exception as",
		"def _stream_event_content_parts_impl(",
		"def fold_stream(",
		"_stream_event_content_parts_impl(event)",
		"_core_string_join(\"\", chunks)",
	} {
		if !strings.Contains(genText, want) {
			t.Fatalf("generated Python gen runtime missing Core-emitted marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"def _complete_with_retries(client, req, retries: int):",
		"def _parse_output(content: str):",
		"def _tool_spec(fn):",
		"def _function_call_mode(mode):",
		"def _completion_call_to_chat(call):",
		"def fold_stream(events) -> str:",
		"while True:\n            req = self._request(messages, options)",
		"elif isinstance(event, dict):",
		"chunks.append(\n                data.get(\"delta\")",
	} {
		if strings.Contains(genText, forbidden) {
			t.Fatalf("generated Python gen runtime still contains old hand-authored fold_stream body %q", forbidden)
		}
	}
	agentFile, err := os.ReadFile(filepath.Join(dir, "ax", "agent.py"))
	if err != nil {
		t.Fatal(err)
	}
	agentText := string(agentFile)
	for _, want := range []string{
		"class AxAgent",
		"class AxAgentClarificationError",
		"class AxCodeRuntime",
		"class AxCodeSession",
		"def agent(",
		"def test(",
		"def execute_actor_step(",
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def _normalize_agent_runtime(",
		"def _normalize_agent_policy(",
		"def _normalize_agent_callable_inventory(",
		"def _agent_discover(",
		"def _agent_recall(",
		"def _agent_used(",
		"def _agent_execute_callable(",
		"def _agent_append_guidance(",
		"def _agent_optimizer_metadata(",
		"def _agent_export_trace(",
		"def _agent_replay_trace(",
		"def get_trace(",
		"def replay_trace(",
		"def _agent_runtime_test(",
		"def _agent_runtime_execute_step(",
		"def _normalize_agent_runtime_step_result(",
		"def _agent_factory(",
		"def _split_context_values(",
		"def _normalize_agent_completion_payload(",
		"def _merge_agent_chat_log(",
		"def _agent_forward(",
		"return _agent_forward(",
	} {
		if !strings.Contains(agentText, want) {
			t.Fatalf("generated Python agent runtime missing Core-emitted marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"_core_agent_forward_impl",
		"_core_agent_runtime_impl",
		"_core_agent_discover_impl",
		"_axir_agent",
		"intrinsic.agent.forward",
	} {
		if strings.Contains(agentText, forbidden) {
			t.Fatalf("generated Python agent runtime contains forbidden semantic escape %q", forbidden)
		}
	}
	signatureFile, err := os.ReadFile(filepath.Join(dir, "ax", "signature.py"))
	if err != nil {
		t.Fatal(err)
	}
	signatureText := string(signatureFile)
	for _, want := range []string{
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def _signature_parse_fields_impl(",
		"def _signature_parse_field_impl(",
		"def _signature_validate_field_shape_impl(",
		"def _signature_parse_impl(",
		"def parse_signature(",
		"_signature_parse_impl(signature)",
		"for part in parts:",
		"if missing_arrow:",
	} {
		if !strings.Contains(signatureText, want) {
			t.Fatalf("generated Python signature runtime missing Core-emitted marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"_core_signature_parse_impl",
		"_core_signature_validate_impl",
		"intrinsic.signature.parse",
		"intrinsic.signature.validate",
	} {
		if strings.Contains(signatureText, forbidden) {
			t.Fatalf("generated Python signature runtime still contains migrated semantic helper %q", forbidden)
		}
	}
	if strings.Contains(signatureText, "_axir_") {
		t.Fatal("generated Python signature runtime still contains forbidden _axir helper escape")
	}
	if strings.Contains(signatureText, "def parse_signature(signature: str) -> AxSignature:\n    text = signature.strip()") {
		t.Fatal("generated Python signature runtime still contains old template parse_signature body")
	}
	schemaFile, err := os.ReadFile(filepath.Join(dir, "ax", "schema.py"))
	if err != nil {
		t.Fatal(err)
	}
	schemaText := string(schemaFile)
	for _, want := range []string{
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def _schema_field_schema_impl(",
		"def _schema_to_json_schema_impl(",
		"def _validate_fields_impl(",
		"def _validate_value_impl(",
		"def to_json_schema(",
		"_schema_to_json_schema_impl(fields, schema_title, options)",
		"def validate_output(",
		"_validate_output_impl(fields, values)",
		"for field in fields:",
		"if include:",
		"re.search(pattern, value)",
	} {
		if !strings.Contains(schemaText, want) {
			t.Fatalf("generated Python schema runtime missing Core-emitted marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"_core_schema_to_json_schema_impl",
		"_core_validate_fields_impl",
		"_core_validate_output_impl",
		"_core_validate_value_impl",
	} {
		if strings.Contains(schemaText, forbidden) {
			t.Fatalf("generated Python schema runtime still contains migrated semantic helper %q", forbidden)
		}
	}
	if strings.Contains(schemaText, "_axir_") {
		t.Fatal("generated Python schema runtime still contains forbidden _axir helper escape")
	}
	if strings.Contains(schemaText, "def to_json_schema(fields, schema_title: str = \"Schema\"") {
		t.Fatal("generated Python schema runtime still contains old template to_json_schema body")
	}
	for _, forbidden := range []string{"def getLastUsed", "def setOptions"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("generated Python should prefer snake_case, found %q", forbidden)
		}
	}
}

func TestJavaGeneratedCoreRuntime(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "java", dir); err != nil {
		t.Fatal(err)
	}
	coreFile, err := os.ReadFile(filepath.Join(dir, "dev", "ax", "Core.java"))
	if err != nil {
		t.Fatal(err)
	}
	coreText := string(coreFile)
	for _, want := range []string{
		"// BEGIN AXIR CORE EMITTED FUNCTIONS",
		"static Object parse_signature(",
		"static Object to_json_schema(",
		"static Object validate_output(",
		"static Object render_prompt(",
		"static Object fold_stream(",
		"static Object _forward_impl(",
		"static Object openai_build_chat_request(",
		"static Object openai_normalize_chat_response(",
		"static Object openai_normalize_stream_delta(",
		"static Object _normalize_agent_runtime(",
		"static Object _normalize_agent_policy(",
		"static Object _normalize_agent_callable_inventory(",
		"static Object _agent_discover(",
		"static Object _agent_optimizer_metadata(",
		"static Object _agent_export_trace(",
		"static Object _agent_replay_trace(",
		"static Object _agent_runtime_test(",
		"static Object _agent_runtime_execute_step(",
		"static Object _normalize_agent_runtime_step_result(",
		"static Object _agent_forward(",
		"static Object _split_context_values(",
		"static Object _normalize_agent_completion_payload(",
		"class TemplateEngine",
		"class PromptRuntime",
	} {
		if !strings.Contains(coreText, want) {
			t.Fatalf("generated Java Core runtime missing marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"_core_signature_parse_impl",
		"_core_schema_to_json_schema_impl",
		"_core_validate_output_impl",
		"_core_openai_build_chat_request_impl",
		"intrinsic.signature.parse",
		"intrinsic.schema.to_json_schema",
		"intrinsic.validate.output",
	} {
		if strings.Contains(coreText, forbidden) {
			t.Fatalf("generated Java Core runtime contains forbidden semantic escape %q", forbidden)
		}
	}
	axGenFile, err := os.ReadFile(filepath.Join(dir, "dev", "ax", "AxGen.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(axGenFile), "Core._forward_impl(") {
		t.Fatal("generated Java AxGen does not delegate forward to Core")
	}
	axAgentFile, err := os.ReadFile(filepath.Join(dir, "dev", "ax", "AxAgent.java"))
	if err != nil {
		t.Fatal(err)
	}
	axAgentText := string(axAgentFile)
	for _, want := range []string{
		"public final class AxAgent",
		"Core._agent_factory(",
		"Core._agent_forward(",
		"Core._agent_runtime_test(",
		"Core._agent_runtime_execute_step(",
		"Core._agent_discover(",
		"executeActorStep",
		"AxCodeRuntime",
		"getRuntimeContract",
		"getPolicy",
		"getChatLog",
		"getState",
	} {
		if !strings.Contains(axAgentText, want) {
			t.Fatalf("generated Java AxAgent missing marker %q", want)
		}
	}
	openAIFile, err := os.ReadFile(filepath.Join(dir, "dev", "ax", "OpenAICompatibleClient.java"))
	if err != nil {
		t.Fatal(err)
	}
	openAIText := string(openAIFile)
	for _, want := range []string{
		"Core.openai_build_chat_request(",
		"Core.openai_normalize_chat_response(",
		"Core.openai_normalize_stream_delta(",
		"Core.openai_build_embed_request(",
		"Core.openai_normalize_error(",
	} {
		if !strings.Contains(openAIText, want) {
			t.Fatalf("generated Java OpenAI client missing Core delegation %q", want)
		}
	}
	conformanceFile, err := os.ReadFile(filepath.Join(dir, "dev", "ax", "Conformance.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(conformanceFile), "public final class Conformance") || !strings.Contains(string(conformanceFile), "case \"ai_chat\"") || !strings.Contains(string(conformanceFile), "case \"agent_forward\"") || !strings.Contains(string(conformanceFile), "case \"agent_runtime_policy\"") || !strings.Contains(string(conformanceFile), "case \"agent_runtime_session\"") || !strings.Contains(string(conformanceFile), "case \"optimize\"") {
		t.Fatal("generated Java conformance runner is missing expected fixture dispatch")
	}
}

func TestCompileJavaGeneratedAxLibrary(t *testing.T) {
	javacPath, err := findJavaTool("javac")
	if err != nil {
		t.Skip(err)
	}
	javaPath, err := findJavaTool("java")
	if err != nil {
		t.Skip(err)
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "java", dir); err != nil {
		t.Fatal(err)
	}
	smoke := filepath.Join(dir, "Smoke.java")
	err = os.WriteFile(smoke, []byte(`import dev.ax.*;
import java.util.*;

public class Smoke {
  static final class Fake implements AiClient {
    public Map<String, Object> complete(Map<String, Object> request) {
      return Map.of("content", "{\"answer\":\"Paris\"}");
    }
  }
  public static void main(String[] args) throws Exception {
    AxSignature sig = Ax.s("question:string -> answer:string");
    AxGen qa = Ax.ax(sig);
    Map<String, Object> out = qa.forward(new Fake(), Map.of("question", "Capital?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    final class AgentFake implements AiClient {
      int calls = 0;
      public Map<String, Object> complete(Map<String, Object> request) {
        calls++;
        if (calls == 1) return Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}");
        if (calls == 2) return Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}");
        return Map.of("content", "{\"answer\":\"Paris\"}");
      }
    }
    AxAgent agent = Ax.agent("question:string -> answer:string", Map.of("contextFields", List.of()));
    Map<String, Object> agentOut = agent.forward(new AgentFake(), Map.of("question", "Capital?"));
    if (!"Paris".equals(agentOut.get("answer"))) throw new RuntimeException("bad agent output: " + agentOut);
    System.out.println("java-ok");
  }
}
`), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "dev", "ax", "*.java"))
	if err != nil {
		t.Fatal(err)
	}
	args := append(files, smoke)
	javac := exec.Command(javacPath, args...)
	out, err := javac.CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "Unable to locate a Java Runtime") {
			t.Skip("javac is present but no Java runtime is installed")
		}
		t.Fatalf("javac failed: %v\n%s", err, out)
	}
	java := exec.Command(javaPath, "-cp", dir, "Smoke")
	out, err = java.CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "Unable to locate a Java Runtime") {
			t.Skip("java runtime is not installed")
		}
		t.Fatalf("java smoke failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "java-ok") {
		t.Fatalf("unexpected java output: %s", out)
	}
	java = exec.Command(javaPath, "-cp", dir, "dev.ax.Conformance", signatureConformancePath(), schemaConformancePath(), validationConformancePath(), promptConformancePath(), axgenConformancePath(), axaiConformancePath(), axagentConformancePath(), axoptimizeConformancePath())
	out, err = java.CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "Unable to locate a Java Runtime") {
			t.Skip("java runtime is not installed")
		}
		t.Fatalf("java conformance failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok default-string-type") || !strings.Contains(string(out), "ok simple-chat") {
		t.Fatalf("unexpected java conformance output: %s", out)
	}
}

func TestCppGeneratedCoreRuntime(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "cpp", dir); err != nil {
		t.Fatal(err)
	}
	header, err := os.ReadFile(filepath.Join(dir, "ax", "ax.hpp"))
	if err != nil {
		t.Fatal(err)
	}
	headerText := string(header)
	for _, want := range []string{
		"namespace ax",
		"Value s(const std::string& signature)",
		"class AIClient",
		"class AxAIService",
		"class OpenAICompatibleClient",
		"class Tool",
		"class AxGen",
		"class AxAgent",
		"class AxCodeRuntime",
		"class AxCodeSession",
		"Value to_json_schema(",
		"Value validate_output(",
		"Value render_prompt(",
		"Value fold_stream(",
		"AxAgent agent(",
		"Value test(AxCodeRuntime& runtime",
		"Value execute_actor_step(AxCodeRuntime& runtime",
		"Value get_runtime_contract() const",
		"Value discover(Value request)",
	} {
		if !strings.Contains(headerText, want) {
			t.Fatalf("generated C++ header missing %q", want)
		}
	}
	source, err := os.ReadFile(filepath.Join(dir, "ax", "ax.cpp"))
	if err != nil {
		t.Fatal(err)
	}
	sourceText := string(source)
	for _, want := range []string{
		"// BEGIN AXIR CORE EMITTED FUNCTIONS",
		"Value Core::parse_signature(",
		"Value Core::to_json_schema(",
		"Value Core::validate_output(",
		"Value Core::render_prompt(",
		"Value Core::_forward_impl(",
		"Value Core::_execute_tool_call(",
		"Value Core::fold_stream(",
		"Value Core::openai_build_chat_request(",
		"Value Core::openai_normalize_chat_response(",
		"Value Core::openai_normalize_stream_delta(",
		"Value Core::openai_build_embed_request(",
		"Value Core::openai_normalize_error(",
		"Value Core::_normalize_agent_runtime(",
		"Value Core::_normalize_agent_policy(",
		"Value Core::_normalize_agent_callable_inventory(",
		"Value Core::_agent_discover(",
		"Value Core::_agent_optimizer_metadata(",
		"Value Core::_agent_export_trace(",
		"Value Core::_agent_replay_trace(",
		"Value Core::_agent_runtime_test(",
		"Value Core::_agent_runtime_execute_step(",
		"Value Core::_normalize_agent_runtime_step_result(",
		"Value Core::_agent_forward(",
		"Value Core::_split_context_values(",
		"Value Core::_normalize_agent_completion_payload(",
		"Value Core::agent_stage_forward(",
	} {
		if !strings.Contains(sourceText, want) {
			t.Fatalf("generated C++ source missing Core marker %q", want)
		}
	}
	for _, forbidden := range []string{
		"_axir_",
		"_core_signature_parse_impl",
		"_core_schema_to_json_schema_impl",
		"_core_validate_output_impl",
		"intrinsic.signature.parse",
		"intrinsic.schema.to_json_schema",
		"intrinsic.validate.output",
	} {
		if strings.Contains(sourceText, forbidden) {
			t.Fatalf("generated C++ source contains forbidden symbol %q", forbidden)
		}
	}
	conformance, err := os.ReadFile(filepath.Join(dir, "conformance.cpp"))
	if err != nil {
		t.Fatal(err)
	}
	conformanceText := string(conformance)
	for _, want := range []string{
		`kind == "signature"`,
		`kind == "json_schema"`,
		`kind == "validate_output"`,
		`kind == "prompt"`,
		`kind == "stream"`,
		`kind == "forward"`,
		`kind == "ai_chat"`,
		`kind == "ai_embed"`,
		`kind == "ai_stream"`,
		`kind == "ai_error"`,
		`kind == "ai_unsupported"`,
		`kind == "agent_forward"`,
		`kind == "agent_runtime_policy"`,
		`kind == "agent_runtime_session"`,
		`kind == "optimize"`,
	} {
		if !strings.Contains(conformanceText, want) {
			t.Fatalf("generated C++ conformance runner missing %q", want)
		}
	}
}

func TestCompileCppGeneratedAxLibrary(t *testing.T) {
	cpp, err := findCppCompiler()
	if err != nil {
		t.Skip(err)
	}
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "cpp", dir); err != nil {
		t.Fatal(err)
	}
	smoke := filepath.Join(dir, "smoke.cpp")
	err = os.WriteFile(smoke, []byte(`#include "ax/ax.hpp"
#include <iostream>

int main() {
  ax::Value sig = ax::s("question:string -> answer:string");
  ax::Value schema = ax::to_json_schema(ax::Core::get(sig, "outputs"));
  ax::Value values = ax::Value::object();
  ax::Core::set(values, "answer", "Paris");
  ax::validate_output(ax::Core::get(sig, "outputs"), values);
  ax::Value input = ax::Value::object();
  ax::Core::set(input, "question", "Capital?");
  ax::Value messages = ax::render_prompt(sig, input);
  if (!ax::Core::truthy(messages) || !ax::Core::truthy(schema)) return 1;
  struct FakeClient : ax::AIClient {
    ax::Value complete(ax::Value) override {
      return ax::object({{"content", "{\"answer\":\"Paris\"}"}});
    }
  } client;
  auto qa = ax::ax("question:string -> answer:string");
  ax::Value out = qa.forward(client, ax::object({{"question", "Capital?"}}));
  if (!ax::equal(ax::Core::get(out, "answer"), "Paris")) return 2;
  struct AgentFakeClient : ax::AIClient {
    int calls = 0;
    ax::Value complete(ax::Value) override {
      ++calls;
      if (calls == 1) return ax::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}});
      if (calls == 2) return ax::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}});
      return ax::object({{"content", "{\"answer\":\"Paris\"}"}});
    }
  } agent_client;
  auto ag = ax::agent("question:string -> answer:string", ax::object({{"contextFields", ax::array({})}}));
  ax::Value agent_out = ag.forward(agent_client, ax::object({{"question", "Capital?"}}));
  if (!ax::equal(ax::Core::get(agent_out, "answer"), "Paris")) return 3;
  auto service = ax::ai("openai", ax::object({{"model", "gpt-4.1-mini"}, {"api_key", "test-key"}}));
  (void)service;
  std::cout << "cpp-ok\n";
}
`), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	axSource := filepath.Join(dir, "ax", "ax.cpp")
	smokeBin := filepath.Join(dir, "smoke")
	cmd := exec.Command(cpp, "-std=c++17", "-I", dir, axSource, smoke, "-o", smokeBin)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("C++ smoke compile failed: %v\n%s", err, out)
	}
	out, err = exec.Command(smokeBin).CombinedOutput()
	if err != nil {
		t.Fatalf("C++ smoke failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "cpp-ok") {
		t.Fatalf("unexpected C++ smoke output: %s", out)
	}

	conformanceBin := filepath.Join(dir, "conformance")
	cmd = exec.Command(cpp, "-std=c++17", "-I", dir, axSource, filepath.Join(dir, "conformance.cpp"), "-o", conformanceBin)
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("C++ conformance compile failed: %v\n%s", err, out)
	}
	out, err = exec.Command(
		conformanceBin,
		signatureConformancePath(),
		schemaConformancePath(),
		validationConformancePath(),
		promptConformancePath(),
		axgenConformancePath(),
		axaiConformancePath(),
		axagentConformancePath(),
		axoptimizeConformancePath(),
	).CombinedOutput()
	if err != nil {
		t.Fatalf("C++ conformance failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok default-string-type") || !strings.Contains(string(out), "ok simple-forward") || !strings.Contains(string(out), "ok simple-chat") {
		t.Fatalf("unexpected C++ conformance output: %s", out)
	}
}

func TestVerifyGeneratedPackages(t *testing.T) {
	report, err := Verify(rootPath(), VerifyOptions{
		Targets: []string{"python", "java", "cpp"},
		WorkDir: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("verify failed: %v\n%s", err, report.String())
	}
	text := report.String()
	for _, want := range []string{
		"python:",
		"java:",
		"cpp:",
		"ok compile",
		"ok manifest",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("verify report missing %q:\n%s", want, text)
		}
	}
}
