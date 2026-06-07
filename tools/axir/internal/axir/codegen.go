package axir

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

func Compile(bundle Bundle, target, outDir string) error {
	if ds := Check(bundle); ds.HasErrors() {
		return ds
	}
	core := LowerToCore(bundle)
	model, err := BuildRuntimeModel(core)
	if err != nil {
		return err
	}
	switch target {
	case "python":
		return EmitPython(model, outDir)
	case "java":
		return EmitJava(model, outDir)
	case "cpp":
		return EmitCpp(model, outDir)
	case "go":
		return EmitGo(model, outDir)
	case "rust":
		return EmitRust(model, outDir)
	default:
		return fmt.Errorf("unknown compile target %q", target)
	}
}

func validateCoreForBackend(core Module) error {
	required := betaRuntimeSymbols
	found := map[string]bool{}
	for _, op := range core.Ops {
		if op.Symbol != "" {
			found[op.Symbol] = true
		}
	}
	var missing []string
	for _, symbol := range required {
		if !found[symbol] {
			missing = append(missing, "@"+symbol)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("lowered core module missing backend symbols: %s", strings.Join(missing, ", "))
	}
	return nil
}

func EmitPython(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	signature, err := BuildPythonSignature(model)
	if err != nil {
		return err
	}
	schema, err := BuildPythonSchema(model)
	if err != nil {
		return err
	}
	prompt, err := BuildPythonPrompt(model)
	if err != nil {
		return err
	}
	ai, err := BuildPythonAI(model)
	if err != nil {
		return err
	}
	gen, err := BuildPythonGen(model)
	if err != nil {
		return err
	}
	agent, err := BuildPythonAgent(model)
	if err != nil {
		return err
	}
	flow, err := BuildPythonFlow(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"pyproject.toml":                                        renderPackageTemplate(pyProjectToml, version),
		"MANIFEST.in":                                           pyManifestIn,
		"axllm/__init__.py":                                     pyInit,
		"axllm/py.typed":                                        "",
		"axllm/signature.py":                                    signature,
		"axllm/schema.py":                                       schema,
		"axllm/tool.py":                                         pyTool,
		"axllm/runtime.py":                                      pyRuntime,
		"axllm/prompt.py":                                       prompt,
		"axllm/ai.py":                                           ai,
		"axllm/gen.py":                                          gen,
		"axllm/agent.py":                                        agent,
		"axllm/flow.py":                                         flow,
		"axllm/conformance.py":                                  pyConformance,
		"axllm/providers/__init__.py":                           pyProvidersInit,
		"axllm/providers/openai.py":                             pyOpenAIProvider,
		"axir-capabilities.json":                                mustCapabilityManifest(model, "python"),
		"conformance-coverage.json":                             mustConformanceCoverageManifest(model, "python"),
		"examples/signature_schema.py":                          pySignatureSchemaExample,
		"examples/axgen_fake_client_tool.py":                    pyAxGenFakeClientToolExample,
		"examples/axgen_openai_api.py":                          pyAxGenOpenAIExample,
		"examples/axai_fake_transport.py":                       pyAxAIFakeTransportExample,
		"examples/axagent_pipeline.py":                          pyAxAgentPipelineExample,
		"examples/runtime_adapter.py":                           pyRuntimeAdapterExample,
		"examples/runtime_protocol.py":                          pyRuntimeProtocolExample,
		"examples/runtime_profiles/javascript_quickjs.py":       pyJavaScriptQuickJSProfilePythonExample,
		"examples/runtime_profiles/python_pyodide.py":           pyPythonPyodideProfileExample,
		"examples/runtime_profiles/pyodide-package.json":        pyodidePackageJSON,
		"examples/runtime_profiles/pyodide-runtime-policy.json": pyodideRuntimePolicyJSON,
		"examples/runtime_profiles/resolve_pyodide_runtime_server.sh": pyodideRuntimeHelper,
		"examples/runtime_profiles/README.md":                         pyodideProfileReadme,
		"examples/axflow_program_graph.py":                            pyAxFlowProgramGraphExample,
		"examples/optimizer_artifact.py":                              pyOptimizerArtifactExample,
		"README.md":                                                   packageREADME(model, "python"),
	}
	return writeFiles(outDir, files)
}

func EmitJava(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildJavaCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"pom.xml":                                                     renderPackageTemplate(javaPomXML, version),
		"build.gradle":                                                renderPackageTemplate(javaBuildGradle, version),
		"settings.gradle":                                             javaSettingsGradle,
		"dev/axllm/ax/Ax.java":                                        javaAx,
		"dev/axllm/ax/AxProgram.java":                                 javaAxProgram,
		"dev/axllm/ax/AxSignature.java":                               javaSignature,
		"dev/axllm/ax/Field.java":                                     javaField,
		"dev/axllm/ax/FieldType.java":                                 javaFieldType,
		"dev/axllm/ax/Tool.java":                                      javaTool,
		"dev/axllm/ax/PromptTemplate.java":                            javaPromptTemplate,
		"dev/axllm/ax/Core.java":                                      core,
		"dev/axllm/ax/AiClient.java":                                  javaAiClient,
		"dev/axllm/ax/AxAIService.java":                               javaAxAIService,
		"dev/axllm/ax/AxMultiServiceRouter.java":                      javaAxMultiServiceRouter,
		"dev/axllm/ax/AxBalancer.java":                                javaAxBalancer,
		"dev/axllm/ax/AxProviderRouter.java":                          javaAxProviderRouter,
		"dev/axllm/ax/AxBaseAI.java":                                  javaAxBaseAI,
		"dev/axllm/ax/AxAIServiceError.java":                          javaAxAIServiceError,
		"dev/axllm/ax/AxMemory.java":                                  javaAxMemory,
		"dev/axllm/ax/AxAgent.java":                                   javaAxAgent,
		"dev/axllm/ax/AxFlow.java":                                    javaAxFlow,
		"dev/axllm/ax/AxAgentClarificationException.java":             javaAxAgentClarificationException,
		"dev/axllm/ax/AxCodeRuntime.java":                             javaAxCodeRuntime,
		"dev/axllm/ax/AxCodeSession.java":                             javaAxCodeSession,
		"dev/axllm/ax/AxRuntimeCapabilities.java":                     javaAxRuntimeCapabilities,
		"dev/axllm/ax/AxRuntimeEnvelope.java":                         javaAxRuntimeEnvelope,
		"dev/axllm/ax/AxProcessCodeRuntime.java":                      javaAxProcessCodeRuntime,
		"dev/axllm/ax/AxProcessCodeSession.java":                      javaAxProcessCodeSession,
		"dev/axllm/ax/runtime/quickjs/AxQuickJsCodeRuntime.java":      javaQuickJSCodeRuntime,
		"dev/axllm/ax/runtime/quickjs/AxQuickJsCodeSession.java":      javaQuickJSCodeSession,
		"dev/axllm/ax/runtime/quickjs/AxQuickJsHostCallable.java":     javaQuickJSHostCallable,
		"dev/axllm/ax/runtime/quickjs/AxQuickJsProtocolServer.java":   javaQuickJSProtocolServer,
		"dev/axllm/ax/OpenAICompatibleClient.java":                    javaOpenAI,
		"dev/axllm/ax/OpenAIResponsesClient.java":                     javaOpenAIResponses,
		"dev/axllm/ax/GoogleGeminiClient.java":                        javaGoogleGemini,
		"dev/axllm/ax/AnthropicClient.java":                           javaAnthropic,
		"dev/axllm/ax/AzureOpenAIClient.java":                         javaAzureOpenAI,
		"dev/axllm/ax/DeepSeekClient.java":                            javaDeepSeek,
		"dev/axllm/ax/MistralClient.java":                             javaMistral,
		"dev/axllm/ax/RekaClient.java":                                javaReka,
		"dev/axllm/ax/CohereClient.java":                              javaCohere,
		"dev/axllm/ax/GrokClient.java":                                javaGrok,
		"dev/axllm/ax/AxGen.java":                                     javaAxGen,
		"dev/axllm/ax/AxGEPA.java":                                    javaAxGEPA,
		"dev/axllm/ax/OptimizerEngine.java":                           javaOptimizerEngine,
		"dev/axllm/ax/OptimizerEvaluator.java":                        javaOptimizerEvaluator,
		"dev/axllm/ax/Json.java":                                      javaJson,
		"dev/axllm/ax/Conformance.java":                               javaConformance,
		"axir-capabilities.json":                                      mustCapabilityManifest(model, "java"),
		"conformance-coverage.json":                                   mustConformanceCoverageManifest(model, "java"),
		"examples/SignatureSchemaExample.java":                        javaSignatureSchemaExample,
		"examples/AxGenFakeClientToolExample.java":                    javaAxGenFakeClientToolExample,
		"examples/AxGenOpenAIExample.java":                            javaAxGenOpenAIExample,
		"examples/AxAIFakeTransportExample.java":                      javaAxAIFakeTransportExample,
		"examples/AxAgentPipelineExample.java":                        javaAxAgentPipelineExample,
		"examples/RuntimeAdapterExample.java":                         javaRuntimeAdapterExample,
		"examples/RuntimeProtocolExample.java":                        javaRuntimeProtocolExample,
		"examples/runtime_profiles/JavaScriptQuickJsExample.java":     javaJavaScriptQuickJSProfileExample,
		"examples/runtime_profiles/PythonPyodideExample.java":         javaPythonPyodideProfileExample,
		"examples/runtime_profiles/quickjs4j-pom.xml":                 javaQuickJSProfilePom,
		"examples/runtime_profiles/quickjs4j-build.gradle":            javaQuickJSProfileGradle,
		"examples/runtime_profiles/quickjs-runtime-policy.json":       quickJSRuntimePolicyJSON,
		"examples/runtime_profiles/resolve_quickjs4j_cp.sh":           javaQuickJSClasspathHelper,
		"examples/runtime_profiles/pyodide-package.json":              pyodidePackageJSON,
		"examples/runtime_profiles/pyodide-runtime-policy.json":       pyodideRuntimePolicyJSON,
		"examples/runtime_profiles/resolve_pyodide_runtime_server.sh": pyodideRuntimeHelper,
		"examples/runtime_profiles/README.md":                         javaRuntimeProfilesReadme,
		"examples/AxFlowProgramGraphExample.java":                     javaAxFlowProgramGraphExample,
		"examples/OptimizerArtifactExample.java":                      javaOptimizerArtifactExample,
		"README.md":                                                   packageREADME(model, "java"),
	}
	return writeFiles(outDir, files)
}

