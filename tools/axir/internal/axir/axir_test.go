package axir

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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

func repoRootPath() string {
	return filepath.Join("..", "..", "..", "..")
}

// TestAgentCrossLanguageParity is the cross-language drift guard (G8). The agent is emitted
// from a single IR (ir/axcore/agent.axir), so the emitted ops are parity by construction and
// the coverage audit already proves 365/365 cross-target. The drift risk lives in the HOST GLUE
// that the IR cannot reach: the per-language intrinsic bindings and the conformance-runner kind
// dispatch. A new agent feature (a new intrinsic or a new conformance kind) added to one language
// but not the others compiles fine per-language yet makes the agents behave differently. This gate
// makes that impossible: a future omission fails the build.
func TestAgentCrossLanguageParity(t *testing.T) {
	// 1. Agent intrinsic binding parity. All four languages with an explicit intrinsic->host map
	//    (Python, Rust, C++, Java; Go derives `_core_*` by convention) must bind the SAME set of
	//    `intrinsic.agent.*`. A new agent intrinsic added to some maps but not others is the most
	//    common silent drift -- it compiles per-language while the agents behave differently.
	//    Scoped to agent intrinsics (the parity guarantee this gate owns); non-agent asymmetries
	//    between the maps are a separate concern.
	isAgent := func(i CoreIntrinsic) bool { return strings.HasPrefix(string(i), "intrinsic.agent.") }
	intrinsicMaps := map[string]map[CoreIntrinsic]string{
		"Python": coreIntrinsicPython,
		"Rust":   coreIntrinsicRust,
		"Cpp":    coreIntrinsicCpp,
		"Java":   coreIntrinsicJava,
	}
	agentIntrinsics := map[CoreIntrinsic]bool{}
	for _, m := range intrinsicMaps {
		for intr := range m {
			if isAgent(intr) {
				agentIntrinsics[intr] = true
			}
		}
	}
	for intr := range agentIntrinsics {
		for lang, m := range intrinsicMaps {
			if _, ok := m[intr]; !ok {
				t.Errorf("DRIFT: agent intrinsic %q is bound in some languages but missing from coreIntrinsic%s", intr, lang)
			}
		}
	}

	// (Host-impl existence is enforced by compilation: when agent.axir uses an intrinsic,
	// codegen emits a call to its host function, and a missing function fails that language's
	// build during verify/go-test. So map-key parity above + compilation together guarantee an
	// implementation exists in every language; we do not re-grep per-language host names, whose
	// spelling differs (Go/Python `_core_*`, Rust `core_*`, Java/C++ methods).)

	// 2. Conformance-kind dispatch parity. Every agent_* fixture kind dispatched in one runner
	//    must be dispatched in all five (anchored on each language's dispatch syntax so
	//    error-category string literals like rust's "agent_clarification" are not matched).
	dispatch := map[string]*regexp.Regexp{
		"go":     regexp.MustCompile(`case\s+"(agent_[a-z_]+)"`),
		"cpp":    regexp.MustCompile(`(?:kind\s*==\s*|case\s+)"(agent_[a-z_]+)"`),
		"java":   regexp.MustCompile(`case\s+"(agent_[a-z_]+)"`),
		"rust":   regexp.MustCompile(`"(agent_[a-z_]+)"\s*=>`),
		"python": regexp.MustCompile(`==\s*"(agent_[a-z_]+)"`),
	}
	sources := map[string]string{"go": goRuntime + goConformance, "cpp": cppConformance, "java": javaConformance, "rust": rustLib, "python": pyConformance}
	kindsByLang := map[string]map[string]bool{}
	union := map[string]bool{}
	for lang, re := range dispatch {
		set := map[string]bool{}
		for _, m := range re.FindAllStringSubmatch(sources[lang], -1) {
			set[m[1]] = true
			union[m[1]] = true
		}
		kindsByLang[lang] = set
	}
	for kind := range union {
		for lang, set := range kindsByLang {
			if !set[kind] {
				t.Errorf("DRIFT: conformance kind %q is dispatched in some languages but NOT %s", kind, lang)
			}
		}
	}
}

// TestAgentPublicAPIParity is the G9 gate: cross-language public-API parity for AxAgent.
//
// The Rust agent shipped without optimize()/playbook(), and Go without optimize(), because no
// gate asserted that every language's AxAgent exposes the SAME public methods. Conformance only
// checks behavior (the forward loop); runtime_model.go merely *appends* claimed public symbols
// (optimize, playbook, AxPlaybook) to a manifest without verifying each package emits them -- so a
// language could silently omit a public method and pass everything. This gate greps each
// language's AxAgent surface (from the embedded templates) and fails if a required method is
// missing anywhere. Negative test: delete one method's impl and this must fail. See
// docs/AXIR_GATES.md (G9).
func TestAgentPublicAPIParity(t *testing.T) {
	// cppHeader declares many classes; slice to the AxAgent class so a method on (say) AxGen
	// can't satisfy the AxAgent requirement. Other sources are the AxAgent file itself
	// (javaAxAgent) or carry per-method patterns that exclude lookalikes.
	sliceFromTo := func(src, start, end string) string {
		i := strings.Index(src, start)
		if i < 0 {
			return ""
		}
		rest := src[i+len(start):]
		if j := strings.Index(rest, end); j >= 0 {
			return rest[:j]
		}
		return rest
	}
	// Skip the forward declaration ("class AxAgent;") and slice the real definition.
	cppAgent := sliceFromTo(cppHeader, "class AxAgent : public AxProgram", "\n};")
	if cppAgent == "" {
		t.Fatal("G9: could not locate class AxAgent in cppHeader")
	}

	// Required AxAgent public methods, with a per-language pattern anchored on the DECLARATION
	// (not a call) and excluding lookalikes: Rust free fns / optimize_with (the `&mut self`
	// receiver + `optimize\b` word-boundary exclude both), and Python ActorAgentRLM.optimize
	// (which takes `self, request` not `self, dataset`).
	patterns := map[string]map[string]string{
		"optimize": {
			"go":     `func \(a \*AxAgent\) Optimize\(`,
			"rust":   `pub fn optimize\b[^(]*\(\s*&mut self`,
			"java":   `public [^\n;]*\boptimize\s*\(`,
			"python": `def optimize\(self, dataset`,
			"cpp":    `\boptimize\s*\(`,
		},
		"playbook": {
			"go":     `func \(a \*AxAgent\) Playbook\(`,
			"rust":   `pub fn playbook\b[^(]*\(\s*&mut self`,
			"java":   `public [^\n;]*\bplaybook\s*\(`,
			"python": `def playbook\(self`,
			"cpp":    `\bplaybook\s*\(`,
		},
	}
	srcs := map[string]string{
		"go":     goRuntime,
		"rust":   rustLib,
		"java":   javaAxAgent,
		"python": pyAgent,
		"cpp":    cppAgent,
	}
	for method, byLang := range patterns {
		for lang, pat := range byLang {
			if !regexp.MustCompile(pat).MatchString(srcs[lang]) {
				t.Errorf("G9 DRIFT: AxAgent.%s() missing in %s (every language's AxAgent must expose it; pattern %q)", method, lang, pat)
			}
		}
	}
}

