package axir

import (
	"encoding/json"
	"fmt"
	"os"
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
		"examples/signature_schema.py":                          pySignatureSchemaExample,
		"examples/axgen_fake_client_tool.py":                    pyAxGenFakeClientToolExample,
		"examples/axgen_live_openai.py":                         pyAxGenLiveOpenAIExample,
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
		"examples/SignatureSchemaExample.java":                        javaSignatureSchemaExample,
		"examples/AxGenFakeClientToolExample.java":                    javaAxGenFakeClientToolExample,
		"examples/AxGenLiveOpenAIExample.java":                        javaAxGenLiveOpenAIExample,
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
		"examples/signature_schema.cpp":                         cppSignatureSchemaExample,
		"examples/axgen_fake_client_tool.cpp":                   cppAxGenFakeClientToolExample,
		"examples/axgen_live_openai.cpp":                        cppAxGenLiveOpenAIExample,
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
	UnsupportedCapabilities []string    `json:"unsupported_capabilities"`
	CoreOwnedFeatureGroups  []string    `json:"core_owned_feature_groups"`
	PublicSymbols           []string    `json:"public_symbols"`
	TargetIdiom             TargetIdiom `json:"target_idiom"`
}

func BuildCapabilityManifest(model AxRuntimeModel, target string) (CapabilityManifest, error) {
	idiom, ok := model.TargetIdioms[target]
	if !ok {
		return CapabilityManifest{}, fmt.Errorf("unknown target %q", target)
	}
	unsupported := []string{
		"OpenTelemetry",
		"live realtime transport",
		"real multipart audio upload transport",
	}
	realNetwork := target == "python" || target == "java" || target == "cpp"
	return CapabilityManifest{
		AxIRVersion:             "0.1",
		Target:                  target,
		PackageName:             packageNameForTarget(target),
		SupportedSuites:         []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow"},
		ProviderMode:            "provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic",
		FakeTransportSupport:    true,
		RealNetworkSupport:      realNetwork,
		UnsupportedCapabilities: unsupported,
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
		PublicSymbols: append([]string(nil), model.PublicSymbols...),
		TargetIdiom:   idiom,
	}, nil
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

func mustCapabilityManifest(model AxRuntimeModel, target string) string {
	text, err := CapabilityManifestJSON(model, target)
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
	default:
		return target
	}
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
	return fmt.Sprintf(`# Generated Ax %s Library

Generated from shared Ax compiler modules.

## Contract

- Compiler contract version: %s
- Package: %s
- Supported conformance suites: %s
- Provider mode: %s
- Fake transport support: %t
- Real network support: %s

The deterministic Ax runtime semantics are Core-owned. Target-owned code is
limited to idiomatic wrappers, transport boundaries, and language primitives.

## Packaging

- Python emits `+"`pyproject.toml`"+`, `+"`MANIFEST.in`"+`, package import `+"`axllm`"+`, and
  `+"`axllm/py.typed`"+`. The default distribution metadata name is
  `+"`axllm`"+`.
- Java emits package `+"`dev.axllm.ax`"+`, base Maven/Gradle metadata for
  `+"`dev.axllm:ax`"+`, and keeps QuickJS4J metadata isolated under
  `+"`examples/runtime_profiles/`"+`.
	- C++ emits `+"`axllm/axllm.hpp`"+`, `+"`axllm/axllm.cpp`"+`, and `+"`CMakeLists.txt`"+` with target
	  `+"`axllm::axllm`"+`. The generated CMake package enables a built-in libcurl
	  HTTP transport when CURL is available. Optional QuickJS sources are not part of
	  the default CMake build.

## Examples

See the files in `+"`examples/`"+` for:

- signature parsing and JSON schema generation
- AxGen forward with a fake client and tool
- AxGen forward with a live OpenAI-compatible provider when `+"`OPENAI_API_KEY`"+` is set
- AxAI/OpenAI-compatible mapping with a fake transport
- AxAgent pipeline alpha with a fake service
- Runtime adapter helpers and custom `+"`AxCodeRuntime`"+` implementation
- Runtime protocol client against the AxJS reference adapter
- Optional JavaScript QuickJS runtime profile files
- Optional Python Pyodide runtime profile files
- AxFlow program graph with child Ax programs
- Optimizer artifact save/load/apply lifecycle

## Optional Runtime Profiles

The TypeScript `+"`AxJSRuntime`"+` remains the canonical JavaScript host runtime
reference for AxAgent actor sessions. Generated runtime profiles are portability
proofs against that same contract; the compiler does not emit separate Node, Deno, or
Bun profiles because those are the existing TypeScript implementation surface.

- `+"`javascript-quickjs`"+`: JavaScript actor code through QuickJS. Java uses
  QuickJS4J (`+"`io.roastedroot:quickjs4j`"+`); C++ uses the QuickJS C API; Python
  drives a QuickJS protocol server through `+"`ProcessCodeRuntime`"+`. This profile
  is dependency-bearing and is verified only when its toolchain environment
  variables are supplied. Java profile verification accepts
  `+"`AXIR_QUICKJS4J_CP`"+`, `+"`AXIR_QUICKJS4J_CP_FILE`"+`, or
  `+"`AXIR_QUICKJS4J_RESOLVE=1`"+` to resolve the classpath with the generated
  Maven helper. Python profile verification accepts `+"`AXIR_QUICKJS_RUNTIME_SERVER`"+`
  directly, or auto-starts the generated Java QuickJS4J protocol server when the
  QuickJS4J classpath is available.
- `+"`python-pyodide`"+`: Python actor code through a Pyodide JSONL protocol
  server. Python, Java, and C++ generated runtimes all use the existing runtime
  protocol boundary for this alpha; no host-native Python interpreter is
  embedded in the generated packages. Verification accepts
  `+"`AXIR_PYODIDE_RUNTIME_SERVER`"+` directly, or `+"`AXIR_PYODIDE_RESOLVE=1`"+`
  to install/resolve Pyodide with the generated npm helper.

Both optional profiles expose a JSON-compatible runtime policy surface. The
generated `+"`quickjs-runtime-policy.json`"+` and `+"`pyodide-runtime-policy.json`"+`
files document conservative defaults: filesystem, network, process/native host
access, and package loading are disabled unless profile adapter code explicitly
supports and enables them. The shared Ax compiler contract still owns envelopes,
state, logs, and traces; adapter policy owns sandboxing, dependency loading,
hard cancellation, and process security.
`, strings.ToUpper(target), manifest.AxIRVersion, manifest.PackageName, strings.Join(manifest.SupportedSuites, ", "), manifest.ProviderMode, manifest.FakeTransportSupport, network)
}
