package axir

import (
	"fmt"
	"strings"
)

type packageSkillSpec struct {
	ID          string
	Title       string
	Area        string
	Description string
	UseWhen     []string
	Sections    []string
}

var packageSkillSpecs = []packageSkillSpec{
	{
		ID:          "llm",
		Title:       "Ax LLM Quick Reference",
		Area:        "core Ax package usage",
		Description: "using the generated Ax package, factory functions, package docs, examples, and API reference",
		UseWhen: []string{
			"Start a generated-language Ax program from package docs or examples.",
			"Translate the Ax mental model into the target package without TypeScript-only imports.",
			"Choose the native package entrypoints for signatures, providers, generators, agents, flows, and optimizers.",
			"Find ordered or adaptive provider-balancing guidance in the language-specific AI skill.",
		},
		Sections: []string{"signatures", "axgen", "axai", "agents-rlm", "flow", "optimizers"},
	},
	{
		ID:          "ai",
		Title:       "AxAI Providers",
		Area:        "provider clients and model routing",
		Description: "provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers",
		UseWhen: []string{
			"Create provider clients or normalize provider options.",
			"Choose between model-list routing, ordered failover, and adaptive operational routing.",
			"Use scripted transports for deterministic no-key examples.",
			"Use provider-api examples only when explicit provider credentials are available.",
		},
		Sections: []string{"axai"},
	},
	{
		ID:          "audio",
		Title:       "Ax Audio And Realtime",
		Area:        "audio and realtime provider mappings",
		Description: "audio input/output, OpenAI Responses audio mapping, realtime event folding, and generated package audio examples",
		UseWhen: []string{
			"Map speech, transcription, or realtime events through the generated provider surface.",
			"Use no-key examples for event folding and provider request mapping.",
			"Keep live provider calls behind explicit credentials and provider-api examples.",
		},
		Sections: []string{"axai"},
	},
	{
		ID:          "signature",
		Title:       "Ax Signatures",
		Area:        "signatures, fields, schemas, and validation",
		Description: "string signatures, field descriptors, JSON schema output, validation, and typed tool argument shapes",
		UseWhen: []string{
			"Declare input and output contracts with native generated-package APIs.",
			"Generate JSON-schema-compatible shapes for outputs, tools, prompts, and validation.",
			"Keep Standard Schema and TypeScript-only helper libraries out of generated-language code.",
		},
		Sections: []string{"signatures", "tools"},
	},
	{
		ID:          "gen",
		Title:       "AxGen Structured Generation",
		Area:        "structured generation and tools",
		Description: "AxGen programs, forward calls, streaming, tools, assertions, traces, usage, and output parsing",
		UseWhen: []string{
			"Build a structured generation program from a signature.",
			"Attach typed tools or MCP-derived tools to a generation call.",
			"Use package examples for no-key scripted clients and provider-api calls.",
		},
		Sections: []string{"axgen", "tools", "mcp"},
	},
	{
		ID:          "agent",
		Title:       "AxAgent",
		Area:        "RLM agents and tools",
		Description: "agents, child delegation, tools, MCP, citations, persistent playbook learning, stage instructions, runtime state, final typed responses, and direct-respond executor skipping",
		UseWhen: []string{
			"Create an RLM agent with tools, child agents, or MCP clients.",
			"Use clarification, discovery, recall, final, or respond envelopes.",
			"Require evidence citations, attach a persistent playbook, or add stage-owned actor instructions.",
			"Harvest run-end failures into the playbook and observe citation or playbook updates.",
			"Skip the executor stage for no-tool tasks with a distiller `respond` envelope (`directResponse`, on by default).",
			"Save and restore agent runtime state around long-running tasks.",
		},
		Sections: []string{"agents-rlm", "runtime-profiles", "mcp"},
	},
	{
		ID:          "agent-rlm",
		Title:       "AxAgent RLM Runtime",
		Area:        "runtime sessions and actor-code execution",
		Description: "RLM executor loops, AxCodeRuntime sessions, runtime envelopes, process runtimes, and optional runtime profiles",
		UseWhen: []string{
			"Wire an AxCodeRuntime or AxCodeSession implementation.",
			"Use ProcessCodeRuntime or an optional runtime profile for actor-code sessions.",
			"Explain that generated packages are not TypeScript transpilers; they adapt the Ax runtime contract.",
		},
		Sections: []string{"agents-rlm", "runtime-profiles"},
	},
	{
		ID:          "agent-memory-skills",
		Title:       "AxAgent Memory And Skills",
		Area:        "memory, recall, and dynamic skill loading",
		Description: "agent memory, recall callbacks, dynamic skill discovery, loaded-skill state, and used-skill tracking",
		UseWhen: []string{
			"Load memories or skill guides into an RLM agent run.",
			"Use static skillsCatalog or memoriesCatalog search without host callbacks.",
			"Preload constructor or forward-time skills with deterministic id merging.",
			"Track which memories or skills actually influenced a turn.",
			"Register non-fatal loaded/used observers in native option maps or target callback wrappers.",
		},
		Sections: []string{"agents-rlm", "runtime-profiles"},
	},
	{
		ID:          "agent-observability",
		Title:       "AxAgent Observability",
		Area:        "traces, logs, usage, and diagnostics",
		Description: "agent tracing, usage accounting, action logs, runtime diagnostics, replay, and production debugging",
		UseWhen: []string{
			"Inspect agent traces, runtime envelopes, usage, or action logs.",
			"Attach callbacks for model/tool activity and runtime progress.",
			"Debug agent loops through generated package state and examples.",
		},
		Sections: []string{"agents-rlm", "runtime-profiles"},
	},
	{
		ID:          "agent-optimize",
		Title:       "AxAgent Optimize",
		Area:        "agent evaluation and optimization artifacts",
		Description: "agent optimization, verified agent-playbook evolution, evaluators, judges, optimizer artifacts, BootstrapFewShot, and GEPA",
		UseWhen: []string{
			"Optimize an AxAgent or reusable program component.",
			"Mine grounded weaknesses from failed agent tasks and keep only playbook proposals that pass the verification gate.",
			"Create evaluator callbacks and persist optimizer artifacts.",
			"Keep optimization runs bounded by explicit budgets and dataset rows.",
		},
		Sections: []string{"agents-rlm", "optimizers"},
	},
	{
		ID:          "agent-context",
		Title:       "AxAgent Context Selection",
		Area:        "choosing context maps, policy, optimization, and recall",
		Description: "deciding between context maps, trajectory context policy, offline optimization (ACE/GEPA), and memory recall for long-context agents",
		UseWhen: []string{
			"Choose between contextMap, contextPolicy, optimization, and recall for a task.",
			"Avoid mixing persistent corpus orientation with within-run compaction.",
			"Route long-context agent work to the right generated-package feature.",
		},
		Sections: []string{"agents-rlm", "runtime-profiles", "optimizers"},
	},
	{
		ID:          "flow",
		Title:       "AxFlow",
		Area:        "workflow graphs and orchestration",
		Description: "flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components",
		UseWhen: []string{
			"Compose generators, agents, and nested flows into a workflow graph.",
			"Reason about flow state, node inputs, returns, caching, and errors.",
			"Use generated package examples for flow graphs and provider-backed flows.",
		},
		Sections: []string{"flow"},
	},
	{
		ID:          "gepa",
		Title:       "Ax GEPA",
		Area:        "Pareto optimization and prompt evolution",
		Description: "GEPA, Pareto tradeoffs, reflection clients, metric budgets, optimizer state, and artifacts",
		UseWhen: []string{
			"Run the generated GEPA optimizer or inspect a GEPA artifact.",
			"Use BootstrapFewShot before GEPA when demonstrations should seed optimization.",
			"Track metric budgets, reflection calls, candidate state, and Pareto fronts.",
		},
		Sections: []string{"optimizers"},
	},
	{
		ID:          "playbook",
		Title:       "Ax Playbook",
		Area:        "evolving context playbooks",
		Description: "the playbook() context-engineering surface, agent-bound verified evolution, run-end learning, online updates, and rendering a playbook into a program",
		UseWhen: []string{
			"Grow an evolving context playbook for a program or agent stage with playbook().",
			"Attach a seed playbook to an agent and learn bounded avoidance rules from run-end failure signals.",
			"Use the agent-bound playbook evolve method to mine grounded weaknesses with verification and exact rollback.",
			"Refine a playbook online from live feedback or offline from labeled examples.",
			"Render or persist a playbook and inject it into a program context.",
		},
		Sections: []string{"optimizers"},
	},
	{
		ID:          "refine",
		Title:       "Ax Refinement Patterns",
		Area:        "candidate improvement and evaluation feedback",
		Description: "reward-scored generation, iterative candidate improvement, evaluator feedback, and optimizer-backed refinement patterns",
		UseWhen: []string{
			"Improve generated outputs with evaluator feedback or optimizer artifacts.",
			"Port TypeScript refinement intent into generated-language surfaces without assuming TypeScript-only helpers.",
			"Use generated optimizer APIs when the target package does not expose a standalone refine helper.",
		},
		Sections: []string{"axgen", "optimizers"},
	},
}