func EmitCpp(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildCppCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"CMakeLists.txt":                                        renderPackageTemplate(cppCMakeLists, version),
		"cmake/axllmConfig.cmake.in":                            cppCMakeConfig,
		"axllm/axllm.hpp":                                       cppHeader,
		"axllm/axllm.cpp":                                       strings.Replace(cppRuntime, "// AXIR_CORE_CPP_FUNCTIONS\n", core, 1),
		"conformance.cpp":                                       cppConformance,
		"axir-capabilities.json":                                mustCapabilityManifest(model, "cpp"),
		"conformance-coverage.json":                             mustConformanceCoverageManifest(model, "cpp"),
		"examples/signature_schema.cpp":                         cppSignatureSchemaExample,
		"examples/axgen_fake_client_tool.cpp":                   cppAxGenFakeClientToolExample,
		"examples/axgen_openai_api.cpp":                         cppAxGenOpenAIExample,
		"examples/axai_fake_transport.cpp":                      cppAxAIFakeTransportExample,
		"examples/axagent_pipeline.cpp":                         cppAxAgentPipelineExample,
		"examples/runtime_adapter.cpp":                          cppRuntimeAdapterExample,
		"examples/runtime_protocol.cpp":                         cppRuntimeProtocolExample,
		"axllm/runtime/quickjs/quickjs_runtime.hpp":             cppQuickJSRuntimeHeader,
		"axllm/runtime/quickjs/quickjs_runtime.cpp":             cppQuickJSRuntimeSource,
		"examples/runtime_profiles/javascript_quickjs.cpp":      cppJavaScriptQuickJSProfileExample,
		"examples/runtime_profiles/python_pyodide.cpp":          cppPythonPyodideProfileExample,
		"examples/runtime_profiles/quickjs-runtime-policy.json": quickJSRuntimePolicyJSON,
		"examples/runtime_profiles/pyodide-runtime-policy.json": pyodideRuntimePolicyJSON,
		"examples/runtime_profiles/README.md":                   cppRuntimeProfilesReadme,
		"examples/axflow_program_graph.cpp":                     cppAxFlowProgramGraphExample,
		"examples/optimizer_artifact.cpp":                       cppOptimizerArtifactExample,
		"README.md":                                             packageREADME(model, "cpp"),
	}
	return writeFiles(outDir, files)
}

