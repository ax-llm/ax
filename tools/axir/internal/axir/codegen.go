package axir

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var generatedPackageLegacyFixtureWord = "fa" + "ke"
var generatedPackageLegacyFixturePattern = regexp.MustCompile(`(?i)` + regexp.QuoteMeta(generatedPackageLegacyFixtureWord))

func Compile(bundle Bundle, target, outDir string) error {
	if ds := Check(bundle); ds.HasErrors() {
		return ds
	}
	core := LowerToCore(bundle)
	model, err := BuildRuntimeModel(core)
	if err != nil {
		return err
	}
	var emitErr error
	switch target {
	case "python":
		emitErr = EmitPython(model, outDir)
	case "java":
		emitErr = EmitJava(model, outDir)
	case "cpp":
		emitErr = EmitCpp(model, outDir)
	case "go":
		emitErr = EmitGo(model, outDir)
	case "rust":
		emitErr = EmitRust(model, outDir)
	default:
		return fmt.Errorf("unknown compile target %q", target)
	}
	if emitErr != nil {
		return emitErr
	}
	provenance, err := AuditProvenanceDir(model, target, outDir)
	if err != nil {
		return err
	}
	if err := WriteProvenanceManifest(outDir, provenance); err != nil {
		return err
	}
	if provenance.Enforced && len(provenance.Violations) > 0 {
		return fmt.Errorf("provenance audit failed for %s:\n  %s", target, strings.Join(provenance.Violations, "\n  "))
	}
	return ValidateGeneratedPackageHygiene(outDir, target)
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
	mcpModule, err := BuildPythonMCP(model)
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
		"axllm/runtime_quickjs.py":                              pyRuntimeQuickjs,
		"axllm/prompt.py":                                       prompt,
		"axllm/ai.py":                                           ai,
		"axllm/gen.py":                                          gen,
		"axllm/agent.py":                                        agent,
		"axllm/flow.py":                                         flow,
		"axllm/mcp.py":                                          mcpModule,
		"axllm/conformance.py":                                  pyConformance,
		"axllm/providers/__init__.py":                           pyProvidersInit,
		"axllm/providers/openai.py":                             pyOpenAIProvider,
		"axir-capabilities.json":                                mustCapabilityManifest(model, "python"),
		"axir-api.json":                                         mustAPIReferenceManifest(model, "python"),
		"conformance-coverage.json":                             mustConformanceCoverageManifest(model, "python"),
		"examples/signature_schema.py":                          pySignatureSchemaExample,
		"examples/axgen_scripted_client_tool.py":                pyAxGenScriptedClientToolExample,
		"examples/axgen_openai_api.py":                          pyAxGenOpenAIExample,
		"examples/provider_mapping_no_key.py":                   pyProviderMappingNoKeyExample,
		"examples/provider_stream_no_key.py":                    pyProviderStreamNoKeyExample,
		"examples/runtime_adapter.py":                           pyRuntimeAdapterExample,
		"examples/runtime_protocol.py":                          pyRuntimeProtocolExample,
		"examples/runtime_profiles/javascript_quickjs.py":       pyJavaScriptQuickJSProfilePythonExample,
		"examples/runtime_profiles/python_pyodide.py":           pyPythonPyodideProfileExample,
		"examples/runtime_profiles/pyodide-package.json":        pyodidePackageJSON,
		"examples/runtime_profiles/pyodide-runtime-policy.json": pyodideRuntimePolicyJSON,
		"examples/runtime_profiles/resolve_pyodide_runtime_server.sh": pyodideRuntimeHelper,
		"examples/runtime_profiles/README.md":                         pyodideProfileReadme,
		"examples/axflow_program_graph.py":                            pyAxFlowProgramGraphExample,
		"examples/flow_mermaid.py":                                    pyFlowMermaidExample,
		"examples/flow_openai_api.py":                                 pyAxFlowOpenAIExample,
		"examples/audio_responses_mapping.py":                         pyAudioResponsesMappingExample,
		"examples/audio_http_roundtrip.py":                            pyAudioHTTPRoundtripExample,
		"examples/stream_http_roundtrip.py":                           pyStreamHTTPRoundtripExample,
		"examples/realtime_audio_events.py":                           pyRealtimeAudioEventsExample,
		"examples/realtime_audio_turn.py":                             pyRealtimeAudioTurnExample,
		"examples/optimizer_artifact.py":                              pyOptimizerArtifactExample,
		"examples/gepa_local_optimizer.py":                            pyGEPALocalOptimizerExample,
		"examples/ace_playbook.py":                                    pyACEPlaybookExample,
		"examples/agent_playbook.py":                                  pyAgentPlaybookExample,
		"examples/mcp_scripted_tools.py":                              pyMCPScriptedToolsExample,
		"examples/mcp_sse_roundtrip.py":                               pyMCPSseRoundtripExample,
		"API.md":                                                      packageAPIReferenceMarkdown(model, "python"),
		"README.md":                                                   packageREADME(model, "python"),
		"LICENSE":                                                     packageLicenseText,
	}
	addPackageSkills(files, model, "python")
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
		"dev/axllm/ax/AxMCPClient.java":                               javaAxMCPClient,
		"dev/axllm/ax/AxEventEnvelope.java":                           javaAxEventEnvelope,
		"dev/axllm/ax/AxEventRoute.java":                              javaAxEventRoute,
		"dev/axllm/ax/AxEventCommand.java":                            javaAxEventCommand,
		"dev/axllm/ax/AxEventSource.java":                             javaAxEventSource,
		"dev/axllm/ax/AxEventSink.java":                               javaAxEventSink,
		"dev/axllm/ax/AxEventClock.java":                              javaAxEventClock,
		"dev/axllm/ax/AxEventStore.java":                              javaAxEventStore,
		"dev/axllm/ax/AxEventRuntime.java":                            javaAxEventRuntime,
		"dev/axllm/ax/AxMCPEventSource.java":                          javaAxMCPEventSource,
		"dev/axllm/ax/AxExecutionContext.java":                        javaAxExecutionContext,
		"dev/axllm/ax/AxMCPContinuationState.java":                    javaAxMCPContinuationState,
		"dev/axllm/ax/AxUCPBinding.java":                              javaAxUCPBinding,
		"dev/axllm/ax/AxUCPClient.java":                               javaAxUCPClient,
		"dev/axllm/ax/AxMCPTransport.java":                            javaAxMCPTransport,
		"dev/axllm/ax/AxMCPStreamableHTTPTransport.java":              javaAxMCPStreamableHTTPTransport,
		"dev/axllm/ax/AxMCPStdioTransport.java":                       javaAxMCPStdioTransport,
		"dev/axllm/ax/AxMCPOAuthOptions.java":                         javaAxMCPOAuthOptions,
		"dev/axllm/ax/AxMCPTokenSet.java":                             javaAxMCPTokenSet,
		"dev/axllm/ax/AxMCPScriptedTransport.java":                    javaAxMCPScriptedTransport,
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
		"dev/axllm/ax/AxBootstrapFewShot.java":                        javaAxBootstrapFewShot,
		"dev/axllm/ax/AxACE.java":                                     javaAxACE,
		"dev/axllm/ax/AxGEPA.java":                                    javaAxGEPA,
		"dev/axllm/ax/AxPlaybook.java":                                javaAxPlaybook,
		"dev/axllm/ax/OptimizerEngine.java":                           javaOptimizerEngine,
		"dev/axllm/ax/OptimizerEvaluator.java":                        javaOptimizerEvaluator,
		"dev/axllm/ax/Json.java":                                      javaJson,
		"dev/axllm/ax/Conformance.java":                               javaConformance,
		"axir-capabilities.json":                                      mustCapabilityManifest(model, "java"),
		"axir-api.json":                                               mustAPIReferenceManifest(model, "java"),
		"conformance-coverage.json":                                   mustConformanceCoverageManifest(model, "java"),
		"examples/SignatureSchemaExample.java":                        javaSignatureSchemaExample,
		"examples/AxGenScriptedClientToolExample.java":                javaAxGenScriptedClientToolExample,
		"examples/AxGenOpenAIExample.java":                            javaAxGenOpenAIExample,
		"examples/ProviderMappingNoKeyExample.java":                   javaProviderMappingNoKeyExample,
		"examples/ProviderStreamNoKeyExample.java":                    javaProviderStreamNoKeyExample,
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
		"examples/FlowMermaidExample.java":                            javaFlowMermaidExample,
		"examples/FlowOpenAIExample.java":                             javaFlowOpenAIExample,
		"examples/AudioResponsesMappingExample.java":                  javaAudioResponsesMappingExample,
		"examples/AudioHTTPRoundtripExample.java":                     javaAudioHTTPRoundtripExample,
		"examples/StreamHTTPRoundtripExample.java":                    javaStreamHTTPRoundtripExample,
		"examples/RealtimeAudioEventsExample.java":                    javaRealtimeAudioEventsExample,
		"examples/RealtimeAudioTurnExample.java":                      javaRealtimeAudioTurnExample,
		"examples/OptimizerArtifactExample.java":                      javaOptimizerArtifactExample,
		"examples/GEPALocalOptimizerExample.java":                     javaGEPALocalOptimizerExample,
		"examples/ACEPlaybookExample.java":                            javaACEPlaybookExample,
		"examples/AgentPlaybookExample.java":                          javaAgentPlaybookExample,
		"examples/AxMCPScriptedToolsExample.java":                     javaMCPScriptedToolsExample,
		"examples/AxMCPSseRoundtripExample.java":                      javaMCPSseRoundtripExample,
		"API.md":                                                      packageAPIReferenceMarkdown(model, "java"),
		"README.md":                                                   packageREADME(model, "java"),
		"LICENSE":                                                     packageLicenseText,
	}
	addPackageSkills(files, model, "java")
	return writeFiles(outDir, files)
}