func addPackageSkills(files map[string]string, model AxRuntimeModel, target string) {
	for name, content := range packageSkills(model, target) {
		files[name] = content
	}
}

func packageSkills(model AxRuntimeModel, target string) map[string]string {
	out := map[string]string{}
	for _, spec := range packageSkillSpecs {
		name := skillName(target, spec)
		out["skills/"+name+"/SKILL.md"] = renderSkill(spec, model, target)
	}
	return out
}

func renderSkill(spec packageSkillSpec, model AxRuntimeModel, target string) string {
	manifest, err := BuildCapabilityManifest(model, target)
	if err != nil {
		panic(err)
	}
	apiRef, err := BuildAPIReferenceManifest(model, target)
	if err != nil {
		panic(err)
	}
	cfg := skillTargetConfig(target)
	name := skillName(target, spec)
	description := skillDescription(target, spec, cfg)
	expandedExamples := skillExpandedExamples(target, spec.ID, cfg.Fence)
	if expandedExamples != "" {
		expandedExamples += "\n\n"
	}
	routingGuide := ""
	if spec.ID == "ai" {
		routingGuide = readmeLines(
			"## Routing And Balancing",
			"",
			"- Use the multi-service router when a logical model key selects a configured service or concrete model. It combines model lists; it does not learn from outcomes.",
			"- Use the default `AxBalancer` for deterministic ordered/metric failover with its existing retry policy.",
			"- Opt into `AxBalancerAdaptiveStrategy` only for operational routing among application-approved equivalent aliases. It learns transient reliability and successful latency, combines them with estimated cost and a deadline, and explores with Thompson sampling.",
			"- Put centralized decision state in an `AxBalancerStatsStore`. The routing-event callback is best-effort analytics and observability, not a state replication mechanism.",
			"- Shared stores require non-empty, unique, stable route keys. Use slices to isolate workflows, tenants, or traffic classes without putting prompts, responses, raw errors, or sensitive identifiers in keys or events.",
			"- Adaptive balancing does not measure answer quality or semantically choose a model. Only group routes that the application already accepts as substitutes.",
			"- Generated streaming APIs are buffered: a provider error can fail over before the completed result is returned, and success latency is recorded after completion.",
			"- Start with `examples/adaptive_balancer_no_key` for store/reducer syntax, then use the cataloged provider-backed adaptive-balancer example for a complete two-route setup.",
			"",
		) + "\n"
	}
	agentMemoryGuide := ""
	if spec.ID == "agent-memory-skills" {
		legacyGet, legacySet, exportState, restoreState := skillAgentStateMethods(target)
		agentMemoryGuide = readmeLines(
			"## Lifecycle And State",
			"",
			"- Constructor `skills` seed the loaded-skill prompt without firing load observers.",
			"- Forward-time `skills` override constructor entries by normalized ID and remain loaded for later calls. IDs and names are trimmed, malformed entries are skipped, valid empty content is preserved, and rendered entries are ID-sorted.",
			"- A forward input named `memories` seeds the first actor turn. Recalled entries merge by ID for that run, then memory state resets before the next forward.",
			"- `onSkillsSearch` / `onMemoriesSearch` take precedence over static catalogs. Without a host callback, `skillsCatalog` / `memoriesCatalog` use the built-in deterministic lexical ranker.",
			"- `onLoadedMemories` / `onLoadedSkills` observe runtime recall and discovery, not constructor presets. `onUsedMemories` / `onUsedSkills` emit one consolidated notification per forward. Forward observers override constructor observers, and observer errors are ignored.",
			"- `relevanceRanking` produces advisory skill and memory hints using the same tokenization, weighting, tie suppression, limits, snippets, and already-loaded exclusion as TypeScript.",
			"- `"+legacyGet+"` and `"+legacySet+"` preserve the legacy bare-runtime snapshot shape. Use `"+exportState+"` and `"+restoreState+"` for the complete portable agent snapshot, including loaded skills and constructor-preset reapplication. Do not interchange the two shapes.",
			"",
			"## Runnable Examples",
			"",
			"- Provider-backed memory, skill, and observer lifecycle: `"+skillAgentMemoryExamplePath(target)+"`.",
			"- Catalog-only search and relevance hints: the target's `smart-defaults-agent` example under `src/examples/"+target+"/long-agents/`.",
			"- Website gallery: https://axllm.dev/"+target+"/examples/long-agents/.",
			"",
		) + "\n"
	}
	return readmeLines(
		skillFrontmatter(name, description, generatedPackageVersion()),
		"# "+spec.Title+" For "+cfg.Language,
		"",
		"This skill helps an agent write "+cfg.Language+" code with the generated Ax package `"+manifest.PackageName+"`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.",
		"",
		"## When To Use",
		"",
		skillBulletList(spec.UseWhen),
		"",
		"## Package Facts",
		"",
		skillBulletList([]string{
			"Language: " + cfg.Language + ".",
			"Package: `" + manifest.PackageName + "`.",
			"Package API docs: `API.md` and `axir-api.json`.",
			"Capability manifest: `axir-capabilities.json`.",
			"Runnable examples: `examples/`.",
			"Real network support: " + skillBoolText(manifest.RealNetworkSupport) + ".",
			"Scripted no-key transport support: " + skillBoolText(manifest.ScriptedTransportSupport) + ".",
			"Runtime profiles: " + skillRuntimeProfileText(manifest.RuntimeProfiles) + ".",
		}),
		"",
		"## Core Pattern",
		"",
		"```"+cfg.Fence,
		skillSnippet(target, spec.ID),
		"```",
		"",
		expandedExamples+routingGuide+agentMemoryGuide+"## Relevant API Surface",
		"",
		skillAPISurface(apiRef, spec.Sections),
		"",
		"## Guardrails",
		"",
		skillBulletList([]string{
			"Start from package examples for exact native syntax before inventing a new call shape.",
			"Use `provider-api` examples only when the user explicitly has provider credentials available.",
			"Use `no-key` examples for deterministic local checks and provider request mapping.",
			"Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.",
			"Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.",
		}),
	)
}

