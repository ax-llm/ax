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
		Description: "agents, child delegation, tools, MCP, clarification, runtime state, final typed responses, and direct-respond executor skipping",
		UseWhen: []string{
			"Create an RLM agent with tools, child agents, or MCP clients.",
			"Use clarification, discovery, recall, final, or respond envelopes.",
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
			"Track which memories or skills actually influenced a turn.",
			"Keep recall and skill search as host callbacks rather than generated-package global state.",
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
		Description: "agent optimization, evaluators, judges, optimizer artifacts, BootstrapFewShot, and GEPA",
		UseWhen: []string{
			"Optimize an AxAgent or reusable program component.",
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
		Description: "the playbook() context-engineering surface, evolving task knowledge, online updates, and rendering a playbook into a program",
		UseWhen: []string{
			"Grow an evolving context playbook for a program or agent stage with playbook().",
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
		"## Relevant API Surface",
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
		return readmeLines("from axllm import flow", "", "wf = flow()", "# See examples/axflow_program_graph.py for node wiring.")
	case "java":
		return readmeLines("AxFlow wf = Ax.flow(java.util.Map.of());", "// See examples/AxFlowProgramGraphExample.java for node wiring.")
	case "cpp":
		return readmeLines("auto wf = axllm::flow();", "// See examples/axflow_program_graph.cpp for node wiring.")
	case "go":
		return readmeLines("wf := ax.NewFlow(nil)", "// See examples/axflow_program_graph/main.go for node wiring.")
	case "rust":
		return readmeLines("let wf = axllm::flow(\"workflow\")?;", "// See examples/axflow_program_graph.rs for node wiring.")
	default:
		return "Read flow examples in `examples/`."
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
		return readmeLines("let program = axllm::ax(\"question:string -> answer:string\")?;", "let mut pb = axllm::playbook(program, &mut llm, None)?;", "pb.evolve(&examples, &mut metric_fn, None)?;")
	default:
		return "Read playbook examples in `examples/`."
	}
}

func skillYAMLString(value string) string {
	escaped := strings.ReplaceAll(value, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
	return "\"" + escaped + "\""
}