func EmitGo(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildGoCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"go.mod":                                            renderPackageTemplate(goMod, version),
		"go.sum":                                            goSum,
		"axllm.go":                                          renderPackageTemplate(core, version),
		"runtime/goja/goja.go":                              goGojaRuntime,
		"axir-capabilities.json":                            mustCapabilityManifest(model, "go"),
		"conformance-coverage.json":                         mustConformanceCoverageManifest(model, "go"),
		"conformance/main.go":                               goConformance,
		"examples/signature_schema/main.go":                 goSignatureSchemaExample,
		"examples/axgen_fake_client_tool/main.go":           goAxGenFakeClientToolExample,
		"examples/axai_fake_transport/main.go":              goAxAIFakeTransportExample,
		"examples/axagent_pipeline/main.go":                 goAxAgentPipelineExample,
		"examples/runtime_adapter/main.go":                  goRuntimeAdapterExample,
		"examples/runtime_protocol/main.go":                 goRuntimeProtocolExample,
		"examples/runtime_profiles/javascript_goja/main.go": goJavaScriptGojaProfileExample,
		"examples/axflow_program_graph/main.go":             goAxFlowProgramGraphExample,
		"examples/optimizer_artifact/main.go":               goOptimizerArtifactExample,
		"README.md":                                         packageREADME(model, "go"),
	}
	return writeFiles(outDir, files)
}

func EmitRust(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildRustCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"Cargo.toml":                          renderPackageTemplate(rustCargoToml, version),
		"src/lib.rs":                          renderPackageTemplate(core, version),
		"src/bin/axllm-conformance.rs":        rustConformanceMain,
		"axir-capabilities.json":              mustCapabilityManifest(model, "rust"),
		"conformance-coverage.json":           mustConformanceCoverageManifest(model, "rust"),
		"examples/signature_schema.rs":        rustSignatureSchemaExample,
		"examples/provider_mapping_no_key.rs": rustProviderMappingNoKeyExample,
		"examples/provider_stream_no_key.rs":  rustProviderStreamNoKeyExample,
		"examples/axgen_fake_client_tool.rs":  rustAxGenFakeClientToolExample,
		"examples/axgen_openai_api.rs":        rustAxGenOpenAIExample,
		"examples/axagent_pipeline.rs":        rustAxAgentPipelineExample,
		"examples/axflow_program_graph.rs":    rustAxFlowProgramGraphExample,
		"examples/runtime_adapter.rs":         rustRuntimeAdapterExample,
		"examples/runtime_protocol.rs":        rustRuntimeProtocolExample,
		"examples/optimizer_artifact.rs":      rustOptimizerArtifactExample,
		"README.md":                           packageREADME(model, "rust"),
	}
	if err := writeFiles(outDir, files); err != nil {
		return err
	}
	return formatRustPackage(outDir)
}