func skillAgentStateMethods(target string) (string, string, string, string) {
	switch target {
	case "java":
		return "getState()", "setState(...)", "exportRuntimeState()", "restoreRuntimeState(...)"
	case "go":
		return "GetState()", "SetState(...)", "ExportRuntimeState()", "RestoreRuntimeState(...)"
	default:
		return "get_state()", "set_state(...)", "export_runtime_state()", "restore_runtime_state(...)"
	}
}

func skillAgentMemoryExamplePath(target string) string {
	switch target {
	case "python":
		return "src/examples/python/long-agents/skills-and-memory-assistant.py"
	case "java":
		return "src/examples/java/long-agents/SkillsAndMemoryAssistantExample.java"
	case "cpp":
		return "src/examples/cpp/long-agents/skills_and_memory_assistant.cpp"
	case "go":
		return "src/examples/go/long-agents/skills_and_memory_assistant.go"
	case "rust":
		return "src/examples/rust/long-agents/skills_and_memory_assistant.rs"
	default:
		return "src/examples/" + target + "/long-agents/"
	}
}

type skillPattern struct {
	Title string
	Intro string
	Code  string
}

func skillExpandedExamples(target, specID, fence string) string {
	var patterns []skillPattern
	var galleryPath string
	switch specID {
	case "signature":
		patterns = skillSignaturePatterns(target)
		galleryPath = "subsystems/s"
	case "flow":
		patterns = skillFlowPatterns(target)
		galleryPath = "subsystems/flow"
	default:
		return ""
	}
	lines := []string{"## More Patterns", ""}
	for _, pattern := range patterns {
		lines = append(lines,
			"### "+pattern.Title,
			"",
			pattern.Intro,
			"",
			"```"+fence,
			pattern.Code,
			"```",
			"",
		)
	}
	lines = append(lines,
		"Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/"+target+"/"+galleryPath+"/.",
	)
	return strings.Join(lines, "\n")
}

func skillName(target string, spec packageSkillSpec) string {
	return "ax-" + target + "-" + spec.ID
}

func skillDescription(target string, spec packageSkillSpec, cfg skillTargetInfo) string {
	return fmt.Sprintf("Use when writing %s code with `%s` for %s.", cfg.Language, packageNameForTarget(target), spec.Description)
}

func skillFrontmatter(name, description, version string) string {
	return readmeLines(
		"---",
		"name: "+skillYAMLString(name),
		"description: "+skillYAMLString(description),
		"version: "+skillYAMLString(version),
		"---",
	)
}

type skillTargetInfo struct {
	Language string
	Fence    string
}