// TestG4AgentCapabilityBackedByRealRunner is the G4 gate: capability-backed-by-real-run.
//
// The non-functional agent() shipped in five languages because "claiming the axagent
// capability" and "really running an agent" were independent facts -- a package exported
// agent()/AxAgent and listed axagent in supported_suites while no test required a real
// model-prose -> real-engine -> real final() -> completion loop. This test fuses the two:
// every language claims axagent (it is in SupportedSuites for all targets), so every
// language's conformance runner MUST carry the real-execution proof handlers. If a future
// change guts the real-engine path (drops the agent_runtime_real handler) or the
// prompt-parity path (agent_prompt), or deletes a real fixture, or drops a target from the
// behavioral-parity ledger, the claim is no longer backed and this fails. See
// docs/AXIR_GATES.md (G4).
func TestG4AgentCapabilityBackedByRealRunner(t *testing.T) {
	has := func(xs []string, want string) bool {
		for _, x := range xs {
			if x == want {
				return true
			}
		}
		return false
	}

	// Each language that claims axagent -> the conformance runner template(s) that must
	// carry the real-execution proof.
	runners := map[string][]string{
		"go":     {goRuntime, goConformance},
		"python": {pyConformance},
		"rust":   {rustLib},
		"java":   {javaConformance},
		"cpp":    {cppConformance},
	}
	for lang, templates := range runners {
		joined := strings.Join(templates, "\n")
		// G1 backing: the runner dispatches the real-engine fixture kind.
		if !strings.Contains(joined, "agent_runtime_real") {
			t.Errorf("%s claims axagent but its conformance runner has no agent_runtime_real handler (G4: real-engine proof missing)", lang)
		}
		// G3 backing: the runner asserts the RLM prompt was rendered into agent state.
		if !strings.Contains(joined, "agent_prompt") {
			t.Errorf("%s claims axagent but its conformance runner has no agent_prompt handler (G4: prompt-parity proof missing)", lang)
		}
	}
	// Go injects the real engine via a registration hook (it cannot import a concrete engine
	// from package ax without an import cycle); without the hook the real fixture cannot run.
	if !strings.Contains(goConformance, "RegisterConformanceRealRuntime") {
		t.Error("go conformance binary must register a real runtime via RegisterConformanceRealRuntime (G4)")
	}

	// The real-run + prompt fixtures the runners dispatch must exist on disk.
	for _, rel := range []string{
		"ir/conformance/axagent-real/agent-runtime-real-javascript-final.json",
		"ir/conformance/axagent/agent-prompt-executor-rlm-protocol.json",
	} {
		if _, err := os.Stat(filepath.Join(repoRootPath(), filepath.FromSlash(rel))); err != nil {
			t.Errorf("G4: required real-execution fixture missing: %s (%v)", rel, err)
		}
	}

	// The behavioral-parity ledger must record real execution as verified for all five.
	data, err := os.ReadFile(filepath.Join(repoRootPath(), "ir", "behavioral-parity-ledger.json"))
	if err != nil {
		t.Fatalf("G4: cannot read behavioral-parity ledger: %v", err)
	}
	var ledger struct {
		Entries []struct {
			Capability      string   `json:"capability"`
			VerifiedTargets []string `json:"verified_targets"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(data, &ledger); err != nil {
		t.Fatalf("G4: cannot parse behavioral-parity ledger: %v", err)
	}
	foundRealExec := false
	for _, e := range ledger.Entries {
		if e.Capability != "agent.rlm.real_execution" {
			continue
		}
		foundRealExec = true
		for _, lang := range []string{"go", "rust", "cpp", "python", "java"} {
			if !has(e.VerifiedTargets, lang) {
				t.Errorf("G4: ledger agent.rlm.real_execution does not list %s as a verified target", lang)
			}
		}
	}
	if !foundRealExec {
		t.Error("G4: behavioral-parity ledger has no agent.rlm.real_execution entry")
	}
}

func TestPublicGeneratedSurfaceHygiene(t *testing.T) {
	repoRoot := repoRootPath()
	for _, relRoot := range []string{
		"README.md",
		"docs",
		"src/examples",
		"scripts",
		"tools/axir",
		"packages",
	} {
		path := filepath.Join(repoRoot, filepath.FromSlash(relRoot))
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if !info.IsDir() {
			auditPublicSurfaceFileHygiene(t, repoRoot, path)
			continue
		}
		if err := filepath.WalkDir(path, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				if generatedPackageHygieneSkipDir(entry.Name()) {
					return filepath.SkipDir
				}
				auditPublicSurfacePathHygiene(t, repoRoot, path)
				return nil
			}
			auditPublicSurfacePathHygiene(t, repoRoot, path)
			if generatedPackageHygieneSkipFile(entry.Name()) {
				return nil
			}
			auditPublicSurfaceFileHygiene(t, repoRoot, path)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func auditPublicSurfacePathHygiene(t *testing.T, root, path string) {
	t.Helper()
	rel := generatedPackageHygieneRel(root, path)
	if rel != "" && generatedPackageLegacyFixturePattern.MatchString(rel) {
		t.Fatalf("public surface hygiene found forbidden public token %q in path %s", generatedPackageLegacyFixtureWord, rel)
	}
}

func auditPublicSurfaceFileHygiene(t *testing.T, root, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.ContainsRune(text, '\x00') {
		return
	}
	loc := generatedPackageLegacyFixturePattern.FindStringIndex(text)
	if loc == nil {
		return
	}
	line := 1 + strings.Count(text[:loc[0]], "\n")
	t.Fatalf("public surface hygiene found forbidden public token %q in %s:%d", generatedPackageLegacyFixtureWord, generatedPackageHygieneRel(root, path), line)
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
		"op core.record @OpenAIResponsesClient",
		"op core.record @AzureOpenAIClient",
		"op core.record @DeepSeekClient",
		"op core.record @MistralClient",
		"op core.record @RekaClient",
		"op core.record @CohereClient",
		"op core.record @GrokClient",
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
		"op core.func @agent_policy_vocabulary_registry",
		"op core.func @agent_context_policy_registry",
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
		"op core.func @resolve_agent_context_policy",
		"op core.func @agent_prepare_actor_context",
		"op core.func @agent_build_action_log_parts",
		"op core.func @agent_refresh_checkpoint_state",
		"op core.func @agent_context_fixture_result",
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
		"op core.func @flow_execute_nested_steps",
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
		"axagent_context_fields",
		"axagent_clarification",
		"axagent_chat_log",
		"axagent_state_alpha",
		"axagent_runtime_contract",
		"axagent_discovery_policy",
		"axagent_delegation_policy",
		"axagent_optimizer_metadata",
		"axagent_runtime_session",
		"axagent_shared_runtime_session",
		"axagent_shared_evidence_handoff",
		"axagent_relevance_ranking",
		"axagent_auto_upgrade",
		"axagent_signature_update",
		"axagent_agent_test",
		"axagent_runtime_state_restore",
		"axagent_runtime_adapter_helpers",
		"axagent_runtime_adapter_examples",
		"axagent_runtime_capability_negotiation",
		"axagent_runtime_protocol",
		"axagent_runtime_protocol_conformance",
		"axagent_runtime_process_error_handling",
		"axagent_runtime_lifecycle_beta",
		"axagent_runtime_cancellation_contract",
		"axagent_runtime_restart_once",
		"axagent_runtime_process_diagnostics",
		"axagent_axjs_reference_adapter",
		"axagent_process_runtime_helpers",
		"axagent_actor_step_alpha",
		"axagent_runtime_language",
		"axagent_actor_prompt_cache",
		"axagent_context_cache_precedence",
		"axagent_context_budget",
		"axagent_checkpointing",
		"axagent_action_log_compaction",
		"axagent_runtime_state_summary",
		"axagent_context_events",
		"axagent_executor_model_policy",
		"axagent_policy_registry",
		"axagent_policy_vocabulary_registry",
		"axagent_context_policy_registry",
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
		"axoptimize_ace_adapter_contract",
		"axoptimize_ace_engine",
		"axoptimize_ace_playbook_ops",
		"axoptimize_ace_online_update",
		"axoptimize_runtime_beta_contract",
		"axoptimize_artifact_lifecycle",
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
		"axflow_control_flow_runtime",
		"axflow_feedback_loop",
		"axflow_branch_runtime",
		"axflow_node_extension_helpers",
		"axflow_streaming_cache",
		"axflow_stop_inflight",
		"axflow_parallel_merge_errors",
		"axflow_optimization_components",
		"axflow_optimization_apply",
		"axflow_optimization_evaluation",
		"axflow_nested_component_paths",
		"axflow_optimization_rollback",
		"axai_provider_descriptor_registry",
		"axai_provider_alias_registry",
		"axai_model_catalog_audit",
		"axai_provider_routing_audit",
		"axai_model_catalog_runtime_api",
		"axai_multi_service_routing",
		"axai_provider_routing_analysis",
		"axai_balancer_runtime",
		"axai_balancer_retry_policy",
		"axai_balancer_metrics",
		"axai_host_processing_callbacks",
		"axai_openai_compatible_catalog_clients",
		"axai_provider_azure_openai_descriptor",
		"axai_provider_deepseek_descriptor",
		"axai_provider_mistral_descriptor",
		"axai_provider_reka_descriptor",
		"axai_provider_cohere_descriptor",
		"axai_provider_grok_descriptor",
		"google_gemini_provider_mapping",
		"gemini_media_content_mapping",
		"gemini_tool_schema_mapping",
		"gemini_stream_folding",
		"gemini_usage_normalization",
		"gemini_embeddings_normalization",
		"anthropic_provider_mapping",
		"anthropic_cache_control_mapping",
		"anthropic_thinking_normalization",
		"anthropic_stream_folding",
		"anthropic_usage_normalization",
	} {
		if !model.Features[feature] {
			t.Fatalf("runtime model missing prompt feature flag %s: %#v", feature, model.Features)
		}
	}
	for _, want := range []string{"ai", "AxAIService", "AxBaseAI", "OpenAICompatibleClient", "OpenAIResponsesClient", "GoogleGeminiClient", "AnthropicClient", "AzureOpenAIClient", "DeepSeekClient", "MistralClient", "RekaClient", "CohereClient", "GrokClient", "agent", "AxAgent", "AxAgentClarificationError", "flow", "AxFlow", "AxProgram"} {
		if _, ok := model.Symbols[want]; !ok {
			t.Fatalf("runtime model missing symbol %s", want)
		}
	}
	for _, want := range []string{"AxBalancer", "MultiServiceRouter", "ProviderRouter", "get_supported_ai_models"} {
		if !containsString(model.PublicSymbols, want) {
			t.Fatalf("runtime model missing generated public symbol %s: %#v", want, model.PublicSymbols)
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
		"resolve_agent_context_policy",
		"resolve_agent_executor_model_policy",
		"agent_prepare_actor_context",
		"agent_build_action_log_parts",
		"agent_refresh_checkpoint_state",
		"agent_build_action_evidence_summary",
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
		"flow_execute_nested_steps",
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
				"API.md",
				"pyproject.toml",
				"MANIFEST.in",
				"axir-capabilities.json",
				"axir-api.json",
				"conformance-coverage.json",
				"axllm/__init__.py",
				"axllm/py.typed",
				"axllm/ai.py",
				"axllm/agent.py",
				"axllm/runtime.py",
				"axllm/runtime_quickjs.py",
				"axllm/flow.py",
				"axllm/gen.py",
				"axllm/conformance.py",
				"examples/signature_schema.py",
				"examples/axgen_scripted_client_tool.py",
				"examples/axgen_openai_api.py",
				"examples/provider_mapping_no_key.py",
				"examples/provider_stream_no_key.py",
				"examples/runtime_adapter.py",
				"examples/runtime_protocol.py",
				"examples/runtime_profiles/javascript_quickjs.py",
				"examples/runtime_profiles/python_pyodide.py",
				"examples/runtime_profiles/pyodide-package.json",
				"examples/runtime_profiles/pyodide-runtime-policy.json",
				"examples/runtime_profiles/resolve_pyodide_runtime_server.sh",
				"examples/runtime_profiles/README.md",
				"examples/axflow_program_graph.py",
				"examples/flow_openai_api.py",
				"examples/audio_responses_mapping.py",
				"examples/audio_http_roundtrip.py",
				"examples/stream_http_roundtrip.py",
				"examples/realtime_audio_events.py",
				"examples/realtime_audio_turn.py",
				"examples/optimizer_artifact.py",
				"examples/gepa_local_optimizer.py",
				"examples/mcp_scripted_tools.py",
				"examples/mcp_sse_roundtrip.py",
			},
			wantReadme: "Ax for Python",
		},
		{
			target: "java",
			wantFiles: []string{
				"README.md",
				"API.md",
				"pom.xml",
				"build.gradle",
				"settings.gradle",
				"axir-capabilities.json",
				"axir-api.json",
				"conformance-coverage.json",
				"dev/axllm/ax/Ax.java",
				"dev/axllm/ax/AxProgram.java",
				"dev/axllm/ax/Core.java",
				"dev/axllm/ax/AxAgent.java",
				"dev/axllm/ax/AxFlow.java",
				"dev/axllm/ax/AxAgentClarificationException.java",
				"dev/axllm/ax/AxCodeRuntime.java",
				"dev/axllm/ax/AxCodeSession.java",
				"dev/axllm/ax/AxRuntimeCapabilities.java",
				"dev/axllm/ax/AxRuntimeEnvelope.java",
				"dev/axllm/ax/AxProcessCodeRuntime.java",
				"dev/axllm/ax/AxProcessCodeSession.java",
				"dev/axllm/ax/runtime/quickjs/AxQuickJsCodeRuntime.java",
				"dev/axllm/ax/runtime/quickjs/AxQuickJsCodeSession.java",
				"dev/axllm/ax/runtime/quickjs/AxQuickJsHostCallable.java",
				"dev/axllm/ax/runtime/quickjs/AxQuickJsProtocolServer.java",
				"dev/axllm/ax/OptimizerEngine.java",
				"dev/axllm/ax/OptimizerEvaluator.java",
				"dev/axllm/ax/AxGEPA.java",
				"dev/axllm/ax/OpenAICompatibleClient.java",
				"dev/axllm/ax/OpenAIResponsesClient.java",
				"dev/axllm/ax/GoogleGeminiClient.java",
				"dev/axllm/ax/AnthropicClient.java",
				"dev/axllm/ax/AzureOpenAIClient.java",
				"dev/axllm/ax/DeepSeekClient.java",
				"dev/axllm/ax/MistralClient.java",
				"dev/axllm/ax/RekaClient.java",
				"dev/axllm/ax/CohereClient.java",
				"dev/axllm/ax/GrokClient.java",
				"dev/axllm/ax/AxMultiServiceRouter.java",
				"dev/axllm/ax/AxBalancer.java",
				"dev/axllm/ax/AxProviderRouter.java",
				"dev/axllm/ax/Conformance.java",
				"examples/SignatureSchemaExample.java",
				"examples/AxGenScriptedClientToolExample.java",
				"examples/AxGenOpenAIExample.java",
				"examples/ProviderMappingNoKeyExample.java",
				"examples/ProviderStreamNoKeyExample.java",
				"examples/RuntimeAdapterExample.java",
				"examples/RuntimeProtocolExample.java",
				"examples/runtime_profiles/JavaScriptQuickJsExample.java",
				"examples/runtime_profiles/PythonPyodideExample.java",
				"examples/runtime_profiles/quickjs4j-pom.xml",
				"examples/runtime_profiles/quickjs4j-build.gradle",
				"examples/runtime_profiles/quickjs-runtime-policy.json",
				"examples/runtime_profiles/resolve_quickjs4j_cp.sh",
				"examples/runtime_profiles/pyodide-package.json",
				"examples/runtime_profiles/pyodide-runtime-policy.json",
				"examples/runtime_profiles/resolve_pyodide_runtime_server.sh",
				"examples/runtime_profiles/README.md",
				"examples/AxFlowProgramGraphExample.java",
				"examples/FlowOpenAIExample.java",
				"examples/AudioResponsesMappingExample.java",
				"examples/AudioHTTPRoundtripExample.java",
				"examples/StreamHTTPRoundtripExample.java",
				"examples/RealtimeAudioEventsExample.java",
				"examples/RealtimeAudioTurnExample.java",
				"examples/OptimizerArtifactExample.java",
				"examples/GEPALocalOptimizerExample.java",
				"examples/AxMCPScriptedToolsExample.java",
				"examples/AxMCPSseRoundtripExample.java",
			},
			wantReadme: "Ax for Java",
		},
		{
			target: "cpp",
			wantFiles: []string{
				"README.md",
				"API.md",
				"CMakeLists.txt",
				"cmake/axllmConfig.cmake.in",
				"axir-capabilities.json",
				"axir-api.json",
				"conformance-coverage.json",
				"axllm/axllm.hpp",
				"axllm/axllm.cpp",
				"conformance.cpp",
				"examples/signature_schema.cpp",
				"examples/axgen_scripted_client_tool.cpp",
				"examples/axgen_openai_api.cpp",
				"examples/provider_mapping_no_key.cpp",
				"examples/provider_stream_no_key.cpp",
				"examples/runtime_adapter.cpp",
				"examples/runtime_protocol.cpp",
				"axllm/runtime/quickjs/quickjs_runtime.hpp",
				"axllm/runtime/quickjs/quickjs_runtime.cpp",
				"examples/runtime_profiles/javascript_quickjs.cpp",
				"examples/runtime_profiles/python_pyodide.cpp",
				"examples/runtime_profiles/quickjs-runtime-policy.json",
				"examples/runtime_profiles/pyodide-runtime-policy.json",
				"examples/runtime_profiles/README.md",
				"examples/axflow_program_graph.cpp",
				"examples/flow_openai_api.cpp",
				"examples/audio_responses_mapping.cpp",
				"examples/audio_http_roundtrip.cpp",
				"examples/stream_http_roundtrip.cpp",
				"examples/realtime_audio_events.cpp",
				"examples/realtime_audio_turn.cpp",
				"examples/optimizer_artifact.cpp",
				"examples/gepa_local_optimizer.cpp",
				"examples/mcp_scripted_tools.cpp",
				"examples/mcp_sse_roundtrip.cpp",
			},
			wantReadme: "Ax for C++",
		},
		{
			target: "go",
			wantFiles: []string{
				"README.md",
				"API.md",
				"go.mod",
				"go.sum",
				"axllm.go",
				"runtime/goja/goja.go",
				"axir-capabilities.json",
				"axir-api.json",
				"conformance-coverage.json",
				"conformance/main.go",
				"examples/signature_schema/main.go",
				"examples/axgen_scripted_client_tool/main.go",
				"examples/axgen_openai_api/main.go",
				"examples/provider_mapping_no_key/main.go",
				"examples/provider_stream_no_key/main.go",
				"examples/runtime_adapter/main.go",
				"examples/runtime_protocol/main.go",
				"examples/runtime_profiles/javascript_goja/main.go",
				"examples/axflow_program_graph/main.go",
				"examples/flow_openai_api/main.go",
				"examples/audio_responses_mapping/main.go",
				"examples/audio_http_roundtrip/main.go",
				"examples/stream_http_roundtrip/main.go",
				"examples/realtime_audio_events/main.go",
				"examples/realtime_audio_turn/main.go",
				"examples/optimizer_artifact/main.go",
				"examples/gepa_local_optimizer/main.go",
				"examples/mcp_scripted_tools/main.go",
				"examples/mcp_sse_roundtrip/main.go",
			},
			wantReadme: "Ax for Go",
		},
		{
			target: "rust",
			wantFiles: []string{
				"README.md",
				"API.md",
				"Cargo.toml",
				"src/lib.rs",
				"src/runtime/quickjs.rs",
				"src/bin/axllm-conformance.rs",
				"axir-capabilities.json",
				"axir-api.json",
				"conformance-coverage.json",
				"examples/signature_schema.rs",
				"examples/provider_mapping_no_key.rs",
				"examples/provider_stream_no_key.rs",
				"examples/axgen_scripted_client_tool.rs",
				"examples/axgen_openai_api.rs",
				"examples/runtime_adapter.rs",
				"examples/runtime_protocol.rs",
				"examples/runtime_profiles/javascript_quickjs.rs",
				"examples/runtime_profiles/README.md",
				"examples/axflow_program_graph.rs",
				"examples/flow_openai_api.rs",
				"examples/audio_responses_mapping.rs",
				"examples/audio_http_roundtrip.rs",
				"examples/stream_http_roundtrip.rs",
				"examples/realtime_audio_events.rs",
				"examples/realtime_audio_turn.rs",
				"examples/optimizer_artifact.rs",
				"examples/gepa_local_optimizer.rs",
				"examples/mcp_scripted_tools.rs",
				"examples/mcp_sse_roundtrip.rs",
			},
			wantReadme: "Ax for Rust",
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
			for _, want := range expectedPackageSkillFiles(tc.target) {
				if !containsString(files, want) {
					t.Fatalf("generated %s package missing skill %s; files=%v", tc.target, want, files)
				}
				assertGeneratedSkillFrontmatter(t, dir, want, tc.target)
			}
			for _, profileExample := range runtimeProfileExampleGuards(tc.target) {
				data, err := os.ReadFile(filepath.Join(dir, profileExample))
				if err != nil {
					t.Fatal(err)
				}
				text := string(data)
				wants := []string{"forward(", "max_actor_steps", "runtime-behavior-parity-ok"}
				if tc.target == "go" {
					wants = []string{"NewAgent(", "agent.Test(runtime", "go-javascript-goja-profile-ok", "runtime-behavior-parity-ok"}
				} else if tc.target == "rust" {
					wants = []string{"agent(", "runner.test", "rust-javascript-quickjs-profile-ok", "runtime-behavior-parity-ok"}
				}
				for _, want := range wants {
					if !strings.Contains(text, want) {
						t.Fatalf("generated %s runtime profile example %s missing actor-loop marker %q", tc.target, profileExample, want)
					}
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
			if manifest.Target != tc.target || manifest.ProviderMode != "provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic" || !manifest.ScriptedTransportSupport {
				t.Fatalf("bad manifest for %s: %#v", tc.target, manifest)
			}
			if len(manifest.UnsupportedCapabilities) != 0 {
				t.Fatalf("%s manifest contains unsupported_capabilities despite claiming generated package completeness: %#v", tc.target, manifest.UnsupportedCapabilities)
			}
			wantProfiles := expectedRuntimeProfileIDs(tc.target)
			for _, want := range wantProfiles {
				if !runtimeProfileManifestContains(manifest.RuntimeProfiles, want) {
					t.Fatalf("%s manifest missing runtime profile %q: %#v", tc.target, want, manifest.RuntimeProfiles)
				}
			}
			for _, profileID := range knownRuntimeProfileIDs() {
				if !containsString(wantProfiles, profileID) && runtimeProfileManifestContains(manifest.RuntimeProfiles, profileID) {
					t.Fatalf("%s manifest should not claim runtime profile %q: %#v", tc.target, profileID, manifest.RuntimeProfiles)
				}
			}
			wantPackage := map[string]string{"python": "axllm", "java": "dev.axllm:ax", "cpp": "axllm", "go": "github.com/ax-llm/ax/packages/go", "rust": "axllm"}[tc.target]
			if manifest.PackageName != wantPackage {
				t.Fatalf("bad package name for %s: got %q want %q", tc.target, manifest.PackageName, wantPackage)
			}
			if (tc.target == "cpp" || tc.target == "rust") && !manifest.RealNetworkSupport {
				t.Fatalf("%s manifest should claim built-in HTTP support: %#v", tc.target, manifest)
			}
			for _, want := range []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow"} {
				if !containsString(manifest.SupportedSuites, want) {
					t.Fatalf("manifest missing suite %s: %#v", want, manifest.SupportedSuites)
				}
			}
			coverageData, err := os.ReadFile(filepath.Join(dir, "conformance-coverage.json"))
			if err != nil {
				t.Fatal(err)
			}
			var coverage ConformanceCoverageManifest
			if err := json.Unmarshal(coverageData, &coverage); err != nil {
				t.Fatal(err)
			}
			if err := ValidateConformanceCoverage(manifest, coverage); err != nil {
				t.Fatalf("%s generated conformance coverage is not valid: %v", tc.target, err)
			}
			for _, want := range []string{"agent_runtime_protocol", "agent_runtime_session", "optimize"} {
				if !conformanceCoverageContainsKind(coverage, want) {
					t.Fatalf("%s conformance coverage missing kind %q: %#v", tc.target, want, coverage.Suites)
				}
			}
			apiData, err := os.ReadFile(filepath.Join(dir, "axir-api.json"))
			if err != nil {
				t.Fatal(err)
			}
			var apiRef APIReferenceManifest
			if err := json.Unmarshal(apiData, &apiRef); err != nil {
				t.Fatal(err)
			}
			if err := ValidateAPIReferenceManifest(apiRef); err != nil {
				t.Fatalf("%s generated API reference manifest is not valid: %v", tc.target, err)
			}
			if apiRef.PackageName != manifest.PackageName || apiRef.AxIRVersion != manifest.AxIRVersion {
				t.Fatalf("%s API reference manifest should mirror capability manifest metadata: api=%#v caps=%#v", tc.target, apiRef, manifest)
			}
			for _, want := range []string{"s", "ax", "ai", "agent", "flow", "fn", "AxMCPClient", "OpenAICompatibleClient", "OpenAIResponsesClient", "GoogleGeminiClient", "AnthropicClient", "ProcessCodeRuntime", "RuntimeCapabilities", "RuntimeEnvelope", "optimize", "playbook", "AxPlaybook", "AxBootstrapFewShot", "AxGEPA", "OptimizerEngine"} {
				if !apiReferenceContainsCanonical(apiRef, want) {
					t.Fatalf("%s API reference missing canonical symbol %q: %#v", tc.target, want, apiRef.Sections)
				}
			}
			apiMarkdown := readRepoFile(t, dir, "API.md")
			for _, want := range []string{"generated API reference", "Canonical Ax concept", "Signatures", "AxGen", "AxAI", "Agents And RLM", "Runtime Profiles", "Optimizers"} {
				if !strings.Contains(apiMarkdown, want) {
					t.Fatalf("%s generated API.md missing %q:\n%s", tc.target, want, apiMarkdown)
				}
			}
			for _, want := range expectedRuntimeProfileFeatureGroups(tc.target) {
				if !containsString(manifest.CoreOwnedFeatureGroups, want) {
					t.Fatalf("manifest missing runtime profile feature %s: %#v", want, manifest.CoreOwnedFeatureGroups)
				}
			}
			for _, stale := range rejectedRuntimeProfileFeatureGroups(tc.target) {
				if containsString(manifest.CoreOwnedFeatureGroups, stale) {
					t.Fatalf("%s manifest has stale broad runtime profile feature %s: %#v", tc.target, stale, manifest.CoreOwnedFeatureGroups)
				}
			}
			for _, want := range []string{"AxGen", "AxSignature", "OpenAICompatibleClient", "OpenAIResponsesClient", "GoogleGeminiClient", "AnthropicClient", "AzureOpenAIClient", "DeepSeekClient", "MistralClient", "RekaClient", "CohereClient", "GrokClient", "AxBalancer", "AxPlaybook", "AxBootstrapFewShot", "AxGEPA", "MultiServiceRouter", "ProviderRouter", "get_supported_ai_models", "optimize", "playbook", "AxAgent", "AxFlow", "AxProgram", "RuntimeCapabilities", "RuntimeEnvelope", "ProcessCodeRuntime", "ProcessCodeSession", "RuntimeProtocolClient", "RuntimeTransport", "OptimizerEngine", "OptimizerEvaluator"} {
				if !containsString(manifest.PublicSymbols, want) {
					t.Fatalf("manifest missing public symbol %s: %#v", want, manifest.PublicSymbols)
				}
			}
			for _, want := range []string{"axoptimize-gepa-engine", "axoptimize-gepa-reflection", "axoptimize-gepa-pareto", "axoptimize-gepa-bootstrap", "axoptimize-gepa-selector-state", "axoptimize-bootstrap-fewshot", "axoptimize-top-level-helper"} {
				if !containsString(manifest.CoreOwnedFeatureGroups, want) {
					t.Fatalf("manifest missing GEPA feature %s: %#v", want, manifest.CoreOwnedFeatureGroups)
				}
			}
			for _, want := range []string{"axagent-stage-instructions", "axagent-evidence-citations", "axagent-playbook-config", "axagent-run-end-playbook-learning", "axagent-playbook-verified-evolve", "axoptimize-ace-bullet-tag-normalization", "axoptimize-ace-updated-bullet-ids", "axoptimize-ace-empty-render", "anthropic-adaptive-thinking-display", "anthropic-adaptive-sampling-suppression"} {
				if !containsString(manifest.CoreOwnedFeatureGroups, want) {
					t.Fatalf("manifest missing cleared-backlog feature %s: %#v", want, manifest.CoreOwnedFeatureGroups)
				}
			}
			for _, want := range []string{"axai-model-catalog-runtime-api", "axai-multi-service-routing", "axai-provider-routing-analysis", "axai-balancer-runtime", "axai-balancer-retry-policy", "axai-balancer-metrics", "axai-host-processing-callbacks"} {
				if !containsString(manifest.CoreOwnedFeatureGroups, want) {
					t.Fatalf("manifest missing provider routing feature %s: %#v", want, manifest.CoreOwnedFeatureGroups)
				}
			}
			readme, err := os.ReadFile(filepath.Join(dir, "README.md"))
			if err != nil {
				t.Fatal(err)
			}
			readmeText := string(readme)
			for _, want := range []string{tc.wantReadme, "Core-owned", "AxJSRuntime", "RLM", "REPL", "not a TypeScript transpiler", "provider-api", "no-key"} {
				if !strings.Contains(readmeText, want) {
					t.Fatalf("generated README missing %q:\n%s", want, readme)
				}
			}
			for _, want := range map[string][]string{
				"python": {"javascript-quickjs", "python-pyodide"},
				"java":   {"javascript-quickjs", "python-pyodide"},
				"cpp":    {"javascript-quickjs", "python-pyodide"},
				"go":     {"javascript-goja"},
				"rust":   {"javascript-quickjs", "runtime-quickjs", "ProcessCodeRuntime"},
			}[tc.target] {
				if !strings.Contains(readmeText, want) {
					t.Fatalf("generated README missing runtime profile %q:\n%s", want, readme)
				}
			}
			switch tc.target {
			case "python":
				checkGeneratedFileContains(t, dir, "pyproject.toml", "axllm", "setuptools", "Typing :: Typed")
			case "java":
				checkGeneratedFileContains(t, dir, "pom.xml", "<groupId>dev.axllm</groupId>", "<artifactId>ax</artifactId>", "dev/axllm/ax/*.java")
				checkGeneratedFileContains(t, dir, "build.gradle", "java-library", "dev/axllm/ax/*.java")
			case "cpp":
				checkGeneratedFileContains(t, dir, "CMakeLists.txt", "add_library(axllm axllm/axllm.cpp axllm/mcp.cpp)", "add_library(axllm::axllm ALIAS axllm)", "AX_BUILD_QUICKJS_PROFILE", "AX_QUICKJS_CFLAGS", "AX_QUICKJS_LDFLAGS", "add_library(axllm_quickjs", "find_package(CURL QUIET)", "AXLLM_ENABLE_CURL", "AXLLM_ENABLE_MCP_STDIO_BOOST", "AXLLM_ENABLE_REALTIME", "provider_stream_no_key", "flow_openai_api", "audio_responses_mapping", "realtime_audio_events", "gepa_local_optimizer", "mcp_scripted_tools")
				checkGeneratedFileContains(t, dir, "axllm/axllm.hpp", "class HttpTransport", "std::unique_ptr<Transport> owned_transport_")
				checkGeneratedFileContains(t, dir, "axllm/mcp.hpp", "class AxMCPClient", "class AxMCPStreamableHTTPTransport", "class AxMCPStdioTransport")
				checkGeneratedFileContains(t, dir, "axllm/axllm.cpp", "HttpTransport::call", "curl_easy_perform")
				checkGeneratedFileContains(t, dir, "cmake/axllmConfig.cmake.in", "find_dependency(OpenSSL)", "axllmTargets.cmake")
			case "go":
				checkGeneratedFileContains(t, dir, "go.mod", "module github.com/ax-llm/ax/packages/go", "go 1.23", "github.com/dop251/goja", "github.com/coder/websocket")
				checkGeneratedFileContains(t, dir, "axllm.go", "package axllm", "type Value = any", "func NewSignature", "type HTTPTransport struct")
				checkGeneratedFileContains(t, dir, "runtime/goja/goja.go", "package goja", "func NewRuntime(options ...Option) *Runtime", "func (r *Runtime) RegisterCallable", "gojavm.New")
				checkGeneratedFileContains(t, dir, "examples/runtime_profiles/javascript_goja/main.go", "go-javascript-goja-profile-ok", "ax.NewAgent", "agent.Test(runtime", "while (true) {}")
			case "rust":
				checkGeneratedFileContains(t, dir, "Cargo.toml", `name = "axllm"`, "reqwest", "rustls-tls", "rquickjs", "runtime-quickjs", `required-features = ["runtime-quickjs"]`, "tungstenite", `realtime = ["dep:tungstenite"]`)
				checkGeneratedFileContains(t, dir, "src/lib.rs", "pub fn s(", "pub fn ax(", "pub fn agent(", "pub fn flow(", "pub fn ai(", "pub fn tool(", "pub trait AxCodeRuntime", "pub struct ProcessCodeRuntime", "pub mod runtime")
				checkGeneratedFileContains(t, dir, "src/lib.rs", "BEGIN AXIR CORE EMITTED FUNCTIONS", "fn parse_signature(args: &[CoreValue])", "fn _schema_flexible_json_as_string_impl(args: &[CoreValue])", "enum CoreValue")
				checkGeneratedFileContains(t, dir, "src/lib.rs", "fn provider_normalize_chat_response(args: &[CoreValue])", "fn _build_agent_actor_prompt_policy(args: &[CoreValue])")
				checkGeneratedFileContains(t, dir, "src/runtime/quickjs.rs", "pub struct QuickJsCodeRuntime", "pub struct QuickJsCodeSession", "pub type HostCallable", "rquickjs", "set_interrupt_handler", "allowFilesystem", "allowNetwork", "allowProcess", "allowNativeHostAccess")
				checkGeneratedFileContains(t, dir, "src/bin/axllm-conformance.rs", "run_conformance_fixture")
				checkGeneratedFileContains(t, dir, "examples/runtime_protocol.rs", "ProcessCodeRuntime", "rust-runtime-protocol-ok")
				checkGeneratedFileContains(t, dir, "examples/runtime_profiles/javascript_quickjs.rs", "QuickJsCodeRuntime", "runtime-behavior-parity-ok", "while (true) {}", "session.close")
			}
			auditGeneratedRuntimePlaceholders(t, dir, tc.target)
			auditGeneratedConformanceRunnerSemantics(t, dir, tc.target)
			auditGeneratedCapabilityCompleteness(t, dir, tc.target, manifest)
			assertNoRemovedProviderReferences(t, dir)
			assertNoUserFacingInternalPackageNames(t, dir, tc.target)
		})
	}
}

func TestRemovedProvidersStayRemovedFromActiveSurfaces(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	for _, rel := range []string{
		"README.md",
		"index.ts",
		"package.json",
		"src",
		"tools/axir",
		"ir",
		"packages",
		"scripts",
		"docs",
	} {
		assertNoRemovedProviderReferences(t, filepath.Join(root, rel))
	}
}

func removedProviderReferenceTokens() []string {
	stem := "hugging" + "face"
	title := "Hugging" + "Face"
	titleWords := "Hugging" + " Face"
	return []string{
		stem,
		title,
		titleWords,
		"AxAI" + title,
		"api-inference." + stem,
		"hf" + "." + "co",
	}
}

func assertNoRemovedProviderReferences(t *testing.T, root string) {
	t.Helper()
	info, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		assertFileHasNoRemovedProviderReferences(t, root)
		return
	}
	if err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			switch name {
			case ".git", "node_modules", "target", "dist", "coverage", ".next", ".astro", ".generated":
				return filepath.SkipDir
			}
			if name == "data" && filepath.Base(filepath.Dir(path)) == "src" {
				return filepath.SkipDir
			}
			return nil
		}
		assertFileHasNoRemovedProviderReferences(t, path)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func assertFileHasNoRemovedProviderReferences(t *testing.T, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, token := range removedProviderReferenceTokens() {
		if strings.Contains(text, token) {
			t.Fatalf("removed provider reference %q found in %s", token, path)
		}
	}
}

func assertNoUserFacingInternalPackageNames(t *testing.T, root, target string) {
	t.Helper()
	metadata := map[string][]string{
		"python": {"pyproject.toml", "MANIFEST.in"},
		"java":   {"pom.xml", "build.gradle", "settings.gradle"},
		"cpp":    {"CMakeLists.txt", "cmake/axllmConfig.cmake.in"},
		"go":     {"go.mod"},
		"rust":   {"Cargo.toml"},
	}[target]
	for _, rel := range metadata {
		text := strings.ToLower(readRepoFile(t, root, filepath.FromSlash(rel)))
		for _, forbidden := range []string{"ax-llm-axir", "ax-go", "<groupid>dev.ax</groupid>", "dev.ax;", "ax::ax", "namespace ax "} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("%s contains user-facing internal or collision-prone package name %q:\n%s", rel, forbidden, text)
			}
		}
	}
}

func TestDocsCoverCompilerAndArchitecture(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	compiler := readRepoFile(t, root, "docs", "COMPILER.md")
	for _, want := range []string{
		"AxIR Compiler",
		"TypeScript",
		".axir",
		"Core-owned",
		"target-owned",
		"Python",
		"Java",
		"C++",
		"Go",
		"Rust",
		"AxAgent",
		"AxFlow",
		"GEPA",
		"audio",
		"realtime",
		"docs/RELEASE.md",
	} {
		if !strings.Contains(compiler, want) {
			t.Fatalf("docs/COMPILER.md missing %q", want)
		}
	}
	architecture := readRepoFile(t, root, "docs", "ARCHITECTURE.md")
	for _, want := range []string{
		"language-agnostic",
		"docs/COMPILER.md",
		"docs/AUDIO.md",
		"AxAgent",
		"GEPA",
		"audio",
		"realtime",
		"Python",
		"Java",
		"C++",
		"Rust",
		"docs/RELEASE.md",
	} {
		if !strings.Contains(architecture, want) {
			t.Fatalf("docs/ARCHITECTURE.md missing %q", want)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "DESIGN.md")); err == nil {
		t.Fatal("root DESIGN.md should not be added; use docs/COMPILER.md")
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
	release := readRepoFile(t, root, "docs", "RELEASE.md")
	for _, want := range []string{"@ax-llm/ax", "axllm", "dev.axllm:ax", "axllm::axllm", "github.com/ax-llm/ax/packages/go", "javascript-goja", "runtime/goja", "crates.io"} {
		if !strings.Contains(release, want) {
			t.Fatalf("docs/RELEASE.md missing %q", want)
		}
	}
}

func checkGeneratedFileContains(t *testing.T, root, rel string, wants ...string) {
	t.Helper()
	text := readRepoFile(t, root, filepath.FromSlash(rel))
	for _, want := range wants {
		if !strings.Contains(text, want) {
			t.Fatalf("%s missing %q:\n%s", rel, want, text)
		}
	}
}

func checkGeneratedFileDoesNotContain(t *testing.T, root, rel string, forbidden ...string) {
	t.Helper()
	text := readRepoFile(t, root, filepath.FromSlash(rel))
	for _, item := range forbidden {
		if strings.Contains(text, item) {
			t.Fatalf("%s should not contain %q:\n%s", rel, item, text)
		}
	}
}

func expectedPackageSkillFiles(target string) []string {
	files := []string{}
	for _, spec := range packageSkillSpecs {
		name := skillName(target, spec)
		files = append(files, "skills/"+name+"/SKILL.md")
	}
	sort.Strings(files)
	return files
}

func assertGeneratedSkillFrontmatter(t *testing.T, root, rel, target string) {
	t.Helper()
	text := readRepoFile(t, root, filepath.FromSlash(rel))
	name := frontmatterStringValue(text, "name")
	description := frontmatterStringValue(text, "description")
	version := frontmatterStringValue(text, "version")
	wantName := strings.TrimSuffix(strings.TrimPrefix(rel, "skills/"), "/SKILL.md")
	if name != wantName {
		t.Fatalf("%s frontmatter name = %q, want %q", rel, name, wantName)
	}
	if !strings.HasPrefix(name, "ax-"+target+"-") {
		t.Fatalf("%s frontmatter name should be language-prefixed for %s", rel, target)
	}
	if description == "" || !strings.Contains(description, skillTargetConfig(target).Language) || !strings.Contains(description, packageNameForTarget(target)) {
		t.Fatalf("%s frontmatter description should route to language and package, got %q", rel, description)
	}
	if version != generatedPackageVersion() {
		t.Fatalf("%s frontmatter version = %q, want %q", rel, version, generatedPackageVersion())
	}
	for _, forbidden := range []string{"axir-language-backend", "website-md-language-docs"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("%s should not include maintainer skill %q:\n%s", rel, forbidden, text)
		}
	}
}

func frontmatterStringValue(markdown, key string) string {
	re := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `:\s*"?([^"\n\r]+)"?\s*$`)
	match := re.FindStringSubmatch(markdown)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

type generatedCoreAuditEntry struct {
	category string
	rel      string
	name     string
}

func auditGeneratedRuntimePlaceholders(t *testing.T, root, target string) {
	t.Helper()
	if target == "rust" {
		auditRustWrapperOwnedCore(t, root)
		return
	}
	for _, entry := range generatedCoreAuditManifest(target) {
		body, ok := extractGeneratedFunctionBody(t, root, target, entry.rel, entry.name)
		if !ok {
			t.Fatalf("%s generated Core audit missing %s helper %s in %s", target, entry.category, entry.name, entry.rel)
		}
		assertGeneratedCoreBodyReal(t, target, entry, body)
		t.Logf("%s generated Core audit %s %s::%s: real-core-body", target, entry.category, entry.rel, entry.name)
	}
}

func generatedCoreAuditManifest(target string) []generatedCoreAuditEntry {
	switch target {
	case "python":
		return []generatedCoreAuditEntry{
			{category: "schema", rel: "axllm/schema.py", name: "_schema_flexible_json_as_string_impl"},
			{category: "provider", rel: "axllm/ai.py", name: "provider_normalize_chat_response"},
			{category: "agent", rel: "axllm/agent.py", name: "_build_agent_actor_prompt_policy"},
			{category: "runtime", rel: "axllm/agent.py", name: "_agent_runtime_build_globals"},
			{category: "flow", rel: "axllm/flow.py", name: "_flow_forward"},
			{category: "optimizer", rel: "axllm/gen.py", name: "_build_optimizer_request"},
		}
	case "java":
		return generatedSingleFileCoreAuditManifest("dev/axllm/ax/Core.java")
	case "cpp":
		return generatedSingleFileCoreAuditManifest("axllm/axllm.cpp")
	case "go":
		return generatedSingleFileCoreAuditManifest("axllm.go")
	default:
		return nil
	}
}

func generatedSingleFileCoreAuditManifest(rel string) []generatedCoreAuditEntry {
	return []generatedCoreAuditEntry{
		{category: "schema", rel: rel, name: "_schema_flexible_json_as_string_impl"},
		{category: "provider", rel: rel, name: "provider_normalize_chat_response"},
		{category: "agent", rel: rel, name: "_build_agent_actor_prompt_policy"},
		{category: "runtime", rel: rel, name: "_agent_runtime_build_globals"},
		{category: "flow", rel: rel, name: "_flow_forward"},
		{category: "optimizer", rel: rel, name: "_build_optimizer_request"},
	}
}

func auditRustWrapperOwnedCore(t *testing.T, root string) {
	t.Helper()
	text := readRepoFile(t, root, "src", "lib.rs")
	// Migrated modules must be emitted from the IR.
	for _, required := range []string{
		"BEGIN AXIR CORE EMITTED FUNCTIONS",
		"fn parse_signature(args: &[CoreValue])",
		"fn _signature_parse_impl(args: &[CoreValue])",
		"fn _schema_flexible_json_as_string_impl(args: &[CoreValue])",
		"fn validate_output(args: &[CoreValue])",
		"fn provider_normalize_chat_response(args: &[CoreValue])",
		"fn render_prompt(args: &[CoreValue])",
		"fn _forward_impl(args: &[CoreValue])",
		"fn _build_optimizer_request(args: &[CoreValue])",
		"fn _flow_forward(args: &[CoreValue])",
		"fn _build_agent_actor_prompt_policy(args: &[CoreValue])",
		"fn _agent_runtime_build_globals(args: &[CoreValue])",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("rust generated Core audit missing emitted helper %q in src/lib.rs", required)
		}
	}
	t.Log("rust generated Core audit: all modules emitted from the IR")
}