func writeFiles(root string, files map[string]string) error {
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func formatRustPackage(outDir string) error {
	cargo, err := exec.LookPath("cargo")
	if err != nil {
		return nil
	}
	cmd := exec.Command(cargo, "fmt", "--manifest-path", filepath.Join(outDir, "Cargo.toml"))
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("format rust package: %w\n%s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func renderPackageTemplate(text, version string) string {
	return strings.ReplaceAll(text, "{{AX_VERSION}}", version)
}

func generatedPackageVersion() string {
	for _, key := range []string{"AX_PACKAGE_VERSION", "AXIR_PACKAGE_VERSION"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return normalizePackageVersion(value)
		}
	}
	if version, ok := findRootPackageVersion(); ok {
		return normalizePackageVersion(version)
	}
	return "0.1.0"
}

func findRootPackageVersion() (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		data, err := os.ReadFile(filepath.Join(dir, "package.json"))
		if err == nil {
			var pkg struct {
				Version string `json:"version"`
			}
			if json.Unmarshal(data, &pkg) == nil && strings.TrimSpace(pkg.Version) != "" {
				return pkg.Version, true
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

func normalizePackageVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		return "0.1.0"
	}
	if regexp.MustCompile(`^[0-9]+(\.[0-9]+){1,2}([a-zA-Z0-9.+-]*)?$`).MatchString(version) {
		return version
	}
	return "0.1.0"
}

type CapabilityManifest struct {
	AxIRVersion             string      `json:"axir_version"`
	Target                  string      `json:"target"`
	PackageName             string      `json:"package_name"`
	SupportedSuites         []string    `json:"supported_suites"`
	ProviderMode            string      `json:"provider_mode"`
	FakeTransportSupport    bool        `json:"fake_transport_support"`
	RealNetworkSupport      bool        `json:"real_network_support"`
	UnsupportedCapabilities []string    `json:"unsupported_capabilities,omitempty"`
	CoreOwnedFeatureGroups  []string    `json:"core_owned_feature_groups"`
	PublicSymbols           []string    `json:"public_symbols"`
	TargetIdiom             TargetIdiom `json:"target_idiom"`
}

type ConformanceCoverageManifest struct {
	AxIRVersion string                                `json:"axir_version"`
	Target      string                                `json:"target"`
	PackageName string                                `json:"package_name"`
	Suites      map[string][]ConformanceCoverageEntry `json:"suites"`
}

type ConformanceCoverageEntry struct {
	Suite     string `json:"suite"`
	Kind      string `json:"kind"`
	Operation string `json:"operation,omitempty"`
	Runner    string `json:"runner"`
	Category  string `json:"category"`
}

func BuildCapabilityManifest(model AxRuntimeModel, target string) (CapabilityManifest, error) {
	idiom, ok := model.TargetIdioms[target]
	if !ok {
		return CapabilityManifest{}, fmt.Errorf("unknown target %q", target)
	}
	realNetwork := target == "python" || target == "java" || target == "cpp" || target == "go" || target == "rust"
	publicSymbols := publicSymbolsForTarget(model, target)
	return CapabilityManifest{
		AxIRVersion:             "0.1",
		Target:                  target,
		PackageName:             packageNameForTarget(target),
		SupportedSuites:         []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow"},
		ProviderMode:            "provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic",
		FakeTransportSupport:    true,
		RealNetworkSupport:      realNetwork,
		UnsupportedCapabilities: nil,
		CoreOwnedFeatureGroups: []string{
			"signature",
			"schema",
			"validation",
			"prompt",
			"stream",
			"axgen",
			"axgen-examples-demos",
			"axgen-memory",
			"axgen-chat-log",
			"axgen-examples-exact",
			"axgen-context-cache",
			"axgen-callbacks",
			"axgen-function-trace",
			"axgen-assertions",
			"axgen-field-processors",
			"axgen-trace",
			"axgen-stop-functions",
			"cache-aware-prompt-inputs",
			"axai",
			"axai-provider-descriptor-registry",
			"axai-provider-alias-registry",
			"axai-model-catalog-audit",
			"axai-provider-routing-audit",
			"axai-model-catalog-runtime-api",
			"axai-multi-service-routing",
			"axai-provider-routing-analysis",
			"axai-balancer-runtime",
			"axai-balancer-retry-policy",
			"axai-balancer-metrics",
			"axai-host-processing-callbacks",
			"openai-compatible-provider-mapping",
			"provider-operation-descriptors",
			"openai-responses-provider-mapping",
			"google-gemini-provider-mapping",
			"gemini-media-content-mapping",
			"gemini-tool-schema-mapping",
			"gemini-stream-folding",
			"gemini-usage-normalization",
			"gemini-embeddings-normalization",
			"anthropic-provider-mapping",
			"anthropic-cache-control-mapping",
			"anthropic-thinking-normalization",
			"anthropic-stream-folding",
			"anthropic-usage-normalization",
			"openai-audio-normalization",
			"openai-realtime-normalization",
			"axagent",
			"axagent-pipeline",
			"axagent-context-fields",
			"axagent-clarification",
			"axagent-chat-log",
			"axagent-state-alpha",
			"axagent-runtime-contract",
			"axagent-discovery-policy",
			"axagent-delegation-policy",
			"axagent-optimizer-metadata",
			"axagent-runtime-session",
			"axagent-agent-test",
			"axagent-runtime-state-restore",
			"axagent-runtime-host-boundary",
			"axagent-runtime-error-envelopes",
			"axagent-runtime-state-contract",
			"axagent-runtime-restart-policy",
			"axagent-runtime-trace-events",
			"axagent-runtime-adapter-helpers",
			"axagent-runtime-adapter-examples",
			"axagent-runtime-capability-negotiation",
			"axagent-runtime-lifecycle-beta",
			"axagent-runtime-cancellation-contract",
			"axagent-runtime-restart-once",
			"axagent-runtime-process-diagnostics",
			"axagent-runtime-profile-javascript-quickjs",
			"axagent-runtime-quickjs-session-state",
			"axagent-runtime-quickjs-host-calls",
			"axagent-runtime-quickjs-native-host-calls",
			"axagent-runtime-quickjs-callback-errors",
			"axagent-runtime-quickjs-limits",
			"axagent-runtime-quickjs-diagnostics",
			"axagent-runtime-profile-python-pyodide",
			"axagent-runtime-pyodide-session-state",
			"axagent-runtime-pyodide-host-calls",
			"axagent-runtime-pyodide-diagnostics",
			"axagent-runtime-profile-parity",
			"axagent-runtime-axjs-reference",
			"axagent-runtime-profile-state-parity",
			"axagent-runtime-profile-diagnostics",
			"axagent-runtime-profile-agent-forward",
			"axagent-runtime-profile-actor-loop",
			"axagent-runtime-profile-productization-alpha",
			"axagent-runtime-profile-policy",
			"axagent-runtime-profile-package-policy",
			"axagent-runtime-profile-javascript-goja",
			"axagent-runtime-goja-session-state",
			"axagent-runtime-goja-host-calls",
			"axagent-runtime-goja-policy",
			"axagent-runtime-goja-diagnostics",
			"axagent-actor-step-alpha",
			"axagent-runtime-language",
			"axagent-actor-prompt-cache",
			"axagent-context-cache-precedence",
			"axagent-context-budget",
			"axagent-checkpointing",
			"axagent-action-log-compaction",
			"axagent-runtime-state-summary",
			"axagent-context-events",
			"axagent-executor-model-policy",
			"axagent-policy-registry",
			"axagent-policy-vocabulary-registry",
			"axagent-context-policy-registry",
			"axagent-policy-versioning",
			"axagent-dynamic-primitives",
			"axagent-host-boundaries",
			"axagent-policy-trace",
			"axagent-policy-execution",
			"axagent-tool-discovery",
			"axagent-skill-discovery",
			"axagent-memory-recall",
			"axagent-usage-tracking",
			"axagent-child-delegation",
			"axagent-guidance-protocol",
			"axagent-trace-export",
			"axagent-deterministic-replay",
			"axagent-host-boundary-contract",
			"axagent-optimizer-trace-artifact",
			"axoptimize-contract",
			"axoptimize-engine-boundary",
			"axoptimize-artifacts",
			"axoptimize-agent-eval",
			"axoptimize-prompt-components",
			"axoptimize-evaluator-boundary",
			"axoptimize-candidate-rollouts",
			"axoptimize-metric-scoring",
			"axoptimize-judge-payloads",
			"axoptimize-state-isolation",
			"axoptimize-gepa-engine",
			"axoptimize-gepa-reflection",
			"axoptimize-gepa-pareto",
			"axoptimize-gepa-bootstrap",
			"axoptimize-gepa-selector-state",
			"axprogram-contract",
			"axprogram-trace-events",
			"axflow-program-graph",
			"axflow-program-contract",
			"axflow-shared-executor",
			"axflow-auto-parallel-barriers",
			"axflow-actual-input-cache-key",
			"axflow-optimizer-components",
			"axflow-execution-runtime",
			"axflow-child-program-aggregation",
			"axflow-cache-runtime",
			"axflow-dynamic-options",
			"axflow-abort-boundary",
			"axflow-control-flow-runtime",
			"axflow-feedback-loop",
			"axflow-branch-runtime",
			"axflow-node-extension-helpers",
			"axflow-streaming-cache",
			"axflow-stop-inflight",
			"axflow-parallel-merge-errors",
			"axflow-optimization-components",
			"axflow-optimization-apply",
			"axflow-optimization-evaluation",
			"axflow-nested-component-paths",
			"axflow-optimization-rollback",
		},
		PublicSymbols: publicSymbols,
		TargetIdiom:   idiom,
	}, nil
}

func BuildConformanceCoverageManifest(model AxRuntimeModel, target string) (ConformanceCoverageManifest, error) {
	manifest, err := BuildCapabilityManifest(model, target)
	if err != nil {
		return ConformanceCoverageManifest{}, err
	}
	suites := map[string][]ConformanceCoverageEntry{}
	add := func(suite, kind, operation, category string) {
		suites[suite] = append(suites[suite], ConformanceCoverageEntry{
			Suite:     suite,
			Kind:      kind,
			Operation: operation,
			Runner:    conformanceCoverageRunner(target, suite, kind, operation),
			Category:  category,
		})
	}
	for _, entry := range []struct {
		suite     string
		kind      string
		operation string
		category  string
	}{
		{"signature", "signature", "", "semantic"},
		{"signature", "signature_error", "", "validation-error"},
		{"schema", "json_schema", "", "semantic"},
		{"validation", "validate_output", "", "semantic"},
		{"validation", "validate_value", "", "semantic"},
		{"validation", "strip_internal", "", "semantic"},
		{"prompt", "prompt", "", "semantic"},
		{"prompt", "template", "", "semantic"},
		{"prompt", "template_error", "", "validation-error"},
		{"prompt", "template_validate", "", "semantic"},
		{"axgen", "forward", "", "semantic"},
		{"axgen", "stream", "", "semantic"},
		{"axai", "ai_chat", "", "transport-boundary"},
		{"axai", "ai_stream", "", "transport-boundary"},
		{"axai", "ai_embed", "", "transport-boundary"},
		{"axai", "ai_transcribe", "", "transport-boundary"},
		{"axai", "ai_speak", "", "transport-boundary"},
		{"axai", "ai_realtime", "", "semantic"},
		{"axai", "ai_provider_descriptor", "", "semantic"},
		{"axai", "ai_provider_registry", "", "semantic"},
		{"axai", "ai_model_catalog_audit", "", "semantic"},
		{"axai", "ai_model_catalog_runtime", "", "semantic"},
		{"axai", "ai_multiservice_router", "", "transport-boundary"},
		{"axai", "ai_provider_router", "", "transport-boundary"},
		{"axai", "ai_balancer", "", "transport-boundary"},
		{"axai", "ai_error", "", "validation-error"},
		{"axai", "ai_unsupported", "", "validation-error"},
		{"axagent", "agent_forward", "", "semantic"},
		{"axagent", "agent_runtime_adapter", "", "semantic"},
		{"axagent", "agent_runtime_policy", "", "semantic"},
		{"axagent", "agent_runtime_protocol", "", "transport-boundary"},
		{"axagent", "agent_runtime_session", "", "semantic"},
		{"axflow", "flow", "", "semantic"},
		{"axflow", "flow", "plan", "semantic"},
		{"axflow", "flow", "cache_key", "semantic"},
		{"axflow", "flow", "streaming", "semantic"},
		{"axprogram", "program_contract", "", "semantic"},
		{"axoptimize", "optimize", "components", "semantic"},
		{"axoptimize", "optimize", "filter", "semantic"},
		{"axoptimize", "optimize", "apply", "semantic"},
		{"axoptimize", "optimize", "artifact", "semantic"},
		{"axoptimize", "optimize", "dataset", "semantic"},
		{"axoptimize", "optimize", "score", "semantic"},
		{"axoptimize", "optimize", "judge_payload", "semantic"},
		{"axoptimize", "optimize", "evidence", "semantic"},
		{"axoptimize", "optimize", "evaluate", "semantic"},
		{"axoptimize", "optimize", "engine", "semantic"},
		{"axoptimize", "optimize", "gepa", "semantic"},
		{"axoptimize", "optimize", "eval", "semantic"},
	} {
		add(entry.suite, entry.kind, entry.operation, entry.category)
	}
	return ConformanceCoverageManifest{
		AxIRVersion: manifest.AxIRVersion,
		Target:      target,
		PackageName: manifest.PackageName,
		Suites:      suites,
	}, nil
}

func conformanceCoverageRunner(target, suite, kind, operation string) string {
	base := suite
	if operation != "" {
		base += "." + operation
	}
	switch target {
	case "python":
		return "python:" + base
	case "java":
		return "java:" + base
	case "cpp":
		return "cpp:" + base
	case "go":
		return "go:" + base
	case "rust":
		return "rust:" + base
	default:
		return target + ":" + kind
	}
}

func ValidateConformanceCoverage(manifest CapabilityManifest, coverage ConformanceCoverageManifest) error {
	if coverage.Target != manifest.Target {
		return fmt.Errorf("conformance coverage target %q does not match capability manifest target %q", coverage.Target, manifest.Target)
	}
	if coverage.PackageName != manifest.PackageName {
		return fmt.Errorf("conformance coverage package %q does not match capability manifest package %q", coverage.PackageName, manifest.PackageName)
	}
	if coverage.AxIRVersion != manifest.AxIRVersion {
		return fmt.Errorf("conformance coverage axir_version %q does not match capability manifest axir_version %q", coverage.AxIRVersion, manifest.AxIRVersion)
	}
	allowedCategories := map[string]bool{
		"semantic":               true,
		"validation-error":       true,
		"transport-boundary":     true,
		"explicitly-not-claimed": true,
	}
	for suite, entries := range coverage.Suites {
		for _, entry := range entries {
			if entry.Suite != suite {
				return fmt.Errorf("conformance coverage entry kind %q records suite %q under suite %q", entry.Kind, entry.Suite, suite)
			}
			if strings.TrimSpace(entry.Kind) == "" {
				return fmt.Errorf("conformance coverage suite %q has an entry with empty kind", suite)
			}
			if strings.TrimSpace(entry.Runner) == "" {
				return fmt.Errorf("conformance coverage suite %q kind %q has empty runner", suite, entry.Kind)
			}
			if entry.Category == "presence-only" {
				return fmt.Errorf("conformance coverage suite %q kind %q is presence-only; claimed suites require semantic validation", suite, entry.Kind)
			}
			if !allowedCategories[entry.Category] {
				return fmt.Errorf("conformance coverage suite %q kind %q has unsupported category %q", suite, entry.Kind, entry.Category)
			}
		}
	}
	for _, suite := range manifest.SupportedSuites {
		entries := coverage.Suites[suite]
		if len(entries) == 0 {
			return fmt.Errorf("conformance coverage missing claimed suite %q", suite)
		}
		hasClaimedRunner := false
		for _, entry := range entries {
			if entry.Category != "explicitly-not-claimed" {
				hasClaimedRunner = true
				break
			}
		}
		if !hasClaimedRunner {
			return fmt.Errorf("conformance coverage suite %q is claimed but only explicitly-not-claimed entries exist", suite)
		}
	}
	return nil
}

func publicSymbolsForTarget(model AxRuntimeModel, target string) []string {
	symbols := append([]string(nil), model.PublicSymbols...)
	if target != "rust" {
		return symbols
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(symbols)+4)
	for _, symbol := range symbols {
		if symbol == "fn" {
			symbol = "tool"
		}
		if seen[symbol] {
			continue
		}
		seen[symbol] = true
		out = append(out, symbol)
	}
	for _, symbol := range []string{"AxError", "AxResult", "FakeTransport"} {
		if !seen[symbol] {
			out = append(out, symbol)
		}
	}
	return out
}

func CapabilityManifestJSON(model AxRuntimeModel, target string) (string, error) {
	manifest, err := BuildCapabilityManifest(model, target)
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

func ConformanceCoverageManifestJSON(model AxRuntimeModel, target string) (string, error) {
	coverage, err := BuildConformanceCoverageManifest(model, target)
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(coverage, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

func mustCapabilityManifest(model AxRuntimeModel, target string) string {
	text, err := CapabilityManifestJSON(model, target)
	if err != nil {
		panic(err)
	}
	return text
}

func mustConformanceCoverageManifest(model AxRuntimeModel, target string) string {
	text, err := ConformanceCoverageManifestJSON(model, target)
	if err != nil {
		panic(err)
	}
	return text
}

func packageNameForTarget(target string) string {
	switch target {
	case "python":
		return "axllm"
	case "java":
		return "dev.axllm:ax"
	case "cpp":
		return "axllm"
	case "go":
		return "github.com/ax-llm/ax/go"
	case "rust":
		return "axllm"
	default:
		return target
	}
}

type packageReadmeConfig struct {
	Title            string
	Language         string
	Intro            string
	Install          string
	QuickStart       string
	PackageFacts     string
	NoKeyExamples    string
	ProviderExamples string
	RuntimeProfiles  string
}

func packageREADME(model AxRuntimeModel, target string) string {
	manifest, err := BuildCapabilityManifest(model, target)
	if err != nil {
		panic(err)
	}
	network := "available"
	if target == "cpp" {
		network = "available through the built-in libcurl HttpTransport when the CMake package finds CURL; custom Transport remains supported"
	} else if !manifest.RealNetworkSupport {
		network = "not implemented; use the fake transport/Transport boundary"
	}
	cfg := packageReadmeConfigForTarget(target, network)
	return readmeLines(
		"# "+cfg.Title,
		"",
		cfg.Intro,
		"",
		"## Quick Start",
		"",
		cfg.Install,
		"",
		cfg.QuickStart,
		"",
		"## What You Can Build",
		"",
		"- Signatures and schemas: describe inputs and outputs once, then reuse that shape for validation, prompts, tools, and typed results.",
		"- AxGen: run structured generation with retries, tool calls, field processors, assertions, traces, usage, and provider-backed output parsing.",
		"- AxAI: call OpenAI-compatible, OpenAI Responses, Gemini, Anthropic, Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, and Grok clients through one provider boundary.",
		"- AxAgent and RLM: let an agent plan and execute actor-code steps while Ax keeps envelopes, state, logs, traces, context, discovery, recall, and final typed responses aligned.",
		"- AxFlow: compose AxGen, AxAgent, and nested flows into a portable program graph.",
		"- Optimizers: save, load, apply, and evaluate optimizer artifacts, including the generated GEPA engine.",
		"",
		"## Package Shape",
		"",
		cfg.PackageFacts,
		"",
		"Shared Ax behavior is Core-owned. The generated target code stays focused on idiomatic wrappers, transports, dynamic value helpers, and host-runtime boundaries.",
		"",
		"## Examples",
		"",
		"`no-key` examples are deterministic local smokes. They are the fastest way to see the package work without any provider account:",
		"",
		cfg.NoKeyExamples,
		"",
		"`provider-api` examples make a real provider call and require `OPENAI_API_KEY` or `OPENAI_APIKEY`:",
		"",
		cfg.ProviderExamples,
		"",
		"## Runtime Profiles And RLM Agents",
		"",
		"AxAgent uses an RLM executor loop. On each turn, the model writes a small actor-code step, and Ax sends that step into an `AxCodeRuntime` session. Think of the runtime as the agent's REPL: it keeps session state, exposes safe host callbacks, returns envelopes such as `final(...)`, `askClarification(...)`, `discover(...)`, `recall(...)`, and `used(...)`, and lets the agent continue from the result.",
		"",
		"The TypeScript package ships `AxJSRuntime` as the reference JavaScript implementation of that REPL contract. Generated runtime profiles are adapters for the same `AxCodeRuntime` / `AxCodeSession` boundary. They exist so RLM agents can execute actor code in a host runtime that fits the target package.",
		"",
		"This package is not a TypeScript transpiler. AxIR compiles shared Ax semantics into native package code; it does not run your original Ax TypeScript application inside a "+cfg.Language+" runtime. Application code is still written in the language you are using here.",
		"",
		cfg.RuntimeProfiles,
		"",
		"Optional runtime profiles are dependency-bearing and opt-in. Adapter policy owns sandboxing, dependency loading, hard cancellation, process security, and host permissions. The shared Ax contract still owns envelopes, state, logs, traces, and the model-visible protocol.",
		"",
		"## Contract Snapshot",
		"",
		fmt.Sprintf("- Compiler contract version: %s", manifest.AxIRVersion),
		fmt.Sprintf("- Package: %s", manifest.PackageName),
		fmt.Sprintf("- Supported conformance suites: %s", strings.Join(manifest.SupportedSuites, ", ")),
		fmt.Sprintf("- Provider mode: %s", manifest.ProviderMode),
		fmt.Sprintf("- Fake transport support: %t", manifest.FakeTransportSupport),
		fmt.Sprintf("- Real network support: %s", network),
	) + "\n"
}

func packageReadmeConfigForTarget(target string, network string) packageReadmeConfig {
	switch target {
	case "python":
		return packageReadmeConfig{
			Title:    "Ax for Python",
			Language: "Python",
			Intro:    "Build Ax programs from Python without giving up the Ax model: typed signatures, structured generation, provider routing, RLM agents, flows, and optimizer artifacts all come from the same shared compiler contract. The package feels like Python, but the behavior stays aligned with the main Ax implementation.",
			Install: readmeLines(
				"```bash",
				"cd packages/python",
				"python -m pip install -e .",
				"PYTHONPATH=. python examples/signature_schema.py",
				"```",
			),
			QuickStart: readmeLines(
				"```python",
				"from axllm import s",
				"",
				"sig = s(\"question:string -> answer:string\")",
				"schema = sig.to_json_schema(\"outputs\")",
				"assert \"answer\" in schema[\"properties\"]",
				"```",
			),
			PackageFacts: readmeLines(
				"- Import package: `axllm`",
				"- Distribution metadata: `pyproject.toml`, `MANIFEST.in`, and `axllm/py.typed`",
				"- Base dependencies: none",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `python examples/signature_schema.py`: signature parsing and JSON schema generation",
				"- `python examples/axgen_fake_client_tool.py`: AxGen with a fake client and tool",
				"- `python examples/axai_fake_transport.py`: provider mapping through a fake transport",
				"- `python examples/axagent_pipeline.py`: deterministic AxAgent pipeline",
				"- `python examples/axflow_program_graph.py`: AxFlow program graph",
				"- `python examples/runtime_adapter.py`: custom `AxCodeRuntime` session",
				"- `python examples/runtime_protocol.py`: process runtime protocol against the AxJS reference adapter",
				"- `python examples/optimizer_artifact.py`: optimizer artifact save/load/apply lifecycle",
			),
			ProviderExamples: "- `OPENAI_API_KEY=... python examples/axgen_openai_api.py`: AxGen with a real OpenAI-compatible provider API",
			RuntimeProfiles: readmeLines(
				"Optional profile files in this package:",
				"",
				"- `javascript-quickjs`: JavaScript actor code through a QuickJS protocol server via `ProcessCodeRuntime`.",
				"- `python-pyodide`: Python actor code through a Pyodide JSONL protocol server.",
				"",
				"See `examples/runtime_profiles/README.md` for setup, policy, and verification details.",
			),
		}
	case "java":
		return packageReadmeConfig{
			Title:    "Ax for Java",
			Language: "Java",
			Intro:    "Bring Ax into Java services and JVM applications with a small native API: signatures, structured generation, providers, RLM agents, flows, and optimizer artifacts are generated from the shared Ax compiler contract and exposed as ordinary Java classes.",
			Install: readmeLines(
				"```bash",
				"cd packages/java",
				"javac -cp . dev/axllm/ax/*.java examples/SignatureSchemaExample.java",
				"java -cp .:examples SignatureSchemaExample",
				"```",
			),
			QuickStart: readmeLines(
				"```java",
				"import dev.axllm.ax.*;",
				"import java.util.*;",
				"",
				"AxSignature sig = Ax.s(\"question:string -> answer:string\");",
				"Map<String, Object> schema = sig.toJsonSchema(\"outputs\", Map.of());",
				"System.out.println(schema.get(\"properties\"));",
				"```",
			),
			PackageFacts: readmeLines(
				"- Java package: `dev.axllm.ax`",
				"- Maven artifact metadata: `dev.axllm:ax`",
				"- Build metadata: `pom.xml`, `build.gradle`, and `settings.gradle`",
				"- Optional QuickJS4J metadata stays under `examples/runtime_profiles/`",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `examples/SignatureSchemaExample.java`: signature parsing and JSON schema generation",
				"- `examples/AxGenFakeClientToolExample.java`: AxGen with a fake client and tool",
				"- `examples/AxAIFakeTransportExample.java`: provider mapping through a fake transport",
				"- `examples/AxAgentPipelineExample.java`: deterministic AxAgent pipeline",
				"- `examples/AxFlowProgramGraphExample.java`: AxFlow program graph",
				"- `examples/RuntimeAdapterExample.java`: custom `AxCodeRuntime` session",
				"- `examples/RuntimeProtocolExample.java`: process runtime protocol against the AxJS reference adapter",
				"- `examples/OptimizerArtifactExample.java`: optimizer artifact save/load/apply lifecycle",
			),
			ProviderExamples: "- `OPENAI_API_KEY=... javac -cp . dev/axllm/ax/*.java examples/AxGenOpenAIExample.java && java -cp .:examples AxGenOpenAIExample`: AxGen with a real OpenAI-compatible provider API",
			RuntimeProfiles: readmeLines(
				"Optional profile files in this package:",
				"",
				"- `javascript-quickjs`: JavaScript actor code in QuickJS4J.",
				"- `python-pyodide`: Python actor code through a Pyodide JSONL protocol server.",
				"",
				"See `examples/runtime_profiles/README.md` for setup, policy, and verification details.",
			),
		}
	case "cpp":
		return packageReadmeConfig{
			Title:    "Ax for C++",
			Language: "C++",
			Intro:    "Use Ax from C++ when you want structured LLM programs close to your runtime: signatures, typed dynamic values, provider transports, RLM agents, flows, and optimizer artifacts are generated into a compact C++17 library.",
			Install: readmeLines(
				"```bash",
				"cd packages/cpp",
				"cmake -S . -B build",
				"cmake --build build",
				"./build/signature_schema",
				"```",
			),
			QuickStart: readmeLines(
				"```cpp",
				"#include \"axllm/axllm.hpp\"",
				"",
				"auto sig = axllm::s(\"question:string -> answer:string\");",
				"auto schema = axllm::to_json_schema(axllm::Core::get(sig, \"outputs\"));",
				"```",
			),
			PackageFacts: readmeLines(
				"- Library target: `axllm::axllm`",
				"- Public files: `axllm/axllm.hpp`, `axllm/axllm.cpp`, and `CMakeLists.txt`",
				"- Built-in HTTP transport: enabled when CMake finds CURL; custom `Transport` remains supported",
				"- Optional QuickJS sources are not part of the default CMake build",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `examples/signature_schema.cpp`: signature parsing and JSON schema generation",
				"- `examples/axgen_fake_client_tool.cpp`: AxGen with a fake client and tool",
				"- `examples/axai_fake_transport.cpp`: provider mapping through a fake transport",
				"- `examples/axagent_pipeline.cpp`: deterministic AxAgent pipeline",
				"- `examples/axflow_program_graph.cpp`: AxFlow program graph",
				"- `examples/runtime_adapter.cpp`: custom `AxCodeRuntime` session",
				"- `examples/runtime_protocol.cpp`: process runtime protocol against the AxJS reference adapter",
				"- `examples/optimizer_artifact.cpp`: optimizer artifact save/load/apply lifecycle",
			),
			ProviderExamples: "- `OPENAI_API_KEY=... ./build/axgen_openai_api`: AxGen with a real OpenAI-compatible provider API after building examples",
			RuntimeProfiles: readmeLines(
				"Optional profile files in this package:",
				"",
				"- `javascript-quickjs`: JavaScript actor code through the QuickJS C API.",
				"- `python-pyodide`: Python actor code through a Pyodide JSONL protocol server.",
				"",
				"See `examples/runtime_profiles/README.md` for setup, policy, and verification details.",
			),
		}
	case "go":
		return packageReadmeConfig{
			Title:    "Ax for Go",
			Language: "Go",
			Intro:    "Write Ax programs in Go with the same contract used by the main Ax library: signatures, structured generation, provider clients, RLM agents, flows, and optimizer artifacts compiled into a native Go module.",
			Install: readmeLines(
				"```bash",
				"cd packages/go",
				"go test ./...",
				"go run ./examples/signature_schema",
				"```",
			),
			QuickStart: readmeLines(
				"```go",
				"package main",
				"",
				"import ax \"github.com/ax-llm/ax/go\"",
				"",
				"func main() {",
				"    sig := ax.NewSignature(\"question:string -> answer:string\")",
				"    _ = sig.ToJSONSchema(nil)",
				"}",
				"```",
			),
			PackageFacts: readmeLines(
				"- Module: `github.com/ax-llm/ax/go`",
				"- Import alias used in examples: `ax`",
				"- Base package uses the Go standard library for HTTP/process boundaries",
				"- Optional JavaScript actor execution lives in `runtime/goja` and is opt-in by import",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `go run ./examples/signature_schema`: signature parsing and JSON schema generation",
				"- `go run ./examples/axgen_fake_client_tool`: AxGen with a fake client and tool",
				"- `go run ./examples/axai_fake_transport`: provider mapping through a fake transport",
				"- `go run ./examples/axagent_pipeline`: deterministic AxAgent pipeline",
				"- `go run ./examples/axflow_program_graph`: AxFlow program graph",
				"- `go run ./examples/runtime_adapter`: custom `AxCodeRuntime` session",
				"- `go run ./examples/runtime_protocol`: process runtime protocol against the AxJS reference adapter",
				"- `go run ./examples/optimizer_artifact`: optimizer artifact save/load/apply lifecycle",
			),
			ProviderExamples: "- From the repo root, `OPENAI_API_KEY=... npm run example -- go axgen_openai_api.go`: AxGen with a real OpenAI-compatible provider API",
			RuntimeProfiles: readmeLines(
				"Optional profile files in this package:",
				"",
				"- `javascript-goja`: Go-native JavaScript actor code through the generated `runtime/goja` package.",
				"",
				"Verify it with `axir verify --targets go --runtime-profiles javascript-goja` when the AxIR toolchain is available.",
			),
		}
	case "rust":
		return packageReadmeConfig{
			Title:    "Ax for Rust",
			Language: "Rust",
			Intro:    "Write Ax programs in Rust with native Result-based errors, serde_json dynamic values at Ax boundaries, blocking provider transport, protocol-first RLM runtime sessions, and shared Ax semantics generated from the compiler contract.",
			Install: readmeLines(
				"```bash",
				"cd packages/rust",
				"cargo test --all-targets",
				"cargo run --example signature_schema",
				"```",
			),
			QuickStart: readmeLines(
				"```rust",
				"use axllm::{s, AxResult};",
				"",
				"fn main() -> AxResult<()> {",
				"    let sig = s(\"question:string -> answer:string\")?;",
				"    let schema = sig.to_json_schema(\"outputs\");",
				"    assert!(schema[\"properties\"].get(\"answer\").is_some());",
				"    Ok(())",
				"}",
				"```",
			),
			PackageFacts: readmeLines(
				"- Crate: `axllm`",
				"- Dynamic value boundary: `serde_json::Value`",
				"- Error boundary: `Result<T, AxError>`",
				"- Built-in HTTP transport: blocking `reqwest` with rustls TLS",
				"- Runtime execution: process/JSONL protocol through `ProcessCodeRuntime`; no embedded JS engine in the base crate",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `cargo run --example signature_schema`: signature parsing and JSON schema generation",
				"- `cargo run --example provider_mapping_no_key`: provider mapping through a fake transport",
				"- `cargo run --example provider_stream_no_key`: provider streaming through a fake SSE transport",
				"- `cargo run --example axgen_fake_client_tool`: AxGen with a fake client and tool",
				"- `cargo run --example axagent_pipeline`: deterministic AxAgent pipeline",
				"- `cargo run --example axflow_program_graph`: AxFlow program graph",
				"- `cargo run --example runtime_adapter`: custom `AxCodeRuntime` session",
				"- `cargo run --example runtime_protocol`: process runtime protocol against the AxJS reference adapter",
				"- `cargo run --example optimizer_artifact`: optimizer artifact lifecycle smoke",
			),
			ProviderExamples: "- `OPENAI_API_KEY=... cargo run --example axgen_openai_api`: AxGen with a real OpenAI-compatible provider API",
			RuntimeProfiles: readmeLines(
				"This package is protocol-first for RLM actor execution:",
				"",
				"- `ProcessCodeRuntime` speaks the shared AxCodeRuntime JSONL protocol.",
				"- Embedded JavaScript engines such as QuickJS/V8 are intentionally deferred from the v1 Rust backend.",
			),
		}
	default:
		return packageReadmeConfig{
			Title:            "Ax for " + target,
			Language:         target,
			Intro:            "Build Ax programs in this generated language package with shared Ax semantics.",
			Install:          "",
			QuickStart:       "",
			PackageFacts:     "- Package: `" + packageNameForTarget(target) + "`\n- Network support: " + network,
			NoKeyExamples:    "- See `examples/`.",
			ProviderExamples: "- Set `OPENAI_API_KEY` before running provider API examples.",
			RuntimeProfiles:  "- See `examples/runtime_profiles/` when present.",
		}
	}
}

func readmeLines(lines ...string) string {
	return strings.Join(lines, "\n")
}