func skillTargetConfig(target string) skillTargetInfo {
	switch target {
	case "python":
		return skillTargetInfo{Language: "Python", Fence: "python"}
	case "java":
		return skillTargetInfo{Language: "Java", Fence: "java"}
	case "cpp":
		return skillTargetInfo{Language: "C++", Fence: "cpp"}
	case "go":
		return skillTargetInfo{Language: "Go", Fence: "go"}
	case "rust":
		return skillTargetInfo{Language: "Rust", Fence: "rust"}
	default:
		return skillTargetInfo{Language: target, Fence: ""}
	}
}

func skillBulletList(items []string) string {
	lines := []string{}
	for _, item := range items {
		lines = append(lines, "- "+item)
	}
	return strings.Join(lines, "\n")
}

func skillRuntimeProfileText(profiles []RuntimeProfileManifestEntry) string {
	if len(profiles) == 0 {
		return "none"
	}
	parts := []string{}
	for _, profile := range profiles {
		parts = append(parts, "`"+profile.ID+"`")
	}
	return strings.Join(parts, ", ")
}

func skillBoolText(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func skillAPISurface(ref APIReferenceManifest, sectionIDs []string) string {
	allowed := map[string]bool{}
	for _, id := range sectionIDs {
		allowed[id] = true
	}
	lines := []string{}
	for _, section := range ref.Sections {
		if !allowed[section.ID] {
			continue
		}
		names := []string{}
		for _, symbol := range section.Symbols {
			names = append(names, "`"+symbol.PublicName+"`")
		}
		lines = append(lines, "- "+section.Title+": "+strings.Join(names, ", "))
	}
	if len(lines) == 0 {
		return "- See `API.md` for the generated target API."
	}
	return strings.Join(lines, "\n")
}

func skillSnippet(target, specID string) string {
	switch {
	case specID == "signature":
		return skillSignatureSnippet(target)
	case specID == "agent" || specID == "agent-rlm" || specID == "agent-memory-skills" || specID == "agent-observability" || specID == "agent-context":
		return skillAgentSnippet(target)
	case specID == "flow":
		return skillFlowSnippet(target)
	case specID == "playbook":
		return skillPlaybookSnippet(target)
	case specID == "gepa" || specID == "agent-optimize" || specID == "refine":
		return skillOptimizeSnippet(target)
	case specID == "ai" || specID == "audio" || specID == "llm":
		return skillAISnippet(target)
	default:
		return skillGenSnippet(target)
	}
}

func skillSignatureSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("from axllm import s", "", "sig = s(\"question:string -> answer:string\")", "schema = sig.to_json_schema(\"outputs\")")
	case "java":
		return readmeLines("import dev.axllm.ax.*;", "", "AxSignature sig = Ax.s(\"question:string -> answer:string\");", "var schema = sig.toJsonSchema(\"outputs\", java.util.Map.of());")
	case "cpp":
		return readmeLines("#include \"axllm/axllm.hpp\"", "", "auto sig = axllm::s(\"question:string -> answer:string\");", "auto schema = axllm::to_json_schema(axllm::Core::get(sig, \"outputs\"));")
	case "go":
		return readmeLines("import ax \"github.com/ax-llm/ax/packages/go\"", "", "sig := ax.NewSignature(\"question:string -> answer:string\")", "schema := sig.ToJSONSchema(nil)")
	case "rust":
		return readmeLines("use axllm::s;", "", "let sig = s(\"question:string -> answer:string\")?;", "let schema = sig.to_json_schema(\"outputs\");")
	default:
		return "Read `examples/signature_schema.*`."
	}
}

func skillAISnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("import os", "from axllm import ai", "", "llm = ai(\"openai\", api_key=os.environ[\"OPENAI_API_KEY\"])")
	case "java":
		return readmeLines("import dev.axllm.ax.*;", "", "var llm = Ax.ai(\"openai\", java.util.Map.of(\"apiKey\", System.getenv(\"OPENAI_API_KEY\")));")
	case "cpp":
		return readmeLines("#include \"axllm/axllm.hpp\"", "", "auto llm = axllm::ai(\"openai\", { {\"apiKey\", std::getenv(\"OPENAI_API_KEY\")} });")
	case "go":
		return readmeLines("import ax \"github.com/ax-llm/ax/packages/go\"", "", "llm := ax.NewAI(\"openai\", map[string]ax.Value{\"apiKey\": os.Getenv(\"OPENAI_API_KEY\")})")
	case "rust":
		return readmeLines("use axllm::ai;", "", "let llm = ai(\"openai\", options)?;")
	default:
		return "Read provider examples in `examples/`."
	}
}

func skillGenSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("from axllm import ax", "", "program = ax(\"question:string -> answer:string\")", "out = program.forward(llm, {\"question\": \"What is Ax?\"})")
	case "java":
		return readmeLines("AxGen program = Ax.ax(\"question:string -> answer:string\");", "var out = program.forward(llm, java.util.Map.of(\"question\", \"What is Ax?\"));")
	case "cpp":
		return readmeLines("auto program = axllm::ax(\"question:string -> answer:string\");", "auto out = program.forward(llm, { {\"question\", \"What is Ax?\"} });")
	case "go":
		return readmeLines("program := ax.NewAx(\"question:string -> answer:string\", nil)", "out := program.Forward(llm, map[string]ax.Value{\"question\": \"What is Ax?\"}, nil)")
	case "rust":
		return readmeLines("let program = axllm::ax(\"question:string -> answer:string\")?;", "let out = program.forward(&llm, inputs, None)?;")
	default:
		return "Read AxGen examples in `examples/`."
	}
}

func skillAgentSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("from axllm import agent", "", "helper = agent(\"question:string -> answer:string\")", "out = helper.forward(llm, {\"question\": \"How should I proceed?\"})")
	case "java":
		return readmeLines("AxAgent helper = Ax.agent(\"question:string -> answer:string\", java.util.Map.of());", "var out = helper.forward(llm, java.util.Map.of(\"question\", \"How should I proceed?\"));")
	case "cpp":
		return readmeLines("auto helper = axllm::agent(\"question:string -> answer:string\");", "auto out = helper.forward(llm, { {\"question\", \"How should I proceed?\"} });")
	case "go":
		return readmeLines("helper := ax.NewAgent(\"question:string -> answer:string\", nil)", "out := helper.Forward(llm, map[string]ax.Value{\"question\": \"How should I proceed?\"}, nil)")
	case "rust":
		return readmeLines("let helper = axllm::agent(\"question:string -> answer:string\")?;", "let out = helper.forward(&llm, inputs, None)?;")
	default:
		return "Read agent examples in `examples/`."
	}
}

func skillFlowSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("from axllm import ax, flow", "", "draft = ax(\"topicText:string -> draftText:string\")", "wf = (", "    flow({\"id\": \"docs.coreFlow\"})", "    .execute(\"draft\", draft, {\"reads\": [\"topicText\"], \"writes\": [\"draftResult\", \"draftText\"]})", "    .returns({\"draftText\": \"draftText\"})", ")")
	case "java":
		return readmeLines("AxGen draft = Ax.ax(\"topicText:string -> draftText:string\");", "AxFlow wf = Ax.flow(java.util.Map.of(\"id\", \"docs.coreFlow\"))", "    .execute(\"draft\", draft, java.util.Map.of(", "        \"reads\", java.util.List.of(\"topicText\"),", "        \"writes\", java.util.List.of(\"draftResult\", \"draftText\")))", "    .returns(java.util.Map.of(\"draftText\", \"draftText\"));")
	case "cpp":
		return readmeLines("auto draft = axllm::ax(\"topicText:string -> draftText:string\");", "auto wf = axllm::flow(axllm::object({{\"id\", \"docs.coreFlow\"}}))", "    .execute(\"draft\", draft, axllm::object({", "      {\"reads\", axllm::array({\"topicText\"})},", "      {\"writes\", axllm::array({\"draftResult\", \"draftText\"})}", "    }))", "    .returns(axllm::object({{\"draftText\", \"draftText\"}}));")
	case "go":
		return readmeLines("draft := ax.NewAx(\"topicText:string -> draftText:string\", nil)", "wf := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.coreFlow\"}).", "  Execute(\"draft\", draft, map[string]ax.Value{", "    \"reads\": ax.Array(\"topicText\"),", "    \"writes\": ax.Array(\"draftResult\", \"draftText\"),", "  }).", "  Returns(map[string]ax.Value{\"draftText\": \"draftText\"})")
	case "rust":
		return readmeLines("let draft = axllm::ax(\"topicText:string -> draftText:string\")?;", "let wf = axllm::flow(\"docs.coreFlow\")", "    .execute_with_options(", "        \"draft\",", "        draft,", "        &json!({\"reads\": [\"topicText\"], \"writes\": [\"draftResult\", \"draftText\"]}),", "    )", "    .returns(json!({\"draftText\": \"draftText\"}));")
	default:
		return "Read flow examples in `examples/`."
	}
}