func auditGeneratedCapabilityCompleteness(t *testing.T, root, target string, manifest CapabilityManifest) {
	t.Helper()
	if len(manifest.UnsupportedCapabilities) != 0 {
		t.Fatalf("%s generated capability audit: unsupported_capabilities must stay empty for claimed generated packages: %#v", target, manifest.UnsupportedCapabilities)
	}
	for _, guard := range generatedCapabilityGuards(target) {
		text := readRepoFile(t, root, filepath.FromSlash(guard.rel))
		for _, want := range guard.contains {
			if !strings.Contains(text, want) {
				t.Fatalf("%s generated capability audit %s missing %q in %s", target, guard.category, want, guard.rel)
			}
		}
		for _, forbidden := range guard.forbidden {
			if strings.Contains(text, forbidden) {
				t.Fatalf("%s generated capability audit %s found forbidden placeholder %q in %s:\n%s", target, guard.category, forbidden, guard.rel, text)
			}
		}
	}
}

func auditGeneratedConformanceRunnerSemantics(t *testing.T, root, target string) {
	t.Helper()
	for _, rel := range generatedConformanceRunnerFiles(target) {
		text := readRepoFile(t, root, filepath.FromSlash(rel))
		if label, found := conformanceRunnerPlaceholderCoveragePattern(text); found {
			t.Fatalf("%s generated conformance audit found %s in %s:\n%s", target, label, rel, text)
		}
	}
	if target == "rust" {
		text := readRepoFile(t, root, "src", "lib.rs")
		for _, want := range []string{
			"fn run_agent_runtime_protocol_fixture",
			"fn run_agent_runtime_session_fixture",
			"fn run_agent_runtime_policy_fixture",
			"match operation.as_str()",
			"\"components\" =>",
			"\"filter\" =>",
			"\"apply\" =>",
			"\"artifact\" =>",
			"\"dataset\" =>",
			"\"score\" =>",
			"\"judge_payload\" =>",
			"\"evidence\" =>",
			"\"evaluate\" =>",
			"\"engine\" =>",
			"\"gepa\" =>",
			"\"eval\" =>",
			"expected_engine_request_subset",
			"expected_gepa_evaluations_subset",
			"expected_trace_event_kinds",
		} {
			if !strings.Contains(text, want) {
				t.Fatalf("rust generated conformance audit missing semantic runner marker %q", want)
			}
		}
	}
}

