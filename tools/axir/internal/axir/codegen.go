package axir

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	files := map[string]string{
		"ax/__init__.py":                     pyInit,
		"ax/signature.py":                    signature,
		"ax/schema.py":                       schema,
		"ax/tool.py":                         pyTool,
		"ax/prompt.py":                       prompt,
		"ax/ai.py":                           ai,
		"ax/gen.py":                          gen,
		"ax/agent.py":                        agent,
		"ax/conformance.py":                  pyConformance,
		"ax/providers/__init__.py":           pyProvidersInit,
		"ax/providers/openai.py":             pyOpenAIProvider,
		"axir-capabilities.json":             mustCapabilityManifest(model, "python"),
		"examples/signature_schema.py":       pySignatureSchemaExample,
		"examples/axgen_fake_client_tool.py": pyAxGenFakeClientToolExample,
		"examples/axai_fake_transport.py":    pyAxAIFakeTransportExample,
		"examples/axagent_pipeline.py":       pyAxAgentPipelineExample,
		"README.md":                          packageREADME(model, "python"),
	}
	return writeFiles(outDir, files)
}

func EmitJava(model AxRuntimeModel, outDir string) error {
	core, err := BuildJavaCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"dev/ax/Ax.java":                            javaAx,
		"dev/ax/AxSignature.java":                   javaSignature,
		"dev/ax/Field.java":                         javaField,
		"dev/ax/FieldType.java":                     javaFieldType,
		"dev/ax/Tool.java":                          javaTool,
		"dev/ax/PromptTemplate.java":                javaPromptTemplate,
		"dev/ax/Core.java":                          core,
		"dev/ax/AiClient.java":                      javaAiClient,
		"dev/ax/AxAIService.java":                   javaAxAIService,
		"dev/ax/AxBaseAI.java":                      javaAxBaseAI,
		"dev/ax/AxAIServiceError.java":              javaAxAIServiceError,
		"dev/ax/AxMemory.java":                      javaAxMemory,
		"dev/ax/AxAgent.java":                       javaAxAgent,
		"dev/ax/AxAgentClarificationException.java": javaAxAgentClarificationException,
		"dev/ax/AxCodeRuntime.java":                 javaAxCodeRuntime,
		"dev/ax/AxCodeSession.java":                 javaAxCodeSession,
		"dev/ax/OpenAICompatibleClient.java":        javaOpenAI,
		"dev/ax/AxGen.java":                         javaAxGen,
		"dev/ax/Json.java":                          javaJson,
		"dev/ax/Conformance.java":                   javaConformance,
		"axir-capabilities.json":                    mustCapabilityManifest(model, "java"),
		"examples/SignatureSchemaExample.java":      javaSignatureSchemaExample,
		"examples/AxGenFakeClientToolExample.java":  javaAxGenFakeClientToolExample,
		"examples/AxAIFakeTransportExample.java":    javaAxAIFakeTransportExample,
		"examples/AxAgentPipelineExample.java":      javaAxAgentPipelineExample,
		"README.md":                                 packageREADME(model, "java"),
	}
	return writeFiles(outDir, files)
}

func EmitCpp(model AxRuntimeModel, outDir string) error {
	core, err := BuildCppCore(model)
	if err != nil {
		return err
	}
	files := map[string]string{
		"ax/ax.hpp":                           cppHeader,
		"ax/ax.cpp":                           strings.Replace(cppRuntime, "// AXIR_CORE_CPP_FUNCTIONS\n", core, 1),
		"conformance.cpp":                     cppConformance,
		"axir-capabilities.json":              mustCapabilityManifest(model, "cpp"),
		"examples/signature_schema.cpp":       cppSignatureSchemaExample,
		"examples/axgen_fake_client_tool.cpp": cppAxGenFakeClientToolExample,
		"examples/axai_fake_transport.cpp":    cppAxAIFakeTransportExample,
		"examples/axagent_pipeline.cpp":       cppAxAgentPipelineExample,
		"README.md":                           packageREADME(model, "cpp"),
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
		"provider balancing",
		"OpenTelemetry",
		"realtime",
		"audio/file execution",
	}
	realNetwork := target == "python" || target == "java"
	if target == "cpp" {
		unsupported = append(unsupported, "real OpenAI-compatible HTTP transport")
	}
	return CapabilityManifest{
		AxIRVersion:             "0.1",
		Target:                  target,
		PackageName:             packageNameForTarget(target),
		SupportedSuites:         []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent"},
		ProviderMode:            "openai-compatible-mapping",
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
			"openai-compatible-provider-mapping",
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
			"axagent-actor-step-alpha",
			"axagent-runtime-language",
			"axagent-actor-prompt-cache",
			"axagent-context-cache-precedence",
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
		return "ax"
	case "java":
		return "dev.ax"
	case "cpp":
		return "ax"
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
	if !manifest.RealNetworkSupport {
		network = "not implemented; use the fake transport/Transport boundary"
	}
	return fmt.Sprintf(`# Generated Ax %s Library

Generated from AxIR AxCore modules.

## Contract

- AxIR version: %s
- Package: %s
- Supported conformance suites: %s
- Provider mode: %s
- Fake transport support: %t
- Real network support: %s

The deterministic Ax runtime semantics are Core-owned. Target-owned code is
limited to idiomatic wrappers, transport boundaries, and language primitives.

## Examples

See the files in `+"`examples/`"+` for:

- signature parsing and JSON schema generation
- AxGen forward with a fake client and tool
- AxAI/OpenAI-compatible mapping with a fake transport
- AxAgent pipeline alpha with a fake service
`, strings.ToUpper(target), manifest.AxIRVersion, manifest.PackageName, strings.Join(manifest.SupportedSuites, ", "), manifest.ProviderMode, manifest.FakeTransportSupport, network)
}
