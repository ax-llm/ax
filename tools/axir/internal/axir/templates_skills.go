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
		Description: "named deployment profiles, generic provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers",
		UseWhen: []string{
			"Create provider clients or normalize provider options.",
			"Choose a named deployment profile separately from the model ID served by that deployment.",
			"Attach renewable per-request credentials for expiring cloud tokens.",
			"Resolve structured-output modes from the selected profile and model.",
			"Choose between model-list routing, ordered failover, and adaptive operational routing.",
			"Route multimodal requests without flattening native images or files when the selected provider supports them.",
			"Use scripted transports for deterministic no-key examples.",
			"Use provider-api examples only when explicit provider credentials are available.",
		},
		Sections: []string{"axai"},
	},
	{
		ID:          "typesafe",
		Title:       "Typesafe / Jev",
		Area:        "decision signatures and native questions",
		Description: "Typesafe Jev boolean/class signatures, value descriptions, configurable Noul conversion, native Noul/Choice/Score, structured criteria and hybrid generation",
		UseWhen:     []string{"Use Jev for typed decisions with ordinary Ax signatures.", "Use native questions for probabilities, rich criteria, structured state, or scoring.", "Compose a separate generative program for prose or tools."},
		Sections:    []string{"signatures", "axgen", "axai"},
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
		Description: "AxGen programs, forward calls, indexed multi-sampling, result pickers, streaming, tools, assertions, traces, usage, and output parsing",
		UseWhen: []string{
			"Build a structured generation program from a signature.",
			"Attach typed tools or MCP-derived tools to a generation call.",
			"Generate multiple validated structured samples and select a winner with a native callback.",
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
		Description: "agent tracing, centralized and multi-tenant usage accounting, action logs, runtime diagnostics, replay, and production debugging",
		UseWhen: []string{
			"Inspect agent traces, runtime envelopes, usage, or action logs.",
			"Register the process-wide usage observer and attribute model calls by tenant, user, request, run, or feature.",
			"Attach callbacks for model/tool activity and runtime progress.",
			"Debug agent loops through generated package state and examples.",
		},
		Sections: []string{"axai", "agents-rlm", "runtime-profiles"},
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
	profileGuide := ""
	routingGuide := ""
	if spec.ID == "ai" {
		profileGuide = readmeLines(
			"## Named Deployment Profiles",
			"",
			"- The first `ai` / `NewAI` factory argument selects deployment behavior. The model option selects a model only inside that deployment; never infer request rules from a vendor-looking model ID.",
			"- `openai` is the official OpenAI deployment. `openai-compatible` is the conservative custom-endpoint profile and requires an explicit base URL. Unknown profile names are errors.",
			"- A Together-hosted DeepSeek model uses the `together` profile's URL, authentication, reasoning fields, and effort mapping. Native DeepSeek `thinking` fields apply only to the `deepseek` profile.",
			"- Verified DeepSeek, Grok, Groq, Cerebras, and DeepInfra model rules default an omitted thinking level to logical `max`, mapped to the strongest documented deployment effort.",
			"- Send `none` only where the selected deployment and model document reasoning disablement. Unsupported levels fail before network I/O; dynamic Hugging Face Router routes remain conservative.",
			"- Structured output is an ordered model-aware capability: `native`, `function`, and `json_object`. Exact caller model metadata overrides the first matching profile rule, which overrides the profile default.",
			"- An explicit unsupported structured-output mode fails before transport. `structuredOutputs` / `structured_outputs` remains the compatibility alias for native JSON Schema only.",
			"- The exact Vertex `google/gemma-4-26b-a4b-it-maas` rule prefers `json_object`, excludes native schema, defaults thinking to `max`, writes nested `enable_thinking`, and extracts/replays `reasoning_content`. Unknown Vertex models stay conservative.",
			"- Use named factories for Azure OpenAI, Cohere, DeepSeek, DeepSeek Responses, Mistral, Reka, Grok, routers, hosted inference, and configurable runtimes. Profile-only branded client constructors were removed.",
			"- Retained client classes are transport/runtime boundaries: OpenAI-compatible Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini GenerateContent. Build ordinary applications through the named factory.",
			"- A profile without a base URL of its own (`openai-compatible`, `databricks`, `amazon-bedrock`, `vertex-ai`, ...) needs one from the caller: `ai(...)` fails with TypeScript's `<Name> requires apiURL` instead of sending the key to another host. Built directly without a base URL, the OpenAI-compatible client class talks to `https://api.openai.com/v1` with the conservative `openai-compatible` profile. For OpenAI itself use the `openai` factory, which applies OpenAI's model catalog.",
			"- Environment credentials stay with their own provider: `OPENAI_API_KEY` and `OPENAI_BASE_URL` are read only for `openai`, `openai-responses` and `openai-compatible`; `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` only for `anthropic`; the Google key variables only for `google-gemini`. Any other provider needs an explicit API key or a credential provider.",
			"- Sampling follows TypeScript. A client starts from its provider's defaults: temperature 0, or temperature 0.7 and top-p 1 for `openai-responses`, and none for the other Responses profiles. The client's model config, a model key's config and then the request's merge over them. The catalog marks the sampling parameters a model rejects (temperature, top-p, top-k and the presence/frequency penalties): a default for one is never sent; an explicit value is sent when the model accepts it for that request's reasoning effort (GPT-5.1-5.4 while reasoning is off, their default; GPT-5.5 and 5.6 with effort `none`) and otherwise dropped with a one-time warning naming the setting and the model. A model the catalog marks `temperatureOne` still takes an explicit temperature of 1. The o-series still get the token limit and `n`; a profile without model info uses OpenAI's for an exact o-series name.",
			"- Anthropic: Opus 4.7 and later, Opus 5, Fable 5 and Sonnet 5 take only temperature 1 (no top-p or top-k); the other Claude models take every value with thinking off, and while thinking only temperature 1, top-p of 0.95 or above, and no top-k, and never temperature with top-p (an explicit top-p goes alone in place of the default temperature; an explicit temperature wins over it with a warning). The default temperature 0 is sent only without thinking. Gemini: the server-managed Flash models ignore temperature, top-p and top-k; the Gemini API rejects the penalties; Gemini 3 raises a temperature below 1 to 1, warning once for an explicit value. Vertex keeps its request shape for both and warns about a value it drops.",
			"- Provider descriptors and conformance fixtures are generated from the shared profile manifest. Do not add provider-name switches or cross-profile model normalization in a generated package.",
			"",
		) + "\n"
		routingGuide = readmeLines(
			"## Vertex And Prompt Caching",
			"",
			"- Configure Gemini or Anthropic Vertex mode with `projectId` / `project_id` and `region`; optionally select a Vertex endpoint with `endpointId` / `endpoint_id`.",
			"- Use `credentialProvider` / `credential_provider` for expiring Vertex and cloud tokens. It receives profile, operation, method, and URL on every attempt; its headers override static authentication.",
			"- Credential callbacks cover chat, stream, embeddings, Responses, transcription, speech, and retries. Callback errors stop before transport, and completed 401/403 generation responses are not replayed automatically.",
			"- Keep ADC and cloud SDK dependencies host-owned: obtain or refresh the token inside the callback. A required-auth profile accepts either a static key or the callback.",
			"- Core resolves `global`, `us`, `eu`, and regional Vertex hosts. An explicit `baseUrl` / `base_url` takes precedence.",
			"- `beta` on a call routes that Vertex call onto `v1beta1`, and `beta: false` keeps it on `v1` when the client sets `beta`, as in TypeScript.",
			"- On Vertex, `gemini-embedding-2` embeds through `:embedContent` at the `global` location whatever `region` is set. Each call embeds exactly one text, because Vertex fuses a request's texts into one vector, and sends no task type, which Vertex ignores for this model; put task instructions in the text instead. Other embedding models and `endpointId` / `endpoint_id` deployments keep the regional `:predict` call.",
			"- OpenAI GPT-5.6 Chat explicit caching is opt-in through `contextCache` / `context_cache` or message/function cache flags. Use `promptCacheKey` / `prompt_cache_key` for stable affinity; `sessionId` / `session_id` is the fallback.",
			"- As in TypeScript, every OpenAI Responses request sends `prompt_cache_key`: the `promptCacheKey` / `prompt_cache_key`, else the `sessionId` / `session_id`, the call's before the client's. Chat Completions sends it only with GPT-5.6 caching.",
			"- Normalized usage separates uncached prompt, cache-read, and cache-creation tokens. `get_model_cost` / target equivalent uses the shared model catalog, including cache-write pricing and long-context thresholds.",
			"- Start with the OpenAI prompt-caching and Vertex Gemini examples under `examples/`. Scripted AxAI fixtures verify routing without live credentials.",
			"",
			"## Request Timeouts",
			"",
			"- `timeoutMs` on a chat, stream or embed call bounds the wait for the response headers in milliseconds, as TypeScript's per-call `timeout` does. In the client's options it applies to every call. A request whose response has not started in time fails with `AxAIServiceTimeoutError` (`Request timed out after <N>ms`). The request layer does not retry it, and AxGen retries it as an infrastructure error. Once the response starts, the body reads as it did before. AxGen and agent forwards pass `timeoutMs` to every model call.",
			"- "+skillCallTimeoutText(target),
			"",
			"## Routing And Balancing",
			"",
			"- Use the multi-service router when a logical model key selects a configured service or concrete model. It combines model lists; it does not learn from outcomes.",
			"- Use `ProviderRouter` for capability-based selection and optional media degradation. When the selected provider supports images, preserve every native image part with its payload, MIME type, detail level, cache and optimization hints, alt text, and ordering with surrounding text.",
			"- Native files retain filename, MIME type, data, cache flags, extraction metadata, and order through provider/model selection and later conversation turns. Existing extracted text is used only when the selected provider cannot consume the file.",
			"- For unsupported files, configure a file-to-text callback or choose degradation, skip, or error policy. An empty extraction result is valid; extraction failures stop before the provider request. Python, Go, and Java accept fileToText in router processing options; C++ exposes file_to_text, and Rust exposes with_file_to_text and with_processing.",
			"- Inline PDF inputs should include filename, mimeType, and base64 data. See the public native-file-routing generation example for this language; it uses the ordinary generator and a real provider.",
			"- Use the default `AxBalancer` for deterministic ordered/metric failover with its existing retry policy.",
			"- Opt into `AxBalancerAdaptiveStrategy` only for operational routing among application-approved equivalent aliases. It learns transient reliability and successful latency, combines them with estimated cost and a deadline, and explores with Thompson sampling.",
			"- Put centralized decision state in an `AxBalancerStatsStore`. The routing-event callback is best-effort analytics and observability, not a state replication mechanism.",
			"- Shared stores require non-empty, unique, stable route keys. Use slices to isolate workflows, tenants, or traffic classes without putting prompts, responses, raw errors, or sensitive identifiers in keys or events.",
			"- Adaptive balancing does not measure answer quality or semantically choose a model. Only group routes that the application already accepts as substitutes.",
			"- Generated provider streams are incremental and closeable. Retry or failover is allowed only before the first content event; later failures surface without replay, and adaptive latency is recorded at the first chunk.",
			"- Start with `examples/adaptive_balancer_no_key` for store/reducer syntax, then use the cataloged provider-backed adaptive-balancer example for a complete two-route setup.",
			"",
		) + "\n"
	}
	sessionGuide := ""
	if spec.ID == "ai" || spec.ID == "gen" || spec.ID == "agent" || spec.ID == "flow" {
		sessionGuide = readmeLines(
			"## Astra Session Work",
			"",
			"Select `gpt-6-astra` through the ordinary OpenAI factory. The adapter chooses Responses automatically; existing model defaults are unchanged. Use low reasoning and standard processing. Portable minimal reasoning maps to low; none is rejected. EU residency does not support priority processing.",
			"",
			"Keep applications on their generation, agent, and flow entrypoints. Declare only independent tools as background; ordinary and imported MCP tools stay blocking unless the application explicitly changes their declaration. A promise, thread, or MCP hint is not a background declaration. Set `asyncMode` to `off` for the ordinary tool loop; chat-only services retain that loop automatically.",
			"",
			"Declared-background native agent tools retain the imported MCP schema, handler, namespace, and raw result. Discovery must expose the tool before the model can call it. Invalid arguments are corrected before handler execution; the responder waits for the incorporated result. Native calls appear in action logs and must not be repeated through actor code.",
			"Owned child agents inherit selected MCP clients at delegation. Parent stages keep their own clients; none or an empty namespace list passes no parent clients. Explicit child context wins over inherited context. Each run refreshes protocol modules without serializing live client handles into model requests. Cancellation propagates through a delegated child into its pending MCP tool; completed child work is not replayed.",
			"Imported MCP tools forward cancellation to context-aware transports, including built-in HTTP. Custom transports using the older send method receive cancellation checks before and after their call; noncooperative work may finish later and its result is discarded. Cancellation does not undo an external action or replay a request.",
			"MCP host policy applies to native background calls too. Configure authorizeToolCall in Python, Go, and Java client options, or set_tool_authorizer on C++ and Rust clients before exposing their tools. The callback receives the client and call metadata; returning false denies the call before a tool request is sent. Use shared application policy state when permissions must change during a run.",
			"",
			"Register child agents before running the parent: add_child_agent(namespace, name, child) in Python/C++, AddChildAgent in Go, addChildAgent in Java, and with_child_agent in Rust. Registered children are available automatically as namespaced actor calls, such as team.researcher({question}). Calls use discovery, validation, and invocation accounting. Child invocation remains serialized on the owning run thread and owns a separate conversation. Retained callbacks reject calls after the run closes. Controls target paths such as root/team.researcher/executor. Child results return through the parent invocation log, and parent usage includes a children section.",
			"",
			"Attach the language-native run controller through forward options for steering, reasoning changes, cancellation, and lifecycle events. Queued and applied are different states. HTTP applies updates at a response boundary; an optional host WebSocket enables native steering. Do not manage response IDs, socket messages, or tool-result submission in application code.",
			"",
			"As in TypeScript, an update queued while a request is in flight applies when the next step starts. If that request gave the final answer, the run takes one more step to apply it, and the answer comes from that step; a steer stays in the conversation for the steps after it.",
			"",
			"A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session, reports unresolved call IDs, and retains unresolved started calls in tool traces and native agent action logs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.",
			"",
			"Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.",
			"",
			"All five session adapters validate completed raw arguments against the shared Core validator before invoking handlers, including local references, unions, nested schemas, additional properties, and numeric/string/array constraints. Raw schema patterns use shared flagless ECMAScript semantics, including UTF-16, lookarounds, named captures, and backreferences. Invalid arguments enter correction; step exhaustion fails the run.",
			"",
			"Independent flow nodes use owned program and client workers. Built-in providers, routers, and balancers supply factories; custom implementations without them run the entire group serially and emit a flow_parallel_fallback trace. Rust does not require Send/Sync on the existing client trait. Rust nested flows and custom AxExecutableProgram implementations use execute_program; an optional AxOwnedProgramFactory constructs state on its worker. Workers deliver events and results to the owner, which merges each successful step's changes in plan order, so a group ends as running its steps one after another would. On group failure, cancellation preserves completed diagnostics and discards late deliveries.",
			"",
			"Use the provider-backed Astra examples under `src/examples/"+target+"/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.",
			"",
		) + "\n"
	}
	genForwardGuide := ""
	if spec.ID == "gen" {
		genForwardGuide = readmeLines(
			"## Provider Forward Options",
			"",
			"AxGen merges constructor and per-call forward options before invoking the provider. Provider-facing keys such as `promptCacheKey`, `sessionId`, `contextCache`, and `timeoutMs` therefore reach the chat request without being copied into program inputs. Per-call values override constructor defaults, and `modelConfig` / `model_config` merges key by key: a call's keys override the constructor's, whichever spelling each uses.",
			"",
			"`structuredOutputMode` / `structured_output_mode` accepts `auto`, `native`, `function`, or `json_object`. Auto follows the selected profile/model ordering, with the provider-neutral singleton string/code JSON-object optimization. Explicit modes must be advertised and fail before transport otherwise. JSON-object mode retains exact-shape prompting, strict parsing, and one bounded correction retry without a synthetic `__axOutput` tool.",
			"",
			"Beside native tools, auto keeps the rung it picks without them, for every provider and for forced calls too: Ax does not switch rungs to work around a provider's or model's JSON-mode problems. Set `structuredOutputMode` / `structured_output_mode` to `function` to have the model answer through `__axOutput` beside the tools instead.",
			"",
			"A simple signature (no object or object-array output) selects no structured-output rung, with or without tools, as in TypeScript: the provider gets no response schema and the model answers with `field: value` lines, whatever `structuredOutputMode` says. Set `forceStructured` / `force_structured` (the TypeScript `useStructured()` equivalent) to keep the JSON contract; agent actor stages set it.",
			"",
			"When the provider returns a thought (it does when `showThoughts` / `show_thoughts` is set), the forward output carries it under `thought`, or under the constructor's `thoughtFieldName` / `thought_field_name`, on every structured-output rung, as in TypeScript. The output thought joins each tool step's thought in order, a validation or refusal retry starts it over, and an empty thought is left out. As in TypeScript, a per-call thought field name is ignored.",
			"",
			"`stream: true` on a forward streams the model's response and returns what a streaming consumer merges, as in TypeScript: the last version's deltas, merged. That matches a non-streaming forward except where TypeScript's streaming differs: a code field keeps its opening fence, and the thought a stop step streamed stays in the output. "+skillStreamingForwardText(target),
			"",
			skillTextContractText(target),
			"",
			skillFieldProcessorText(target),
			"",
			skillCachingFunctionText(target),
			"",
			skillAudioOutputText(target),
			"",
			skillNumberFormatText(target),
			"",
			"`maxSteps` / `max_steps` (default 25) caps the tool loop. Each model turn that calls tools is one step, and validation retries stay inside their step. Reaching the cap raises `Generate failed: Max steps reached: N`. A call to a stop function (`stopFunctions` / `stop_functions`) runs the tool and ends the forward, as in TypeScript: the output is empty apart from the earlier steps' thought, and the tool's result is not the output.",
			"",
			"`maxRetries` / `max_retries` (default 3) caps both retry loops, as in TypeScript. A failed provider request is retried only for infrastructure errors: a 5xx status, a network error, a timeout, or a terminated stream. As in TypeScript, these retries wrap the validation loop: a step's infrastructure retries share one budget, and each one restarts validation with a fresh budget. Any other error, such as a 400 or 429 status, a response error, or a rejection before the request is sent, surfaces after one request. Validation failures, and assertion failures that carry a message, are retried inside the current step with a correction message, and each tool step starts with fresh budgets. As in TypeScript, an assertion that fails without a message, or that raises an error, surfaces at once without a retry; give it a message (the `message` key of a declarative assertion, or the message argument of a callable assertion where the target has one) to make its failure retryable. On the `function` rung a retry keeps the failed `__axOutput` call on the assistant turn with a `done` result and asks the model to fix its arguments, as TypeScript does. A model refusal spends the same budget: the same prompt goes out again at once, with no backoff and no correction message. `validationRetries` / `validation_retries` and `infraRetries` / `infra_retries` override the two budgets separately.",
			"",
			skillErrorsText(target),
			"",
			"`includeOptionalInputFieldsInSystemPrompt` / `include_optional_input_fields_in_system_prompt` (off by default), set on the constructor or the forward (the forward's wins), lists every input field in the system prompt, provided or not, as in TypeScript; the user message still leaves out an unset optional field. The agent's actor stages turn it on, as TypeScript's do.",
			"",
			"`strictMode` / `strict_mode`, set on the constructor or the forward (the forward's wins), requires the answer to open with its first required field's label, as in TypeScript: an unlabeled answer, or one JSON object, is retried with a correction instead of being read as a single-field answer.",
			"",
			skillDateFieldsText(target),
			"",
			"`functionCall` / `function_call` sets the tool choice: `auto`, `none`, `required`, or `{ type: 'function', function: { name } }` to force one function. A forced call (`required` or named) applies to the first step only, as in TypeScript: later steps drop it together with the tools so the model can answer. Under the `function` structured-output rung the forced step withholds `__axOutput`, so the forcing reaches a user tool, and the next step forces `__axOutput`. A tool choice passed as `functionCallMode` is routed the same way.",
			"",
			"## Multi-Sampling",
			"",
			"- Set `sampleCount` / `sample_count` to request N provider candidates. Core parses and validates every candidate, preserving each provider result index.",
			"- Without a result picker, AxGen returns candidate 0. A result picker receives all `{ index, sample }` structured candidates and returns the winning list index; Core rejects an index outside `0..N-1`.",
			"- Native callback surface: "+skillResultPickerSurface(target)+".",
			"- OpenAI-compatible Chat and Gemini map multi-sampling to `n` and `candidateCount`. Anthropic rejects `n > 1` explicitly. Gemini 3 on the Gemini API returns one candidate, so `n > 1` is dropped with a one-time warning and AxGen gets one sample.",
			"",
		) + "\n"
	}
	agentStreamingGuide := ""
	if spec.ID == "agent" {
		agentStreamingGuide = readmeLines(
			"## Where The Runtime Goes",
			"",
			skillAgentRuntimeText(target),
			"",
			"- A run with a runtime runs the RLM stages, as TypeScript's agent always does with its default JavaScript runtime: the distiller and the executor write code in the runtime's language and run it in the runtime.",
			"- A run without one runs the ports' runtime-less stages, which answer with a completion payload instead of code; TypeScript has no such mode.",
			"- Each run picks its stages from its own runtime, so one agent can alternate. Both stage sets are kept, and each keeps the standing instruction, actor addenda and optimized components; `set_signature` rebuilds them.",
			"",
			"## Flat Function Namespaces",
			"",
			"- A flat function (one in the agent's `functions` outside a module) is called `tools.<name>` by default, even when it names its own namespace. TypeScript's agent calls it `<namespace>.<name>` (and `utils.<name>` when it names none).",
			"- `flatFunctionNamespace` / `flat_function_namespace` on the agent: `'own'` calls each flat function by its own namespace now, as TypeScript does (one without a namespace stays `tools.<name>`), and a namespace that shadows a runtime global such as `inputs` or `final` raises TypeScript's error; `'tools'` keeps `tools.<name>`. Left unset, a flat function that names another namespace warns once. `'own'` becomes the default in the next major version.",
			"- "+skillAgentFlatNamespaceText(target),
			"",
			"## Streaming An Agent Run",
			"",
			skillAgentStreamingText(target),
			"",
			"- The distiller and the executor, or the direct-respond skip, run first without streaming, as in TypeScript. A clarification request or a stage failure raises before any delta.",
			"- The deltas are the responder's AxGen deltas: merge each index's deltas (strings and lists append, other values replace) and start over when the version changes. A responder retry, such as a citation correction, streams a new version.",
			"- With `citations` on, the responder's assertion checks the cited ids against the run's evidence and retries with TypeScript's correction message, in forward and streaming alike. With `surface: \"hidden\"` each delta leaves out the citation field, so a delta can be empty, and the citations observer gets the ids streamed in the last version that streamed any.",
			"- As in forward, the used-memory and used-skill observers run before the responder, and the context map and the playbook learn after it.",
			"- `parseDates` / `parse_dates` on the agent or on the forward call (the call's wins) reaches the responder, so its `date`, `datetime`, `dateRange` and `datetimeRange` output fields come back parsed as AxGen parses them, in forward outputs and streamed deltas alike. Without it they keep the model's text, as before.",
			"- A run `control` hears the run at its own path (`root`) and each stage at `root/distiller`, `root/executor` and `root/responder`, in forward and streaming alike. Stopping the stream early ends the responder and the run as `aborted`. A steer queued while a stage's request is in flight makes that stage take another step, as AxGen does, and a steer without a target reaches every later stage too.",
			"- "+skillAgentStreamingSessionText(target),
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
	audioGuide := ""
	if spec.ID == "audio" {
		audioGuide = readmeLines(
			"## Speech And Audio Fields",
			"",
			"- `speak()` returns TypeScript's speech result keys: `data` (base64 audio), `format`, `mimeType`, `transcript` (the spoken text), and `sampleRate` / `channels` when the mime type gives them. The older keys `audio`, `mime_type`, and `sample_rate` stay beside them until the next major version; read the TypeScript keys in new code.",
			"- As in TypeScript, a binary speech body's Content-Type is its `mimeType` (else the format's mime type), and a JSON body (by its Content-Type) is read from `audio_data`, `audioData`, `data`, `audio.data`, `output.audio.data`, or a Gemini part's inline data. A JSON body whose audio is under the older `audio` key still works, with a one-time deprecation warning, until the next major version; a JSON body with no audio raises TypeScript's error.",
			"- Speak requests match TypeScript: OpenAI defaults to `gpt-4o-mini-tts` with the `alloy` voice, sends a `{ id }` voice by its id, sends `speed` when set, and asks for `pcm` when the format is `pcm16`; Mistral defaults to `voxtral-mini-tts-2603` and sends the voice as `voice_id`; Grok sends `speed` when set.",
			"- "+skillAudioSpeakSurface(target)+"",
			"- An AxGen `audio` output field becomes speech with the `renderAudio` / `render_audio` option (see the gen skill): the field then holds the `speak()` result, with the spoken text as its `transcript`.",
			"- An agent's `audio` output fields render the same way when `renderAudio` / `render_audio` is set on the agent, its `responderOptions`, or the forward call (the call's wins); as in TypeScript, the responder's `speak()` request takes the forward call's `speech` or `responderOptions.speech`, not a top-level `speech` option.",
			"- An audio input that is a string, or an audio object with a string `transcript` (a rendered audio output), reaches the model as text. Audio without a transcript goes as an audio part with only its `format` (`wav` when it has none) and `data`.",
			"",
		) + "\n"
	}
	usageObserverGuide := ""
	if spec.ID == "agent-observability" {
		usageObserverGuide = readmeLines(
			"## Centralized Usage Observer",
			"",
			"Use the process-wide usage observer for application accounting across many agents, API routes, tenants, and users. Keep per-agent usage accessors for inspecting one agent instance after a run.",
			"",
			"```"+cfg.Fence,
			skillUsageObserverSnippet(target),
			"```",
			"",
			"- The observer receives one normalized event for each completed chat or embedding call that reports provider usage. A fully consumed stream emits once; an unconsumed or cancelled stream may not emit.",
			"- Events include the operation, AI/provider name, model, normalized tokens, streaming flag, optional usage context, and available session or remote request IDs.",
			"- Attach `usageContext` in AI service options for stable application or environment defaults. Attach it in call or agent-forward option maps for tenant, user, request, run, and feature attribution.",
			"- Per-call context overrides service defaults. Nested `attributes` are shallow-merged.",
			"- The observer is process-wide, best-effort, and fail-open. Registering again replaces the previous observer. Clear it during test teardown or shutdown when appropriate.",
			"- The observer runs on the request path. Production callbacks should synchronously enqueue into a bounded concurrent queue and return immediately, then persist or aggregate out of band. Use a shared durable pipeline across processes or serverless instances.",
			"- Keep identifiers opaque and attributes low-cardinality. Do not attach prompts, responses, secrets, or other sensitive payloads.",
			"- Calculate currency cost downstream against a versioned provider/model pricing table.",
			"- Runnable provider example: `"+skillUsageObserverExamplePath(target)+"`.",
			"",
		) + "\n"
	}
	guardrails := []string{
		"Start from package examples for exact native syntax before inventing a new call shape.",
		"Use `provider-api` examples only when the user explicitly has provider credentials available.",
		"Use `no-key` examples for deterministic local checks and provider request mapping.",
		"Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.",
		"Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.",
	}
	if target == "go" && spec.ID == "ai" {
		guardrails = append(guardrails, "A provider can split a surrogate pair (an emoji, say) across stream chunks. AxGen streaming deltas and outputs join it, but a raw client `Stream` delta carries each half as its WTF-8 bytes, as TypeScript's raw deltas carry the lone surrogate. Join raw deltas with `JoinStreamText(text, delta)`: concatenating them with `+` leaves the two halves' bytes, which are not valid UTF-8, where the character belongs.")
		guardrails = append(guardrails, "When decorating `AIClient`, forward `GetFeatures(model) map[string]Value` whenever the wrapped client implements it. AxGen otherwise falls back to permissive capabilities, which can select an unsupported structured-output rung.")
		guardrails = append(guardrails, "For Vertex OpenAI-compatible MaaS, prefer `NewAI(\"vertex-ai\", options)` with `AxCredentialProviderFunc`; do not reintroduce a request-rewriting response-format decorator.")
	}
	if target == "rust" && spec.ID == "ai" {
		guardrails = append(guardrails, "A provider can split a surrogate pair (an emoji, say) across stream chunks. AxGen streaming deltas and outputs join it, but a raw client `stream` delta carries each half as a private-use mark (U+10F800 plus the half's offset from U+D800), since a Rust `String` can't hold a lone surrogate. Join raw deltas with `join_stream_text(&text, &delta)`: `push_str` leaves the two marks where the character belongs.")
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
		expandedExamples+skillTypesafeGuide(target, spec.ID)+profileGuide+routingGuide+sessionGuide+genForwardGuide+audioGuide+agentStreamingGuide+agentMemoryGuide+usageObserverGuide+"## Relevant API Surface",
		"",
		skillAPISurface(apiRef, spec.Sections),
		"",
		"## Guardrails",
		"",
		skillBulletList(guardrails),
	)
}

func skillAgentRuntimeText(target string) string {
	switch target {
	case "python":
		return "Give the agent a code runtime on the constructor (`runtime`: a runtime object, or a `{\"language\": ...}` config with the runtime passed per call) or on a forward call (`{\"runtime\": AxQuickJsCodeRuntime()}`). The constructor's runtime wins; without one, a run uses the forward call's. Playbook evolve and agent optimize take a runtime in their options the same way, and run each task on it."
	case "go":
		return "Give the agent a code runtime on the constructor (`\"runtime\"`: a `CodeRuntime`, or a `{\"language\": ...}` config with the runtime passed per call) or on a forward call (`map[string]ax.Value{\"runtime\": axgoja.NewRuntime()}`). The constructor's runtime wins; without one, a run uses the forward call's. Playbook evolve and agent optimize take a runtime in their options the same way, and run each task on it."
	case "java":
		return "Give the agent a code runtime on the constructor (`\"runtime\"`: an `AxCodeRuntime`, or a `{\"language\": ...}` config with the runtime passed per call) or on a forward call (`Map.of(\"runtime\", runtime)`). The constructor's runtime wins; without one, a run uses the forward call's. Playbook evolve and agent optimize take a runtime in their options the same way, and run each task on it."
	case "cpp":
		return "Give the agent a code runtime on the constructor (`\"runtime\"`: `axllm::Core::code_runtime_ref(runtime)`, or a `{\"language\": ...}` config with the runtime passed per call) or on a forward call's options (`{\"runtime\", axllm::Core::code_runtime_ref(runtime)}`). The constructor's runtime wins; without one, a run uses the forward call's. Playbook evolve and agent optimize take a runtime in their options the same way, and run each task on it."
	case "rust":
		return "Attach the code runtime to the agent with `with_runtime(Box::new(runtime))`; Rust takes no runtime on the forward call."
	default:
		return "Give the agent a code runtime on the constructor or on a forward call."
	}
}

func skillAgentFlatNamespaceText(target string) string {
	switch target {
	case "python":
		return "A function names its namespace with `fn(name).namespace(\"crm\")`, or a function spec with a `\"namespace\"` key."
	case "go":
		return "A function names its namespace with `ax.Fn(name).WithNamespace(\"crm\")`, or a function spec with a `\"namespace\"` key."
	case "java":
		return "A function names its namespace with `Ax.fn(name).namespace(\"crm\")` (or `tool.namespace(\"crm\")` on a built `Tool`), or a function spec with a `\"namespace\"` key."
	case "rust":
		return "Host `Tool`s go under a namespace with `with_tool_module(\"crm\", tools)`, which needs no option; `'own'` reads a function spec's `\"namespace\"` key."
	case "cpp":
		return "Host `Tool`s go under a namespace with `add_tool_module(\"crm\", tools)`, which needs no option; `'own'` reads a function spec's `\"namespace\"` key."
	default:
		return "A function spec names its namespace with a `\"namespace\"` key."
	}
}

func skillAgentStreamingText(target string) string {
	switch target {
	case "python":
		return "`agent.streaming_forward(client, values, options)` runs the agent and yields the responder's `{\"version\", \"index\", \"delta\"}` deltas as TypeScript's `streamingForward` does. The run works on a worker thread that waits while you handle each delta; closing the generator stops the run."
	case "go":
		return "`(*AxAgent).StreamingForward(ctx, client, values, options)` runs the agent and returns an `iter.Seq2[AxGenDelta, error]` of the responder's deltas, as TypeScript's `streamingForward` does. The run works in its own goroutine; stopping the iteration cancels it, and an error ends the sequence as a final `(AxGenDelta{}, err)` pair."
	case "java":
		return "`agent.streamingForward(client, values, options)` runs the agent and returns an `AxGenDeltaStream` of the responder's deltas, as TypeScript's `streamingForward` does. Consume it once, in try-with-resources: the run starts on a worker thread with the iteration, and closing the stream stops it."
	case "rust":
		return "`agent.streaming_forward(&mut client, values, options, on_delta)` runs the agent, calls `on_delta` with each `AxGenDelta` of the responder as TypeScript's `streamingForward` yields it, and returns the responder's output. Returning `Err(error)` from `on_delta` stops the run, and `streaming_forward` returns that same error."
	case "cpp":
		return "`agent.streaming_forward(client, values, options, handler)` runs the agent, calls `handler(const AxGenDelta&)` with each delta of the responder as TypeScript's `streamingForward` yields it, on the calling thread, and returns the responder's output. Returning false stops the run without an exception; an exception the handler throws stops it and propagates."
	default:
		return "The agent streams the responder's deltas as TypeScript's `streamingForward` does."
	}
}

func skillAgentStreamingSessionText(target string) string {
	switch target {
	case "python":
		return "A run `control` on a client that opens async model sessions (such as `gpt-6-astra`) is not streamed through a session yet: `streaming_forward` raises `NotImplementedError` before any stage runs, as AxGen deltas do. Use `forward()` there."
	case "java":
		return "A run `control` on a client that opens async model sessions (such as `gpt-6-astra`) is not streamed through a session yet: the stream throws `UnsupportedOperationException` before any stage runs, as AxGen deltas do. Use `forward()` there."
	case "go":
		return "Under a run `control` the responder streams through the request boundary, as `AxGen.StreamingForward` does; it does not open an async model session yet."
	default:
		return "Under a run `control` the responder streams through the request boundary, as AxGen streaming does; on a client that opens async model sessions (such as `gpt-6-astra`) the session answers the responder in one chunk."
	}
}

func skillStreamingForwardText(target string) string {
	deltas := "merge each index's deltas (strings and lists append, other values replace) and discard what you merged when the version changes. A validation or refusal retry starts a new version, an infrastructure retry continues the current one, and a step that replaces output an earlier step emitted (for example after a field processor's feedback) starts a new version that re-sends the thought so far. Streaming assertions and streaming field processors see the current field's text as it streams, as in TypeScript."
	switch target {
	case "python":
		return "`streaming_forward(client, values, {\"deltas\": True})` yields TypeScript's `{\"version\", \"index\", \"delta\"}` deltas as the model streams: " + deltas + " The forward runs on a worker thread that waits while you handle each delta, and closing the generator stops the run; with a run `control` the run then ends with an `aborted` event rather than `failed`. Without the flag, `streaming_forward` still yields the provider's raw chat response chunks and raises a `DeprecationWarning`: deltas become the default in the next major version, and `stream_raw()` keeps the raw chunks."
	case "go":
		return "`StreamingForward(ctx, client, values, options)` returns an `iter.Seq2[AxGenDelta, error]` of TypeScript's `{Version, Index, Delta}` deltas as the model streams: " + deltas + " Stopping the iteration cancels the run; with a run `control` the run then ends with an `aborted` event rather than `failed`."
	case "java":
		return "`streamingForward(client, values, options)` (or with a trailing `AxCancellationToken`) returns an `AxGenDeltaStream`, an `Iterable<AxGenDelta>` that is also `AutoCloseable`, of TypeScript's `{version, index, delta}` deltas (`version()`, `index()`, `delta()`) as the model streams: " + deltas + " The forward runs on a worker thread that starts with the iteration and waits while the caller handles each delta. Consume the stream once, in try-with-resources: closing it (or leaving the block early) stops the run and waits for the worker; with a run `control` the run then ends with an `aborted` event rather than `failed`. Cancelling the token aborts the run with `AxAIServiceAbortedError`, and a forward error is rethrown from the iterator as the forward raised it."
	case "rust":
		return "`streaming_forward(&mut client, values, options, on_delta)` calls `on_delta` with each `AxGenDelta { version, index, delta }` of TypeScript's deltas as the model streams, and returns the merged output of the picked sample: " + deltas + " The forward runs on the caller's thread. Returning `Err(error)` from `on_delta` stops the run without a retry, and `streaming_forward` returns that same error; give your own stop an error of its own (for example `AxError::new(\"stopped\", ...)`) to tell it from a failed run. Under a run control (`AxForwardOptions::with_control`) the stream works as a controlled forward does: it reports `started`, then `completed` or `failed`, and applies steering at each model request; an `Err` from `on_delta` ends the run with an `aborted` event rather than `failed`. `AxFlow::streaming_forward` runs the whole flow, as `forward_with_options` does, and returns its output as the single update `AxGenDelta { version: 1, index: 0, delta }`, as TypeScript does."
	case "cpp":
		return "`streaming_forward(client, values, options, handler)` calls `handler(const AxGenDelta&)` with TypeScript's `{version, index, delta}` deltas as the model streams, on the calling thread, and returns the merged output of the picked sample: " + deltas + " Returning false from the handler stops the run (the provider stream closes and no further request is sent) without an exception, and `streaming_forward` returns what was merged so far; an exception the handler throws stops the run and propagates unchanged. With a run `control`, a run the handler stops either way ends with an `aborted` event rather than `failed`. An overload takes a `const AxCancellationToken*`."
	default:
		return "The streaming forward API yields the provider's raw chat response chunks (`results[].content`, `results[].thought`, `results[].function_calls`), not TypeScript's `{ version, index, delta }` field deltas."
	}
}

func skillCallTimeoutText(target string) string {
	ignored := "A per-call `timeout` is ignored until the next major version, which reads it in milliseconds as TypeScript does. A call that gives it without `timeoutMs` warns once, naming `timeoutMs`. "
	return map[string]string{
		"python": ignored + "The client's `timeout` argument stays in seconds.",
		"go":     ignored + "Go's HTTP transport sets no timeout of its own; give `HTTPTransport` an `http.Client` with one for a client-wide bound.",
		"java":   ignored + "The client's `timeout` option stays in seconds.",
		"cpp":    ignored + "The client's `timeout` option stays in seconds.",
		"rust":   "Rust reads a per-call `timeout` in seconds, for streams too. The next major version reads it in milliseconds, as TypeScript does, so a call that gives it without `timeoutMs` warns once, naming `timeoutMs`. The client's `timeout` option stays in seconds.",
	}[target]
}

func skillErrorsText(target string) string {
	text := "A failed forward raises `Generate failed: <reason>`, as TypeScript's message reads. Exhausted validation, assertion or refusal retries give `Generate failed: Unable to fix validation error: <last error>`, ending with `LLM Output:` and the last attempt's answer (each sample's, joined with `---`). A response the model cut off at its token limit raises `Generate failed: Max tokens reached before completion`, streamed or not, instead of returning the partial answer. Only the message text changed: the error keeps its class and category (a validation failure is still a validation error), and an aborted run raises its abort error as it is. "
	cause := map[string]string{
		"python": "The error it wraps is its `__cause__`, as `raise ... from` sets it.",
		"java":   "The error it wraps is its `getCause()`.",
		"go":     "The error it wraps is what `errors.Unwrap` returns, so `errors.Is` and `errors.As` reach it; an error the runtime caught and raised again comes back rebuilt with the same category, type and message.",
		"cpp":    "The error it wraps is its `cause()`.",
		"rust":   "The message includes the wrapped error's text; `AxError` gains a `cause`, `source()`, a provider error's request (its URL and body, as TypeScript keeps them) and `#[non_exhaustive]` in the next major version, since a new public field would break struct literals now.",
	}[target]
	return text + cause + " TypeScript raises an `AxGenerateError`, which the ports raise from the next major version."
}

func skillTextContractText(target string) string {
	warning := map[string]string{
		"python": "raises a `DeprecationWarning` once",
		"go":     "logs a deprecation warning once",
		"java":   "logs a deprecation warning once",
		"rust":   "prints a deprecation warning once",
		"cpp":    "prints a deprecation warning once",
	}[target]
	if warning == "" {
		warning = "warns once"
	}
	return "Text-contract answers are parsed as TypeScript's `extractValues` parses them: `Label: value` lines, a single-field answer without a label, JavaScript `Number()` coercion, a JSON array or markdown list for list fields, fenced code and JSON blocks, and `null` for an optional field, with TypeScript's validation messages. For compatibility an answer that is exactly one JSON object whose keys are all output fields is still read as those fields; that fallback " + warning + " and is removed in the next major version, when such an answer is read as text, as in TypeScript."
}

func skillNumberFormatText(target string) string {
	text := "Prompts and provider request bodies write JSON as TypeScript's `JSON.stringify` does. Object keys come in the object's own order: array-index keys (`\"2\"`, `\"10\"`) first in numeric order, then the rest in insertion order, never sorted; `null` stays `null`. Numbers get shortest round-trip digits, `2` for a float two, exponent form below 1e-6 and from 1e21 up (`1e-7`, `1e+21`), and `null` for NaN and the infinities. "
	switch target {
	case "python":
		return text + "Python ints keep their exact digits past 2^53, where TypeScript's doubles round them."
	case "java":
		return text + "`Long` values, which `Json.parse` gives integer literals that fit in a long, keep their exact digits past 2^53, where TypeScript's doubles round them."
	case "rust":
		return text + "Integer JSON numbers (`u64` / `i64`, which serde_json parses exactly) keep their exact digits past 2^53, where TypeScript's doubles round them."
	case "go":
		return text + "`int` and `int64` values keep their exact digits past 2^53, where TypeScript's doubles round them; JSON text parses to `float64`, which rounds as TypeScript does."
	default:
		return text + "Values hold numbers as doubles, so integers past 2^53 round as they do in TypeScript."
	}
}

func skillDateFieldsText(target string) string {
	text := "`parseDates` / `parse_dates`, set on the constructor or the forward (the forward's wins), parses `date`, `datetime`, `dateRange` and `datetimeRange` output fields as TypeScript does in the text contract: `YYYY-MM-DD`; ISO 8601 with `Z` or an offset; or `YYYY-MM-DD HH:mm Zone` with an offset, `UTC`/`GMT`, an IANA zone name (matched without regard to case, with TypeScript's handling of DST gaps, which are an error, and overlaps, which take the earlier instant), or an abbreviation at its literal offset (`PST` is -08:00 all year; ambiguous ones such as `BST`, `IST` and `CST` are rejected; `PST`/`PDT` and `CDT` follow US usage, so for Philippine time (`PST`) or Cuban daylight time (`CDT`) give an IANA name (`Asia/Manila`, `America/Havana`) or a UTC offset); and ranges as `{\"start\", \"end\"}` JSON, a two-item array, `start/end`, or `start to end`. A value comes back as TypeScript's JSON of its `Date`: a `toISOString()` string such as `2024-05-09T18:30:00.000Z`, and `{\"start\", \"end\"}` of those for a range, in forward outputs and in streamed deltas. An unparseable value is a validation error that is retried with TypeScript's correction; an optional field's bad value is left out. Structured JSON answers keep the model's strings, as in TypeScript. Without the option date fields keep the model's text as before: that is the default until the next major version, which parses by default, and `parseDates: false` keeps today's behavior after that. "
	switch target {
	case "python":
		return text + "Named zones resolve through the `zoneinfo` module (the platform tz database, or the `tzdata` package where there is none, as on Windows). A date or datetime input also takes a `datetime` (an aware one is its instant, a naive one is local time) or a `date` (its UTC midnight), rendered as TypeScript renders a `Date`: the UTC day for a date field and ISO 8601 without milliseconds for a datetime; a range input takes a `{\"start\", \"end\"}` dict, of dates or of strings."
	case "go":
		return text + "Named zones resolve through `time.LoadLocation` (the platform tz database, `$ZONEINFO`, or `time/tzdata` when your program imports it, which Windows builds without Go installed need). A date or datetime input also takes a `time.Time`, rendered as TypeScript renders a `Date`: the UTC day for a date field and ISO 8601 without milliseconds for a datetime; a range input takes a `{\"start\", \"end\"}` map, of `time.Time` values or of strings."
	case "java":
		return text + "Named zones resolve through `java.time`'s bundled tz database. A date or datetime input also takes an `Instant`, `OffsetDateTime`, `ZonedDateTime` or `java.util.Date` (its instant), a `LocalDateTime` (in the JVM's zone) or a `LocalDate` (its UTC midnight), rendered as TypeScript renders a `Date`: the UTC day for a date field and ISO 8601 without milliseconds for a datetime; a range input takes a `{\"start\", \"end\"}` map, of those or of strings."
	default:
		return text + "Named zones resolve through the platform tz database, read directly: TZif files under `$TZDIR`, then `/usr/share/zoneinfo` and the other usual directories, with the zone's POSIX rule past its last transition. Windows has no such directory, so set `TZDIR` to a zoneinfo directory there, or named zones fail as unrecognized (offsets and UTC still work). Date inputs are strings, since `Value` has no date type; a range input can also be a `{\"start\", \"end\"}` object, rendered as JSON."
	}
}

func skillFieldProcessorText(target string) string {
	feedback := " As in TypeScript, the feedback message's content is one text part (`[{type: \"text\", text}]`), and a streaming field processor's feedback waits for the end of the step: it follows the full answer and comes before the final processors' feedback. A streamed delta never ends in half of a surrogate pair, and a pair a provider splits across stream events is joined back into one character."
	switch target {
	case "python":
		return "`add_field_processor(field, fn, feedback=True)` follows TypeScript: `fn(value, {\"values\", \"done\"})` runs on the parsed field, and a non-empty result goes back to the model as a user message for another step, whose answer replaces the earlier one. `add_streaming_field_processor(field, fn)` does the same on each streamed chunk of a string or code field. Without `feedback=True`, `add_field_processor` still rewrites the field value and raises a `DeprecationWarning`: that default becomes the feedback behavior in the next major version. `add_field_transform(field, op)` is the permanent, port-only home of the rewrite (`uppercase`, `lowercase`, `trim`, `prefix:...`, `suffix:...`, or a callable); in `streaming_forward` a transformed field is held back and sent once, transformed." + feedback
	case "go":
		return "`AddFieldProcessor(field, processor)` follows TypeScript: the `AxFieldProcessor` runs on the parsed field, and a non-empty result goes back to the model as a user message for another step, whose answer replaces the earlier one. `AddStreamingFieldProcessor` does the same on each streamed chunk of a string or code field. `AddFieldTransform` (or the `FieldProcessors` field) rewrites a field's value instead, a port extension; in `StreamingForward` a transformed field is held back and sent once, transformed." + feedback
	case "java":
		return "`addFieldProcessor(field, processor, AxFieldProcessorMode.FEEDBACK)` follows TypeScript: the `AxFieldProcessor` gets the parsed field and an `AxFieldProcessorContext` (`values()`, `done()`), and a non-empty result goes back to the model as a user message for another step, whose answer replaces the earlier one. `addStreamingFieldProcessor(field, processor)` does the same on each streamed chunk of a string or code field. Both throw when the field is not an output field (or, streaming, not a text field). `addFieldTransform(field, op)` is the permanent, port-only home of the rewrite (`uppercase`, `lowercase`, `trim`, `prefix:...`, `suffix:...`, or a `FieldProcessorCallback`), and `AxFieldProcessorMode.TRANSFORM` rewrites the field with the processor's result; in `streamingForward` a transformed field is held back and sent once, transformed. The two-argument `addFieldProcessor(field, op)` and `addFieldProcessor(field, callback)` still rewrite the field value; they are `@Deprecated` and log a deprecation warning once: that default becomes the feedback behavior in the next major version. `addStreamingAssert(field, assertion, message)` takes an `AxStreamingAssertion` `(text, done) -> result` over a string or code field's text as it streams: `null` or `true` passes, and `false` or a message string stops the attempt and retries it with a correction (the returned message, else `message`); an exception the check throws ends the forward without a retry. The declarative `addStreamingAssert(field, notContains, message)` still works." + feedback
	case "rust":
		return "`add_field_processor(field, processor)` follows TypeScript: `processor(value, AxFieldProcessorContext { values, done })` runs on the parsed field, and a `Some` result goes back to the model as a user message for another step, whose answer replaces the earlier one; `Ok(None)` sends nothing, and an `Err` ends the forward without a retry. `add_streaming_field_processor` does the same on each streamed chunk of a string or code field, and `add_streaming_assert(field, check, message)` checks that text as it streams: `check(text, done)` passes with `Value::Null` or `true`, fails with `false` or a message string (the attempt is retried with a correction), and ends the forward with an `Err`. The three return `AxResult<&mut Self>`, so calls chain with `?`: as TypeScript throws, they return an error for a field that is not an output field (or not a string or code field, for the streaming two). `with_field_transform(field, op)`, or `with_field_transform_fn(field, closure)`, is the permanent, port-only home of the rewrite (`uppercase`, `lowercase`, `trim`, `prefix:...`, `suffix:...`); in `streaming_forward` a transformed field is held back and sent once, transformed. `with_field_processor(field, op)` still rewrites the value and is deprecated: in the next major version it switches to TypeScript's feedback semantics." + feedback
	case "cpp":
		return "`add_field_processor(field, processor, AxFieldProcessorMode::Feedback)` follows TypeScript: the `AxFieldProcessor` (`processor(value, context)`, with the output values so far in `context.values` and `context.done`) runs on the parsed field, and a non-empty result goes back to the model as a user message for another step, whose answer replaces the earlier one. `add_streaming_field_processor(field, processor)` does the same on each streamed chunk of a string or code field, and `add_streaming_assert(field, assertion, message)` checks a string or code field as it streams: `assertion(text, done)` returns null or true to pass, or a message string or false to fail, which retries the attempt with a correction. `add_field_transform(field, op)` is the permanent, port-only home of the rewrite (`uppercase`, `lowercase`, `trim`, `prefix:...`, `suffix:...`, or a callable), and `AxFieldProcessorMode::Transform` rewrites with an `AxFieldProcessor`; in `streaming_forward` a transformed field is held back and sent once, transformed. The two-argument `add_field_processor(field, op)` still rewrites the field value and prints a deprecation warning once: it becomes the feedback behavior in the next major version." + feedback
	default:
		return "Field processors rewrite the field value, a port extension; TypeScript's feedback processors (a result sent back to the model for another step) are in progress for this language."
	}
}

func skillCachingFunctionText(target string) string {
	shared := " The call's function comes first, then the program's, then the process-wide one, and a run with a `control` skips the cache. As in TypeScript, a forward reads the cache before it opens the run's span or records metrics, so a hit sends no request and records neither; an error from the read propagates. A streaming forward yields a hit as one delta (version 0, index 0) and ignores an error from the read. Both store the finished output (the picked sample's, with a result picker) and ignore an error from the store. Keys are lowercase hex SHA-256 digests of the signature and the input values, media included; they differ from other languages' keys, so don't share one store across languages."
	switch target {
	case "python":
		return "`caching_function` (or `cachingFunction`), a constructor or forward option, caches outputs as TypeScript's `cachingFunction` does: `fn(key)` returns a stored output, or `None` for a miss, and `fn(key, output)` stores one. `set_caching_function(fn)` sets a process-wide function, and `None` clears it." + shared
	case "go":
		return "An `AxCachingFunction` (`func(key string, value map[string]Value) (map[string]Value, error)`), passed as the `cachingFunction` (or `caching_function`) option of `NewAx` or of a forward call, caches outputs as TypeScript's `cachingFunction` does: a read passes a nil `value` and gets the stored output back, or a nil map for a miss (an empty map that is not nil is a hit with an empty output), and a store passes the output. `SetCachingFunction(fn)` sets a process-wide function, and `nil` clears it. It may be called from several goroutines at once." + shared
	case "java":
		return "An `AxCachingFunction` (`Map<String, Object> apply(String key, Map<String, Object> value) throws Exception`), passed as the `cachingFunction` (or `caching_function`) option of the `AxGen` constructor or of a forward call, caches outputs as TypeScript's `cachingFunction` does: `apply(key, null)` returns a stored output, or `null` for a miss, and `apply(key, output)` stores one. `AxGlobals.setCachingFunction(fn)` sets a process-wide function, and `null` clears it. It may be called from several threads at once, so keep it thread-safe." + shared
	case "rust":
		return "An `AxCachingFunction` (`Arc<dyn Fn(&str, Option<&Value>) -> AxResult<Option<Value>> + Send + Sync>`) caches outputs as TypeScript's `cachingFunction` does: `f(key, None)` returns `Ok(Some(output))` for a stored output or `Ok(None)` for a miss, and `f(key, Some(&output))` stores one. Set it on a program with `with_caching_function(f)`, for one call with `forward_with_caching_function(client, input, options, f)` or `streaming_forward_with_caching_function(client, input, options, f, on_delta)`, or process-wide with `set_caching_function(Some(f))`, where `None` clears it. A call's function covers that forward only, not programs its tools run. `owned_worker_factory()` workers keep the program's function." + shared + " `with_control(control)` gives a program a run control for every forward, as TypeScript's constructor `control` does; a call's control wins, and either one skips the cache."
	case "cpp":
		return "An `AxCachingFunction` (`std::function<std::optional<Value>(const std::string& key, const Value* value)>`) caches outputs as TypeScript's `cachingFunction` does: a read passes `value == nullptr` and gets the stored output back, or `std::nullopt` for a miss, and a store passes `&output` and its return is ignored. Set it on a program with `gen.set_caching_function(fn)`; for one call, make a handle with `auto cache = axllm::caching_function(fn);` and pass `{\"caching_function\", cache.value()}` in the `forward` or `streaming_forward` options, as a run control's `value()` is passed, keeping the handle alive for the call; or set it process-wide with `axllm::set_caching_function(fn)`. An empty function clears it." + shared
	default:
		return "A caching function (TypeScript's `cachingFunction`) is not available in this language yet."
	}
}

func skillAudioSpeakSurface(target string) string {
	switch target {
	case "python":
		return "The renderer calls the client's `speak(request, options)`, which every `AxAIService` has."
	case "go":
		return "The renderer calls the client's `Speak(ctx, request, options)`: `AxAIService` clients have it, and the `AIClient` interface does not require it, so a custom client without `Speak` cannot render audio."
	case "java":
		return "The renderer calls `AiClient.speak(request, options)`: `AxAIService` clients speak, and a client without speech throws `UnsupportedOperationException`."
	case "rust":
		return "The renderer calls `AxAIClient::speak(request)`, whose default returns an error; provider clients, routers, and balancers implement it."
	case "cpp":
		return "The renderer calls `AIClient::speak(request, options)`: `AxAIService` clients speak, and the base `AIClient` throws."
	default:
		return "The renderer calls the client's speech method."
	}
}

func skillAudioOutputText(target string) string {
	option := "`renderAudio` (or `render_audio`)"
	if target == "python" {
		option = "`render_audio` (or `renderAudio`)"
	}
	return option + ", a constructor or forward option (the forward's wins), renders `audio` output fields as TypeScript does: each audio output that holds text goes through the client's speak(), and the field becomes the speak() result, with the text as its `transcript` unless speak() gave one. The speak request is the forward options' `speech.speak` defaults, then `speech.fields.<field>`, then the text. It renders where TypeScript does: a forward's answer (streamed or not; with a result picker, only the picked sample), a cache hit, and a streaming forward's result when a result picker picks it, which then goes out as its one delta. Deltas that stream without a result picker stay text. The trace and the cache hold the rendered output, a rendered artifact passes through a cache hit untouched, and an error from speak() surfaces as it is, without a retry. Without the option an audio output keeps the model's text, as before, and the first such output logs a deprecation warning once per process; `false` keeps the text without the warning. Rendering becomes the default in the next major version."
}

func skillResultPickerSurface(target string) string {
	switch target {
	case "python":
		return "`ax(..., sample_count=N, result_picker=callback)` or `set_sample_count` / `set_result_picker`"
	case "java":
		return "`setSampleCount` / `setResultPicker`"
	case "cpp":
		return "`set_sample_count` / `set_result_picker`"
	case "go":
		return "`SetSampleCount` / `SetResultPicker` with `AxResultPickerSample`"
	case "rust":
		return "`with_sample_count` / `with_result_picker` with `AxResultPickerSample`"
	default:
		return "the target's generated AxGen setters"
	}
}

func skillUsageObserverSnippet(target string) string {
	switch target {
	case "python":
		return readmeLines(
			"from axllm import set_usage_observer",
			"",
			"set_usage_observer(usage_queue.put_nowait)",
			"# Later: set_usage_observer(None)",
		)
	case "java":
		return readmeLines(
			"AxGlobals.setUsageObserver(usageQueue::add);",
			"// Later: AxGlobals.setUsageObserver(null);",
		)
	case "cpp":
		return readmeLines(
			"axllm::set_usage_observer(",
			"    [&usage_queue](axllm::AxUsageEvent event) {",
			"      usage_queue.push(std::move(event));",
			"    });",
			"// Later: axllm::set_usage_observer({});",
		)
	case "go":
		return readmeLines(
			"axllm.SetUsageObserver(func(event axllm.AxUsageEvent) {",
			"    usageQueue.Enqueue(event)",
			"})",
			"// Later: axllm.SetUsageObserver(nil)",
		)
	case "rust":
		return readmeLines(
			"set_usage_observer(Some(Arc::new(move |event| {",
			"    usage_queue.push(event);",
			"})));",
			"// Later: set_usage_observer(None);",
		)
	default:
		return "See the target package API for `set_usage_observer`."
	}
}

func skillUsageObserverExamplePath(target string) string {
	switch target {
	case "python":
		return "src/examples/python/generation/usage-observer.py"
	case "java":
		return "src/examples/java/generation/UsageObserverExample.java"
	case "cpp":
		return "src/examples/cpp/generation/usage_observer.cpp"
	case "go":
		return "src/examples/go/generation/usage_observer.go"
	case "rust":
		return "src/examples/rust/generation/usage_observer.rs"
	default:
		return "src/examples/typescript/generation/usage-observer.ts"
	}
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
	case specID == "typesafe":
		return skillTypesafeSnippet(target)
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
			pattern("Fan-out and join", "Independent reads place research and audience analysis in one planner group. Owned clients and programs run concurrently; unsupported custom workers use a traced serial fallback.", readmeLines("parallel_flow = (", "    flow({\"id\": \"docs.parallelFlow\"})", "    .execute(\"research\", research, {\"reads\": [\"topicText\"], \"writes\": [\"researchResult\", \"factList\"]})", "    .execute(\"audience\", audience, {\"reads\": [\"topicText\"], \"writes\": [\"audienceResult\", \"audienceAngle\"]})", "    .execute(\"join\", join, {\"reads\": [\"factList\", \"audienceAngle\"], \"writes\": [\"joinResult\", \"briefText\"]})", "    .returns({\"briefText\": \"briefText\"})", ")")),
			pattern("Undeclared steps", "A step added with a program and no `reads` or `writes` plans from the program's signature: it reads the input fields and writes `{name}Result` plus the output fields. An output field orders only the later steps that read it, so steps with independent inputs still share a group. A program without a signature (a nested flow, a custom program) runs alone, as a barrier.", readmeLines("outline_flow = (", "    flow({\"id\": \"docs.outlineFlow\"})", "    .execute(\"outline\", ax(\"topic:string -> outline:string\"))", "    .execute(\"polish\", ax(\"outline:string -> answer:string\"))  # after outline", "    .returns({\"answer\": \"answer\"})", ")")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("refine_flow = (", "    flow({\"id\": \"docs.refineFlow\"})", "    .execute(\"draft\", draft, {\"reads\": [\"topicText\"], \"writes\": [\"draftResult\", \"draftText\"]})", "    .execute(\"critique\", critique, {\"reads\": [\"draftText\"], \"writes\": [\"critiqueResult\", \"critiqueText\"]})", "    .execute(\"revise\", revise, {\"reads\": [\"draftText\", \"critiqueText\"], \"writes\": [\"reviseResult\", \"revisedText\"]})", "    .returns({\"revisedText\": \"revisedText\"})", ")")),
			pattern("Run a flow", "Forward accepts the provider client and the public flow inputs.", readmeLines("output = parallel_flow.forward(client, {\"topicText\": \"Typed LLM workflows\"})")),
			pattern("Cache a flow", "A `caching_function` (or `cachingFunction`) in the forward options, or `set_caching_function(fn)` for the process, caches the flow's output as TypeScript does: a hit runs no node and records no span or metric, and a run `control` skips it. The flow constructor takes none; the function also reaches the flow's AxGen nodes, which cache their own outputs.", readmeLines("output = parallel_flow.forward(", "    client,", "    {\"topicText\": \"Typed LLM workflows\"},", "    {\"caching_function\": cache},", ")")),
		}
	case "java":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("AxGen classifier = Ax.ax(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\");", "AxGen responder = Ax.ax(\"requestText:string, route:string -> responseText:string\");")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("AxFlow branchFlow = Ax.flow(Map.of(\"id\", \"docs.branchFlow\"))", "    .execute(\"classifier\", classifier, Map.of(\"reads\", List.of(\"requestText\"), \"writes\", List.of(\"classifierResult\", \"route\")))", "    .execute(\"responder\", responder, Map.of(\"reads\", List.of(\"requestText\", \"route\"), \"writes\", List.of(\"responderResult\", \"responseText\")))", "    .returns(Map.of(\"route\", \"route\", \"responseText\", \"responseText\"));")),
			pattern("Fan-out and join", "Independent reads place research and audience analysis in one planner group. Owned clients and programs run concurrently; unsupported custom workers use a traced serial fallback.", readmeLines("AxFlow parallelFlow = Ax.flow(Map.of(\"id\", \"docs.parallelFlow\"))", "    .execute(\"research\", research, Map.of(\"reads\", List.of(\"topicText\"), \"writes\", List.of(\"researchResult\", \"factList\")))", "    .execute(\"audience\", audience, Map.of(\"reads\", List.of(\"topicText\"), \"writes\", List.of(\"audienceResult\", \"audienceAngle\")))", "    .execute(\"join\", join, Map.of(\"reads\", List.of(\"factList\", \"audienceAngle\"), \"writes\", List.of(\"joinResult\", \"briefText\")))", "    .returns(Map.of(\"briefText\", \"briefText\"));")),
			pattern("Undeclared steps", "A step added with a program and no `reads` or `writes` plans from the program's signature: it reads the input fields and writes `{name}Result` plus the output fields. An output field orders only the later steps that read it, so steps with independent inputs still share a group. A program without a signature (a nested flow, a custom program) runs alone, as a barrier.", readmeLines("AxFlow outlineFlow = Ax.flow(Map.of(\"id\", \"docs.outlineFlow\"))", "    .execute(\"outline\", Ax.ax(\"topic:string -> outline:string\"))", "    .execute(\"polish\", Ax.ax(\"outline:string -> answer:string\")) // after outline", "    .returns(Map.of(\"answer\", \"answer\"));")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("AxFlow refineFlow = Ax.flow(Map.of(\"id\", \"docs.refineFlow\"))", "    .execute(\"draft\", draft, Map.of(\"reads\", List.of(\"topicText\"), \"writes\", List.of(\"draftResult\", \"draftText\")))", "    .execute(\"critique\", critique, Map.of(\"reads\", List.of(\"draftText\"), \"writes\", List.of(\"critiqueResult\", \"critiqueText\")))", "    .execute(\"revise\", revise, Map.of(\"reads\", List.of(\"draftText\", \"critiqueText\"), \"writes\", List.of(\"reviseResult\", \"revisedText\")))", "    .returns(Map.of(\"revisedText\", \"revisedText\"));")),
			pattern("Run a flow", "Forward accepts the provider client and the public flow inputs.", readmeLines("var output = parallelFlow.forward(client, Map.of(\"topicText\", \"Typed LLM workflows\"));")),
			pattern("Cache a flow", "An `AxCachingFunction` under `cachingFunction` in the `forward` or `streamingForward` options, or `AxGlobals.setCachingFunction(fn)` for the process, caches the flow's output as TypeScript does: a hit runs no node and records no span or metric, and a run `control` skips it. The `AxFlow` constructor takes none; the function also reaches the flow's AxGen nodes, which cache their own outputs.", readmeLines("var output = parallelFlow.forward(", "    client,", "    Map.of(\"topicText\", \"Typed LLM workflows\"),", "    Map.of(\"cachingFunction\", cache));")),
		}
	case "go":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("classifier := ax.NewAx(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\", nil)", "responder := ax.NewAx(\"requestText:string, route:string -> responseText:string\", nil)")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("branchFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.branchFlow\"}).", "  Execute(\"classifier\", classifier, map[string]ax.Value{\"reads\": ax.Array(\"requestText\"), \"writes\": ax.Array(\"classifierResult\", \"route\")}).", "  Execute(\"responder\", responder, map[string]ax.Value{\"reads\": ax.Array(\"requestText\", \"route\"), \"writes\": ax.Array(\"responderResult\", \"responseText\")}).", "  Returns(map[string]ax.Value{\"route\": \"route\", \"responseText\": \"responseText\"})")),
			pattern("Fan-out and join", "Independent reads place research and audience analysis in one planner group. Owned clients and programs run concurrently; unsupported custom workers use a traced serial fallback.", readmeLines("parallelFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.parallelFlow\"}).", "  Execute(\"research\", research, map[string]ax.Value{\"reads\": ax.Array(\"topicText\"), \"writes\": ax.Array(\"researchResult\", \"factList\")}).", "  Execute(\"audience\", audience, map[string]ax.Value{\"reads\": ax.Array(\"topicText\"), \"writes\": ax.Array(\"audienceResult\", \"audienceAngle\")}).", "  Execute(\"join\", join, map[string]ax.Value{\"reads\": ax.Array(\"factList\", \"audienceAngle\"), \"writes\": ax.Array(\"joinResult\", \"briefText\")}).", "  Returns(map[string]ax.Value{\"briefText\": \"briefText\"})")),
			pattern("Undeclared steps", "A step added with a program and no `reads` or `writes` plans from the program's signature: it reads the input fields and writes `{name}Result` plus the output fields. An output field orders only the later steps that read it, so steps with independent inputs still share a group. A program without a signature (a nested flow, a custom program) runs alone, as a barrier.", readmeLines("outlineFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.outlineFlow\"}).", "  Execute(\"outline\", ax.NewAx(\"topic:string -> outline:string\", nil), nil).", "  Execute(\"polish\", ax.NewAx(\"outline:string -> answer:string\", nil), nil). // after outline", "  Returns(map[string]ax.Value{\"answer\": \"answer\"})")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("refineFlow := ax.NewFlow(map[string]ax.Value{\"id\": \"docs.refineFlow\"}).", "  Execute(\"draft\", draft, map[string]ax.Value{\"reads\": ax.Array(\"topicText\"), \"writes\": ax.Array(\"draftResult\", \"draftText\")}).", "  Execute(\"critique\", critique, map[string]ax.Value{\"reads\": ax.Array(\"draftText\"), \"writes\": ax.Array(\"critiqueResult\", \"critiqueText\")}).", "  Execute(\"revise\", revise, map[string]ax.Value{\"reads\": ax.Array(\"draftText\", \"critiqueText\"), \"writes\": ax.Array(\"reviseResult\", \"revisedText\")}).", "  Returns(map[string]ax.Value{\"revisedText\": \"revisedText\"})")),
			pattern("Run a flow", "Forward accepts the context, provider client, public inputs, and options.", readmeLines("output, err := parallelFlow.Forward(", "  ctx, client,", "  map[string]ax.Value{\"topicText\": \"Typed LLM workflows\"},", "  nil,", ")")),
			pattern("Stream a flow", "`StreamingForward` runs the whole flow, as `Forward` does, and yields its output as one update (`Version` 1, `Index` 0), as TypeScript's `streamingForward` does; an error ends the sequence.", readmeLines("for delta, err := range parallelFlow.StreamingForward(", "  ctx, client,", "  map[string]ax.Value{\"topicText\": \"Typed LLM workflows\"},", "  nil,", ") {", "  if err != nil {", "    return err", "  }", "  fmt.Println(delta.Version, delta.Delta)", "}")),
			pattern("Cache a flow", "An `ax.AxCachingFunction` under `\"cachingFunction\"` (or `\"caching_function\"`) in the `Forward` or `StreamingForward` options, or `ax.SetCachingFunction(fn)` for the process, caches the flow's output as TypeScript does: a hit runs no node and records no span or metric, and a run `control` skips it. `ax.NewFlow` takes none; the function also reaches the flow's AxGen nodes, which cache their own outputs.", readmeLines("output, err := parallelFlow.Forward(", "  ctx, client,", "  map[string]ax.Value{\"topicText\": \"Typed LLM workflows\"},", "  map[string]ax.Value{\"cachingFunction\": cache},", ")")),
		}
	case "rust":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("let classifier = axllm::ax(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\")?;", "let responder = axllm::ax(\"requestText:string, route:string -> responseText:string\")?;")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("let mut branch_flow = axllm::flow(\"docs.branchFlow\")", "    .execute_with_options(\"classifier\", classifier, &json!({\"reads\": [\"requestText\"], \"writes\": [\"classifierResult\", \"route\"]}))", "    .execute_with_options(\"responder\", responder, &json!({\"reads\": [\"requestText\", \"route\"], \"writes\": [\"responderResult\", \"responseText\"]}))", "    .returns(json!({\"route\": \"route\", \"responseText\": \"responseText\"}));")),
			pattern("Fan-out and join", "Independent reads place research and audience analysis in one planner group. Owned clients and programs run concurrently; unsupported custom workers use a traced serial fallback.", readmeLines("let mut parallel_flow = axllm::flow(\"docs.parallelFlow\")", "    .execute_with_options(\"research\", research, &json!({\"reads\": [\"topicText\"], \"writes\": [\"researchResult\", \"factList\"]}))", "    .execute_with_options(\"audience\", audience, &json!({\"reads\": [\"topicText\"], \"writes\": [\"audienceResult\", \"audienceAngle\"]}))", "    .execute_with_options(\"join\", join, &json!({\"reads\": [\"factList\", \"audienceAngle\"], \"writes\": [\"joinResult\", \"briefText\"]}))", "    .returns(json!({\"briefText\": \"briefText\"}));")),
			pattern("Undeclared steps", "A step added with a program and no `reads` or `writes` plans from the program's signature: it reads the input fields and writes `{name}Result` plus the output fields. An output field orders only the later steps that read it, so steps with independent inputs still share a group. A program without a signature (a nested flow, or an `execute_program` program whose `signature_text` is `None`) runs alone, as a barrier.", readmeLines("let mut outline_flow = axllm::flow(\"docs.outlineFlow\")", "    .execute(\"outline\", axllm::ax(\"topic:string -> outline:string\")?)", "    .execute(\"polish\", axllm::ax(\"outline:string -> answer:string\")?) // after outline", "    .returns(json!({\"answer\": \"answer\"}));")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("let mut refine_flow = axllm::flow(\"docs.refineFlow\")", "    .execute_with_options(\"draft\", draft, &json!({\"reads\": [\"topicText\"], \"writes\": [\"draftResult\", \"draftText\"]}))", "    .execute_with_options(\"critique\", critique, &json!({\"reads\": [\"draftText\"], \"writes\": [\"critiqueResult\", \"critiqueText\"]}))", "    .execute_with_options(\"revise\", revise, &json!({\"reads\": [\"draftText\", \"critiqueText\"], \"writes\": [\"reviseResult\", \"revisedText\"]}))", "    .returns(json!({\"revisedText\": \"revisedText\"}));")),
			pattern("Run a flow", "Forward accepts the mutable provider client and public inputs.", readmeLines("let output = parallel_flow.forward(", "    &mut client,", "    json!({\"topicText\": \"Typed LLM workflows\"}),", ")?;")),
			pattern("Stream a flow", "`streaming_forward` runs the whole flow, as `forward_with_options` does, and returns its output as one update (`version` 1, `index` 0), as TypeScript's `streamingForward` does.", readmeLines("let updates = parallel_flow.streaming_forward(", "    &mut client,", "    json!({\"topicText\": \"Typed LLM workflows\"}),", "    json!({}),", ")?;", "let output = &updates[0].delta;")),
			pattern("Cache a flow", "For one call, `forward_with_caching_function(&mut client, input, options, f)` or `streaming_forward_with_caching_function(&mut client, input, options, f)` caches the flow's output as TypeScript does; `set_caching_function(Some(f))` covers the process. A hit runs no node and records no span or metric, and a run control skips it. A flow's constructor takes none; the flow's AxGen nodes use the same function and cache their own outputs.", readmeLines("let output = parallel_flow.forward_with_caching_function(", "    &mut client,", "    json!({\"topicText\": \"Typed LLM workflows\"}),", "    json!({}),", "    cache.clone(),", ")?;")),
		}
	case "cpp":
		return []skillPattern{
			pattern("Typed programs", "Build each flow node from its own input/output contract.", readmeLines("auto classifier = axllm::ax(\"requestText:string -> route:class \\\"support, sales, engineering\\\"\");", "auto responder = axllm::ax(\"requestText:string, route:string -> responseText:string\");")),
			pattern("Class decision", "Declare reads and writes so the responder waits for the typed route.", readmeLines("auto branch_flow = axllm::flow(axllm::object({{\"id\", \"docs.branchFlow\"}}))", "    .execute(\"classifier\", classifier, axllm::object({{\"reads\", axllm::array({\"requestText\"})}, {\"writes\", axllm::array({\"classifierResult\", \"route\"})}}))", "    .execute(\"responder\", responder, axllm::object({{\"reads\", axllm::array({\"requestText\", \"route\"})}, {\"writes\", axllm::array({\"responderResult\", \"responseText\"})}}))", "    .returns(axllm::object({{\"route\", \"route\"}, {\"responseText\", \"responseText\"}}));")),
			pattern("Fan-out and join", "Independent reads place research and audience analysis in one planner group. Owned clients and programs run concurrently; unsupported custom workers use a traced serial fallback.", readmeLines("auto parallel_flow = axllm::flow(axllm::object({{\"id\", \"docs.parallelFlow\"}}))", "    .execute(\"research\", research, axllm::object({{\"reads\", axllm::array({\"topicText\"})}, {\"writes\", axllm::array({\"researchResult\", \"factList\"})}}))", "    .execute(\"audience\", audience, axllm::object({{\"reads\", axllm::array({\"topicText\"})}, {\"writes\", axllm::array({\"audienceResult\", \"audienceAngle\"})}}))", "    .execute(\"join\", join, axllm::object({{\"reads\", axllm::array({\"factList\", \"audienceAngle\"})}, {\"writes\", axllm::array({\"joinResult\", \"briefText\"})}}))", "    .returns(axllm::object({{\"briefText\", \"briefText\"}}));")),
			pattern("Undeclared steps", "A step added with a program and no `reads` or `writes` plans from the program's signature: it reads the input fields and writes `{name}Result` plus the output fields. An output field orders only the later steps that read it, so steps with independent inputs still share a group. A program without a signature (a nested flow, a custom program) runs alone, as a barrier.", readmeLines("auto outline = axllm::ax(\"topic:string -> outline:string\");", "auto polish = axllm::ax(\"outline:string -> answer:string\");", "auto outline_flow = axllm::flow(axllm::object({{\"id\", \"docs.outlineFlow\"}}))", "    .execute(\"outline\", outline)", "    .execute(\"polish\", polish) // after outline", "    .returns(axllm::object({{\"answer\", \"answer\"}}));")),
			pattern("Draft, critique, revise", "A linear refinement pipeline makes each dependency explicit.", readmeLines("auto refine_flow = axllm::flow(axllm::object({{\"id\", \"docs.refineFlow\"}}))", "    .execute(\"draft\", draft, axllm::object({{\"reads\", axllm::array({\"topicText\"})}, {\"writes\", axllm::array({\"draftResult\", \"draftText\"})}}))", "    .execute(\"critique\", critique, axllm::object({{\"reads\", axllm::array({\"draftText\"})}, {\"writes\", axllm::array({\"critiqueResult\", \"critiqueText\"})}}))", "    .execute(\"revise\", revise, axllm::object({{\"reads\", axllm::array({\"draftText\", \"critiqueText\"})}, {\"writes\", axllm::array({\"reviseResult\", \"revisedText\"})}}))", "    .returns(axllm::object({{\"revisedText\", \"revisedText\"}}));")),
			pattern("Run a flow", "Forward accepts the provider client and public inputs.", readmeLines("auto output = parallel_flow.forward(", "    client,", "    axllm::object({{\"topicText\", \"Typed LLM workflows\"}}));")),
			pattern("Cache a flow", "Put an `axllm::caching_function(fn)` handle's `value()` under `\"caching_function\"` in the `forward` or `streaming_forward` options, keeping the handle alive for the call, or set one process-wide with `axllm::set_caching_function(fn)`. As in TypeScript, a hit runs no node and records no span or metric, and a run `control` skips it. An `AxFlow` takes none in its constructor; the flow's AxGen nodes use the same function and cache their own outputs.", readmeLines("auto cache = axllm::caching_function(fn);", "auto output = parallel_flow.forward(", "    client,", "    axllm::object({{\"topicText\", \"Typed LLM workflows\"}}),", "    axllm::object({{\"caching_function\", cache.value()}}));")),
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

func skillTypesafeGuide(target, specID string) string {
	if specID != "typesafe" && specID != "ai" && specID != "signature" {
		return ""
	}
	return readmeLines(
		"## Typesafe / Jev", "",
		"The typesafe provider supports required boolean and class outputs. Numeric bounds never define a Score rubric; numbers, freeform strings, optional outputs, arrays, nesting, media, tools, and sampling controls are rejected before transport.", "",
		"Set provider trueThreshold (or true_threshold) to a finite value in [0,1], default 0.5. Boolean conversion uses noul >= threshold; this policy is local and never sent. Choice returns the selected label without a confidence cutoff.", "",
		"Use boolean(true \"Core task blocked\", false \"Routine request\") and class label descriptions for criteria. Fluent describe_values / describeValues / DescribeValues keeps the same field value type. C++ uses valueDescriptions on its existing field descriptors. Other providers receive readable prompt and schema descriptions.", "",
		"The separate native client exposes system_one / systemOne / SystemOne and list_models / listModels / ListModels. Native probabilities remain unchanged. Score returns a fractional zero-based rubric position: convert scales explicitly in application code. Entries may be text, structured JSON objects/arrays, or null. Choice allows 1–255 labels; Score requires 2–10 rubric levels. The service context limit covers state, questions, and criteria; Ax never truncates or pretends to count native tokens exactly.", "",
		"Choice and Score probabilities must be finite values in [0,1], match the criteria keys, and sum to one within an inclusive 0.01 tolerance. Totals of 0.99 and 1.01 are accepted with an allowance for floating-point summation error. Ax preserves the returned probabilities without renormalizing them.", "",
		"The default model is jev-latest. Use API keys or renewable credential callbacks, the shared HTTP transport, retry settings, timeout, and cancellation. Native model discovery is separate from configured Ax model aliases. Typed native answers retain question names; only TypeScript can infer literal question keys and Choice-label unions at compile time. Other languages use their native typed maps/records/enums.", "",
		"Typesafe-only balancers propagate the output-schema requirement. Mixed pools retain ordinary prompts and select Typesafe only when the actual request already has a supported schema. Unsupported requests remain excluded during fallback and degradation. Typesafe has no token streaming; the provider returns one completed result through its stream interface.", "",
		"Runnable signature, native criteria/scoring, and two-program hybrid examples are under src/examples/"+target+"/generation/. See https://axllm.dev/"+target+"/examples/generation/.", "",
	) + "\n"
}
func skillTypesafeSnippet(target string) string {
	signature := `ticket:string -> urgent:boolean(true "Core task blocked", false "Routine request"), team:class "support, billing, engineering"`
	switch target {
	case "python":
		return "model = ai('typesafe', api_key=api_key, trueThreshold=0.9)\ntriage = ax('" + signature + "')\ndecision = triage.forward(model, {'ticket': ticket})"
	case "java":
		return "var model = Ax.ai(\"typesafe\", Map.of(\"apiKey\", apiKey, \"trueThreshold\", 0.9));\nvar triage = Ax.ax(" + fmt.Sprintf("%q", signature) + ");\nvar decision = triage.forward(model, Map.of(\"ticket\", ticket));"
	case "cpp":
		return "auto model = axllm::ai(\"typesafe\", axllm::object({{\"api_key\", api_key}, {\"trueThreshold\", 0.9}}));\nauto triage = axllm::ax(" + fmt.Sprintf("%q", signature) + ");\nauto decision = triage.forward(*model, axllm::object({{\"ticket\", ticket}}));"
	case "go":
		return "model := axllm.NewAI(\"typesafe\", map[string]axllm.Value{\"api_key\": apiKey, \"trueThreshold\": 0.9})\ntriage := axllm.NewAx(" + fmt.Sprintf("%q", signature) + ", nil)\ndecision, err := triage.Forward(ctx, model, map[string]axllm.Value{\"ticket\": ticket}, nil)"
	case "rust":
		return "let mut model = ai(\"typesafe\", json!({\"api_key\": api_key, \"trueThreshold\": 0.9}))?;\nlet decision = ax(" + fmt.Sprintf("%q", signature) + ")?.forward(&mut model, json!({\"ticket\": ticket}))?;"
	}
	return ""
}