func generatedConformanceRunnerFiles(target string) []string {
	switch target {
	case "python":
		return []string{"axllm/conformance.py"}
	case "java":
		return []string{"dev/axllm/ax/Conformance.java"}
	case "cpp":
		return []string{"conformance.cpp"}
	case "go":
		return []string{"axllm.go", "conformance/main.go"}
	case "rust":
		return []string{"src/lib.rs", "src/bin/axllm-conformance.rs"}
	default:
		return nil
	}
}

func conformanceRunnerPlaceholderCoveragePattern(text string) (string, bool) {
	for _, tc := range []struct {
		label string
		re    *regexp.Regexp
	}{
		{label: "broad expectation guard", re: regexp.MustCompile(`\brequire_any_expectation\s*\(`)},
		{label: "presence-only expectation error", re: regexp.MustCompile(`missing executable expectation`)},
		{label: "presence-only coverage category", re: regexp.MustCompile(`presence-only`)},
		{label: "flow self-comparison", re: regexp.MustCompile(`expect_json_equal\([^,\n]+,\s*expected,\s*expected\s*\)`)},
		{label: "generic self-comparison", re: regexp.MustCompile(`(?m)(assertEqual|assert_equal|_assert_equal)\([^,\n]+,\s*expected,\s*expected`)},
		{label: "Rust fixture arm returning success", re: regexp.MustCompile(`(?m)"[^"]+"\s*=>\s*Ok\(\(\)\)`)},
		{label: "Rust grouped fixture arm returning success", re: regexp.MustCompile(`(?m)\|\s*"[^"]+"\s*=>\s*Ok\(\(\)\)`)},
		{label: "expected-key-only validation", re: regexp.MustCompile(`expected key exists|expected keys exist|key exists`)},
	} {
		if tc.re.MatchString(text) {
			return tc.label, true
		}
	}
	return "", false
}

func conformanceCoverageContainsKind(coverage ConformanceCoverageManifest, kind string) bool {
	for _, entries := range coverage.Suites {
		for _, entry := range entries {
			if entry.Kind == kind && entry.Category != "explicitly-not-claimed" {
				return true
			}
		}
	}
	return false
}

type generatedCapabilityGuard struct {
	category  string
	rel       string
	contains  []string
	forbidden []string
}