func EmitCpp(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildCppCore(model)
	if err != nil {
		return err
	}
	header, err := BuildCppHeader(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"CMakeLists.txt":                                        renderPackageTemplate(cppCMakeLists, version),
		"cmake/axllmConfig.cmake.in":                            cppCMakeConfig,
		"axllm/axllm.hpp":                                       header,
		"axllm/axllm.cpp":                                       core,
		"axllm/mcp.hpp":                                         cppMCPHeader,
		"axllm/mcp.cpp":                                         cppMCPSource,
		"conformance.cpp":                                       cppConformance,
		"axir-capabilities.json":                                mustCapabilityManifest(model, "cpp"),
		"axir-api.json":                                         mustAPIReferenceManifest(model, "cpp"),
		"conformance-coverage.json":                             mustConformanceCoverageManifest(model, "cpp"),
		"examples/signature_schema.cpp":                         cppSignatureSchemaExample,
		"examples/axgen_scripted_client_tool.cpp":               cppAxGenScriptedClientToolExample,
		"examples/axgen_openai_api.cpp":                         cppAxGenOpenAIExample,
		"examples/provider_mapping_no_key.cpp":                  cppProviderMappingNoKeyExample,
		"examples/provider_stream_no_key.cpp":                   cppProviderStreamNoKeyExample,
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
		"examples/flow_mermaid.cpp":                             cppFlowMermaidExample,
		"examples/flow_openai_api.cpp":                          cppFlowOpenAIExample,
		"examples/audio_responses_mapping.cpp":                  cppAudioResponsesMappingExample,
		"examples/audio_http_roundtrip.cpp":                     cppAudioHTTPRoundtripExample,
		"examples/stream_http_roundtrip.cpp":                    cppStreamHTTPRoundtripExample,
		"examples/realtime_audio_events.cpp":                    cppRealtimeAudioEventsExample,
		"examples/realtime_audio_turn.cpp":                      cppRealtimeAudioTurnExample,
		"examples/optimizer_artifact.cpp":                       cppOptimizerArtifactExample,
		"examples/gepa_local_optimizer.cpp":                     cppGEPALocalOptimizerExample,
		"examples/ace_playbook.cpp":                             cppACEPlaybookExample,
		"examples/agent_playbook.cpp":                           cppAgentPlaybookExample,
		"examples/mcp_scripted_tools.cpp":                       cppMCPScriptedToolsExample,
		"examples/mcp_sse_roundtrip.cpp":                        cppMCPSseRoundtripExample,
		"API.md":                                                packageAPIReferenceMarkdown(model, "cpp"),
		"README.md":                                             packageREADME(model, "cpp"),
		"LICENSE":                                               packageLicenseText,
	}
	addPackageSkills(files, model, "cpp")
	return writeFiles(outDir, files)
}

func EmitGo(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildGoCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"go.mod":                            renderPackageTemplate(goMod, version),
		"go.sum":                            goSum,
		"axllm.go":                          renderPackageTemplate(core, version),
		"mcp.go":                            goMCP,
		"runtime/goja/goja.go":              goGojaRuntime,
		"axir-capabilities.json":            mustCapabilityManifest(model, "go"),
		"axir-api.json":                     mustAPIReferenceManifest(model, "go"),
		"conformance-coverage.json":         mustConformanceCoverageManifest(model, "go"),
		"conformance/main.go":               goConformance,
		"examples/signature_schema/main.go": goSignatureSchemaExample,
		"examples/axgen_scripted_client_tool/main.go":       goAxGenScriptedClientToolExample,
		"examples/axgen_openai_api/main.go":                 goAxGenOpenAIExample,
		"examples/provider_mapping_no_key/main.go":          goProviderMappingNoKeyExample,
		"examples/provider_stream_no_key/main.go":           goProviderStreamNoKeyExample,
		"examples/runtime_adapter/main.go":                  goRuntimeAdapterExample,
		"examples/runtime_protocol/main.go":                 goRuntimeProtocolExample,
		"examples/runtime_profiles/javascript_goja/main.go": goJavaScriptGojaProfileExample,
		"examples/axflow_program_graph/main.go":             goAxFlowProgramGraphExample,
		"examples/flow_mermaid/main.go":                     goFlowMermaidExample,
		"examples/flow_openai_api/main.go":                  goAxFlowOpenAIExample,
		"examples/audio_responses_mapping/main.go":          goAudioResponsesMappingExample,
		"examples/audio_http_roundtrip/main.go":             goAudioHTTPRoundtripExample,
		"examples/stream_http_roundtrip/main.go":            goStreamHTTPRoundtripExample,
		"examples/realtime_audio_events/main.go":            goRealtimeAudioEventsExample,
		"examples/realtime_audio_turn/main.go":              goRealtimeAudioTurnExample,
		"examples/optimizer_artifact/main.go":               goOptimizerArtifactExample,
		"examples/gepa_local_optimizer/main.go":             goGEPALocalOptimizerExample,
		"examples/ace_playbook/main.go":                     goACEPlaybookExample,
		"examples/agent_playbook/main.go":                   goAgentPlaybookExample,
		"examples/mcp_scripted_tools/main.go":               goMCPScriptedToolsExample,
		"examples/mcp_sse_roundtrip/main.go":                goMCPSseRoundtripExample,
		"API.md":                                            packageAPIReferenceMarkdown(model, "go"),
		"README.md":                                         packageREADME(model, "go"),
		"LICENSE":                                           packageLicenseText,
	}
	addPackageSkills(files, model, "go")
	return writeFiles(outDir, files)
}

func EmitRust(model AxRuntimeModel, outDir string) error {
	version := generatedPackageVersion()
	core, err := BuildRustCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"Cargo.toml":                                      renderPackageTemplate(rustCargoToml, version),
		"src/lib.rs":                                      renderPackageTemplate(core, version),
		"src/mcp.rs":                                      rustMCP,
		"src/runtime/quickjs.rs":                          rustQuickJSRuntime,
		"src/bin/axllm-conformance.rs":                    rustConformanceMain,
		"axir-capabilities.json":                          mustCapabilityManifest(model, "rust"),
		"axir-api.json":                                   mustAPIReferenceManifest(model, "rust"),
		"conformance-coverage.json":                       mustConformanceCoverageManifest(model, "rust"),
		"examples/signature_schema.rs":                    rustSignatureSchemaExample,
		"examples/provider_mapping_no_key.rs":             rustProviderMappingNoKeyExample,
		"examples/provider_stream_no_key.rs":              rustProviderStreamNoKeyExample,
		"examples/axgen_scripted_client_tool.rs":          rustAxGenScriptedClientToolExample,
		"examples/axgen_openai_api.rs":                    rustAxGenOpenAIExample,
		"examples/axflow_program_graph.rs":                rustAxFlowProgramGraphExample,
		"examples/flow_mermaid.rs":                        rustFlowMermaidExample,
		"examples/flow_openai_api.rs":                     rustAxFlowOpenAIExample,
		"examples/audio_responses_mapping.rs":             rustAudioResponsesMappingExample,
		"examples/audio_http_roundtrip.rs":                rustAudioHTTPRoundtripExample,
		"examples/stream_http_roundtrip.rs":               rustStreamHTTPRoundtripExample,
		"examples/realtime_audio_events.rs":               rustRealtimeAudioEventsExample,
		"examples/realtime_audio_turn.rs":                 rustRealtimeAudioTurnExample,
		"examples/runtime_adapter.rs":                     rustRuntimeAdapterExample,
		"examples/runtime_protocol.rs":                    rustRuntimeProtocolExample,
		"examples/runtime_profiles/javascript_quickjs.rs": rustJavaScriptQuickJSProfileExample,
		"examples/runtime_profiles/README.md":             rustRuntimeProfilesReadme,
		"examples/optimizer_artifact.rs":                  rustOptimizerArtifactExample,
		"examples/gepa_local_optimizer.rs":                rustGEPALocalOptimizerExample,
		"examples/ace_playbook.rs":                        rustACEPlaybookExample,
		"examples/agent_playbook.rs":                      rustAgentPlaybookExample,
		"examples/mcp_scripted_tools.rs":                  rustMCPScriptedToolsExample,
		"examples/mcp_sse_roundtrip.rs":                   rustMCPSseRoundtripExample,
		"API.md":                                          packageAPIReferenceMarkdown(model, "rust"),
		"README.md":                                       packageREADME(model, "rust"),
		"LICENSE":                                         packageLicenseText,
	}
	addPackageSkills(files, model, "rust")
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

func ValidateGeneratedPackageHygiene(root, target string) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		name := entry.Name()
		if entry.IsDir() {
			if generatedPackageHygieneSkipDir(name) {
				return filepath.SkipDir
			}
			if rel := generatedPackageHygieneRel(root, path); rel != "" && generatedPackageLegacyFixturePattern.MatchString(rel) {
				return fmt.Errorf("%s generated package hygiene: forbidden public token %q in generated path %s; use scripted naming for deterministic fixtures", target, generatedPackageLegacyFixtureWord, rel)
			}
			return nil
		}
		rel := generatedPackageHygieneRel(root, path)
		if rel != "" && generatedPackageLegacyFixturePattern.MatchString(rel) {
			return fmt.Errorf("%s generated package hygiene: forbidden public token %q in generated path %s; use scripted naming for deterministic fixtures", target, generatedPackageLegacyFixtureWord, rel)
		}
		if generatedPackageHygieneSkipFile(name) {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := string(data)
		if strings.ContainsRune(text, '\x00') {
			return nil
		}
		loc := generatedPackageLegacyFixturePattern.FindStringIndex(text)
		if loc == nil {
			return nil
		}
		line := 1 + strings.Count(text[:loc[0]], "\n")
		return fmt.Errorf("%s generated package hygiene: forbidden public token %q in %s:%d; use scripted naming for deterministic fixtures", target, generatedPackageLegacyFixtureWord, rel, line)
	})
}

func generatedPackageHygieneRel(root, path string) string {
	if path == root {
		return ""
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		rel = path
	}
	return filepath.ToSlash(rel)
}

func generatedPackageHygieneSkipDir(name string) bool {
	switch name {
	case ".git", ".gradle", ".pytest_cache", "__pycache__", "build", "cmake-build-debug", "cmake-build-release", "CMakeFiles", "node_modules", "target", "tmp", ".generated":
		return true
	default:
		return false
	}
}

func generatedPackageHygieneSkipFile(name string) bool {
	switch filepath.Ext(name) {
	case ".class", ".o", ".a", ".so", ".dylib", ".dll", ".exe", ".bin", ".pyc":
		return true
	default:
		return false
	}
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
	AxIRVersion              string                        `json:"axir_version"`
	Target                   string                        `json:"target"`
	PackageName              string                        `json:"package_name"`
	SupportedSuites          []string                      `json:"supported_suites"`
	ProviderMode             string                        `json:"provider_mode"`
	ScriptedTransportSupport bool                          `json:"scripted_transport_support"`
	RealNetworkSupport       bool                          `json:"real_network_support"`
	RuntimeProfiles          []RuntimeProfileManifestEntry `json:"runtime_profiles"`
	UnsupportedCapabilities  []string                      `json:"unsupported_capabilities,omitempty"`
	CoreOwnedFeatureGroups   []string                      `json:"core_owned_feature_groups"`
	PublicSymbols            []string                      `json:"public_symbols"`
	TargetIdiom              TargetIdiom                   `json:"target_idiom"`
}