func skillSignaturePatterns(target string) []skillPattern {
	pattern := func(title, intro, code string) skillPattern {
		return skillPattern{Title: title, Intro: intro, Code: code}
	}
	switch target {
	case "python":
		return []skillPattern{
			pattern("Simple string contract", "Use the string form when field names and types are enough.", readmeLines("from axllm import ax", "", "program = ax(\"questionText:string -> answerText:string\")")),
			pattern("Bounded class output", "A class field constrains the model to a known label set.", readmeLines("router = ax(", "    'messageText:string -> routeClass:class \"support, sales, engineering\"'", ")")),
			pattern("Fluent constraints", "Python exposes the native fluent builder for validation constraints and objects.", readmeLines("from axllm import f", "", "signature = (", "    f()", "    .input(\"contactEmail\", f.string(\"Contact email\").email())", "    .output(\"partySize\", f.number(\"Guests\").min(1).max(12))", "    .output(\"bookingCode\", f.string().regex(r\"^[A-Z]{3}-\\d{4}$\"))", "    .build()", ")")),
			pattern("JSON schema", "Render the output contract for tools, validators, or external consumers.", readmeLines("schema = signature.to_json_schema(\"outputs\")")),
			pattern("Reuse the signature", "Pass one built signature into AxGen and call it like any other program.", readmeLines("program = ax(signature)", "output = program.forward(client, inputs)")),
		}
	case "java":
		return []skillPattern{
			pattern("Simple string contract", "Use the string form when field names and types are enough.", readmeLines("AxGen program = Ax.ax(\"questionText:string -> answerText:string\");")),
			pattern("Bounded class output", "A class field constrains the model to a known label set.", readmeLines("AxGen router = Ax.ax(", "    \"messageText:string -> routeClass:class \\\"support, sales, engineering\\\"\");")),
			pattern("Fluent constraints", "Java exposes the native fluent builder for validation constraints and objects.", readmeLines("AxSignature signature = Ax.f().call()", "    .input(\"contactEmail\", Ax.f().string(\"Contact email\").email())", "    .output(\"partySize\", Ax.f().number(\"Guests\").min(1).max(12))", "    .output(\"bookingCode\", Ax.f().string().regex(\"^[A-Z]{3}-\\\\d{4}$\", \"ABC-1234\"))", "    .build();")),
			pattern("JSON schema", "Render the output contract for tools, validators, or external consumers.", readmeLines("var schema = signature.toJsonSchema(\"outputs\", java.util.Map.of());")),
			pattern("Reuse the signature", "Pass one built signature into AxGen and call it like any other program.", readmeLines("AxGen program = Ax.ax(signature);", "var output = program.forward(client, inputs);")),
		}
	case "go":
		return []skillPattern{
			pattern("Simple string contract", "Use the string form when field names and types are enough.", readmeLines("program := ax.NewAx(\"questionText:string -> answerText:string\", nil)")),
			pattern("Bounded class output", "A class field constrains the model to a known label set.", readmeLines("router := ax.NewAx(", "  \"messageText:string -> routeClass:class \\\"support, sales, engineering\\\"\",", "  nil,", ")")),
			pattern("Native constraints", "Go exposes generated signature and field records directly.", readmeLines("signature := ax.AxSignature{", "  Inputs: []ax.Field{{", "    Name: \"contactEmail\",", "    Type: ax.FieldType{Name: \"string\", Format: \"email\"},", "  }},", "  Outputs: []ax.Field{{", "    Name: \"partySize\",", "    Type: ax.FieldType{Name: \"number\", Minimum: 1, Maximum: 12},", "  }},", "}")),
			pattern("JSON schema", "Render the native signature for tools, validators, or external consumers.", readmeLines("schema := signature.ToJSONSchema(nil)")),
			pattern("Reuse the signature", "Attach the native signature to AxGen before the forward call.", readmeLines("program := ax.NewAx(\"contactEmail:string -> partySize:number\", nil)", "program.Signature = signature", "output, err := program.Forward(ctx, client, inputs, nil)")),
		}
	case "rust":
		return []skillPattern{
			pattern("Simple string contract", "Use the string form when field names and types are enough.", readmeLines("let mut program = axllm::ax(\"questionText:string -> answerText:string\")?;")),
			pattern("Bounded class output", "A class field constrains the model to a known label set.", readmeLines("let router = axllm::ax(", "    \"messageText:string -> routeClass:class \\\"support, sales, engineering\\\"\",", ")?;")),
			pattern("Native constraints", "Rust combines FieldType constraints with the generated signature builder.", readmeLines("let mut party_type = FieldType::number();", "party_type.minimum = Some(1.0);", "party_type.maximum = Some(12.0);", "", "let mut code_type = FieldType::string();", "code_type.pattern = Some(r\"^[A-Z]{3}-\\d{4}$\".to_string());", "", "let signature = f()", "    .output(\"partySize\", party_type)", "    .output(\"bookingCode\", code_type)", "    .build();")),
			pattern("JSON schema", "Render the output contract for tools, validators, or external consumers.", readmeLines("let schema = signature.to_json_schema(\"outputs\");")),
			pattern("Reuse the signature", "Attach the native signature to AxGen before the forward call.", readmeLines("let mut program = axllm::ax(\"requestText:string -> partySize:number, bookingCode:string\")?;", "program.signature = signature;", "let output = program.forward(&mut client, inputs)?;")),
		}
	case "cpp":
		return []skillPattern{
			pattern("Simple string contract", "Use the string form when field names and types are enough.", readmeLines("auto program = axllm::ax(\"questionText:string -> answerText:string\");")),
			pattern("Bounded class output", "A class field constrains the model to a known label set.", readmeLines("auto router = axllm::ax(", "    \"messageText:string -> routeClass:class \\\"support, sales, engineering\\\"\");")),
			pattern("Native constraints", "C++ exposes the generated record surface for constrained fields.", readmeLines("auto party_type = axllm::Core::record_new(", "    \"FieldType\",", "    axllm::object({", "      {\"name\", \"number\"},", "      {\"minimum\", 1},", "      {\"maximum\", 12},", "    }));")),
			pattern("Validate and render", "Validate the native record, then render its output fields as JSON schema.", readmeLines("axllm::Core::validate_signature(signature);", "auto schema = axllm::to_json_schema(", "    axllm::Core::get(signature, \"outputs\"),", "    \"outputs\");")),
			pattern("Reuse the signature", "Pass the native signature record directly into AxGen.", readmeLines("axllm::AxGen program = axllm::ax(signature);", "auto output = program.forward(client, inputs);")),
		}
	default:
		return nil
	}
}