func generatedCapabilityGuards(target string) []generatedCapabilityGuard {
	switch target {
	case "python":
		return []generatedCapabilityGuard{
			{
				category: "provider",
				rel:      "axllm/ai.py",
				contains: []string{
					"def chat(",
					"def stream(",
					"def embed(",
					"def transcribe(",
					"def speak(",
					"class MultiServiceRouter",
					"class AxBalancer",
					"class ProviderRouter",
					"def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):",
					"def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):",
					"def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):",
					"def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):",
					"def _selected_provider(self, request: dict[str, Any]):",
					"return provider.embed(request, options)",
					"return provider.transcribe(request, options)",
					"return provider.speak(request, options)",
				},
				forbidden: []string{
					"def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):\n        raise AxUnsupportedCapabilityError",
					"def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):\n        raise AxUnsupportedCapabilityError",
				},
			},
			{category: "agent", rel: "axllm/agent.py", contains: []string{"class AxAgent", "def forward(", "def execute_actor_step("}},
			{category: "flow", rel: "axllm/flow.py", contains: []string{"class AxFlow", "def forward("}},
			{category: "optimizer", rel: "axllm/agent.py", contains: []string{"class AxGEPA", "def optimize("}},
			{category: "runtime", rel: "axllm/runtime.py", contains: []string{"class ProcessCodeRuntime", "class ProcessCodeSession"}},
		}
	case "java":
		return []generatedCapabilityGuard{
			{category: "provider", rel: "dev/axllm/ax/OpenAICompatibleClient.java", contains: []string{"protected Map<String, Object> doChat(", "public Iterable<Map<String, Object>> stream(", "protected Map<String, Object> doEmbed(", "public Map<String, Object> transcribe(", "public Map<String, Object> speak("}, forbidden: []string{"return null;\n}"}},
			{category: "router", rel: "dev/axllm/ax/AxMultiServiceRouter.java", contains: []string{"public Map<String, Object> chat(", "public Map<String, Object> embed(", "public Map<String, Object> transcribe(", "public Map<String, Object> speak("}},
			{category: "provider-router", rel: "dev/axllm/ax/AxProviderRouter.java", contains: []string{"public Map<String, Object> chat(", "public Iterable<Map<String, Object>> stream(", "public Map<String, Object> embed(", "public Map<String, Object> transcribe(", "public Map<String, Object> speak("}},
			{category: "balancer", rel: "dev/axllm/ax/AxBalancer.java", contains: []string{"public Map<String, Object> chat(", "public Map<String, Object> embed(", "public Map<String, Object> transcribe(", "public Map<String, Object> speak("}},
			{category: "base-service", rel: "dev/axllm/ax/AxAIService.java", contains: []string{"Map<String, Object> transcribe(Map<String, Object> request) throws Exception;", "Map<String, Object> speak(Map<String, Object> request) throws Exception;"}, forbidden: []string{"getModelList() { return null; }", "is not supported by this generated AxAI beta provider"}},
			{category: "agent", rel: "dev/axllm/ax/AxAgent.java", contains: []string{"public Map<String, Object> forward(", "executeActorStep("}},
			{category: "flow", rel: "dev/axllm/ax/AxFlow.java", contains: []string{"public Map<String, Object> forward("}},
			{category: "optimizer", rel: "dev/axllm/ax/AxGEPA.java", contains: []string{"public Map<String, Object> optimize("}},
			{category: "runtime", rel: "dev/axllm/ax/AxProcessCodeRuntime.java", contains: []string{"createSession("}},
		}
	case "cpp":
		return []generatedCapabilityGuard{
			{category: "provider", rel: "axllm/axllm.cpp", contains: []string{"Value OpenAICompatibleClient::do_chat(", "std::vector<Value> OpenAICompatibleClient::stream(", "Value OpenAICompatibleClient::do_embed(", "Value OpenAICompatibleClient::transcribe(", "Value OpenAICompatibleClient::speak("}, forbidden: []string{"not implemented", "Value AxAIService::transcribe(Value) { throw Core::as_error(Core::ai_error_unsupported", "Value AxAIService::speak(Value) { throw Core::as_error(Core::ai_error_unsupported", "Value AxAIService::get_model_list() { return Value(); }"}},
			{category: "router", rel: "axllm/axllm.cpp", contains: []string{"Value MultiServiceRouter::chat(", "Value MultiServiceRouter::embed(", "Value MultiServiceRouter::transcribe(", "Value MultiServiceRouter::speak("}},
			{category: "provider-router", rel: "axllm/axllm.cpp", contains: []string{"Value ProviderRouter::chat(", "std::vector<Value> ProviderRouter::stream(", "Value ProviderRouter::embed(", "Value ProviderRouter::transcribe(", "Value ProviderRouter::speak("}},
			{category: "balancer", rel: "axllm/axllm.cpp", contains: []string{"Value AxBalancer::chat(", "Value AxBalancer::embed(", "Value AxBalancer::transcribe(", "Value AxBalancer::speak("}},
			{category: "agent-flow-optimizer-runtime", rel: "axllm/axllm.cpp", contains: []string{"Value AxAgent::forward(", "Value AxFlow::forward(", "Value AxGEPA::optimize(", "AxCodeSession* RuntimeProtocolClient::create_session("}},
		}
	case "go":
		return []generatedCapabilityGuard{
			{category: "provider", rel: "axllm.go", contains: []string{"func (c *OpenAICompatibleClient) Chat(", "func (c *OpenAICompatibleClient) Stream(", "func (c *OpenAICompatibleClient) Embed(", "func (c *OpenAICompatibleClient) Transcribe(", "func (c *OpenAICompatibleClient) Speak("}, forbidden: []string{"func (c *OpenAICompatibleClient) GetModelList() Value { return nil }"}},
			{category: "router", rel: "axllm.go", contains: []string{"func (r *MultiServiceRouter) Chat(", "func (r *MultiServiceRouter) Stream(", "func (r *MultiServiceRouter) Embed(", "func (r *MultiServiceRouter) Transcribe(", "func (r *MultiServiceRouter) Speak("}},
			{category: "provider-router", rel: "axllm.go", contains: []string{"func (r *ProviderRouter) Chat(", "func (r *ProviderRouter) Stream(", "func (r *ProviderRouter) Embed(", "func (r *ProviderRouter) Transcribe(", "func (r *ProviderRouter) Speak("}},
			{category: "balancer", rel: "axllm.go", contains: []string{"func (b *AxBalancer) Chat(", "func (b *AxBalancer) Stream(", "func (b *AxBalancer) Embed(", "func (b *AxBalancer) Transcribe(", "func (b *AxBalancer) Speak("}},
			{category: "agent-flow-optimizer-runtime", rel: "axllm.go", contains: []string{"func (a *AxAgent) Forward(", "func (f *AxFlow) Forward(", "func (g *AxGEPA) Optimize(", "func (r *ProcessCodeRuntime) CreateSession("}},
		}
	case "rust":
		return []generatedCapabilityGuard{
			{
				category: "provider",
				rel:      "src/lib.rs",
				contains: []string{
					"fn stream(&mut self, request: Value) -> AxResult<Vec<Value>>",
					"pub fn embed(&mut self, request: Value) -> AxResult<Value>",
					"pub fn transcribe(&mut self, request: Value) -> AxResult<Value>",
					"pub fn speak(&mut self, request: Value) -> AxResult<Value>",
					"pub fn realtime(&self, event: Value) -> AxResult<Value>",
					"pub fn realtime_audio_setup(&self, request: Value) -> AxResult<Value>",
					"pub fn realtime_audio_input(&self, audio: Value) -> AxResult<Value>",
					"\"openai-responses\" | \"responses\"",
					"\"google-gemini\" | \"gemini\"",
					"\"anthropic\"",
				},
				forbidden: []string{
					"stream is not implemented",
					"not implemented",
					"unsupported provider",
					"pub struct AxBalancer;",
					"pub struct MultiServiceRouter;",
					"pub struct ProviderRouter;",
				},
			},
			{category: "router", rel: "src/lib.rs", contains: []string{"services: BTreeMap<String, OpenAICompatibleClient>", "providers: BTreeMap<String, OpenAICompatibleClient>", "pub fn stream(&mut self, request: Value) -> AxResult<Vec<Value>>"}},
			{
				category: "conformance",
				rel:      "src/lib.rs",
				contains: []string{"\"signature\" => run_signature_fixture(&fixture)?", "\"json_schema\" => run_json_schema_fixture(&fixture)?", "\"validate_output\" => run_validate_output_fixture(&fixture)?", "\"prompt\" => run_prompt_fixture(&fixture)?", "\"forward\" => run_simple_forward_fixture(&fixture)?", "\"stream\" => run_stream_fixture(&fixture)?", "\"ai_stream\" => run_ai_stream_fixture(&fixture)?", "\"ai_embed\" => run_ai_embed_fixture(&fixture)?", "\"ai_transcribe\" => run_ai_transcribe_fixture(&fixture)?", "\"ai_speak\" => run_ai_speak_fixture(&fixture)?", "\"ai_realtime\" => run_ai_realtime_fixture(&fixture)?", "\"agent_forward\"", "\"agent_playbook_evolve\"", "\"flow\" => run_flow_fixture(&fixture)?", "\"optimize\" => run_optimize_fixture(&fixture)?", "unsupported Rust conformance fixture kind", "expect_transport_request_subset"},
				forbidden: []string{
					"| \"flow\"\n        | \"json_schema\"",
					"| \"validate_value\" => Ok(())",
				},
			},
			{category: "agent-flow-optimizer-runtime", rel: "src/lib.rs", contains: []string{"pub struct AxAgent", "pub struct AxFlow", "pub struct AxGEPA", "pub struct ProcessCodeRuntime"}},
		}
	default:
		return nil
	}
}

func extractGeneratedFunctionBody(t *testing.T, root, target, rel, name string) (string, bool) {
	t.Helper()
	text := readRepoFile(t, root, filepath.FromSlash(rel))
	switch target {
	case "python":
		return extractPythonFunctionBody(text, name)
	case "java":
		return extractBracedFunctionBody(text, "static Object "+name+"(")
	case "cpp":
		return extractBracedFunctionBody(text, "Value Core::"+name+"(")
	case "go":
		return extractBracedFunctionBody(text, "func "+name+"(")
	default:
		return "", false
	}
}

func extractPythonFunctionBody(text, name string) (string, bool) {
	marker := "def " + name + "("
	idx := strings.Index(text, marker)
	if idx < 0 {
		return "", false
	}
	lineStart := strings.LastIndex(text[:idx], "\n") + 1
	if lineStart != idx {
		return "", false
	}
	headerEnd := strings.Index(text[idx:], "\n")
	if headerEnd < 0 {
		return "", false
	}
	bodyStart := idx + headerEnd + 1
	var body strings.Builder
	for _, line := range strings.SplitAfter(text[bodyStart:], "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			body.WriteString(line)
			continue
		}
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			break
		}
		body.WriteString(line)
	}
	return body.String(), true
}

func extractBracedFunctionBody(text, signature string) (string, bool) {
	idx := strings.Index(text, signature)
	if idx < 0 {
		return "", false
	}
	braceOffset := strings.Index(text[idx:], "{")
	if braceOffset < 0 {
		return "", false
	}
	start := idx + braceOffset
	end := matchingBraceIndex(text, start)
	if end < 0 {
		return "", false
	}
	return text[start+1 : end], true
}