type RuntimeProfileManifestEntry struct {
	ID                  string   `json:"id"`
	ActorLanguage       string   `json:"actor_language"`
	SupportMode         string   `json:"support_mode"`
	DependencyMode      string   `json:"dependency_mode"`
	FeatureGate         string   `json:"feature_gate,omitempty"`
	EnvironmentGates    []string `json:"environment_gates,omitempty"`
	VerificationCommand string   `json:"verification_command"`
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

type APIReferenceManifest struct {
	SchemaVersion string                `json:"schema_version"`
	AxIRVersion   string                `json:"axir_version"`
	Target        string                `json:"target"`
	PackageName   string                `json:"package_name"`
	Sections      []APIReferenceSection `json:"sections"`
}

type APIReferenceSection struct {
	ID      string               `json:"id"`
	Title   string               `json:"title"`
	Summary string               `json:"summary"`
	Symbols []APIReferenceSymbol `json:"symbols"`
}

type APIReferenceSymbol struct {
	TargetName       string   `json:"target_name"`
	CanonicalName    string   `json:"canonical_name"`
	PublicName       string   `json:"public_name"`
	Kind             string   `json:"kind"`
	Description      string   `json:"description"`
	Form             string   `json:"form"`
	ImportantOptions []string `json:"important_options,omitempty"`
	Returns          string   `json:"returns"`
	Example          string   `json:"example,omitempty"`
}

func BuildCapabilityManifest(model AxRuntimeModel, target string) (CapabilityManifest, error) {
	idiom, ok := model.TargetIdioms[target]
	if !ok {
		return CapabilityManifest{}, fmt.Errorf("unknown target %q", target)
	}
	realNetwork := target == "python" || target == "java" || target == "cpp" || target == "go" || target == "rust"
	publicSymbols := publicSymbolsForTarget(model, target)
	return CapabilityManifest{
		AxIRVersion:              "0.1",
		Target:                   target,
		PackageName:              packageNameForTarget(target),
		SupportedSuites:          []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow", "axmcp", "axevent"},
		ProviderMode:             "provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic",
		ScriptedTransportSupport: true,
		RealNetworkSupport:       realNetwork,
		RuntimeProfiles:          runtimeProfilesForTarget(target),
		UnsupportedCapabilities:  nil,
		CoreOwnedFeatureGroups: targetCoreOwnedFeatureGroups(target, []string{
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
			"anthropic-adaptive-thinking-display",
			"anthropic-adaptive-sampling-suppression",
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
			"axagent-stage-instructions",
			"axagent-evidence-citations",
			"axagent-playbook-config",
			"axagent-run-end-playbook-learning",
			"axagent-playbook-verified-evolve",
			"axagent-runtime-contract",
			"axagent-discovery-policy",
			"axagent-delegation-policy",
			"axagent-optimizer-metadata",
			"axagent-runtime-session",
			"axagent-shared-runtime-session",
			"axagent-shared-evidence-handoff",
			"axagent-relevance-ranking",
			"axagent-auto-upgrade",
			"axagent-signature-update",
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
			"axoptimize-ace-bullet-tag-normalization",
			"axoptimize-ace-updated-bullet-ids",
			"axoptimize-ace-empty-render",
			"axoptimize-gepa-engine",
			"axoptimize-gepa-reflection",
			"axoptimize-gepa-pareto",
			"axoptimize-gepa-bootstrap",
			"axoptimize-gepa-selector-state",
			"axoptimize-bootstrap-fewshot",
			"axoptimize-top-level-helper",
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
			"axmcp",
			"axmcp-json-rpc-lifecycle",
			"axmcp-protocol-negotiation",
			"axmcp-tools-prompts-resources",
			"axmcp-to-function",
			"axmcp-streamable-http-transport",
			"axmcp-stdio-transport",
			"axmcp-oauth",
			"axmcp-cancellation",
			"axmcp-session-headers",
			"axmcp-ssrf-protection",
			"axevent.single-worker",
			"axevent-lifecycle-dispatch",
			"axevent-routing",
			"axevent-retry-classification",
			"axevent-continuations",
			"axevent-mcp-normalization",
			"axevent-input-mapping",
		}),
		PublicSymbols: publicSymbols,
		TargetIdiom:   idiom,
	}, nil
}

func BuildAPIReferenceManifest(model AxRuntimeModel, target string) (APIReferenceManifest, error) {
	manifest, err := BuildCapabilityManifest(model, target)
	if err != nil {
		return APIReferenceManifest{}, err
	}
	ref := APIReferenceManifest{
		SchemaVersion: "axir-api-v1",
		AxIRVersion:   manifest.AxIRVersion,
		Target:        target,
		PackageName:   manifest.PackageName,
		Sections:      apiReferenceSectionsForTarget(target),
	}
	if err := ValidateAPIReferenceManifest(ref); err != nil {
		return APIReferenceManifest{}, err
	}
	return ref, nil
}

func ValidateAPIReferenceManifest(manifest APIReferenceManifest) error {
	if manifest.SchemaVersion != "axir-api-v1" {
		return fmt.Errorf("api reference schema_version %q is not axir-api-v1", manifest.SchemaVersion)
	}
	if strings.TrimSpace(manifest.Target) == "" {
		return fmt.Errorf("api reference target is empty")
	}
	if strings.TrimSpace(manifest.PackageName) == "" {
		return fmt.Errorf("api reference package_name is empty")
	}
	requiredSections := []string{"signatures", "axgen", "axai", "agents-rlm", "flow", "tools", "mcp", "runtime-profiles", "optimizers", "errors-values"}
	sections := map[string]bool{}
	symbols := map[string]bool{}
	for _, section := range manifest.Sections {
		if strings.TrimSpace(section.ID) == "" || strings.TrimSpace(section.Title) == "" || strings.TrimSpace(section.Summary) == "" {
			return fmt.Errorf("api reference has incomplete section %#v", section)
		}
		if sections[section.ID] {
			return fmt.Errorf("api reference has duplicate section %q", section.ID)
		}
		sections[section.ID] = true
		if len(section.Symbols) == 0 {
			return fmt.Errorf("api reference section %q has no symbols", section.ID)
		}
		for _, symbol := range section.Symbols {
			if symbol.TargetName != manifest.Target {
				return fmt.Errorf("api reference symbol %q has target_name %q, want %q", symbol.CanonicalName, symbol.TargetName, manifest.Target)
			}
			if strings.TrimSpace(symbol.CanonicalName) == "" || strings.TrimSpace(symbol.PublicName) == "" || strings.TrimSpace(symbol.Kind) == "" || strings.TrimSpace(symbol.Description) == "" || strings.TrimSpace(symbol.Form) == "" || strings.TrimSpace(symbol.Returns) == "" {
				return fmt.Errorf("api reference section %q has incomplete symbol %#v", section.ID, symbol)
			}
			symbols[symbol.CanonicalName] = true
		}
	}
	for _, id := range requiredSections {
		if !sections[id] {
			return fmt.Errorf("api reference missing section %q", id)
		}
	}
	for _, canonical := range []string{"s", "ax", "ai", "agent", "flow", "fn", "AxMCPClient", "OpenAICompatibleClient", "OpenAIResponsesClient", "GoogleGeminiClient", "AnthropicClient", "ProcessCodeRuntime", "RuntimeCapabilities", "RuntimeEnvelope", "optimize", "AxBootstrapFewShot", "AxGEPA", "OptimizerEngine"} {
		if !symbols[canonical] {
			return fmt.Errorf("api reference missing canonical symbol %q", canonical)
		}
	}
	return nil
}

func apiReferenceSectionsForTarget(target string) []APIReferenceSection {
	sym := func(canonical, kind, description string, options []string, returns string) APIReferenceSymbol {
		publicName := apiReferencePublicName(target, canonical)
		return APIReferenceSymbol{
			TargetName:       target,
			CanonicalName:    canonical,
			PublicName:       publicName,
			Kind:             kind,
			Description:      description,
			Form:             apiReferenceForm(target, canonical, publicName),
			ImportantOptions: options,
			Returns:          apiReferenceReturns(target, canonical, returns),
			Example:          apiReferenceExample(target, canonical),
		}
	}
	return []APIReferenceSection{
		{
			ID:      "signatures",
			Title:   "Signatures",
			Summary: "Describe typed Ax inputs and outputs once, then reuse that shape for schemas, prompts, validation, tools, and structured results.",
			Symbols: []APIReferenceSymbol{
				sym("s", "function", "Parse an Ax string signature into the target language signature object.", nil, "AxSignature"),
				sym("f", "function", "Build signatures and field types fluently when the target has a fluent helper.", []string{"input fields", "output fields", "field descriptions", "constraints"}, "signature builder or field factory"),
				sym("AxSignature", "type", "Parsed signature with input/output fields, descriptions, and JSON schema helpers.", []string{"inputs", "outputs", "description"}, "signature object"),
			},
		},
		{
			ID:      "axgen",
			Title:   "AxGen",
			Summary: "Run structured generation with Core-owned prompts, tool loops, retries, streaming folds, traces, usage, examples, and field processors.",
			Symbols: []APIReferenceSymbol{
				sym("ax", "function", "Create an AxGen program from a string or parsed signature.", []string{"functions", "examples", "demos", "modelConfig", "maxRetries", "streaming assertions", "field processors"}, "AxGen"),
				sym("AxGen", "type", "Structured generation program with forward, streaming, optimization, trace, usage, and tool-call behavior.", []string{"signature", "functions", "examples", "demos", "memory", "prompt template"}, "program object"),
			},
		},
		{
			ID:      "axai",
			Title:   "AxAI",
			Summary: "Call supported providers through the shared provider descriptor registry, scripted transports, routers, and balancers.",
			Symbols: []APIReferenceSymbol{
				sym("ai", "function", "Create a provider client from a provider name and options.", []string{"api key", "model", "api URL", "headers", "transport"}, "AI client/service"),
				sym("OpenAICompatibleClient", "type", "OpenAI-compatible chat, stream, embedding, audio, and realtime provider boundary.", []string{"api key", "model", "base URL", "transport"}, "provider client"),
				sym("OpenAIResponsesClient", "type", "OpenAI Responses provider mapping using the same Core-owned request and response contract.", []string{"api key", "model", "audio", "realtime"}, "provider client"),
				sym("GoogleGeminiClient", "type", "Gemini provider mapping for chat, streaming, media, tools, embeddings, and usage normalization.", []string{"api key", "model", "embed model"}, "provider client"),
				sym("AnthropicClient", "type", "Anthropic provider mapping for messages, thinking, cache control, streaming, and usage normalization.", []string{"api key", "model", "thinking", "cache control"}, "provider client"),
				sym("AxBalancer", "type", "Retry and route requests across multiple provider services while preserving Ax request shape.", []string{"services", "retry policy", "capability requirements"}, "AI service"),
				sym("MultiServiceRouter", "type", "Choose a service by capability or model routing policy.", []string{"services", "routing"}, "AI service"),
				sym("ProviderRouter", "type", "Route provider requests to registered provider clients.", []string{"providers", "routing", "processing"}, "AI service"),
			},
		},
		{
			ID:      "agents-rlm",
			Title:   "Agents And RLM",
			Summary: "Run AxAgent through the RLM executor loop with stage instructions, validated evidence citations, persistent playbooks, and actor-code execution through an AxCodeRuntime session.",
			Symbols: []APIReferenceSymbol{
				sym("agent", "function", "Create an AxAgent from a signature and agent/runtime options.", []string{"name", "description", "runtime", "maxSteps", "context fields", "discovery", "recall", "functions", "citations", "playbook", "instruction", "instructionAddenda"}, "AxAgent"),
				sym("AxAgent", "type", "RLM agent with Core-owned envelopes, state, traces, discovery, recall, delegation, validated citations, stage instructions, persistent run-end learning, and verified playbook evolution.", []string{"executor model", "runtime", "policy", "context", "optimizer metadata", "citations", "playbook"}, "agent program"),
			},
		},
		{
			ID:      "flow",
			Title:   "Flow",
			Summary: "Compose AxGen, AxAgent, and nested flows into a portable program graph.",
			Symbols: []APIReferenceSymbol{
				sym("flow", "function", "Create an AxFlow program graph or compile the portable Mermaid shorthand.", []string{"nodes", "execute mappers", "conditions", "cache", "returns", "Mermaid roundtrip"}, "AxFlow"),
				sym("AxFlow", "type", "Workflow graph with Core-owned planning, cache keys, state merge, child aggregation, optimization, and returns projection.", []string{"steps", "state", "parallel groups", "returns"}, "flow program"),
			},
		},
		{
			ID:      "tools",
			Title:   "Tools",
			Summary: "Expose host functions to AxGen and AxAgent with typed argument and return schemas.",
			Symbols: []APIReferenceSymbol{
				sym("fn", "function", "Build a typed function tool. Rust uses `tool` because `fn` is reserved.", []string{"name", "description", "args", "returns", "handler"}, "tool builder or Tool"),
				sym("Tool", "type", "Callable tool descriptor with JSON-schema-compatible parameters and a host handler.", []string{"parameters", "returns", "handler"}, "tool descriptor"),
			},
		},
		{
			ID:      "mcp",
			Title:   "MCP",
			Summary: "Use MCP clients and transports while keeping JSON-RPC lifecycle, tools, prompts, resources, OAuth, cancellation, and SSRF checks aligned.",
			Symbols: []APIReferenceSymbol{
				sym("AxMCPClient", "type", "MCP client that lists tools/prompts/resources and converts MCP tools to Ax functions.", []string{"transport", "client info", "roots", "tool overrides"}, "MCP client"),
				sym("AxMCPStreamableHTTPTransport", "type", "Streamable HTTP transport with session headers, OAuth options, and SSRF protection.", []string{"endpoint", "headers", "OAuth", "SSRF protection"}, "MCP transport"),
				sym("AxMCPStdioTransport", "type", "Stdio transport with JSON-RPC framing for local MCP servers.", []string{"command", "args", "env"}, "MCP transport"),
			},
		},
		{
			ID:      "runtime-profiles",
			Title:   "Runtime Profiles",
			Summary: "Run RLM actor code through the portable AxCodeRuntime and optional target-specific runtime profiles.",
			Symbols: append([]APIReferenceSymbol{
				sym("ProcessCodeRuntime", "type", "Process/JSONL runtime adapter for actor-code sessions and runtime protocol tests.", []string{"command", "env", "cwd", "timeout"}, "AxCodeRuntime"),
				sym("RuntimeCapabilities", "type", "Runtime capability envelope visible to the agent runtime policy.", []string{"language", "snapshot", "patch", "abort", "usage instructions"}, "capability record"),
				sym("RuntimeEnvelope", "type", "Actor primitive envelope for final, clarification, discovery, recall, used, guidance, and runtime results.", []string{"type", "args", "result", "error"}, "runtime envelope"),
			}, apiRuntimeProfileSymbols(target)...),
		},
		{
			ID:      "optimizers",
			Title:   "Optimizers",
			Summary: "Optimize Ax programs through BootstrapFewShot -> GEPA composition and evolve program or agent playbooks through grounded, budgeted, rollback-safe learning.",
			Symbols: []APIReferenceSymbol{
				sym("optimize", "function", "Convenience optimizer helper that composes AxBootstrapFewShot before AxGEPA and returns an artifact without applying final component changes.", []string{"student/client", "teacher/reflection client", "metric budget", "bootstrap"}, "optimized artifact"),
				sym("playbook", "function", "Bind an ACE-backed playbook to a program; agents also expose an agent-bound playbook handle.", []string{"student/client", "teacher", "seed snapshot", "online updates", "verification budget"}, "AxPlaybook"),
				sym("AxPlaybook", "type", "Persistent playbook with render/update/snapshot operations and agent-bound verified evolve over train/validation task sets.", []string{"verify", "minHeldInGain", "epsilon", "runsPerTask", "maxMetricCalls", "maxProposals"}, "playbook handle"),
				sym("AxBootstrapFewShot", "type", "Few-shot demonstration optimizer that selects successful evaluator rollouts before prompt/component evolution.", []string{"quality threshold", "max demos", "max rounds", "batch size"}, "optimizer engine"),
				sym("AxGEPA", "type", "Generated GEPA optimizer engine with Core-owned reflection, Pareto, bootstrap, and selector-state behavior.", []string{"reflection client", "budget", "metric", "candidate count"}, "optimizer engine"),
				sym("OptimizerEngine", "interface", "Optimizer boundary consumed by AxGen, AxAgent, and AxFlow optimization helpers.", []string{"request", "evaluator"}, "optimized artifact"),
				sym("OptimizerEvaluator", "interface", "Evaluator callback boundary used by generated optimizers.", []string{"dataset rows", "candidate map", "evidence"}, "score/evidence result"),
			},
		},
		{
			ID:      "errors-values",
			Title:   "Errors And Values",
			Summary: "Handle target-native errors and dynamic values at Ax host boundaries.",
			Symbols: []APIReferenceSymbol{
				sym("AxError", "type", "Target-native error envelope for validation, provider, runtime, MCP, and optimizer failures.", []string{"category", "message", "status", "code", "retryable"}, "error"),
				sym("Value", "type", "Dynamic JSON-like value boundary used by generated package APIs, tools, providers, MCP, and runtime sessions.", []string{"string", "number", "boolean", "object", "array", "null"}, "dynamic value"),
			},
		},
	}
}

func apiRuntimeProfileSymbols(target string) []APIReferenceSymbol {
	out := []APIReferenceSymbol{}
	for _, profile := range runtimeProfilesForTarget(target) {
		options := []string{"actor language: " + profile.ActorLanguage, "support mode: " + profile.SupportMode, "dependency mode: " + profile.DependencyMode}
		if profile.FeatureGate != "" {
			options = append(options, "feature gate: "+profile.FeatureGate)
		}
		for _, gate := range profile.EnvironmentGates {
			options = append(options, "environment gate: "+gate)
		}
		out = append(out, APIReferenceSymbol{
			TargetName:       target,
			CanonicalName:    "runtime-profile:" + profile.ID,
			PublicName:       profile.ID,
			Kind:             "runtime-profile",
			Description:      "Optional runtime profile for " + profile.ActorLanguage + " actor code.",
			Form:             profile.VerificationCommand,
			ImportantOptions: options,
			Returns:          "AxCodeRuntime-compatible actor execution profile",
		})
	}
	return out
}

func apiReferencePublicName(target, canonical string) string {
	switch canonical {
	case "s":
		return mapTarget(target, "s", "Ax.s", "axllm::s", "axllm.S", "s")
	case "f":
		return mapTarget(target, "f", "Ax.f", "axllm::FieldType", "axllm.FieldType", "f")
	case "ax":
		return mapTarget(target, "ax", "Ax.ax", "axllm::ax", "axllm.NewAx", "ax")
	case "ai":
		return mapTarget(target, "ai", "Ax.ai", "axllm::ai", "axllm.NewAI", "ai")
	case "agent":
		return mapTarget(target, "agent", "Ax.agent", "axllm::agent", "axllm.NewAgent", "agent")
	case "flow":
		return mapTarget(target, "flow", "Ax.flow", "axllm::flow", "axllm.NewFlow", "flow")
	case "optimize":
		return mapTarget(target, "optimize", "Ax.optimize", "axllm::optimize", "axllm.Optimize", "optimize")
	case "playbook":
		return mapTarget(target, "playbook", "Ax.playbook", "axllm::playbook", "axllm.Playbook", "playbook")
	case "fn":
		return mapTarget(target, "fn", "Ax.fn", "axllm::Tool", "axllm.Fn", "tool")
	case "AxMCPStreamableHTTPTransport":
		return apiReferenceQualifiedName(target, canonical)
	case "AxMCPStdioTransport":
		return apiReferenceQualifiedName(target, canonical)
	case "Value":
		return mapTarget(target, "dict/list/scalar", "Object", "axllm::Value", "axllm.Value", "serde_json::Value")
	case "AxError":
		return mapTarget(target, "AxValidationError / AxAIServiceError", "AxAIServiceError", "axllm::AxError", "axllm.AxError", "AxError")
	default:
		return apiReferenceQualifiedName(target, canonical)
	}
}

func mapTarget(target, python, java, cpp, goName, rust string) string {
	switch target {
	case "python":
		return python
	case "java":
		return java
	case "cpp":
		return cpp
	case "go":
		return goName
	case "rust":
		return rust
	default:
		return python
	}
}

func apiReferenceQualifiedName(target, name string) string {
	switch target {
	case "cpp":
		return "axllm::" + name
	case "go":
		return "axllm." + name
	default:
		return name
	}
}

func apiReferenceForm(target, canonical, publicName string) string {
	switch canonical {
	case "s":
		return mapTarget(target, "s(signature: str)", "Ax.s(String signature)", "axllm::s(const std::string& signature)", "axllm.S(signature string)", "s(spec: &str)")
	case "f":
		return mapTarget(target, "f().input(...).output(...).build()", "Ax.f().input(...).output(...)", "FieldType / Field descriptors", "FieldType and Field descriptors", "f().input(...).output(...).build()")
	case "AxSignature":
		return mapTarget(target, "AxSignature", "AxSignature", "axllm::Value signature", "axllm.AxSignature", "AxSignature")
	case "ax":
		return mapTarget(target, "ax(signature, options=None)", "Ax.ax(signature)", "axllm::ax(signature, options)", "axllm.NewAx(signature, options)", "ax(spec: &str)")
	case "AxGen":
		return mapTarget(target, "AxGen(signature, options=None)", "new AxGen(signature)", "axllm::AxGen(signature, options)", "axllm.NewGen(signature, options)", "AxGen")
	case "ai":
		return mapTarget(target, "ai(provider='openai', **options)", "Ax.ai(provider, options)", "axllm::ai(provider, options)", "axllm.NewAI(provider, options)", "ai(provider, options)")
	case "OpenAICompatibleClient", "OpenAIResponsesClient", "GoogleGeminiClient", "AnthropicClient":
		return providerClientForm(target, canonical)
	case "AxBalancer":
		return mapTarget(target, "AxBalancer(services, options=None)", "new AxBalancer(services, options)", "axllm::AxBalancer(services, options)", "axllm.NewAxBalancer(services, options)", "AxBalancer")
	case "MultiServiceRouter":
		return mapTarget(target, "MultiServiceRouter(services)", "new AxMultiServiceRouter(services)", "axllm::MultiServiceRouter(services)", "axllm.MultiServiceRouter", "MultiServiceRouter")
	case "ProviderRouter":
		return mapTarget(target, "ProviderRouter(providers, routing=None, processing=None)", "new AxProviderRouter(providers, routing, processing)", "axllm::ProviderRouter(providers, routing, processing)", "axllm.ProviderRouter", "ProviderRouter")
	case "agent":
		return mapTarget(target, "agent(signature, config=None)", "Ax.agent(signature, options)", "axllm::agent(signature, options)", "axllm.NewAgent(signature, options)", "agent(spec: &str)")
	case "AxAgent":
		return mapTarget(target, "AxAgent(signature, config=None)", "new AxAgent(signature, options)", "axllm::AxAgent(signature, options)", "axllm.NewAgent(signature, options)", "AxAgent")
	case "flow":
		return mapTarget(target, "flow(options=None) / flow(mermaid, bindings=None)", "Ax.flow(options) / Ax.flow(mermaid, bindings)", "axllm::flow(options) / axllm::flow(mermaid, bindings)", "axllm.NewFlow(optionsOrMermaid, bindings...)", "flow(source) / flow_with_bindings(source, bindings)")
	case "AxFlow":
		return mapTarget(target, "AxFlow(options=None, bindings=None)", "new AxFlow(optionsOrMermaid, bindings)", "axllm::AxFlow(optionsOrMermaid, bindings)", "axllm.NewFlow(optionsOrMermaid, bindings...)", "AxFlow")
	case "fn":
		return mapTarget(target, "fn(name).description(...).arg(...).handler(...).build()", "Ax.fn(name).description(...).arg(...).handler(...).build()", "axllm::Tool(name, description, parameters, handler)", "axllm.Fn(name).Description(...).Arg(...).Handler(...)", "tool(name).description(...).arg(...).handler(...).build()")
	case "Tool":
		return mapTarget(target, "Tool(name, description, parameters, handler)", "Tool", "axllm::Tool", "axllm.Tool", "Tool")
	case "AxMCPClient":
		return mapTarget(target, "AxMCPClient(transport, options=None)", "new AxMCPClient(transport, options)", "axllm::AxMCPClient(transport, options)", "axllm.NewAxMCPClient(transport, options)", "AxMCPClient::new(transport, options)")
	case "AxMCPStreamableHTTPTransport":
		return mapTarget(target, "AxMCPStreamableHTTPTransport(endpoint, options=None)", "new AxMCPStreamableHTTPTransport(endpoint, options)", "axllm::AxMCPStreamableHTTPTransport(endpoint, options)", "axllm.NewAxMCPStreamableHTTPTransport(endpoint, options)", "AxMCPStreamableHTTPTransport")
	case "AxMCPStdioTransport":
		return mapTarget(target, "AxMCPStdioTransport(command, options=None)", "new AxMCPStdioTransport(command, options)", "axllm::AxMCPStdioTransport(command, options)", "axllm.NewAxMCPStdioTransport(command, options)", "AxMCPStdioTransport")
	case "ProcessCodeRuntime":
		return mapTarget(target, "ProcessCodeRuntime(command, env=None)", "new AxProcessCodeRuntime(command, env)", "axllm::RuntimeProtocolClient(transport)", "axllm.NewProcessCodeRuntime(command, env)", "ProcessCodeRuntime::new(command)")
	case "RuntimeCapabilities":
		return mapTarget(target, "RuntimeCapabilities(...).to_dict()", "new AxRuntimeCapabilities()", "axllm::RuntimeCapabilities", "axllm.RuntimeCapabilities", "RuntimeCapabilities")
	case "RuntimeEnvelope":
		return mapTarget(target, "RuntimeEnvelope.from_result(...)", "AxRuntimeEnvelope", "axllm::RuntimeEnvelope", "runtime envelope map", "RuntimeEnvelope")
	case "AxGEPA":
		return mapTarget(target, "AxGEPA(reflection, **options)", "new AxGEPA(reflection, options)", "axllm::AxGEPA(reflection, options)", "axllm.NewGEPA(reflection, options)", "AxGEPA::new(reflection, options)")
	case "AxBootstrapFewShot":
		return mapTarget(target, "AxBootstrapFewShot(**options)", "new AxBootstrapFewShot(options)", "axllm::AxBootstrapFewShot(options)", "axllm.NewBootstrapFewShot(options)", "AxBootstrapFewShot::new(options)")
	case "optimize":
		return mapTarget(target, "optimize(program, examples, options=None)", "Ax.optimize(program, examples, options)", "axllm::optimize(program, student, examples, options, teacher)", "axllm.Optimize(program, examples, options)", "optimize(program, examples, options)")
	case "playbook":
		return mapTarget(target, "playbook(program, options=None)", "Ax.playbook(program, options)", "axllm::playbook(program, student, options)", "axllm.Playbook(program, options)", "playbook(program, student, teacher, options)")
	case "AxPlaybook":
		return mapTarget(target, "AxPlaybook / agent.playbook()", "AxPlaybook / agent.playbook(options)", "axllm::AxPlaybook / agent.playbook(...)", "axllm.AxPlaybook / agent.GetPlaybook()", "AxPlaybook / agent.playbook(...)")
	case "OptimizerEngine":
		return mapTarget(target, "OptimizerEngine.optimize(request, evaluator)", "OptimizerEngine.optimize(request, evaluator)", "axllm::OptimizerEngine::optimize(request, evaluator)", "OptimizerEngine.Optimize(request, evaluator)", "OptimizerEngine::optimize(request, evaluator)")
	case "OptimizerEvaluator":
		return mapTarget(target, "OptimizerEvaluator.evaluate(request)", "OptimizerEvaluator.evaluate(request)", "axllm::OptimizerEvaluator::evaluate(request)", "OptimizerEvaluator.Evaluate(request)", "OptimizerEvaluator::evaluate(request)")
	case "AxError":
		return publicName + " with target-native error handling"
	case "Value":
		return publicName
	default:
		return publicName
	}
}

func providerClientForm(target, canonical string) string {
	switch target {
	case "python":
		return canonical + "(options=None)"
	case "java":
		return "new " + canonical + "(options)"
	case "cpp":
		return "axllm::" + canonical + "(options, transport)"
	case "go":
		return "axllm.New" + canonical + "(options)"
	case "rust":
		return canonical + " / ai(provider, options)"
	default:
		return canonical
	}
}

func apiReferenceReturns(target, canonical, fallback string) string {
	if target == "rust" {
		switch canonical {
		case "s":
			return "AxResult<AxSignature>"
		case "ax":
			return "AxResult<AxGen>"
		case "ai":
			return "AxResult<OpenAICompatibleClient>"
		case "agent":
			return "AxResult<AxAgent>"
		case "fn":
			return "ToolBuilder"
		case "optimize":
			return "AxResult<OptimizedArtifact>"
		}
	}
	if target == "go" {
		switch canonical {
		case "ai":
			return "AIClient"
		case "agent":
			return "*AxAgent"
		case "flow":
			return "*AxFlow"
		case "fn":
			return "Tool"
		case "optimize":
			return "Value"
		case "playbook":
			return "*AxPlaybook"
		}
	}
	return fallback
}

func apiReferenceExample(target, canonical string) string {
	switch canonical {
	case "s":
		return mapTarget(target,
			`sig = s("question:string -> answer:string")`,
			`AxSignature sig = Ax.s("question:string -> answer:string");`,
			`auto sig = axllm::s("question:string -> answer:string");`,
			`sig := axllm.S("question:string -> answer:string")`,
			`let sig = s("question:string -> answer:string")?;`,
		)
	case "ax":
		return mapTarget(target,
			`qa = ax("question:string -> answer:string")`,
			`AxGen qa = Ax.ax("question:string -> answer:string");`,
			`auto qa = axllm::ax("question:string -> answer:string");`,
			`qa := axllm.NewAx("question:string -> answer:string", nil)`,
			`let qa = ax("question:string -> answer:string")?;`,
		)
	case "ai":
		return mapTarget(target,
			`client = ai("openai", api_key=os.environ["OPENAI_API_KEY"])`,
			`AxAIService client = Ax.ai("openai", Map.of("apiKey", System.getenv("OPENAI_API_KEY")));`,
			`auto client = axllm::ai("openai", axllm::object({{"apiKey", std::getenv("OPENAI_API_KEY")}}));`,
			`client := axllm.NewAI("openai", map[string]axllm.Value{"apiKey": os.Getenv("OPENAI_API_KEY")})`,
			`let client = ai("openai", json!({"apiKey": std::env::var("OPENAI_API_KEY")?}))?;`,
		)
	case "agent":
		return mapTarget(target,
			`helper = agent("query:string -> answer:string")`,
			`AxAgent helper = Ax.agent("query:string -> answer:string", Map.of());`,
			`auto helper = axllm::agent("query:string -> answer:string");`,
			`helper := axllm.NewAgent("query:string -> answer:string", nil)`,
			`let helper = agent("query:string -> answer:string")?;`,
		)
	case "flow":
		return mapTarget(target,
			`wf = flow().node("qa", ax("question:string -> answer:string"))`,
			`AxFlow wf = Ax.flow(Map.of());`,
			`auto wf = axllm::flow();`,
			`wf := axllm.NewFlow(nil)`,
			`let wf = flow("workflow");`,
		)
	case "fn":
		return mapTarget(target,
			`search = fn("search").description("Search docs").arg("query", f.string()).build()`,
			`Tool search = Ax.fn("search").description("Search docs").build();`,
			`axllm::Tool search("search", "Search docs", axllm::object({}), handler);`,
			`search := axllm.Fn("search").Description("Search docs")`,
			`let search = tool("search").description("Search docs").build();`,
		)
	case "AxMCPClient":
		return mapTarget(target,
			`client = AxMCPClient(transport)`,
			`AxMCPClient client = new AxMCPClient(transport);`,
			`axllm::AxMCPClient client(transport);`,
			`client := axllm.NewAxMCPClient(transport, nil)`,
			`let client = AxMCPClient::new(transport, json!({}));`,
		)
	case "ProcessCodeRuntime":
		return mapTarget(target,
			`runtime = ProcessCodeRuntime(["node", "runtime-server.mjs"])`,
			`AxCodeRuntime runtime = new AxProcessCodeRuntime(List.of("node", "runtime-server.mjs"), Map.of());`,
			`auto runtime = axllm::RuntimeProtocolClient(transport);`,
			`runtime := axllm.NewProcessCodeRuntime([]string{"node", "runtime-server.mjs"}, nil)`,
			`let runtime = ProcessCodeRuntime::new(vec!["node".into(), "runtime-server.mjs".into()]);`,
		)
	case "AxGEPA":
		return mapTarget(target,
			`engine = AxGEPA(reflection_client)`,
			`AxGEPA engine = new AxGEPA(reflectionClient, Map.of());`,
			`axllm::AxGEPA engine(reflection_client);`,
			`engine := axllm.NewGEPA(reflectionClient, nil)`,
			`let engine = AxGEPA::new(reflection_client, json!({}));`,
		)
	case "AxBootstrapFewShot":
		return mapTarget(target,
			`bootstrap = AxBootstrapFewShot(qualityThreshold=0.7)`,
			`AxBootstrapFewShot bootstrap = new AxBootstrapFewShot(Map.of("qualityThreshold", 0.7));`,
			`axllm::AxBootstrapFewShot bootstrap(axllm::object({{"qualityThreshold", 0.7}}));`,
			`bootstrap := axllm.NewBootstrapFewShot(map[string]axllm.Value{"qualityThreshold": 0.7})`,
			`let bootstrap = AxBootstrapFewShot::new(json!({"qualityThreshold": 0.7}));`,
		)
	case "optimize":
		return mapTarget(target,
			`artifact = optimize(qa, train, {"studentAI": client, "teacherAI": reflection})`,
			`Map<String, Object> artifact = Ax.optimize(qa, train, Map.of("studentAI", client, "teacherAI", reflection));`,
			`auto artifact = axllm::optimize(qa, client, train, axllm::object({}), &reflection);`,
			`artifact, err := axllm.Optimize(qa, train, map[string]axllm.Value{"studentAI": client})`,
			`let artifact = optimize(&mut qa, train, json!({"maxMetricCalls": 100}))?;`,
		)
	case "playbook":
		return mapTarget(target,
			`pb = playbook(program, {"studentAI": client})`,
			`AxPlaybook pb = Ax.playbook(program, Map.of("studentAI", client));`,
			`auto pb = axllm::playbook(program, client);`,
			`pb := axllm.Playbook(program, map[string]axllm.Value{"studentAI": client})`,
			`let pb = playbook(program, student, None::<Rc<RefCell<OpenAICompatibleClient>>>, json!({}));`,
		)
	default:
		return ""
	}
}

func runtimeProfilesForTarget(target string) []RuntimeProfileManifestEntry {
	switch target {
	case "python":
		return []RuntimeProfileManifestEntry{
			{
				ID:                  "javascript-quickjs",
				ActorLanguage:       "javascript",
				SupportMode:         "process-adapter",
				DependencyMode:      "optional-env",
				EnvironmentGates:    []string{"AXIR_QUICKJS4J_CP", "AXIR_QUICKJS4J_CP_FILE", "AXIR_QUICKJS4J_RESOLVE"},
				VerificationCommand: "tools/axir verify --targets python --runtime-profiles javascript-quickjs",
			},
			{
				ID:                  "python-pyodide",
				ActorLanguage:       "python",
				SupportMode:         "process-adapter",
				DependencyMode:      "optional-env",
				EnvironmentGates:    []string{"AXIR_PYODIDE_RUNTIME_SERVER", "AXIR_PYODIDE_RESOLVE"},
				VerificationCommand: "tools/axir verify --targets python --runtime-profiles python-pyodide",
			},
		}
	case "java":
		return []RuntimeProfileManifestEntry{
			{
				ID:                  "javascript-quickjs",
				ActorLanguage:       "javascript",
				SupportMode:         "embedded",
				DependencyMode:      "optional-classpath",
				EnvironmentGates:    []string{"AXIR_QUICKJS4J_CP", "AXIR_QUICKJS4J_CP_FILE", "AXIR_QUICKJS4J_RESOLVE"},
				VerificationCommand: "tools/axir verify --targets java --runtime-profiles javascript-quickjs",
			},
			{
				ID:                  "python-pyodide",
				ActorLanguage:       "python",
				SupportMode:         "process-adapter",
				DependencyMode:      "optional-env",
				EnvironmentGates:    []string{"AXIR_PYODIDE_RUNTIME_SERVER", "AXIR_PYODIDE_RESOLVE"},
				VerificationCommand: "tools/axir verify --targets java --runtime-profiles python-pyodide",
			},
		}
	case "cpp":
		return []RuntimeProfileManifestEntry{
			{
				ID:                  "javascript-quickjs",
				ActorLanguage:       "javascript",
				SupportMode:         "embedded",
				DependencyMode:      "optional-build",
				FeatureGate:         "AX_BUILD_QUICKJS_PROFILE",
				EnvironmentGates:    []string{"AXIR_QUICKJS_CFLAGS", "AXIR_QUICKJS_LDFLAGS"},
				VerificationCommand: "tools/axir verify --targets cpp --runtime-profiles javascript-quickjs",
			},
			{
				ID:                  "python-pyodide",
				ActorLanguage:       "python",
				SupportMode:         "process-adapter",
				DependencyMode:      "optional-env",
				EnvironmentGates:    []string{"AXIR_PYODIDE_RUNTIME_SERVER", "AXIR_PYODIDE_RESOLVE"},
				VerificationCommand: "tools/axir verify --targets cpp --runtime-profiles python-pyodide",
			},
		}
	case "go":
		return []RuntimeProfileManifestEntry{{
			ID:                  "javascript-goja",
			ActorLanguage:       "javascript",
			SupportMode:         "embedded",
			DependencyMode:      "optional-import",
			VerificationCommand: "tools/axir verify --targets go --runtime-profiles javascript-goja",
		}}
	case "rust":
		return []RuntimeProfileManifestEntry{{
			ID:                  "javascript-quickjs",
			ActorLanguage:       "javascript",
			SupportMode:         "embedded",
			DependencyMode:      "optional-feature",
			FeatureGate:         "runtime-quickjs",
			VerificationCommand: "tools/axir verify --targets rust --runtime-profiles javascript-quickjs",
		}}
	default:
		return nil
	}
}

func targetCoreOwnedFeatureGroups(target string, groups []string) []string {
	profileGroups := map[string]bool{
		"axagent-runtime-profile-javascript-quickjs":   true,
		"axagent-runtime-quickjs-session-state":        true,
		"axagent-runtime-quickjs-host-calls":           true,
		"axagent-runtime-quickjs-native-host-calls":    true,
		"axagent-runtime-quickjs-callback-errors":      true,
		"axagent-runtime-quickjs-limits":               true,
		"axagent-runtime-quickjs-diagnostics":          true,
		"axagent-runtime-profile-python-pyodide":       true,
		"axagent-runtime-pyodide-session-state":        true,
		"axagent-runtime-pyodide-host-calls":           true,
		"axagent-runtime-pyodide-diagnostics":          true,
		"axagent-runtime-profile-parity":               true,
		"axagent-runtime-axjs-reference":               true,
		"axagent-runtime-profile-state-parity":         true,
		"axagent-runtime-profile-diagnostics":          true,
		"axagent-runtime-profile-agent-forward":        true,
		"axagent-runtime-profile-actor-loop":           true,
		"axagent-runtime-profile-productization-alpha": true,
		"axagent-runtime-profile-policy":               true,
		"axagent-runtime-profile-package-policy":       true,
		"axagent-runtime-profile-javascript-goja":      true,
		"axagent-runtime-goja-session-state":           true,
		"axagent-runtime-goja-host-calls":              true,
		"axagent-runtime-goja-policy":                  true,
		"axagent-runtime-goja-diagnostics":             true,
	}
	out := make([]string, 0, len(groups))
	seen := map[string]bool{}
	add := func(group string) {
		if seen[group] {
			return
		}
		seen[group] = true
		out = append(out, group)
	}
	for _, group := range groups {
		if profileGroups[group] {
			continue
		}
		add(group)
	}
	if len(runtimeProfilesForTarget(target)) == 0 {
		return out
	}
	for _, group := range []string{
		"axagent-runtime-profile-parity",
		"axagent-runtime-axjs-reference",
		"axagent-runtime-profile-state-parity",
		"axagent-runtime-profile-diagnostics",
		"axagent-runtime-profile-agent-forward",
		"axagent-runtime-profile-actor-loop",
		"axagent-runtime-profile-productization-alpha",
		"axagent-runtime-profile-policy",
		"axagent-runtime-profile-package-policy",
	} {
		add(group)
	}
	if runtimeProfileClaimed(target, "javascript-quickjs") {
		for _, group := range []string{
			"axagent-runtime-profile-javascript-quickjs",
			"axagent-runtime-quickjs-session-state",
			"axagent-runtime-quickjs-host-calls",
			"axagent-runtime-quickjs-native-host-calls",
			"axagent-runtime-quickjs-callback-errors",
			"axagent-runtime-quickjs-limits",
			"axagent-runtime-quickjs-diagnostics",
		} {
			add(group)
		}
	}
	if runtimeProfileClaimed(target, "python-pyodide") {
		for _, group := range []string{
			"axagent-runtime-profile-python-pyodide",
			"axagent-runtime-pyodide-session-state",
			"axagent-runtime-pyodide-host-calls",
			"axagent-runtime-pyodide-diagnostics",
		} {
			add(group)
		}
	}
	if runtimeProfileClaimed(target, "javascript-goja") {
		for _, group := range []string{
			"axagent-runtime-profile-javascript-goja",
			"axagent-runtime-goja-session-state",
			"axagent-runtime-goja-host-calls",
			"axagent-runtime-goja-policy",
			"axagent-runtime-goja-diagnostics",
		} {
			add(group)
		}
	}
	return out
}

func runtimeProfileClaimed(target, id string) bool {
	for _, profile := range runtimeProfilesForTarget(target) {
		if profile.ID == id {
			return true
		}
	}
	return false
}

func knownRuntimeProfileIDs() []string {
	return []string{"javascript-quickjs", "javascript-goja", "python-pyodide"}
}

func runtimeProfileCoverageCategory(target, id string) string {
	if !runtimeProfileClaimed(target, id) {
		return "explicitly-not-claimed"
	}
	for _, profile := range runtimeProfilesForTarget(target) {
		if profile.ID != id {
			continue
		}
		switch profile.SupportMode {
		case "embedded":
			return "semantic"
		default:
			return "transport-boundary"
		}
	}
	return "explicitly-not-claimed"
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
		{"axflow", "flow_mermaid", "", "semantic"},
		{"axflow", "flow_mermaid", "builder_render", "semantic"},
		{"axflow", "flow_mermaid", "error", "validation-error"},
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
		{"axoptimize", "optimize", "bootstrap", "semantic"},
		{"axoptimize", "optimize", "helper", "semantic"},
		{"axoptimize", "optimize", "eval", "semantic"},
		{"axmcp", "mcp", "initialize", "transport-boundary"},
		{"axmcp", "mcp", "protocol_negotiation", "semantic"},
		{"axmcp", "mcp", "ping", "transport-boundary"},
		{"axmcp", "mcp", "tools", "semantic"},
		{"axmcp", "mcp", "prompts_resources", "semantic"},
		{"axmcp", "mcp", "roots_notifications", "semantic"},
		{"axmcp", "mcp", "cancellation", "transport-boundary"},
		{"axmcp", "mcp", "http_session_headers", "transport-boundary"},
		{"axmcp", "mcp", "stdio_framing", "transport-boundary"},
		{"axmcp", "mcp", "oauth", "transport-boundary"},
		{"axmcp", "mcp", "ssrf", "validation-error"},
		{"axevent", "event", "routing", "semantic"},
		{"axevent", "event", "retry", "semantic"},
		{"axevent", "event", "continuation", "semantic"},
		{"axevent", "event", "mcp_normalization", "semantic"},
		{"axevent", "event", "mapping", "semantic"},
		{"axevent", "event", "lifecycle", "semantic"},
	} {
		add(entry.suite, entry.kind, entry.operation, entry.category)
	}
	for _, profileID := range knownRuntimeProfileIDs() {
		add("axagent", "agent_runtime_profile", profileID, runtimeProfileCoverageCategory(target, profileID))
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
	profileCoverage := map[string]string{}
	for _, entry := range coverage.Suites["axagent"] {
		if entry.Kind == "agent_runtime_profile" && strings.TrimSpace(entry.Operation) != "" {
			profileCoverage[entry.Operation] = entry.Category
		}
	}
	for _, profile := range manifest.RuntimeProfiles {
		category, ok := profileCoverage[profile.ID]
		if !ok {
			return fmt.Errorf("conformance coverage missing runtime profile %q", profile.ID)
		}
		if category == "explicitly-not-claimed" {
			return fmt.Errorf("conformance coverage marks manifest runtime profile %q as explicitly-not-claimed", profile.ID)
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
	for _, symbol := range []string{"AxError", "AxResult", "ScriptedTransport"} {
		if !seen[symbol] {
			out = append(out, symbol)
		}
	}
	for _, symbol := range []string{"QuickJsCodeRuntime", "QuickJsCodeSession", "HostCallable"} {
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

func APIReferenceManifestJSON(model AxRuntimeModel, target string) (string, error) {
	manifest, err := BuildAPIReferenceManifest(model, target)
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

func packageAPIReferenceMarkdown(model AxRuntimeModel, target string) string {
	manifest, err := BuildAPIReferenceManifest(model, target)
	if err != nil {
		panic(err)
	}
	title := mapTarget(target, "Ax for Python", "Ax for Java", "Ax for C++", "Ax for Go", "Ax for Rust")
	fence := mapTarget(target, "python", "java", "cpp", "go", "rust")
	var lines []string
	lines = append(lines,
		"# "+title+" API Reference",
		"",
		"This generated API reference is emitted by AxIR from compiler-owned metadata. Do not edit it by hand; change the AxIR generator and regenerate packages instead.",
		"",
		"## Package",
		"",
		fmt.Sprintf("- Target: `%s`", manifest.Target),
		fmt.Sprintf("- Package: `%s`", manifest.PackageName),
		fmt.Sprintf("- AxIR contract: `%s`", manifest.AxIRVersion),
	)
	for _, section := range manifest.Sections {
		lines = append(lines, "", "## "+section.Title, "", section.Summary, "")
		for _, symbol := range section.Symbols {
			lines = append(lines,
				"### `"+symbol.PublicName+"`",
				"",
				symbol.Description,
				"",
				fmt.Sprintf("- Canonical Ax concept: `%s`", symbol.CanonicalName),
				fmt.Sprintf("- Kind: `%s`", symbol.Kind),
				fmt.Sprintf("- Form: `%s`", symbol.Form),
				fmt.Sprintf("- Returns: `%s`", symbol.Returns),
			)
			if len(symbol.ImportantOptions) > 0 {
				lines = append(lines, "- Important options: "+strings.Join(symbol.ImportantOptions, ", "))
			}
			if symbol.Example != "" {
				lines = append(lines, "", "```"+fence, symbol.Example, "```")
			}
			lines = append(lines, "")
		}
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
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

func mustAPIReferenceManifest(model AxRuntimeModel, target string) string {
	text, err := APIReferenceManifestJSON(model, target)
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
		return "github.com/ax-llm/ax/packages/go"
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
		network = "not implemented; use the scripted transport/Transport boundary"
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
		"- Audio and realtime: `.chat()` accepts `input_audio` content parts, `transcribe()`/`speak()` do batch speech-to-text and text-to-speech, and realtime-capable models stream audio over a WebSocket — transparently through `chat()` or via the productized `realtime_chat()` driver (Go: `RealtimeChat`).",
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
		fmt.Sprintf("- Scripted transport support: %t", manifest.ScriptedTransportSupport),
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
				"pip install axllm",
				"```",
				"",
				"Realtime audio over WebSocket is an opt-in extra (pulls `websocket-client`):",
				"",
				"```bash",
				"pip install axllm[realtime]",
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
				"- `python examples/axgen_scripted_client_tool.py`: AxGen with a scripted client and tool",
				"- `python examples/provider_mapping_no_key.py`: provider mapping through a scripted transport",
				"- `python examples/provider_stream_no_key.py`: provider streaming through a scripted SSE transport",
				"- `python examples/axflow_program_graph.py`: AxFlow program graph",
				"- `python examples/flow_mermaid.py`: portable Mermaid flow parsing and canonical round-trip",
				"- `python examples/audio_responses_mapping.py`: OpenAI Responses speak/transcribe mapping through a scripted transport",
				"- `python examples/realtime_audio_events.py`: Grok/Gemini realtime audio setup, input, and event folding",
				"- `python examples/realtime_audio_turn.py`: drive a full realtime audio turn through the productized `realtime_chat()` driver (offline, scripted transport)",
				"- `python examples/runtime_adapter.py`: custom `AxCodeRuntime` session",
				"- `python examples/runtime_protocol.py`: process runtime protocol against the AxJS reference adapter",
				"- `python examples/optimizer_artifact.py`: optimizer artifact save/load/apply lifecycle",
				"- `python examples/gepa_local_optimizer.py`: local GEPA optimizer artifact generation",
				"- `python examples/ace_playbook.py`: grow an evolving context playbook with `playbook()` (offline, scripted client)",
				"- `python examples/agent_playbook.py`: attach a seeded agent playbook, exercise stage instructions and citations, learn from run-end failures, and verify accept/rollback evolution (offline, scripted client)",
				"- `python examples/mcp_scripted_tools.py`: MCP tool discovery and invocation through a scripted transport",
			),
			ProviderExamples: readmeLines(
				"- `OPENAI_API_KEY=... python examples/axgen_openai_api.py`: AxGen with a real OpenAI-compatible provider API",
				"- `OPENAI_API_KEY=... python examples/flow_openai_api.py`: AxFlow with a real OpenAI-compatible provider API",
			),
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
				"Add the dependency from Maven Central:",
				"",
				"```xml",
				"<dependency>",
				"  <groupId>dev.axllm</groupId>",
				"  <artifactId>ax</artifactId>",
				"  <version>"+generatedPackageVersion()+"</version>",
				"</dependency>",
				"```",
				"",
				"Or with Gradle:",
				"",
				"```groovy",
				"implementation 'dev.axllm:ax:"+generatedPackageVersion()+"'",
				"```",
				"",
				"Realtime audio over WebSocket uses the JDK's built-in `java.net.http` WebSocket — no extra dependency.",
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
				"- `examples/AxGenScriptedClientToolExample.java`: AxGen with a scripted client and tool",
				"- `examples/ProviderMappingNoKeyExample.java`: provider mapping through a scripted transport",
				"- `examples/ProviderStreamNoKeyExample.java`: provider streaming through a scripted SSE transport",
				"- `examples/AxFlowProgramGraphExample.java`: AxFlow program graph",
				"- `examples/FlowMermaidExample.java`: portable Mermaid flow parsing and canonical round-trip",
				"- `examples/AudioResponsesMappingExample.java`: OpenAI Responses speak/transcribe mapping through a scripted transport",
				"- `examples/RealtimeAudioEventsExample.java`: Grok/Gemini realtime audio setup, input, and event folding",
				"- `examples/RealtimeAudioTurnExample.java`: drive a full realtime audio turn through `realtimeChat` (offline, scripted transport)",
				"- `examples/RuntimeAdapterExample.java`: custom `AxCodeRuntime` session",
				"- `examples/RuntimeProtocolExample.java`: process runtime protocol against the AxJS reference adapter",
				"- `examples/OptimizerArtifactExample.java`: optimizer artifact save/load/apply lifecycle",
				"- `examples/GEPALocalOptimizerExample.java`: local GEPA optimizer artifact generation",
				"- `examples/ACEPlaybookExample.java`: grow an evolving context playbook with `Ax.playbook()` (offline, scripted client)",
				"- `examples/AgentPlaybookExample.java`: attach a seeded agent playbook, exercise stage instructions and citations, learn from run-end failures, and verify accept/rollback evolution (offline, scripted client)",
				"- `examples/AxMCPScriptedToolsExample.java`: MCP tool discovery and invocation through a scripted transport",
			),
			ProviderExamples: readmeLines(
				"- `OPENAI_API_KEY=... javac -cp . dev/axllm/ax/*.java examples/AxGenOpenAIExample.java && java -cp .:examples AxGenOpenAIExample`: AxGen with a real OpenAI-compatible provider API",
				"- `OPENAI_API_KEY=... javac -cp . dev/axllm/ax/*.java examples/FlowOpenAIExample.java && java -cp .:examples FlowOpenAIExample`: AxFlow with a real OpenAI-compatible provider API",
			),
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
				"Add Ax to your CMake project with `FetchContent`:",
				"",
				"```cmake",
				"include(FetchContent)",
				"FetchContent_Declare(axllm GIT_REPOSITORY https://github.com/ax-llm/ax GIT_TAG main SOURCE_SUBDIR packages/cpp)",
				"FetchContent_MakeAvailable(axllm)",
				"target_link_libraries(your_app PRIVATE axllm::axllm)",
				"```",
				"",
				"Realtime audio over WebSocket is opt-in; enable it (fetches IXWebSocket) by setting the CMake option before `FetchContent_MakeAvailable`:",
				"",
				"```cmake",
				"set(AXLLM_ENABLE_REALTIME ON)",
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
				"- `examples/axgen_scripted_client_tool.cpp`: AxGen with a scripted client and tool",
				"- `examples/provider_mapping_no_key.cpp`: provider mapping through a scripted transport",
				"- `examples/provider_stream_no_key.cpp`: provider streaming through a scripted SSE transport",
				"- `examples/axflow_program_graph.cpp`: AxFlow program graph",
				"- `examples/flow_mermaid.cpp`: portable Mermaid flow parsing and canonical round-trip",
				"- `examples/audio_responses_mapping.cpp`: OpenAI Responses speak/transcribe mapping through a scripted transport",
				"- `examples/realtime_audio_events.cpp`: Grok/Gemini realtime audio setup, input, and event folding",
				"- `examples/realtime_audio_turn.cpp`: drive a full realtime audio turn through `realtime_chat` (offline, scripted transport)",
				"- `examples/runtime_adapter.cpp`: custom `AxCodeRuntime` session",
				"- `examples/runtime_protocol.cpp`: process runtime protocol against the AxJS reference adapter",
				"- `examples/optimizer_artifact.cpp`: optimizer artifact save/load/apply lifecycle",
				"- `examples/gepa_local_optimizer.cpp`: local GEPA optimizer artifact generation",
				"- `examples/ace_playbook.cpp`: grow an evolving context playbook with `playbook()` (offline, scripted client)",
				"- `examples/agent_playbook.cpp`: attach a seeded agent playbook, exercise stage instructions and citations, learn from run-end failures, and verify accept/rollback evolution (offline, scripted client)",
				"- `examples/mcp_scripted_tools.cpp`: MCP tool discovery and invocation through a scripted transport",
			),
			ProviderExamples: readmeLines(
				"- `OPENAI_API_KEY=... ./build/axgen_openai_api`: AxGen with a real OpenAI-compatible provider API after building examples",
				"- `OPENAI_API_KEY=... ./build/flow_openai_api`: AxFlow with a real OpenAI-compatible provider API after building examples",
			),
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
				"go get github.com/ax-llm/ax/packages/go",
				"```",
				"",
				"Realtime audio over WebSocket needs Go 1.23+; the module pulls in `github.com/coder/websocket` automatically.",
			),
			QuickStart: readmeLines(
				"```go",
				"package main",
				"",
				"import ax \"github.com/ax-llm/ax/packages/go\"",
				"",
				"func main() {",
				"    sig := ax.NewSignature(\"question:string -> answer:string\")",
				"    _ = sig.ToJSONSchema(nil)",
				"}",
				"```",
			),
			PackageFacts: readmeLines(
				"- Module: `github.com/ax-llm/ax/packages/go`",
				"- Import alias used in examples: `ax`",
				"- Base package uses the Go standard library for HTTP/process boundaries",
				"- Optional JavaScript actor execution lives in `runtime/goja` and is opt-in by import",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `go run ./examples/signature_schema`: signature parsing and JSON schema generation",
				"- `go run ./examples/axgen_scripted_client_tool`: AxGen with a scripted client and tool",
				"- `go run ./examples/provider_mapping_no_key`: provider mapping through a scripted transport",
				"- `go run ./examples/provider_stream_no_key`: provider streaming through a scripted SSE transport",
				"- `go run ./examples/axflow_program_graph`: AxFlow program graph",
				"- `go run ./examples/flow_mermaid`: portable Mermaid flow parsing and canonical round-trip",
				"- `go run ./examples/audio_responses_mapping`: OpenAI Responses speak/transcribe mapping through a scripted transport",
				"- `go run ./examples/realtime_audio_events`: Grok/Gemini realtime audio setup, input, and event folding",
				"- `go run ./examples/realtime_audio_turn`: drive a full realtime audio turn through `RealtimeChat` (offline, scripted transport)",
				"- `go run ./examples/runtime_adapter`: custom `AxCodeRuntime` session",
				"- `go run ./examples/runtime_protocol`: process runtime protocol against the AxJS reference adapter",
				"- `go run ./examples/optimizer_artifact`: optimizer artifact save/load/apply lifecycle",
				"- `go run ./examples/gepa_local_optimizer`: local GEPA optimizer artifact generation",
				"- `go run ./examples/ace_playbook`: grow an evolving context playbook with `Playbook()` (offline, scripted client)",
				"- `go run ./examples/agent_playbook`: attach a seeded agent playbook, exercise stage instructions and citations, learn from run-end failures, and verify accept/rollback evolution (offline, scripted client)",
				"- `go run ./examples/mcp_scripted_tools`: MCP tool discovery and invocation through a scripted transport",
			),
			ProviderExamples: readmeLines(
				"- From the repo root, `OPENAI_API_KEY=... npm run example -- go axgen_openai_api.go`: AxGen with a real OpenAI-compatible provider API",
				"- From the repo root, `OPENAI_API_KEY=... npm run example -- go flow_openai_api.go`: AxFlow with a real OpenAI-compatible provider API",
			),
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
				"cargo add axllm",
				"```",
				"",
				"Or add to your `Cargo.toml`:",
				"",
				"```toml",
				"axllm = \""+generatedPackageVersion()+"\"",
				"```",
				"",
				"Enable realtime audio over WebSocket with the `realtime` feature (pulls `tungstenite`):",
				"",
				"```bash",
				"cargo add axllm --features realtime",
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
				"- Runtime execution: process/JSONL protocol through `ProcessCodeRuntime`; embedded QuickJS is opt-in with the `runtime-quickjs` Cargo feature",
				"- Network support: "+network,
			),
			NoKeyExamples: readmeLines(
				"- `cargo run --example signature_schema`: signature parsing and JSON schema generation",
				"- `cargo run --example provider_mapping_no_key`: provider mapping through a scripted transport",
				"- `cargo run --example provider_stream_no_key`: provider streaming through a scripted SSE transport",
				"- `cargo run --example axgen_scripted_client_tool`: AxGen with a scripted client and tool",
				"- `cargo run --example axflow_program_graph`: AxFlow program graph",
				"- `cargo run --example flow_mermaid`: portable Mermaid flow parsing and canonical round-trip",
				"- `cargo run --example audio_responses_mapping`: OpenAI Responses speak/transcribe mapping through a scripted transport",
				"- `cargo run --example realtime_audio_events`: Grok/Gemini realtime audio setup, input, and event folding",
				"- `cargo run --example realtime_audio_turn`: drive a full realtime audio turn through `realtime_chat` (offline, scripted transport)",
				"- `cargo run --example runtime_adapter`: custom `AxCodeRuntime` session",
				"- `cargo run --example runtime_protocol`: process runtime protocol against the AxJS reference adapter",
				"- `cargo run --example javascript_quickjs --features runtime-quickjs`: embedded QuickJS actor runtime profile",
				"- `cargo run --example optimizer_artifact`: optimizer artifact lifecycle smoke",
				"- `cargo run --example gepa_local_optimizer`: local GEPA optimizer artifact generation",
				"- `cargo run --example ace_playbook`: grow an evolving context playbook with `playbook()` (offline, scripted client)",
				"- `cargo run --example agent_playbook`: attach a seeded agent playbook, exercise stage instructions and citations, learn from run-end failures, and verify accept/rollback evolution (offline, scripted client)",
				"- `cargo run --example mcp_scripted_tools`: MCP tool discovery and invocation through a scripted transport",
			),
			ProviderExamples: readmeLines(
				"- `OPENAI_API_KEY=... cargo run --example axgen_openai_api`: AxGen with a real OpenAI-compatible provider API",
				"- `OPENAI_API_KEY=... cargo run --example flow_openai_api`: AxFlow with a real OpenAI-compatible provider API",
			),
			RuntimeProfiles: readmeLines(
				"Runtime profiles are target-specific and opt in to their engine dependencies:",
				"",
				"- `ProcessCodeRuntime` speaks the shared AxCodeRuntime JSONL protocol.",
				"- `javascript-quickjs` is an embedded JavaScript actor runtime backed by `rquickjs` and gated by Cargo feature `runtime-quickjs`.",
				"",
				"Verify it with `axir verify --targets rust --runtime-profiles javascript-quickjs` when the AxIR toolchain is available.",
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