func skillFlowPatterns(target string) []skillPattern {
	pattern := func(title, intro, code string) skillPattern {
		return skillPattern{Title: title, Intro: intro, Code: code}
	}
	switch target {
	case "python":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("classifier = ax('requestText:string -> route:class \"support, sales, engineering\"')", "responder = ax(\"requestText:string, route:string -> responseText:string\")")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("branch_flow = (", "    flow({\"id\": \"docs.branchFlow\"})", "    .execute(\"classifier\", classifier, {\"reads\": [\"requestText\"], \"writes\": [\"classifierResult\", \"route\"]})", "    .execute(\"responder\", responder, {\"reads\": [\"requestText\", \"route\"], \"writes\": [\"responderResult\", \"responseText\"]})", "    .returns({\"route\": \"route\", \"responseText\": \"responseText\"})", ")")),
			pattern("Parallel fan-out and join", "Independent reads let research and audience analysis share one planner group.", readmeLines("parallel_flow = (", "    flow({\"id\": \"docs.parallelFlow\"})", "    .execute(\"research\", research, {\"reads\": [\"topicText\"], \"writes\": [\"researchResult\", \"factList\"]})", "    .execute(\"audience\", audience, {\"reads\": [\"topicText\"], \"writes\": [\"audienceResult\", \"audienceAngle\"]})", "    .execute(\"join\", join, {\"reads\": [\"factList\", \"audienceAngle\"], \"writes\": [\"joinResult\", \"briefText\"]})", "    .returns({\"briefText\": \"briefText\"})", ")")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("refine_flow = (", "    flow({\"id\": \"docs.refineFlow\"})", "    .execute(\"draft\", draft, {\"reads\": [\"topicText\"], \"writes\": [\"draftResult\", \"draftText\"]})", "    .execute(\"critique\", critique, {\"reads\": [\"draftText\"], \"writes\": [\"critiqueResult\", \"critiqueText\"]})", "    .execute(\"revise\", revise, {\"reads\": [\"draftText\", \"critiqueText\"], \"writes\": [\"reviseResult\", \"revisedText\"]})", "    .returns({\"revisedText\": \"revisedText\"})", ")")),
			pattern("Run a flow", "Forward accepts the provider client and the public flow inputs.", readmeLines("output = parallel_flow.forward(client, {\"topicText\": \"Typed LLM workflows\"})")),
		}
	case "java":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("AxGen classifier = Ax.ax(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\");", "AxGen responder = Ax.ax(\"requestText:string, route:string -> responseText:string\");")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("AxFlow branchFlow = Ax.flow(Map.of(\"id\", \"docs.branchFlow\"))", "    .execute(\"classifier\", classifier, Map.of(\"reads\", List.of(\"requestText\"), \"writes\", List.of(\"classifierResult\", \"route\")))", "    .execute(\"responder\", responder, Map.of(\"reads\", List.of(\"requestText\", \"route\"), \"writes\", List.of(\"responderResult\", \"responseText\")))", "    .returns(Map.of(\"route\", \"route\", \"responseText\", \"responseText\"));")),
			pattern("Parallel fan-out and join", "Independent reads let research and audience analysis share one planner group.", readmeLines("AxFlow parallelFlow = Ax.flow(Map.of(\"id\", \"docs.parallelFlow\"))", "    .execute(\"research\", research, Map.of(\"reads\", List.of(\"topicText\"), \"writes\", List.of(\"researchResult\", \"factList\")))", "    .execute(\"audience\", audience, Map.of(\"reads\", List.of(\"topicText\"), \"writes\", List.of(\"audienceResult\", \"audienceAngle\")))", "    .execute(\"join\", join, Map.of(\"reads\", List.of(\"factList\", \"audienceAngle\"), \"writes\", List.of(\"joinResult\", \"briefText\")))", "    .returns(Map.of(\"briefText\", \"briefText\"));")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("AxFlow refineFlow = Ax.flow(Map.of(\"id\", \"docs.refineFlow\"))", "    .execute(\"draft\", draft, Map.of(\"reads\", List.of(\"topicText\"), \"writes\", List.of(\"draftResult\", \"draftText\")))", "    .execute(\"critique\", critique, Map.of(\"reads\", List.of(\"draftText\"), \"writes\", List.of(\"critiqueResult\", \"critiqueText\")))", "    .execute(\"revise\", revise, Map.of(\"reads\", List.of(\"draftText\", \"critiqueText\"), \"writes\", List.of(\"reviseResult\", \"revisedText\")))", "    .returns(Map.of(\"revisedText\", \"revisedText\"));")),
			pattern("Run a flow", "Forward accepts the provider client and the public flow inputs.", readmeLines("var output = parallelFlow.forward(client, Map.of(\"topicText\", \"Typed LLM workflows\"));")),
		}
	case "go":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("classifier := ax.NewAx(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\", nil)", "responder := ax.NewAx(\"requestText:string, route:string -> responseText:string\", nil)")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("branchFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.branchFlow\"}).", "  Execute(\"classifier\", classifier, map[string]ax.Value{\"reads\": ax.Array(\"requestText\"), \"writes\": ax.Array(\"classifierResult\", \"route\")}).", "  Execute(\"responder\", responder, map[string]ax.Value{\"reads\": ax.Array(\"requestText\", \"route\"), \"writes\": ax.Array(\"responderResult\", \"responseText\")}).", "  Returns(map[string]ax.Value{\"route\": \"route\", \"responseText\": \"responseText\"})")),
			pattern("Parallel fan-out and join", "Independent reads let research and audience analysis share one planner group.", readmeLines("parallelFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.parallelFlow\"}).", "  Execute(\"research\", research, map[string]ax.Value{\"reads\": ax.Array(\"topicText\"), \"writes\": ax.Array(\"researchResult\", \"factList\")}).", "  Execute(\"audience\", audience, map[string]ax.Value{\"reads\": ax.Array(\"topicText\"), \"writes\": ax.Array(\"audienceResult\", \"audienceAngle\")}).", "  Execute(\"join\", join, map[string]ax.Value{\"reads\": ax.Array(\"factList\", \"audienceAngle\"), \"writes\": ax.Array(\"joinResult\", \"briefText\")}).", "  Returns(map[string]ax.Value{\"briefText\": \"briefText\"})")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("refineFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.refineFlow\"}).", "  Execute(\"draft\", draft, map[string]ax.Value{\"reads\": ax.Array(\"topicText\"), \"writes\": ax.Array(\"draftResult\", \"draftText\")}).", "  Execute(\"critique\", critique, map[string]ax.Value{\"reads\": ax.Array(\"draftText\"), \"writes\": ax.Array(\"critiqueResult\", \"critiqueText\")}).", "  Execute(\"revise\", revise, map[string]ax.Value{\"reads\": ax.Array(\"draftText\", \"critiqueText\"), \"writes\": ax.Array(\"reviseResult\", \"revisedText\")}).", "  Returns(map[string]ax.Value{\"revisedText\": \"revisedText\"})")),
			pattern("Run a flow", "Forward accepts the context, provider client, public inputs, and options.", readmeLines("output, err := parallelFlow.Forward(", "  ctx, client,", "  map[string]ax.Value{\"topicText\": \"Typed LLM workflows\"},", "  nil,", ")")),
		}
	case "rust":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("let classifier = axllm::ax(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\")?;", "let responder = axllm::ax(\"requestText:string, route:string -> responseText:string\")?;")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("let mut branch_flow = axllm::flow(\"docs.branchFlow\")", "    .execute_with_options(\"classifier\", classifier, &json!({\"reads\": [\"requestText\"], \"writes\": [\"classifierResult\", \"route\"]}))", "    .execute_with_options(\"responder\", responder, &json!({\"reads\": [\"requestText\", \"route\"], \"writes\": [\"responderResult\", \"responseText\"]}))", "    .returns(json!({\"route\": \"route\", \"responseText\": \"responseText\"}));")),
			pattern("Parallel fan-out and join", "Independent reads let research and audience analysis share one planner group.", readmeLines("let mut parallel_flow = axllm::flow(\"docs.parallelFlow\")", "    .execute_with_options(\"research\", research, &json!({\"reads\": [\"topicText\"], \"writes\": [\"researchResult\", \"factList\"]}))", "    .execute_with_options(\"audience\", audience, &json!({\"reads\": [\"topicText\"], \"writes\": [\"audienceResult\", \"audienceAngle\"]}))", "    .execute_with_options(\"join\", join, &json!({\"reads\": [\"factList\", \"audienceAngle\"], \"writes\": [\"joinResult\", \"briefText\"]}))", "    .returns(json!({\"briefText\": \"briefText\"}));")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("let mut refine_flow = axllm::flow(\"docs.refineFlow\")", "    .execute_with_options(\"draft\", draft, &json!({\"reads\": [\"topicText\"], \"writes\": [\"draftResult\", \"draftText\"]}))", "    .execute_with_options(\"critique\", critique, &json!({\"reads\": [\"draftText\"], \"writes\": [\"critiqueResult\", \"critiqueText\"]}))", "    .execute_with_options(\"revise\", revise, &json!({\"reads\": [\"draftText\", \"critiqueText\"], \"writes\": [\"reviseResult\", \"revisedText\"]}))", "    .returns(json!({\"revisedText\": \"revisedText\"}));")),
			pattern("Run a flow", "Forward accepts the mutable provider client and public inputs.", readmeLines("let output = parallel_flow.forward(", "    &mut client,", "    json!({\"topicText\": \"Typed LLM workflows\"}),", ")?;")),
		}
	case "cpp":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("auto classifier = axllm::ax(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\");", "auto responder = axllm::ax(\"requestText:string, route:string -> responseText:string\");")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("auto branch_flow = axllm::flow(axllm::object({{\"id\", \"docs.branchFlow\"}}))", "    .execute(\"classifier\", classifier, axllm::object({{\"reads\", axllm::array({\"requestText\"})}, {\"writes\", axllm::array({\"classifierResult\", \"route\"})}}))", "    .execute(\"responder\", responder, axllm::object({{\"reads\", axllm::array({\"requestText\", \"route\"})}, {\"writes\", axllm::array({\"responderResult\", \"responseText\"})}}))", "    .returns(axllm::object({{\"route\", \"route\"}, {\"responseText\", \"responseText\"}}));")),
			pattern("Parallel fan-out and join", "Independent reads let research and audience analysis share one planner group.", readmeLines("auto parallel_flow = axllm::flow(axllm::object({{\"id\", \"docs.parallelFlow\"}}))", "    .execute(\"research\", research, axllm::object({{\"reads\", axllm::array({\"topicText\"})}, {\"writes\", axllm::array({\"researchResult\", \"factList\"})}}))", "    .execute(\"audience\", audience, axllm::object({{\"reads\", axllm::array({\"topicText\"})}, {\"writes\", axllm::array({\"audienceResult\", \"audienceAngle\"})}}))", "    .execute(\"join\", join, axllm::object({{\"reads\", axllm::array({\"factList\", \"audienceAngle\"})}, {\"writes\", axllm::array({\"joinResult\", \"briefText\"})}}))", "    .returns(axllm::object({{\"briefText\", \"briefText\"}}));")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("auto refine_flow = axllm::flow(axllm::object({{\"id\", \"docs.refineFlow\"}}))", "    .execute(\"draft\", draft, axllm::object({{\"reads\", axllm::array({\"topicText\"})}, {\"writes\", axllm::array({\"draftResult\", \"draftText\"})}}))", "    .execute(\"critique\", critique, axllm::object({{\"reads\", axllm::array({\"draftText\"})}, {\"writes\", axllm::array({\"critiqueResult\", \"critiqueText\"})}}))", "    .execute(\"revise\", revise, axllm::object({{\"reads\", axllm::array({\"draftText\", \"critiqueText\"})}, {\"writes\", axllm::array({\"reviseResult\", \"revisedText\"})}}))", "    .returns(axllm::object({{\"revisedText\", \"revisedText\"}}));")),
			pattern("Run a flow", "Forward accepts the provider client and public inputs.", readmeLines("auto output = parallel_flow.forward(", "    client,", "    axllm::object({{\"topicText\", \"Typed LLM workflows\"}}));")),
		}
	default:
		return nil
	}
}

func skillOptimizeSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("from axllm import AxGEPA", "", "engine = AxGEPA(reflection_client)", "result = engine.optimize(request, evaluator)")
	case "java":
		return readmeLines("AxGEPA engine = new AxGEPA(reflectionClient, java.util.Map.of());", "var result = engine.optimize(request, evaluator);")
	case "cpp":
		return readmeLines("axllm::AxGEPA engine(reflection_client, options);", "auto result = engine.optimize(request, evaluator);")
	case "go":
		return readmeLines("engine := ax.NewGEPA(reflectionClient, nil)", "result := engine.Optimize(request, evaluator)")
	case "rust":
		return readmeLines("let engine = axllm::AxGEPA::new(reflection_client, options)?;", "let result = engine.optimize(request, evaluator)?;")
	default:
		return "Read optimizer examples in `examples/`."
	}
}

func skillPlaybookSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines("from axllm import ax, playbook", "", "program = ax(\"question:string -> answer:string\")", "pb = playbook(program, {\"studentAI\": llm})", "pb.evolve(examples, metric_fn)")
	case "java":
		return readmeLines("AxGen program = Ax.ax(\"question:string -> answer:string\");", "AxPlaybook pb = Ax.playbook(program, java.util.Map.of(\"studentAI\", llm));", "pb.evolve(examples, metricFn, java.util.Map.of());")
	case "cpp":
		return readmeLines("auto program = axllm::ax(\"question:string -> answer:string\");", "auto pb = axllm::playbook(program, *llm);", "pb.evolve(examples, metric_fn);")
	case "go":
		return readmeLines("program := ax.NewAx(\"question:string -> answer:string\", nil)", "pb := ax.Playbook(program, map[string]ax.Value{\"studentAI\": llm})", "pb.Evolve(ctx, examples, metricFn, nil)")
	case "rust":
		return readmeLines("let program = axllm::ax(\"question:string -> answer:string\")?;", "let student = Rc::new(RefCell::new(llm));", "let mut pb = axllm::playbook(program, student, None::<Rc<RefCell<OpenAICompatibleClient>>>, json!({}));", "pb.evolve(&examples, &mut metric_fn, &json!({}))?;")
	default:
		return "Read playbook examples in `examples/`."
	}
}

func skillYAMLString(value string) string {
	escaped := strings.ReplaceAll(value, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
	return "\"" + escaped + "\""
}