func matchingBraceIndex(text string, start int) int {
	depth := 0
	var quote byte
	escaped := false
	lineComment := false
	blockComment := false
	for i := start; i < len(text); i++ {
		c := text[i]
		if lineComment {
			if c == '\n' {
				lineComment = false
			}
			continue
		}
		if blockComment {
			if c == '*' && i+1 < len(text) && text[i+1] == '/' {
				blockComment = false
				i++
			}
			continue
		}
		if quote != 0 {
			if quote != '`' && escaped {
				escaped = false
				continue
			}
			if quote != '`' && c == '\\' {
				escaped = true
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '/' && i+1 < len(text) {
			switch text[i+1] {
			case '/':
				lineComment = true
				i++
				continue
			case '*':
				blockComment = true
				i++
				continue
			}
		}
		switch c {
		case '"', '\'', '`':
			quote = c
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func assertGeneratedCoreBodyReal(t *testing.T, target string, entry generatedCoreAuditEntry, body string) {
	t.Helper()
	lines := generatedCoreSemanticLines(target, body)
	if len(lines) == 0 {
		t.Fatalf("%s generated Core audit %s %s::%s: suspicious-placeholder empty body", target, entry.category, entry.rel, entry.name)
	}
	if generatedCoreBodyIsPlaceholder(target, lines) {
		t.Fatalf("%s generated Core audit %s %s::%s: suspicious-placeholder body:\n%s", target, entry.category, entry.rel, entry.name, body)
	}
	for _, marker := range generatedCoreRealBodyMarkers(target) {
		if strings.Contains(body, marker) {
			return
		}
	}
	if len(lines) > 1 {
		return
	}
	t.Fatalf("%s generated Core audit %s %s::%s: body does not look Core-emitted:\n%s", target, entry.category, entry.rel, entry.name, body)
}

func generatedCoreRealBodyMarkers(target string) []string {
	switch target {
	case "python":
		return []string{"_core_", "Core."}
	case "java":
		return []string{"Core."}
	case "cpp":
		return []string{"Core::"}
	case "go":
		return []string{"_core_", "coreGet", "coreSet", "coreTruthy"}
	default:
		return nil
	}
}

func generatedCoreSemanticLines(target, body string) []string {
	var out []string
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if target == "go" && generatedGoCoreBoilerplateLine(trimmed) {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func generatedGoCoreBoilerplateLine(line string) bool {
	if line == "}" {
		return true
	}
	for _, prefix := range []string{"var ", "_ = ", "if len(args) > "} {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	return false
}

func generatedCoreBodyIsPlaceholder(target string, lines []string) bool {
	if len(lines) == 0 {
		return true
	}
	for _, line := range lines {
		if !generatedCorePlaceholderLine(target, line) {
			return false
		}
	}
	return true
}

func generatedCorePlaceholderLine(target, line string) bool {
	line = strings.TrimSuffix(line, ";")
	switch target {
	case "python":
		return line == "pass" || line == "return None"
	case "java":
		return line == "return null"
	case "cpp":
		return line == "return Value()" || line == "return nullptr" || line == "return {}"
	case "go":
		return line == "return" || line == "return nil" || line == "return nil, nil" || line == "ret = nil"
	default:
		return false
	}
}

// TestActorRuntimeSurfacesAsyncRejections guards the QuickJS async-rejection error_category bug.
//
// Commit a59eb9e4 wrapped RLM actor code in an async IIFE so the model's top-level
// `await final(...)` is legal. But an async IIFE turns a synchronous `throw` into a *rejected
// promise*: an engine that runs the IIFE without awaiting it or draining the job queue never
// observes the rejection, so session.execute("throw ...") silently loses its
// error_category=runtime. That break surfaces only in the runtime-profile examples, and the
// java/python QuickJS4J profiles are skipped unless AXIR_QUICKJS4J_* is set, so it slipped past
// CI. Each engine that wraps actor code in an async IIFE must surface rejections: libquickjs,
// py-quickjs, and rquickjs attach a rejection handler that records __ax_error and drain the job
// queue; goja attaches the same handler and relies on RunString draining the promise job queue on
// return; quickjs4j awaits the IIFE so the host resolves its promise (propagating the rejection).
// Lock those markers in so the await/drain cannot be silently dropped again.
//
// The goja (Go) and rquickjs (Rust) profiles run only under an explicit --runtime-profiles pass,
// so the default suite does not exercise their error paths at runtime; these markers are the
// regression guard that keeps their rejection handling in place.
func TestActorRuntimeSurfacesAsyncRejections(t *testing.T) {
	cases := []struct {
		engine  string
		rel     string
		markers []string
	}{
		{"quickjs4j", "quickjs/javaQuickJSCodeSession.java", []string{"await (async function"}},
		{"libquickjs", "quickjs/cppQuickJSRuntimeSource.cpp", []string{"JS_ExecutePendingJob", "__ax_error"}},
		{"py-quickjs", "runtime/pyRuntimeQuickjs.py", []string{"execute_pending_job", "__ax_error"}},
		{"rquickjs", "rust_quickjs/rustQuickJSRuntime.rs", []string{"execute_pending_job", "__ax_error"}},
		{"goja", "goja/goGojaRuntime.go.txt", []string{".then(function(){}, function(e)", "__ax_error"}},
	}
	for _, tc := range cases {
		t.Run(tc.engine, func(t *testing.T) {
			path := filepath.Join(repoRootPath(), "tools", "axir", "internal", "axir", "templates", filepath.FromSlash(tc.rel))
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read actor runtime template %s: %v", tc.rel, err)
			}
			text := string(data)
			for _, marker := range tc.markers {
				if !strings.Contains(text, marker) {
					t.Fatalf("%s runtime %s is missing rejection-surfacing marker %q: a synchronous throw in actor code would become an unhandled rejected promise and error_category=runtime would be lost (see commit a59eb9e4)", tc.engine, tc.rel, marker)
				}
			}
		})
	}
}

func TestGeneratedRuntimePlaceholderDetectorRejectsDefaultBodies(t *testing.T) {
	for _, tc := range []struct {
		target string
		lines  []string
	}{
		{target: "python", lines: []string{"return None"}},
		{target: "python", lines: []string{"pass"}},
		{target: "java", lines: []string{"return null"}},
		{target: "cpp", lines: []string{"return Value()"}},
		{target: "cpp", lines: []string{"return nullptr"}},
		{target: "go", lines: []string{"return nil"}},
		{target: "go", lines: []string{"return nil, nil"}},
	} {
		t.Run(tc.target+"/"+strings.Join(tc.lines, "_"), func(t *testing.T) {
			if !generatedCoreBodyIsPlaceholder(tc.target, tc.lines) {
				t.Fatalf("placeholder detector accepted %s body %#v", tc.target, tc.lines)
			}
		})
	}
	for _, tc := range []struct {
		target string
		lines  []string
	}{
		{target: "python", lines: []string{"value = _core_schema_json_type(args[0])", "return value"}},
		{target: "java", lines: []string{"Object value = Core.schemaJsonType(args.get(0))", "return value"}},
		{target: "cpp", lines: []string{"auto value = Core::schema_json_type(args[0])", "return value"}},
		{target: "go", lines: []string{"value := _core_schema_json_type(args[0])", "return value"}},
	} {
		t.Run("real/"+tc.target, func(t *testing.T) {
			if generatedCoreBodyIsPlaceholder(tc.target, tc.lines) {
				t.Fatalf("placeholder detector rejected real %s body %#v", tc.target, tc.lines)
			}
		})
	}
}

func TestGeneratedConformanceRunnerAuditRejectsPlaceholderCoverage(t *testing.T) {
	for _, tc := range []struct {
		name string
		text string
	}{
		{name: "broad expectation guard", text: `fn run_optimize_fixture(fixture: &Value) -> AxResult<()> { require_any_expectation(fixture, &["expected_output"]) }`},
		{name: "fixture arm ok", text: `match kind { "agent_forward" => Ok(()), _ => run_fixture()? }`},
		{name: "grouped fixture arm ok", text: `match kind { "agent_runtime_policy" | "agent_runtime_session" => Ok(()), _ => run_fixture()? }`},
		{name: "self comparison", text: `expect_json_equal("flow plan", expected, expected)?;`},
		{name: "expected key only", text: `if expected key exists then accept fixture`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, found := conformanceRunnerPlaceholderCoveragePattern(tc.text); !found {
				t.Fatalf("conformance runner audit accepted placeholder coverage snippet: %s", tc.text)
			}
		})
	}
	manifest := CapabilityManifest{
		AxIRVersion:     "0.1",
		Target:          "rust",
		PackageName:     "axllm",
		SupportedSuites: []string{"axoptimize"},
	}
	coverage := ConformanceCoverageManifest{
		AxIRVersion: "0.1",
		Target:      "rust",
		PackageName: "axllm",
		Suites: map[string][]ConformanceCoverageEntry{
			"axoptimize": {{
				Suite:    "axoptimize",
				Kind:     "optimize",
				Runner:   "rust:axoptimize",
				Category: "presence-only",
			}},
		},
	}
	if err := ValidateConformanceCoverage(manifest, coverage); err == nil {
		t.Fatal("conformance coverage validator accepted presence-only claimed suite")
	}
}

func readRepoFile(t *testing.T, root string, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{root}, parts...)...)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func runtimeProfileExampleGuards(target string) []string {
	switch target {
	case "python":
		return []string{
			"examples/runtime_profiles/javascript_quickjs.py",
			"examples/runtime_profiles/python_pyodide.py",
		}
	case "java":
		return []string{
			"examples/runtime_profiles/JavaScriptQuickJsExample.java",
			"examples/runtime_profiles/PythonPyodideExample.java",
		}
	case "cpp":
		return []string{
			"examples/runtime_profiles/javascript_quickjs.cpp",
			"examples/runtime_profiles/python_pyodide.cpp",
		}
	case "go":
		return []string{
			"examples/runtime_profiles/javascript_goja/main.go",
		}
	case "rust":
		return []string{
			"examples/runtime_profiles/javascript_quickjs.rs",
		}
	default:
		return nil
	}
}

func expectedRuntimeProfileIDs(target string) []string {
	switch target {
	case "python", "java", "cpp":
		return []string{"javascript-quickjs", "python-pyodide"}
	case "go":
		return []string{"javascript-goja"}
	case "rust":
		return []string{"javascript-quickjs"}
	default:
		return nil
	}
}

func runtimeProfileManifestContains(entries []RuntimeProfileManifestEntry, id string) bool {
	for _, entry := range entries {
		if entry.ID == id {
			return true
		}
	}
	return false
}

func expectedRuntimeProfileFeatureGroups(target string) []string {
	groups := []string{
		"axagent-runtime-profile-parity",
		"axagent-runtime-axjs-reference",
		"axagent-runtime-profile-state-parity",
		"axagent-runtime-profile-diagnostics",
		"axagent-runtime-profile-agent-forward",
		"axagent-runtime-profile-actor-loop",
		"axagent-runtime-profile-productization-alpha",
		"axagent-runtime-profile-policy",
		"axagent-runtime-profile-package-policy",
	}
	if containsString(expectedRuntimeProfileIDs(target), "javascript-quickjs") {
		groups = append(groups,
			"axagent-runtime-profile-javascript-quickjs",
			"axagent-runtime-quickjs-session-state",
			"axagent-runtime-quickjs-host-calls",
			"axagent-runtime-quickjs-native-host-calls",
			"axagent-runtime-quickjs-callback-errors",
			"axagent-runtime-quickjs-limits",
			"axagent-runtime-quickjs-diagnostics",
		)
	}
	if containsString(expectedRuntimeProfileIDs(target), "python-pyodide") {
		groups = append(groups,
			"axagent-runtime-profile-python-pyodide",
			"axagent-runtime-pyodide-session-state",
			"axagent-runtime-pyodide-host-calls",
			"axagent-runtime-pyodide-diagnostics",
		)
	}
	if containsString(expectedRuntimeProfileIDs(target), "javascript-goja") {
		groups = append(groups,
			"axagent-runtime-profile-javascript-goja",
			"axagent-runtime-goja-session-state",
			"axagent-runtime-goja-host-calls",
			"axagent-runtime-goja-policy",
			"axagent-runtime-goja-diagnostics",
		)
	}
	return groups
}

func rejectedRuntimeProfileFeatureGroups(target string) []string {
	claimed := expectedRuntimeProfileIDs(target)
	var rejected []string
	if !containsString(claimed, "javascript-quickjs") {
		rejected = append(rejected, "axagent-runtime-profile-javascript-quickjs", "axagent-runtime-quickjs-session-state")
	}
	if !containsString(claimed, "python-pyodide") {
		rejected = append(rejected, "axagent-runtime-profile-python-pyodide", "axagent-runtime-pyodide-session-state")
	}
	if !containsString(claimed, "javascript-goja") {
		rejected = append(rejected, "axagent-runtime-profile-javascript-goja", "axagent-runtime-goja-session-state")
	}
	return rejected
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

func apiReferenceContainsCanonical(manifest APIReferenceManifest, want string) bool {
	for _, section := range manifest.Sections {
		for _, symbol := range section.Symbols {
			if symbol.CanonicalName == want {
				return true
			}
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

func TestCompactIfWithoutElseRoundTrip(t *testing.T) {
	src := `module @bodytest version "0.1" {
  dialect @core version "0.1"

  op core.func @demo {
    type signature = "(string) -> string"
    body @entry(%input: string) {
      %items = core.list
      %ok = core.call intrinsic.is_not_none(%input)
      core.if %ok {
        core.append %items, %input
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
	ifOp := mod.Ops[0].Regions[0].Blocks[0].Ops[2]
	if ifOp.Name != "core.if" || len(ifOp.Regions) != 2 {
		t.Fatalf("if without else must synthesize the empty else region, got %d regions", len(ifOp.Regions))
	}
	if _, err := BuildCoreBody(mod.Ops[0]); err != nil {
		t.Fatal(err)
	}
	text := FormatModuleCompact(mod)
	if strings.Contains(text, "} else {") {
		t.Fatalf("empty else must be omitted when formatting:\n%s", text)
	}
	again, err := ParseModule(text, "compact.axir")
	if err != nil {
		t.Fatalf("formatted if-without-else did not parse:\n%s\n%v", text, err)
	}
	if FormatModuleCompact(again) != text {
		t.Fatal("if-without-else format is not a fixed point")
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
				"expected_state_subset",
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
				"expected_context_result",
				"expected_context_result_subset",
				"expected_context_events_subset",
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
		case "agent_runtime_adapter":
			if _, ok := fixture["helper_calls"]; !ok {
				if _, ok := fixture["run_session"]; !ok {
					t.Fatalf("%s missing adapter helper_calls or run_session", file)
				}
			}
		case "agent_runtime_protocol":
			if _, ok := fixture["operation"]; !ok {
				t.Fatalf("%s missing runtime protocol operation", file)
			}
			if _, ok := fixture["expected_execute_subset"]; !ok {
				if _, ok := fixture["expected_capabilities_subset"]; !ok {
					if _, ok := fixture["expected_error_contains"]; !ok {
						t.Fatalf("%s missing runtime protocol expectation", file)
					}
				}
			}
		case "agent_prompt":
			if _, ok := fixture["signature"]; !ok {
				t.Fatalf("%s missing signature", file)
			}
			if _, ok := fixture["expected_description_contains"]; !ok {
				t.Fatalf("%s missing expected_description_contains", file)
			}
		case "agent_playbook_coverage":
			cases, ok := fixture["cases"].([]any)
			if !ok || len(cases) == 0 {
				t.Fatalf("%s missing playbook coverage cases", file)
			}
			for index, raw := range cases {
				item, ok := raw.(map[string]any)
				if !ok {
					t.Fatalf("%s case %d is not an object", file, index)
				}
				if item["name"] == "" {
					t.Fatalf("%s case %d missing name", file, index)
				}
				if _, ok := item["snapshot"]; !ok {
					t.Fatalf("%s case %d missing snapshot", file, index)
				}
				if _, ok := item["expected_covered"]; !ok {
					t.Fatalf("%s case %d missing expected_covered", file, index)
				}
			}
		case "agent_playbook_evolve":
			cases, ok := fixture["cases"].([]any)
			if !ok || len(cases) == 0 {
				t.Fatalf("%s missing playbook evolve cases", file)
			}
			if responses, ok := fixture["responses"].([]any); !ok || len(responses) == 0 {
				t.Fatalf("%s missing responses", file)
			}
			if _, ok := fixture["runtime_script"]; !ok {
				t.Fatalf("%s missing runtime_script", file)
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
		case "playbook-empty":
			if _, ok := fixture["expected_playbook"]; !ok {
				t.Fatalf("%s missing expected_playbook", file)
			}
		case "playbook-render":
			if _, ok := fixture["expected_render"]; !ok {
				t.Fatalf("%s missing expected_render", file)
			}
		case "playbook-stats":
			if _, ok := fixture["expected_playbook"]; !ok {
				t.Fatalf("%s missing expected_playbook", file)
			}
		case "playbook-dedupe":
			if _, ok := fixture["expected_playbook"]; !ok {
				t.Fatalf("%s missing expected_playbook", file)
			}
		case "playbook-feedback":
			if _, ok := fixture["expected_playbook"]; !ok {
				t.Fatalf("%s missing expected_playbook", file)
			}
		case "playbook-apply-ops":
			if _, ok := fixture["expected_result"]; !ok {
				t.Fatalf("%s missing expected_result", file)
			}
		case "ace-compile", "ace-online-update":
			_, hasPlaybook := fixture["expected_playbook"]
			_, hasArtifact := fixture["expected_artifact"]
			_, hasArtifactSubset := fixture["expected_artifact_subset"]
			_, hasCurator := fixture["expected_curator"]
			if !hasPlaybook && !hasArtifact && !hasArtifactSubset && !hasCurator {
				t.Fatalf("%s missing expected ace engine output", file)
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
		case "gepa":
			if _, ok := fixture["components"]; !ok {
				t.Fatalf("%s missing components", file)
			}
			if _, ok := fixture["optimize_options"]; !ok {
				t.Fatalf("%s missing optimize_options", file)
			}
		case "bootstrap":
			if _, ok := fixture["optimize_options"]; !ok {
				t.Fatalf("%s missing optimize_options", file)
			}
			if _, ok := fixture["expected_artifact_subset"]; !ok {
				t.Fatalf("%s missing expected_artifact_subset", file)
			}
		case "helper":
			if _, ok := fixture["optimize_options"]; !ok {
				t.Fatalf("%s missing optimize_options", file)
			}
			if _, ok := fixture["expected_artifact_subset"]; !ok {
				t.Fatalf("%s missing expected_artifact_subset", file)
			}
		case "eval":
			if _, ok := fixture["responses"]; !ok {
				t.Fatalf("%s missing responses", file)
			}
		case "verification":
			if _, ok := fixture["expected_output"]; !ok {
				t.Fatalf("%s missing expected_output", file)
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
from axllm import AIClient, AnthropicClient, AzureOpenAIClient, AxBaseAI, CohereClient, DeepSeekClient, GoogleGeminiClient, GrokClient, MistralClient, OpenAICompatibleClient, OpenAIResponsesClient, RekaClient, agent, ai, ax, f, fn, s

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

class Scripted(AxBaseAI):
    def __init__(self):
        super().__init__(name='scripted', model='scripted-chat', embed_model='scripted-embed')
        self.calls = 0
    def _chat(self, request, options):
        self.calls += 1
        if self.calls == 1:
            return {'results': [{'index': 0, 'content': '', 'function_calls': [{'id': 'c1', 'function': {'name': 'search', 'params': {'query': 'q'}}}]}]}
        if self.calls == 2:
            return {'results': [{'index': 0, 'content': '{}'}]}
        return {'results': [{'index': 0, 'content': '{"answer": "done"}'}]}
    def _embed(self, request, options):
        return {'embeddings': [[0.0]], 'model_usage': {'ai': 'scripted'}}
    def transcribe(self, request, options=None):
        return {'text': 'scripted transcript'}
    def speak(self, request, options=None):
        return {'audio': 'scripted-audio'}

gen = ax('query:string -> answer:string', {'functions': [search], 'validation_retries': 2})
out = gen.forward(Scripted(), {'query': 'q'})
assert out == {'answer': 'done'}, out

class AgentScripted(AxBaseAI):
    def __init__(self):
        super().__init__(name='agent-scripted', model='scripted-chat', embed_model='scripted-embed')
        self.calls = 0
    def _chat(self, request, options):
        self.calls += 1
        if self.calls == 1:
            return {'results': [{'index': 0, 'content': '{"completion":{"type":"final","args":["Answer",{}]}}'}]}
        if self.calls == 2:
            return {'results': [{'index': 0, 'content': '{"completion":{"type":"final","args":["Answer",{"answer":"done"}]}}'}]}
        return {'results': [{'index': 0, 'content': '{"answer": "done"}'}]}
    def _embed(self, request, options):
        return {'embeddings': [[0.0]], 'model_usage': {'ai': 'agent-scripted'}}
    def transcribe(self, request, options=None):
        return {'text': 'scripted transcript'}
    def speak(self, request, options=None):
        return {'audio': 'scripted-audio'}

ag = agent('question:string -> answer:string', {'contextFields': []})
agent_out = ag.forward(AgentScripted(), {'question': 'q'})
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
responses_service = ai('openai-responses', api_key='test', transport=lambda req: {
    'status': 200,
    'json': {'id': 'resp_smoke', 'model': 'gpt-4o', 'output': [{'id': 'm1', 'type': 'message', 'content': [{'type': 'output_text', 'text': 'ok'}]}]},
})
assert isinstance(responses_service, OpenAIResponsesClient)
responses_chat = responses_service.chat({'chat_prompt': [{'role': 'user', 'content': 'hello'}], 'model_config': {'stream': False}})
assert responses_chat['results'][0]['content'] == 'ok', responses_chat
gemini_requests = []
gemini_service = ai('google-gemini', api_key='test', transport=lambda req: (
    gemini_requests.append(req) or {
        'status': 200,
        'json': {'responseId': 'gem_smoke', 'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': 'ok'}]}}]},
    }
))
assert isinstance(gemini_service, GoogleGeminiClient)
gemini_chat = gemini_service.chat({'chat_prompt': [{'role': 'user', 'content': 'hello'}], 'model_config': {'stream': False}})
assert gemini_chat['results'][0]['content'] == 'ok', gemini_chat
assert gemini_requests[0]['url'].endswith('/models/gemini-2.5-flash:generateContent?key=test'), gemini_requests[0]
anthropic_requests = []
anthropic_service = ai('anthropic', api_key='test', transport=lambda req: (
    anthropic_requests.append(req) or {
        'status': 200,
        'json': {'id': 'msg_smoke', 'model': 'claude-3-7-sonnet-latest', 'content': [{'type': 'text', 'text': 'ok'}], 'stop_reason': 'end_turn'},
    }
))
assert isinstance(anthropic_service, AnthropicClient)
anthropic_chat = anthropic_service.chat({'chat_prompt': [{'role': 'user', 'content': 'hello'}], 'model_config': {'stream': False}})
assert anthropic_chat['results'][0]['content'] == 'ok', anthropic_chat
assert anthropic_requests[0]['url'].endswith('/messages'), anthropic_requests[0]
assert anthropic_requests[0]['headers']['anthropic-version'] == '2023-06-01', anthropic_requests[0]
for provider_name, cls in [
    ('azure-openai', AzureOpenAIClient),
    ('deepseek', DeepSeekClient),
    ('mistral', MistralClient),
    ('reka', RekaClient),
    ('cohere', CohereClient),
    ('grok', GrokClient),
]:
    provider_requests = []
    provider_options = {'resource_name': 'example', 'deployment_name': 'deployment'} if provider_name == 'azure-openai' else {}
    service = ai(provider_name, api_key='test', transport=lambda req: (
        provider_requests.append(req) or {
            'status': 200,
            'json': {
                'id': 'chatcmpl_provider',
                'model': 'fixture',
                'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'content': 'ok'}}],
            },
        }
    ), **provider_options)
    assert isinstance(service, cls), (provider_name, service)
    result = service.chat({'chat_prompt': [{'role': 'user', 'content': 'hello'}], 'model_config': {'stream': False}})
    assert result['results'][0]['content'] == 'ok', result
    assert provider_requests, provider_name
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

// TestResponsePerturbationGate runs the anti-hardcode gate: for every fixture
// whose assertions depend on a scripted model response, mutating that response
// must make the run fail. A passing-on-mutation fixture asserts a hardcoded or
// unwired value. The standard test lane runs the fast `go` target; CI runs all
// five via `npm run axir:gate:response-perturb` with AXIR_PERTURB_ALL=1.
func TestResponsePerturbationGate(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not available")
	}
	script := filepath.Join(repoRootPath(), "scripts", "axir-response-perturb-check.mjs")
	cmd := exec.Command("node", script, "go")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("response-perturbation gate failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "model-dependent assertion") {
		t.Fatalf("unexpected gate output: %s", out)
	}
}

// TestRLMStagesSymmetric guards the class of bug where one RLM actor stage runs
// the real runtime loop while its sibling is left as a one-shot that demands a
// structured completion. Scripted fixtures hide it by hand-feeding the one-shot
// stage a completion; a live model returns RLM code and the stage throws
// "Required field is missing: Completion". Every actor stage must (a) switch to a
// code-output signature under runtime and (b) drive the engine via
// @agent_runtime_execute_step in an actor loop. This is exactly the distiller bug
// a real-model run surfaced that all scripted conformance + the G1 antidote missed.
func TestRLMStagesSymmetric(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoRootPath(), "ir", "axcore", "agent.axir"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, stage := range []string{"distiller", "executor"} {
		sigVar := "%runtime_" + stage + "_signature"
		if !strings.Contains(text, sigVar+" = core.call intrinsic.string.format(") {
			t.Fatalf("RLM stage %q has no runtime code signature %s; a one-shot stage will throw 'Required field is missing: Completion' on a live model", stage, sigVar)
		}
		if !strings.Contains(text, "%"+stage+"_signature = core.let "+sigVar) {
			t.Fatalf("RLM stage %q does not switch to its code signature under runtime", stage)
		}
	}
	// Both stages must build a code-output runtime signature and run the engine.
	if c := strings.Count(text, "-> {}:code"); c < 2 {
		t.Fatalf("expected distiller AND executor code-output runtime signatures (-> {}:code), found %d", c)
	}
	if !strings.Contains(text, "agent distiller loop exceeded max steps") {
		t.Fatal("distiller has no runtime actor loop (missing its loop guard); it cannot execute model-authored code through the engine")
	}
	if !strings.Contains(text, "agent actor loop exceeded max steps") {
		t.Fatal("executor has no runtime actor loop guard")
	}
	if n := strings.Count(text, "@agent_runtime_execute_step("); n < 2 {
		t.Fatalf("expected >= 2 @agent_runtime_execute_step call sites (distiller + executor actor loops), found %d", n)
	}
}

// TestCodeStageUsesStructuredOutput guards the second half of the live-model fix:
// a code-emitting stage (RLM distiller/executor, `-> {}:code`) must request a strict
// json_schema response_format that forces the output field name, NOT a generic
// json_object. With json_object a live model picks its own keys and answers directly
// (e.g. {"answer":"Paris"}) instead of emitting the javascriptCode field, so the stage
// throws "Required field is missing: 'Javascript Code'". The behavioral guard is the
// agent-runtime-real-javascript-await fixture (asserts json_schema+javascriptCode in the
// request across all five engines); this is the fast-lane structural backstop.
func TestCodeStageUsesStructuredOutput(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoRootPath(), "ir", "axcore", "gen.axir"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, `intrinsic.eq(%of_type_name, "code")`) {
		t.Fatal("@build_gen_chat_request no longer detects a code-type output field; code stages will fall back to generic json_object and a live model will answer directly instead of emitting code")
	}
	if !strings.Contains(text, `@schema_to_json_schema_impl(`) {
		t.Fatal("@build_gen_chat_request does not build a json_schema from the output fields for code stages")
	}
	if !strings.Contains(text, "strictStructuredOutputs") {
		t.Fatal("code-stage json_schema is not strict; without strict mode the output field name is not forced")
	}
	if !strings.Contains(text, `"json_schema"`) {
		t.Fatal("@build_gen_chat_request never sets a json_schema response_format")
	}
}

// TestRealEngineFixturesRunCode guards the verification gap that let the distiller
// bug ship: a real-engine (axagent-real) fixture must execute MODEL-AUTHORED CODE
// through the engine for every actor stage. A hand-fed {"completion":...} at an
// actor position bypasses the engine and masks a one-shot stage -- which is exactly
// how the G1 antidote fed the distiller a completion and never ran distiller code.
// This is the closest mechanical proxy for "run it against a real model" that works
// without an API key (the in-process engine actually executes the code).
func TestRealEngineFixturesRunCode(t *testing.T) {
	dir := filepath.Join(repoRootPath(), "ir", "conformance", "axagent-real")
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no axagent-real fixtures: the real-engine path is unverified")
	}
	sawDistillerCode := false
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var fx struct {
			Kind      string `json:"kind"`
			Responses []struct {
				Content string `json:"content"`
			} `json:"responses"`
		}
		if err := json.Unmarshal(raw, &fx); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		if fx.Kind != "agent_runtime_real" {
			continue
		}
		for i, r := range fx.Responses {
			isResponder := i == len(fx.Responses)-1 // last response is the structured answer
			if !isResponder && strings.Contains(r.Content, "\"completion\"") {
				t.Fatalf("%s response[%d] hand-feeds a {\"completion\":...} to an actor stage; a real-engine fixture must run model-authored code through the engine, not a scripted completion (this is exactly what masked the distiller bug)", filepath.Base(f), i)
			}
		}
		if len(fx.Responses) > 0 &&
			strings.Contains(fx.Responses[0].Content, "final(") &&
			strings.Contains(fx.Responses[0].Content, "Code") {
			sawDistillerCode = true
		}
	}
	if !sawDistillerCode {
		t.Fatal("no axagent-real fixture runs DISTILLER-authored code through the engine; the distiller path is unverified against a real engine (the gap that let the one-shot distiller ship)")
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
	cmd := exec.Command("python3", "-m", "axllm.conformance", promptConformancePath())
	cmd.Env = fixtureEnv(dir)
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
	cmd := exec.Command("python3", "-m", "axllm.conformance", axgenConformancePath())
	cmd.Env = fixtureEnv(dir)
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
	cmd := exec.Command("python3", "-m", "axllm.conformance", axaiConformancePath())
	cmd.Env = fixtureEnv(dir)
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
	cmd := exec.Command("python3", "-m", "axllm.conformance", axagentConformancePath())
	cmd.Env = fixtureEnv(dir)
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
	cmd := exec.Command("python3", "-m", "axllm.conformance", axoptimizeConformancePath())
	cmd.Env = fixtureEnv(dir)
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
		cmd := exec.Command("python3", "-m", "axllm.conformance", tc.path)
		cmd.Env = fixtureEnv(dir)
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
	aiFile, err := os.ReadFile(filepath.Join(dir, "axllm", "ai.py"))
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
		"class OpenAIResponsesClient",
		"class GoogleGeminiClient",
		"class AnthropicClient",
		"class AzureOpenAIClient",
		"class DeepSeekClient",
		"class MistralClient",
		"class RekaClient",
		"class CohereClient",
		"class GrokClient",
		"class AxBalancer",
		"class MultiServiceRouter",
		"class ProviderRouter",
		"def get_supported_ai_models(",
		"# BEGIN AXIR CORE EMITTED FUNCTIONS",
		"def validate_chat_request(",
		"def merge_model_config(",
		"def chat_response_to_completion(",
		"def provider_normalize_profile(",
		"def provider_profile_registry(",
		"def provider_resolve_profile(",
		"def provider_model_catalog_summary(",
		"def provider_model_catalog(",
		"def provider_route_recommendation(",
		"def provider_route_validation(",
		"def provider_routing_stats(",
		"def provider_descriptor(",
		"def provider_build_chat_request(",
		"def openai_build_chat_request(",
		"def openai_normalize_chat_response(",
		"def openai_normalize_stream_delta(",
		"def openai_normalize_error(",
		"def _gemini_build_chat_request(",
		"def _gemini_normalize_chat_response(",
		"def _gemini_normalize_embed_response(",
		"def _anthropic_build_chat_request(",
		"def _anthropic_normalize_chat_response(",
		"def _anthropic_normalize_stream_delta(",
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
	if !strings.Contains(text, "resolved = provider_resolve_profile(") {
		t.Fatal("generated Python ai(...) factory does not use Core provider resolver")
	}
	promptFile, err := os.ReadFile(filepath.Join(dir, "axllm", "prompt.py"))
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
	genFile, err := os.ReadFile(filepath.Join(dir, "axllm", "gen.py"))
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
	agentFile, err := os.ReadFile(filepath.Join(dir, "axllm", "agent.py"))
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
		"output = _agent_forward(",
		"return output",
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
	runtimeFile, err := os.ReadFile(filepath.Join(dir, "axllm", "runtime.py"))
	if err != nil {
		t.Fatal(err)
	}
	runtimeText := string(runtimeFile)
	for _, want := range []string{
		"class RuntimeCapabilities",
		"class RuntimeEnvelope",
		"class ProcessCodeRuntime",
		"class ProcessCodeSession",
		"def session_closed(",
		"def ask_clarification(",
		"def guide_agent(",
		"runtime protocol response id mismatch",
		"closed_without_response_message",
	} {
		if !strings.Contains(runtimeText, want) {
			t.Fatalf("generated Python runtime adapter helpers missing %q", want)
		}
	}
	signatureFile, err := os.ReadFile(filepath.Join(dir, "axllm", "signature.py"))
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
	schemaFile, err := os.ReadFile(filepath.Join(dir, "axllm", "schema.py"))
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

// fixtureEnv returns the process environment with provider endpoint and
// credential overrides removed, so scripted conformance fixtures cannot be
// skewed by a developer's local ANTHROPIC_BASE_URL/OPENAI_API_KEY etc.
func fixtureEnv(pythonPath string) []string {
	var env []string
	if pythonPath != "" {
		env = append(env, "PYTHONPATH="+pythonPath)
	}
	for _, kv := range os.Environ() {
		name, _, ok := strings.Cut(kv, "=")
		if !ok || name == "PYTHONPATH" {
			continue
		}
		if strings.HasSuffix(name, "_BASE_URL") || strings.HasSuffix(name, "_API_KEY") {
			continue
		}
		env = append(env, kv)
	}
	return env
}

func TestPythonModulesSelfContained(t *testing.T) {
	bundle, err := LoadBundle(rootPath())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := Compile(bundle, "python", dir); err != nil {
		t.Fatal(err)
	}
	moduleDir := filepath.Join(dir, "axllm")
	entries, err := os.ReadDir(moduleDir)
	if err != nil {
		t.Fatal(err)
	}
	// Python is the only target without compile-time reference checking, so
	// every underscore helper a module calls must be defined in that module,
	// bound at module scope, or imported from a sibling. Guards against
	// emit-list drift (missing gemini/grok audio functions) and callee naming
	// mismatches (pythonCallee underscore-prefixing public core functions).
	// buildPythonCoreModule applies the same audit (pythonModuleMissingHelpers)
	// at codegen time so a missing helper fails generation rather than surfacing
	// as a runtime NameError; this test extends the sweep to every module.
	sawCalls := false
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".py") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(moduleDir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		if pythonHelperCallRe.MatchString(text) {
			sawCalls = true
		}
		for _, missing := range pythonModuleMissingHelpers(text) {
			t.Errorf("%s calls %s but never defines or imports it", entry.Name(), missing)
		}
	}
	if !sawCalls {
		t.Fatal("no underscore helper references found in generated Python; audit regexes are stale")
	}
	aiFile, err := os.ReadFile(filepath.Join(moduleDir, "ai.py"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(aiFile)
	for _, want := range []string{
		"def _grok_build_transcribe_request(",
		"def _grok_build_speak_request(",
		"def _gemini_build_transcribe_request(",
		"def _gemini_build_speak_request(",
		"def _gemini_normalize_transcribe_response(",
		"def _gemini_normalize_speak_response(",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("generated Python ai.py missing audio core function %q", want)
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
	coreFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "Core.java"))
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
		"static Object provider_normalize_profile(",
		"static Object provider_profile_registry(",
		"static Object provider_resolve_profile(",
		"static Object provider_model_catalog_summary(",
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
	axFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "Ax.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(axFile), "Core.provider_resolve_profile(") {
		t.Fatal("generated Java Ax.ai factory does not use Core provider resolver")
	}
	if !strings.Contains(string(axFile), "getSupportedAIModels(") {
		t.Fatal("generated Java Ax does not expose model catalog helpers")
	}
	javaRouterFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxMultiServiceRouter.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(javaRouterFile), "public final class AxMultiServiceRouter") || !strings.Contains(string(javaRouterFile), "Model key must be specified") || !strings.Contains(string(javaRouterFile), "duplicate model key") {
		t.Fatal("generated Java multi-service router is missing expected implementation")
	}
	javaBalancerFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxBalancer.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(javaBalancerFile), "public final class AxBalancer") || !strings.Contains(string(javaBalancerFile), "Core.provider_balancer_retry_policy(") || !strings.Contains(string(javaBalancerFile), "Core.provider_balancer_candidate_allowed(") {
		t.Fatal("generated Java balancer is missing Core delegation")
	}
	javaGEPAFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxGEPA.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(javaGEPAFile), "public final class AxGEPA implements OptimizerEngine") || !strings.Contains(string(javaGEPAFile), "AxGEPA requires an OptimizerEvaluator") {
		t.Fatal("generated Java GEPA engine is missing optimizer boundary implementation")
	}
	javaProviderRouterFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxProviderRouter.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(javaProviderRouterFile), "public final class AxProviderRouter") || !strings.Contains(string(javaProviderRouterFile), "Core.provider_route_recommendation(") {
		t.Fatal("generated Java provider router is missing Core delegation")
	}
	axGenFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxGen.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(axGenFile), "Core._forward_impl(") {
		t.Fatal("generated Java AxGen does not delegate forward to Core")
	}
	axAgentFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxAgent.java"))
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
	openAIFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "OpenAICompatibleClient.java"))
	if err != nil {
		t.Fatal(err)
	}
	openAIText := string(openAIFile)
	for _, want := range []string{
		"Core.provider_build_chat_request(",
		"Core.provider_normalize_chat_response(",
		"Core.provider_normalize_stream_delta(",
		"Core.provider_build_embed_request(",
		"Core.provider_build_transcribe_request(",
		"Core.provider_build_realtime_audio_setup(",
		"Core.provider_build_realtime_audio_input(",
		"Core.provider_normalize_realtime_event(",
		"Core.openai_normalize_error(",
	} {
		if !strings.Contains(openAIText, want) {
			t.Fatalf("generated Java OpenAI client missing Core delegation %q", want)
		}
	}
	for _, forbidden := range []string{"BidiGenerateContent", "output_audio_transcript", "gemini_live_bidi", "grok-voice"} {
		if strings.Contains(openAIText, forbidden) {
			t.Fatalf("generated Java OpenAI client contains provider-specific realtime logic %q", forbidden)
		}
	}
	openAIResponsesFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "OpenAIResponsesClient.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(openAIResponsesFile), "openai-responses") {
		t.Fatalf("generated Java OpenAI Responses client missing provider marker")
	}
	googleGeminiFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "GoogleGeminiClient.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(googleGeminiFile), "google-gemini") || !strings.Contains(string(openAIText), "Core.provider_build_chat_request(") {
		t.Fatalf("generated Java Gemini client missing provider marker or Core delegation")
	}
	anthropicFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AnthropicClient.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(anthropicFile), "anthropic") || !strings.Contains(string(openAIText), "Core.provider_build_chat_request(") {
		t.Fatalf("generated Java Anthropic client missing provider marker or Core delegation")
	}
	for providerFile, providerMarker := range map[string]string{
		"AzureOpenAIClient.java": "azure-openai",
		"DeepSeekClient.java":    "deepseek",
		"MistralClient.java":     "mistral",
		"RekaClient.java":        "reka",
		"CohereClient.java":      "cohere",
		"GrokClient.java":        "grok",
	} {
		fileText, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", providerFile))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(fileText), providerFile[:len(providerFile)-5]) || !strings.Contains(string(fileText), providerMarker) || !strings.Contains(openAIText, "Core.provider_build_chat_request(") {
			t.Fatalf("generated Java provider client %s missing provider marker or Core delegation", providerFile)
		}
	}
	conformanceFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "Conformance.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(conformanceFile), "public final class Conformance") || !strings.Contains(string(conformanceFile), "case \"ai_chat\"") || !strings.Contains(string(conformanceFile), "case \"agent_forward\"") || !strings.Contains(string(conformanceFile), "case \"agent_runtime_policy\"") || !strings.Contains(string(conformanceFile), "case \"agent_runtime_session\"") || !strings.Contains(string(conformanceFile), "case \"agent_runtime_adapter\"") || !strings.Contains(string(conformanceFile), "case \"agent_runtime_protocol\"") || !strings.Contains(string(conformanceFile), "case \"optimize\"") {
		t.Fatal("generated Java conformance runner is missing expected fixture dispatch")
	}
	runtimeEnvelopeFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxRuntimeEnvelope.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(runtimeEnvelopeFile), "public final class AxRuntimeEnvelope") || !strings.Contains(string(runtimeEnvelopeFile), "sessionClosed") || !strings.Contains(string(runtimeEnvelopeFile), "askClarification") {
		t.Fatal("generated Java runtime adapter helpers are missing expected factories")
	}
	processRuntimeFile, err := os.ReadFile(filepath.Join(dir, "dev", "axllm", "ax", "AxProcessCodeRuntime.java"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(processRuntimeFile), "public final class AxProcessCodeRuntime") || !strings.Contains(string(processRuntimeFile), "ProcessBuilder") || !strings.Contains(string(processRuntimeFile), "closedWithoutResponseMessage") {
		t.Fatal("generated Java process runtime protocol helper is missing expected implementation")
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
	err = os.WriteFile(smoke, []byte(`import dev.axllm.ax.*;
import java.util.*;

public class Smoke {
  static final class Scripted implements AiClient {
    public Map<String, Object> complete(Map<String, Object> request) {
      return Map.of("content", "{\"answer\":\"Paris\"}");
    }
  }
  public static void main(String[] args) throws Exception {
    AxSignature sig = Ax.s("question:string -> answer:string");
    AxGen qa = Ax.ax(sig);
    Map<String, Object> out = qa.forward(new Scripted(), Map.of("question", "Capital?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    final class AgentScripted implements AiClient {
      int calls = 0;
      public Map<String, Object> complete(Map<String, Object> request) {
        calls++;
        if (calls == 1) return Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}");
        if (calls == 2) return Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}");
        return Map.of("content", "{\"answer\":\"Paris\"}");
      }
    }
    AxAgent agent = Ax.agent("question:string -> answer:string", Map.of("contextFields", List.of()));
    Map<String, Object> agentOut = agent.forward(new AgentScripted(), Map.of("question", "Capital?"));
    if (!"Paris".equals(agentOut.get("answer"))) throw new RuntimeException("bad agent output: " + agentOut);
    System.out.println("java-ok");
  }
}
`), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "dev", "axllm", "ax", "*.java"))
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
	java.Env = fixtureEnv("")
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
	java = exec.Command(javaPath, "-cp", dir, "dev.axllm.ax.Conformance", signatureConformancePath(), schemaConformancePath(), validationConformancePath(), promptConformancePath(), axgenConformancePath(), axaiConformancePath(), axagentConformancePath(), axoptimizeConformancePath())
	java.Env = fixtureEnv("")
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
	header, err := os.ReadFile(filepath.Join(dir, "axllm", "axllm.hpp"))
	if err != nil {
		t.Fatal(err)
	}
	headerText := string(header)
	for _, want := range []string{
		"namespace axllm",
		"Value s(const std::string& signature)",
		"class AIClient",
		"class AxAIService",
		"class OpenAICompatibleClient",
		"class OpenAIResponsesClient",
		"class GoogleGeminiClient",
		"class AnthropicClient",
		"class AzureOpenAIClient",
		"class DeepSeekClient",
		"class MistralClient",
		"class RekaClient",
		"class CohereClient",
		"class GrokClient",
		"class AxBalancer",
		"class MultiServiceRouter",
		"class ProviderRouter",
		"class Tool",
		"class AxGen",
		"class AxAgent",
		"class AxCodeRuntime",
		"class AxCodeSession",
		"struct RuntimeCapabilities",
		"struct RuntimeEnvelope",
		"class RuntimeTransport",
		"class RuntimeProtocolClient",
		"Value to_json_schema(",
		"Value validate_output(",
		"Value render_prompt(",
		"Value fold_stream(",
		"Value get_supported_ai_models(",
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
	source, err := os.ReadFile(filepath.Join(dir, "axllm", "axllm.cpp"))
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
		"Value Core::provider_normalize_profile(",
		"Value Core::provider_profile_registry(",
		"Value Core::provider_resolve_profile(",
		"Value Core::provider_model_catalog_summary(",
		"Value Core::provider_model_catalog(",
		"Value Core::provider_route_recommendation(",
		"Value Core::provider_route_validation(",
		"Value Core::provider_routing_stats(",
		"Value Core::provider_descriptor(",
		"Value Core::provider_build_chat_request(",
		"Value Core::openai_build_chat_request(",
		"Value Core::openai_normalize_chat_response(",
		"Value Core::openai_normalize_stream_delta(",
		"Value Core::openai_build_embed_request(",
		"Value Core::openai_normalize_error(",
		"Value Core::_gemini_build_chat_request(",
		"Value Core::_gemini_normalize_chat_response(",
		"Value Core::_gemini_normalize_embed_response(",
		"Value Core::_anthropic_build_chat_request(",
		"Value Core::_anthropic_normalize_chat_response(",
		"Value Core::_anthropic_normalize_stream_delta(",
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
		"Core::provider_resolve_profile(",
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
		`kind == "agent_playbook_evolve"`,
		`kind == "agent_runtime_policy"`,
		`kind == "agent_runtime_session"`,
		`kind == "agent_runtime_adapter"`,
		`kind == "agent_runtime_protocol"`,
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
	err = os.WriteFile(smoke, []byte(`#include "axllm/axllm.hpp"
#include <iostream>

int main() {
  axllm::Value sig = axllm::s("question:string -> answer:string");
  axllm::Value schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
  axllm::Value values = axllm::Value::object();
  axllm::Core::set(values, "answer", "Paris");
  axllm::validate_output(axllm::Core::get(sig, "outputs"), values);
  axllm::Value input = axllm::Value::object();
  axllm::Core::set(input, "question", "Capital?");
  axllm::Value messages = axllm::render_prompt(sig, input);
  if (!axllm::Core::truthy(messages) || !axllm::Core::truthy(schema)) return 1;
  struct ScriptedClient : axllm::AIClient {
    axllm::Value complete(axllm::Value) override {
      return axllm::object({{"content", "{\"answer\":\"Paris\"}"}});
    }
  } client;
  auto qa = axllm::ax("question:string -> answer:string");
  axllm::Value out = qa.forward(client, axllm::object({{"question", "Capital?"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Paris")) return 2;
  struct AgentScriptedClient : axllm::AIClient {
    int calls = 0;
    axllm::Value complete(axllm::Value) override {
      ++calls;
      if (calls == 1) return axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}});
      if (calls == 2) return axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}});
      return axllm::object({{"content", "{\"answer\":\"Paris\"}"}});
    }
  } agent_client;
  auto ag = axllm::agent("question:string -> answer:string", axllm::object({{"contextFields", axllm::array({})}}));
  axllm::Value agent_out = ag.forward(agent_client, axllm::object({{"question", "Capital?"}}));
  if (!axllm::equal(axllm::Core::get(agent_out, "answer"), "Paris")) return 3;
  auto service = axllm::ai("openai", axllm::object({{"model", "gpt-4.1-mini"}, {"api_key", "test-key"}}));
  (void)service;
  std::cout << "cpp-ok\n";
}
`), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	axSource := filepath.Join(dir, "axllm", "axllm.cpp")
	mcpSource := filepath.Join(dir, "axllm", "mcp.cpp")
	smokeBin := filepath.Join(dir, "smoke")
	cmd := exec.Command(cpp, "-std=c++17", "-I", dir, axSource, smoke, "-o", smokeBin)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("C++ smoke compile failed: %v\n%s", err, out)
	}
	smokeCmd := exec.Command(smokeBin)
	smokeCmd.Env = fixtureEnv("")
	out, err = smokeCmd.CombinedOutput()
	if err != nil {
		t.Fatalf("C++ smoke failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "cpp-ok") {
		t.Fatalf("unexpected C++ smoke output: %s", out)
	}

	conformanceBin := filepath.Join(dir, "conformance")
	cmd = exec.Command(cpp, "-std=c++17", "-I", dir, axSource, mcpSource, filepath.Join(dir, "conformance.cpp"), "-o", conformanceBin)
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("C++ conformance compile failed: %v\n%s", err, out)
	}
	conformanceCmd := exec.Command(
		conformanceBin,
		signatureConformancePath(),
		schemaConformancePath(),
		validationConformancePath(),
		promptConformancePath(),
		axgenConformancePath(),
		axaiConformancePath(),
		axagentConformancePath(),
		axoptimizeConformancePath(),
	)
	conformanceCmd.Env = fixtureEnv("")
	out, err = conformanceCmd.CombinedOutput()
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

func TestVerifyQuickJSProfileCanAutoDrivePythonThroughJavaServer(t *testing.T) {
	data, err := os.ReadFile("verify.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		"quickJSJavaProtocolServerCommand",
		"AXIR_QUICKJS_RUNTIME_SERVER",
		"generated Java QuickJS4J protocol server",
		"compile runtime profile javascript-quickjs server",
		"AxQuickJsProtocolServer",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("verify.go missing QuickJS Python-through-Java marker %q", want)
		}
	}
}

func TestVerifyGojaProfileIsGoNative(t *testing.T) {
	data, err := os.ReadFile("verify.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		"javascript-goja",
		"verifyGoGojaProfile",
		"./examples/runtime_profiles/javascript_goja",
		"Go uses javascript-goja for built-in JavaScript actor execution",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("verify.go missing Go goja runtime profile marker %q", want)
		}
	}
}
