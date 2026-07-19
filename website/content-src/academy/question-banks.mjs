const q = ([prompt, correct, wrongA, wrongB, contextCode]) => ({
  type: 'choice',
  prompt,
  choices: [correct, wrongA, wrongB],
  answer: 0,
  explanation: correct,
  ...(contextCode ? { contextCode } : {}),
});

const bank = (...questions) => ({
  practice: questions.slice(0, 2).map(q),
  review: questions.slice(2).map(q),
});

export const academyQuestionBanks = {
  'programs-not-prompts': bank(
    [
      'A classifier currently returns prose that the app parses with regular expressions. What is the Ax-shaped repair?',
      'Declare the inputs and typed outputs in a signature and run that program.',
      'Add more prose instructions but keep the regular-expression parser.',
      'Move the parser into the provider configuration.',
    ],
    [
      'Which artifact gives a team a stable boundary for evaluating and optimizing an LLM feature?',
      'The Ax program signature and its examples.',
      'A saved transcript from one successful request.',
      'The longest prompt version tried so far.',
    ],
    [
      'A model upgrade changes wording but not the declared result fields. What should the application continue to depend on?',
      'The validated output contract.',
      'The exact sentence order in the raw response.',
      'The provider-specific response envelope.',
    ],
    [
      'Which code-review finding most clearly reveals prompt-string programming?',
      'Application logic scrapes free-form model text for fields.',
      'The feature has evaluation examples.',
      'The output signature contains a class field.',
    ]
  ),
  'examples-metrics-loop': bank(
    [
      'Two prompt variants both look reasonable. How should the team choose between them?',
      'Run both against representative examples with the same metric.',
      'Choose the variant with more tokens.',
      'Ask the author which one feels clearer.',
    ],
    [
      'What makes an example useful for iterative improvement?',
      'It includes behavior the metric can score against an expected result.',
      'It contains the provider API key used during creation.',
      'It is always longer than production inputs.',
    ],
    [
      'A change improves three cherry-picked requests but lowers the held-out score. What is the defensible conclusion?',
      'The measured program regressed on the evaluation set.',
      'The change improved because the demos looked better.',
      'The metric should be ignored after any manual success.',
    ],
    [
      'Which loop best supports repeatable Ax improvement?',
      'Run, observe, measure, optimize, then re-evaluate.',
      'Rewrite, deploy, and judge from anecdotes.',
      'Switch providers until one answer looks right.',
    ]
  ),
  'signature-semantic-contract': bank(
    [
      'A signature must be shared by a generator and a tool adapter. What should the team create?',
      'One reusable parsed signature value.',
      'Two unrelated prompt strings with similar wording.',
      'A provider model enum entry.',
    ],
    [
      'Why should the meaning of a signature field remain stable as a program grows?',
      'Downstream validation, tracing, examples, and optimization all depend on that meaning.',
      'Stable fields prevent streaming.',
      'Stable fields force one model provider.',
    ],
    [
      'A field named score means confidence in one module and cost in another. What is the core problem?',
      'The shared semantic contract has become ambiguous.',
      'The context window is necessarily too small.',
      'The transport must be changed to WebSocket.',
    ],
    [
      'Which change preserves signature composability?',
      'Use one explicit field name and meaning across every boundary.',
      'Let each consumer reinterpret the field silently.',
      'Remove output validation to allow both meanings.',
    ]
  ),
  'ai-providers-models': bank(
    [
      'An application may route between two current models. Where should credentials and model choice live?',
      'In the host environment and provider configuration.',
      'Inside every signature description.',
      'In the generated output parser.',
    ],
    [
      'A cheap model satisfies the required capabilities and evaluation target. Which default is sensible?',
      'Use the current smaller model and keep the contract stable.',
      'Use an older flagship because it was once the largest.',
      'Pin a dated preview even after a stable model exists.',
    ],
    [
      'What should routing change without forcing application rewrites?',
      'The provider or model used behind the same program contract.',
      'The meaning of every output field.',
      'The prerequisite graph for the course.',
    ],
    [
      'A model lacks required audio input support. What should happen before the call?',
      'Capability-aware selection should reject or route the request.',
      'The app should send audio and parse the likely error as output.',
      'The signature should pretend the audio is ordinary text.',
    ]
  ),
  'string-signatures': bank(
    [
      'Which signature shape declares text input and a boolean output?',
      'text:string -> accepted:boolean',
      'accepted:boolean -> text:string',
      'text:string, accepted:boolean',
    ],
    [
      'A classifier has three allowed labels. Where should that constraint be expressed?',
      'On the output field in the signature.',
      'Only in a comment after the model call.',
      'As a provider transport option.',
    ],
    [
      'Why is a concise string signature preferable to an unstructured prompt for a simple feature?',
      'It declares the parseable input and output contract directly.',
      'It guarantees the model knows every fact.',
      'It disables validation retries.',
    ],
    [
      'A developer puts the desired output fields before the arrow. What will readers infer?',
      'Those fields are inputs, so the contract is reversed.',
      'The arrow direction has no semantic meaning.',
      'The fields become optional automatically.',
    ]
  ),
  'fluent-fields-validation': bank(
    [
      'A result needs a score constrained from 0 to 1. Which design is strongest?',
      'Declare the numeric bounds in the field schema.',
      'Mention the range only in a log message.',
      'Clamp every result silently after evaluation.',
    ],
    [
      'When is a fluent field builder preferable to a short string signature?',
      'When nested shapes, optionality, or richer constraints must be explicit.',
      'Whenever the selected provider supports streaming.',
      'Only when no output validation is wanted.',
    ],
    [
      'A generated object omits a required nested field. Which layer should detect that?',
      'The declared schema validation at the program boundary.',
      'A later UI component by accident.',
      'The MCP transport handshake.',
    ],
    [
      'What does Standard Schema interoperability preserve?',
      'A shared validation contract across compatible schema tools.',
      'A single hard-coded provider.',
      'Free-form output without parsing.',
    ]
  ),
  'typed-contracts-everywhere': bank(
    [
      'A tool returns ticketId as a number while the flow treats it as a string. What should be fixed first?',
      'Align the field type and meaning across both boundaries.',
      'Increase the model temperature.',
      'Add another transport retry.',
      'tool: ticketId:number -> status:string\nflow: ticketId:string -> resolution:string',
    ],
    [
      'Why should a generator output flow cleanly into an agent input?',
      'Both surfaces should share the same typed vocabulary.',
      'Agents ignore declared field shapes.',
      'Flows serialize every value as provider prose.',
    ],
    [
      'Which integration is least likely to need glue parsing?',
      'Components that preserve the same named typed fields.',
      'Components that each invent their own response prose.',
      'Components that discard validation results.',
    ],
    [
      'An optimizer evaluates a field differently from production. What contract has failed?',
      'The field semantics are not consistent across evaluation and runtime.',
      'The remote transport lacks SSE.',
      'The model catalog contains too many entries.',
    ]
  ),
  'ax-forward': bank(
    [
      'After a structured program runs successfully, what should business logic consume?',
      'The validated fields declared by the output signature.',
      'The raw provider body and headers.',
      'A regular expression over the prompt transcript.',
    ],
    [
      'A program expects answer and confidence. Which result is a contract failure?',
      'A response that cannot produce a valid confidence field.',
      'A valid answer with confidence equal to zero.',
      'A streamed response that later validates successfully.',
    ],
    [
      'What stays responsible for provider access when running a typed program?',
      'The configured model client passed to the program.',
      'The output field descriptions.',
      'The course prerequisite graph.',
    ],
    [
      'Why is manually parsing provider text after a successful forward call a smell?',
      'It bypasses the structured result Ax already parsed and validated.',
      'It makes the model run twice automatically.',
      'It prevents any provider from authenticating.',
    ]
  ),
  'structured-validation-errors': bank(
    [
      'A retry says only “invalid output.” What improvement gives the model a repairable target?',
      'Name the failed field and violated constraint.',
      'Remove the schema from the next attempt.',
      'Include the API key in the error.',
    ],
    [
      'Why should an app distinguish cancellation from generation validation failure?',
      'They require different recovery and user feedback.',
      'Cancellation means the output schema is optional.',
      'Validation failures always require a provider change.',
    ],
    [
      'A provider times out before returning content. Which diagnosis is most accurate?',
      'It is a provider or request failure, not an output-field validation error.',
      'It proves the signature field names are wrong.',
      'It should be reported as a successful empty output.',
    ],
    [
      'What should a production error boundary preserve?',
      'The distinction between generation, provider, and cancellation failures.',
      'Only one generic unknown-error category.',
      'The complete secret-bearing request body in every message.',
    ]
  ),
  'streaming-assertions': bank(
    [
      'A UI renders a streamed answer. Which value should it read from each update?',
      'The typed delta fields exposed by the program.',
      'Arbitrary substrings from the provider wire format.',
      'The original signature source text.',
    ],
    [
      'When is a streaming assertion useful?',
      'When invalid or unsafe output should be stopped or repaired while arriving.',
      'When the host needs to store an API key in the prompt.',
      'When no streaming response is being consumed.',
    ],
    [
      'Does consuming partial typed deltas remove the final output contract?',
      'No; the completed result still follows the signature and validation rules.',
      'Yes; streaming makes every field optional and unvalidated.',
      'Yes; the provider wire format becomes the application API.',
    ],
    [
      'Which implementation is most portable across providers?',
      'Render signature-aware deltas and let Ax adapt provider events.',
      'Parse one provider’s raw event strings in the UI.',
      'Assume every provider emits identical JSON fragments.',
    ]
  ),
  'gen-memory-sampling-hooks': bank(
    [
      'A program requests five samples but has no scorer or picker. What is missing?',
      'A principled rule for selecting among candidates.',
      'A second output signature arrow.',
      'An MCP resource subscription.',
    ],
    [
      'When should conversation memory be attached to a generator?',
      'When prior turns are genuinely part of the next decision context.',
      'For every stateless classification by default.',
      'To replace the output schema.',
    ],
    [
      'What is the role of a context cache?',
      'Reuse stable context work without changing the program contract.',
      'Authorize host tools automatically.',
      'Choose a correct sample without a scoring rule.',
    ],
    [
      'A hook records each generation step. What should it be used for?',
      'Observability or controlled lifecycle behavior.',
      'Silently changing output field meanings.',
      'Embedding provider secrets in examples.',
    ]
  ),
  'typed-tools': bank(
    [
      'A search tool accepts a query and returns text. What belongs in its definition?',
      'A clear description, typed arguments, typed result, and handler.',
      'Only the handler function name.',
      'A copy of every possible model prompt.',
    ],
    [
      'What should a good tool description primarily explain?',
      'When the model should use the capability.',
      'How to bypass host authorization.',
      'Which provider response header is longest.',
    ],
    [
      'A tool receives malformed arguments. Which boundary should reject them?',
      'The declared argument schema before unsafe handler work.',
      'A later unrelated model call.',
      'The Academy progress store.',
    ],
    [
      'Why declare a typed tool result?',
      'The model and host can reason about a stable capability contract.',
      'It makes the handler run without authorization.',
      'It converts the tool into an MCP server automatically.',
    ]
  ),
  'flow-state-nodes': bank(
    [
      'A workflow must always research before drafting. Who should encode that order?',
      'The application-defined flow graph.',
      'An open-ended model instruction.',
      'The provider retry policy.',
    ],
    [
      'What should a flow node add to state?',
      'A useful typed result needed by later mappings or returns.',
      'An unrelated provider credential.',
      'A hidden reinterpretation of existing fields.',
    ],
    [
      'Which construct selects the final flow output?',
      'An explicit return mapping from flow state.',
      'The last raw provider packet.',
      'The MCP initialize response.',
    ],
    [
      'A model decides which fixed node runs next despite a required order. What was lost?',
      'Host-owned deterministic orchestration.',
      'Output streaming support.',
      'The ability to use typed fields.',
    ]
  ),
  'flow-composition': bank(
    [
      'A flow must compute wordLimit from an existing setting without an LLM. What should it use?',
      'A deterministic state mapping step.',
      'A new agent runtime loop.',
      'An MCP catalog refresh.',
    ],
    [
      'Why make sequential node dependencies explicit?',
      'Later steps receive inspectable state produced by known earlier steps.',
      'It forces every node to use a different provider.',
      'It removes the need for typed inputs.',
    ],
    [
      'A state transform only renames a field. Should it call a model?',
      'No; ordinary deterministic mapping is the right boundary.',
      'Yes; every flow step must call a model.',
      'Yes; otherwise state cannot change.',
    ],
    [
      'What is a warning sign in a composed flow?',
      'A step adds no useful field, decision, or observable effect.',
      'A mapping copies a required value explicitly.',
      'A node consumes a typed prior result.',
    ]
  ),
  'flow-control': bank(
    [
      'Compliance requires a fixed high-risk branch. Which layer should own it?',
      'The host flow condition and branch graph.',
      'A larger prompt asking the model to remember policy.',
      'The output parser after execution.',
    ],
    [
      'A list of independent documents needs the same summarizer. Which flow shape fits?',
      'Derive or parallel work over the document collection.',
      'A single hidden mutable global variable.',
      'A resource notification with no workflow.',
    ],
    [
      'When is a loop in a flow appropriate?',
      'When the host can state the repeat condition explicitly.',
      'Whenever a one-step typed call succeeds.',
      'To replace all cancellation bounds.',
    ],
    [
      'What is the main benefit of host-owned branching?',
      'Critical control flow remains deterministic and inspectable.',
      'The model gains permission to call every tool.',
      'Output schemas become unnecessary.',
    ]
  ),
  'flow-operations': bank(
    [
      'A completed workflow should be callable by an agent. What is the useful adaptation?',
      'Expose the flow as a typed function capability.',
      'Copy its trace into the agent prompt.',
      'Replace every node with a transport callback.',
    ],
    [
      'What should tracing reveal for a workflow?',
      'The ordered node, mapping, model, and tool activity.',
      'Only the final text with no execution context.',
      'The user’s localStorage contents.',
    ],
    [
      'A flow contains generators that need tuning. Which optimizer boundary should be used?',
      'The shared language optimization surface for the flow target.',
      'A made-up flow-only prompt editor.',
      'The MCP transport constructor.',
    ],
    [
      'A flow waits for external work. What must the host preserve?',
      'An owned continuation that can resume the correct workflow state.',
      'Only the model’s last sentence.',
      'A public session ID as authorization.',
    ]
  ),
  'flow-mermaid': bank(
    [
      'A flow diagram carries a line "%%ax summarize: doc:string -> summary:string". What is that directive?',
      'The node signature the compiler reads while mermaid renderers ignore it.',
      'A plain comment the compiler also skips, so the node has no contract.',
      'A provider setting that selects the model for that node.',
    ],
    [
      'You pass a mermaid string to flow(). How does data reach each node?',
      'Every input auto-wires to the nearest upstream node that outputs that field name.',
      'Each node receives the entire raw provider response.',
      'Nodes exchange data only when the diagram lists numeric slot ids.',
    ],
    [
      'In the flow dialect, what does a back-edge labeled "fail, max 3" express?',
      'A feedback loop that retries the target node up to three times.',
      'A parse error, because flow edges may not carry labels.',
      'A parallel branch that always fans out three copies.',
    ],
    [
      'What happens when you pass a mermaid flowchart string to flow()?',
      'The dialect is compiled into a runnable flow — the same flow String() can render back.',
      'The string is stored as a description and an empty flow is returned.',
      'flow() only accepts option objects, so any string argument throws.',
    ]
  ),
  'agent-core': bank(
    [
      'A task requires inspecting evidence, calling tools, and deciding when it is finished. Which surface fits?',
      'An agent with a typed task and runtime loop.',
      'A single output field added to a generator.',
      'A provider model enum alone.',
    ],
    [
      'When is a generator still preferable to an agent?',
      'When one structured model call can produce the required result.',
      'When the task needs repeated tool use and observation.',
      'When the model must recover across many runtime steps.',
    ],
    [
      'What tells an agent runtime it has completed successfully?',
      'A result that satisfies the declared final output contract.',
      'Any intermediate tool response.',
      'The first streamed token.',
    ],
    [
      'Which design unnecessarily escalates complexity?',
      'Using an agent loop for a deterministic one-call classification.',
      'Using an agent for iterative investigation.',
      'Giving an agent typed tools.',
    ]
  ),
  'agent-discovery': bank(
    [
      'An agent has hundreds of tools. How should their documentation enter context?',
      'Load compact namespaces first and discover full tool details when relevant.',
      'Paste every schema into every actor turn.',
      'Remove tool descriptions entirely.',
    ],
    [
      'Does discovering a tool authorize its execution?',
      'No; host policy still controls whether the tool may run.',
      'Yes; visibility and authorization are identical.',
      'Yes; discovery bypasses argument validation too.',
    ],
    [
      'What should a function group communicate?',
      'A coherent capability namespace that helps the actor orient.',
      'A shared secret for every handler.',
      'A guarantee that all tools are always relevant.',
    ],
    [
      'The prompt is dominated by unused tool schemas. Which capability should be enabled?',
      'Progressive function discovery.',
      'Longer raw provider logging.',
      'Unbounded sampling.',
    ]
  ),
  'child-agents': bank(
    [
      'A billing subtask needs its own tools and multi-step investigation. What should the coordinator delegate to?',
      'A child agent exposed as a typed specialist.',
      'A deterministic field rename.',
      'A single semantic helper with no tools.',
    ],
    [
      'A one-sentence ambiguity needs a focused semantic judgment. What is lighter than a child agent?',
      'A bounded model query inside the existing runtime.',
      'A second independent agent harness.',
      'A new MCP server.',
    ],
    [
      'What boundary should a child agent retain?',
      'Its own signature, runtime loop, tools, and typed result.',
      'The parent’s hidden mutable output fields.',
      'Automatic permission to every host capability.',
    ],
    [
      'When is child-agent delegation a poor fit?',
      'When ordinary code can compute the sub-result directly.',
      'When a specialist must inspect evidence over several turns.',
      'When the parent needs a typed delegated result.',
    ]
  ),
  'agent-clarification-resume': bank(
    [
      'A refund request omits the destination account. What should the agent do?',
      'Ask for the missing account because it changes the action.',
      'Guess the most recently used account.',
      'Send the refund to every account.',
    ],
    [
      'What must the host preserve while waiting for clarification?',
      'Owned state that can resume the correct task safely.',
      'Only a public transport session identifier.',
      'The provider API key in the user message.',
    ],
    [
      'A tool fails but the agent returns a deliberate final result. Why distinguish those paths?',
      'Completion, tool failure, and child failure have different semantics.',
      'Every path should be flattened into the same empty string.',
      'A final result always proves every tool succeeded.',
    ],
    [
      'When is clarification unnecessary?',
      'When the missing detail cannot materially change the safe result.',
      'When the action affects an unknown account.',
      'When two incompatible user intents remain possible.',
    ]
  ),
  'agent-context-observability': bank(
    [
      'Where should a large task document live if the actor only needs oriented access?',
      'In the appropriate context field or runtime reference, not repeated prose.',
      'Duplicated into every tool description.',
      'Encoded into the model name.',
    ],
    [
      'Which signal proves the order of actual tool calls?',
      'Function-call events and runtime traces.',
      'The final output signature by itself.',
      'The provider’s marketing page.',
    ],
    [
      'What does a status callback add beyond the final result?',
      'Observable lifecycle progress while the agent is working.',
      'Automatic authorization for risky tools.',
      'A replacement for output validation.',
    ],
    [
      'A team infers agent behavior only from the final answer. What evidence is missing?',
      'Actor turns, context events, calls, traces, and usage.',
      'Another copy of the same final answer.',
      'A larger daily XP goal.',
    ]
  ),
  'rlm-pipeline': bank(
    [
      'An actor emits a huge speculative script before seeing runtime results. What is the better RLM pattern?',
      'Execute one small observable step, inspect evidence, then continue.',
      'Hide all intermediate evidence until the final turn.',
      'Copy the entire dataset into the prompt first.',
    ],
    [
      'Why does the runtime-as-REPL shape help long investigations?',
      'Live state persists while each prompt receives only compact evidence.',
      'It guarantees no tool can fail.',
      'It makes context limits irrelevant by duplicating every turn.',
    ],
    [
      'What should a non-final actor turn produce?',
      'A bounded runtime action whose result can guide the next turn.',
      'An unverifiable final answer plus no action.',
      'A complete hidden program for every future branch.',
    ],
    [
      'Which behavior defeats the distiller-executor-responder pipeline?',
      'Reasoning over imagined results instead of returned runtime evidence.',
      'Using compact evidence from a completed step.',
      'Preserving live variables between turns.',
    ]
  ),
  'persistent-runtime-state': bank(
    [
      'A variable was computed successfully before old prompt turns were summarized. Is the value lost?',
      'No; runtime state remains live independently of prompt replay.',
      'Yes; checkpointing deletes all runtime values.',
      'Yes; every variable exists only as model prose.',
    ],
    [
      'What is the advantage of keeping large results in runtime variables?',
      'Later code can compute on full values without putting them back in context.',
      'It removes the need for ownership controls.',
      'It turns every value into a model parameter.',
    ],
    [
      'Context compression removes an old transcript containing a variable assignment. What should still be inspectable?',
      'The live runtime variable and its current value.',
      'Only the deleted prose turn.',
      'No state from before compression.',
    ],
    [
      'Which design incorrectly couples state to context?',
      'Reconstructing critical runtime values only from old chat text.',
      'Persisting values in the runtime session.',
      'Returning compact evidence to the actor.',
    ]
  ),
  'context-fields-auto-upgrade': bank(
    [
      'A task receives a 50 MB log as a declared context field. What should enter the actor prompt?',
      'Compact orientation metadata while the runtime retains full access.',
      'The full log on every turn.',
      'Only the file name with no runtime access.',
    ],
    [
      'Why can an agent compute exactly over referenced context?',
      'Runtime tools operate on the full value even when prompts stay bounded.',
      'The model memorizes all omitted bytes.',
      'The provider automatically uploads every local file.',
    ],
    [
      'When should auto-upgrade change the context strategy?',
      'When size or pressure makes the simpler representation unsafe or wasteful.',
      'On every request regardless of context size.',
      'Only after deleting the original value.',
    ],
    [
      'What must remain true after a context field is moved behind a reference?',
      'The actor can still obtain exact evidence through the runtime.',
      'The field becomes impossible to inspect.',
      'Its type meaning changes silently.',
    ]
  ),
  'context-policies': bank(
    [
      'Which starting policy balances recent evidence with pressure-aware compression?',
      'Checkpointed context with balanced behavior.',
      'Always replay every byte forever.',
      'Discard every prior result after one turn.',
    ],
    [
      'When might a lean policy be appropriate?',
      'When tight prompt bounds matter and runtime state carries the working set.',
      'When the task requires every raw turn repeated verbatim.',
      'When no runtime evidence exists.',
    ],
    [
      'What should an adaptive policy react to?',
      'Observed context pressure and the value of retained evidence.',
      'A random provider switch on every turn.',
      'The user’s Academy streak.',
    ],
    [
      'A full policy exceeds the model window during a long run. What is the correct response?',
      'Move to a policy that checkpoints or compresses while preserving live state.',
      'Silently truncate the output signature.',
      'Disable all runtime variables.',
    ]
  ),
  'rlm-semantic-helpers': bank(
    [
      'The runtime has ten candidate labels and needs one semantic grouping. What is an appropriate helper?',
      'A bounded model query over the compact candidates.',
      'A new child agent with an unrelated tool catalog.',
      'A provider transport reconnect.',
    ],
    [
      'What should a direct response path be used for?',
      'Returning a deliberate result without another unnecessary actor cycle.',
      'Bypassing the declared final contract.',
      'Hiding a runtime failure as success.',
    ],
    [
      'Why assign model policies to semantic helper work?',
      'Different bounded decisions can use appropriate cost and capability tiers.',
      'Policies make every helper unbounded.',
      'Policies replace runtime state ownership.',
    ],
    [
      'A semantic helper fails transiently. What should recovery preserve?',
      'The surrounding runtime state and an explicit retry or fallback boundary.',
      'Only the failed provider text.',
      'A fabricated helper result.',
    ]
  ),
  'peek-orientation': bank(
    [
      'What belongs in a context map for a large repository?',
      'Compact landmarks, relationships, and where to verify them.',
      'A cached final answer for every future task.',
      'A complete duplicate of every source file.',
    ],
    [
      'Why is a context map an orientation cache?',
      'It helps the agent find relevant live evidence without replacing that evidence.',
      'It grants write access to every file.',
      'It guarantees repository contents never change.',
    ],
    [
      'A map records that auth lives in one module. What should the agent do on a new auth task?',
      'Use the landmark to inspect the current module.',
      'Answer from the landmark without opening source.',
      'Delete the landmark before searching.',
    ],
    [
      'Which map entry is harmful?',
      'An unqualified task answer presented as permanent truth.',
      'A concise pointer to an ownership boundary.',
      'A relationship between two stable subsystems.',
    ]
  ),
  'context-map-lifecycle': bank(
    [
      'A run fails halfway through an uncertain exploration. Should its guesses update the durable map?',
      'No; only successful completed runs should contribute durable orientation.',
      'Yes; every intermediate thought should be permanent.',
      'Yes; failure is stronger evidence than verification.',
    ],
    [
      'When should a context-map update be persisted?',
      'After the configured updater produces validated orientation from a successful run.',
      'Before the task has inspected any evidence.',
      'Whenever a provider emits a partial token.',
    ],
    [
      'What should loading a persisted map restore?',
      'Reusable orientation, not an unfinished task continuation.',
      'Automatic authorization for prior tools.',
      'Every old prompt token as required context.',
    ],
    [
      'Why separate map lifecycle from task state?',
      'Orientation can outlive a run while task-specific actions remain owned by that run.',
      'The map should resume any user’s task.',
      'Task state never needs identity checks.',
    ]
  ),
  'repeated-corpus-exploration': bank(
    [
      'An agent revisits the same repository weekly. How should a context map help?',
      'Point quickly to likely seams, then verify current source.',
      'Freeze the first week’s findings as permanent answers.',
      'Skip all live inspection after one successful run.',
    ],
    [
      'What is the right response when source contradicts a stored landmark?',
      'Trust the live source and update orientation after successful work.',
      'Ignore the source because the map is durable.',
      'Merge both claims without resolving them.',
    ],
    [
      'Which benefit is realistic for repeated document work?',
      'Less time rediscovering stable structure and terminology.',
      'No need to retrieve current documents.',
      'Guaranteed correctness from stale summaries.',
    ],
    [
      'A map says a file owns routing, but the file was removed. What does this demonstrate?',
      'Orientation accelerates grounding but can become stale.',
      'Live repositories must preserve every old path.',
      'The model should recreate the removed file automatically.',
    ]
  ),
  'memory-recall': bank(
    [
      'An actor calls recall for a relevant customer preference. When is that memory available?',
      'It is scheduled into agent context for the next turn.',
      'It replaces the current expression result immediately.',
      'It is written into every tool schema.',
    ],
    [
      'What should memory search return?',
      'Relevant factual entries with enough metadata to use safely.',
      'Unbounded raw history regardless of relevance.',
      'Procedural instructions disguised as user facts.',
    ],
    [
      'Why is recall not a synchronous variable lookup for the current expression?',
      'It is a context-loading action coordinated with the actor-turn lifecycle.',
      'Memories are never visible to agents.',
      'Recall only works after final completion.',
    ],
    [
      'Which content belongs in memory rather than a skill?',
      'A relevant fact learned about a user or prior situation.',
      'A reusable step-by-step deployment procedure.',
      'The tool argument schema itself.',
    ]
  ),
  'skill-discovery': bank(
    [
      'An agent needs the approved release procedure. What should discovery load?',
      'A relevant procedural skill.',
      'An unrelated user memory.',
      'Every skill in full before the task starts.',
    ],
    [
      'What do relevance hints improve?',
      'Selecting useful skills without flooding the actor context.',
      'Automatic execution of every discovered instruction.',
      'Provider authentication.',
    ],
    [
      'How should a skill differ from a memory?',
      'A skill explains how to act; a memory supplies relevant facts.',
      'A skill stores only secrets; a memory stores only code.',
      'They are identical catalogs with different names.',
    ],
    [
      'A task has no relevant skill. What is safer than loading random procedures?',
      'Proceed with normal reasoning and explicit tools.',
      'Pick the largest skill by file size.',
      'Treat discovery failure as authorization.',
    ]
  ),
  'evals-metrics-judges': bank(
    [
      'A target has an exact expected category. Which evaluator should be preferred first?',
      'A deterministic comparison metric.',
      'An expensive open-ended judge for every case.',
      'Manual inspection of one convenient example.',
    ],
    [
      'When does a model judge add value?',
      'When quality requires a semantic rubric that deterministic code cannot express well.',
      'When an exact string equality already captures success.',
      'When no evaluation dataset exists.',
    ],
    [
      'Why replay the same dataset across program versions?',
      'It makes quality changes comparable under a stable evaluation target.',
      'It guarantees production inputs never differ.',
      'It removes the need to inspect metric failures.',
    ],
    [
      'A judge score changes because its rubric changed. What should the report note?',
      'The evaluation contract changed, so scores are not directly comparable.',
      'The program alone caused the entire difference.',
      'Rubrics never affect judge output.',
    ]
  ),
  'optimize-gen-flow': bank(
    [
      'A generator’s reusable prompt behavior underperforms on held-out examples. What should be tuned?',
      'The program through the shared optimization surface and evaluation data.',
      'Only the production output parser.',
      'The MCP session identifier.',
    ],
    [
      'A flow contains several optimizable model steps. What should the optimizer receive?',
      'The flow target plus representative examples and metrics.',
      'A screenshot of one final answer.',
      'Only a provider model name.',
    ],
    [
      'What makes an optimized artifact reusable?',
      'It records a measured program improvement that can be applied again.',
      'It depends on one hidden ad-hoc request.',
      'It discards its evaluation context.',
    ],
    [
      'Which change is not optimization evidence?',
      'A prompt edit that was never evaluated.',
      'A candidate that improves the defined metric.',
      'A saved artifact with evaluation statistics.',
    ]
  ),
  'agent-optimize': bank(
    [
      'An agent answers correctly but calls a forbidden tool first. What must evaluation include?',
      'Runtime behavior such as tool use, clarification, and final result.',
      'Only the final sentence text.',
      'Only the provider token count.',
    ],
    [
      'Why is one generation metric insufficient for agent tuning?',
      'Agent quality depends on a multi-step trajectory and actions.',
      'Agents never produce typed results.',
      'Agent tools cannot be observed.',
    ],
    [
      'A task lacks required data and the agent guesses. Which behavior should a judge penalize?',
      'Failure to clarify before a materially changed action.',
      'Use of a declared output field.',
      'Returning a trace identifier.',
    ],
    [
      'What should an agent optimization artifact improve?',
      'Repeatable runtime policy or components measured on agent tasks.',
      'Only the color of the dashboard.',
      'Transport authorization outside the agent.',
    ]
  ),
  'gepa-pareto-artifacts': bank(
    [
      'One candidate is more accurate but slower; another is cheaper but slightly worse. What should be preserved?',
      'Both non-dominated candidates on the Pareto frontier.',
      'Only the most expensive candidate.',
      'A random candidate without metrics.',
    ],
    [
      'What does an optimization budget control?',
      'How much search and evaluation work may be spent.',
      'Which user is authorized to call a tool.',
      'The output signature field order.',
    ],
    [
      'Why save Pareto artifacts instead of one universal winner?',
      'Deployment can choose among measured quality, cost, and latency tradeoffs.',
      'Every environment has identical priorities.',
      'Artifacts eliminate the need for evaluation.',
    ],
    [
      'A candidate is worse on every objective than another. Where does it belong?',
      'Outside the Pareto frontier as a dominated result.',
      'At the front because it was generated later.',
      'As the automatic production default.',
    ]
  ),
  'playbook-learning': bank(
    [
      'A successful incident run discovers a durable investigation tactic. Where can that guidance grow?',
      'In a verified playbook for future tasks.',
      'Only in the provider response cache.',
      'In the user’s transport session ID.',
    ],
    [
      'What should happen before promoting online playbook guidance?',
      'Verify that the proposed guidance improves or safely explains behavior.',
      'Persist every actor thought automatically.',
      'Remove the original task evidence.',
    ],
    [
      'How does a playbook differ from offline component optimization?',
      'It accumulates durable task guidance rather than only tuning program components.',
      'It replaces all evaluation metrics.',
      'It is a provider authentication scheme.',
    ],
    [
      'Which playbook entry is unsafe to retain?',
      'An unverified shortcut that bypasses required authorization.',
      'A tested diagnostic sequence with clear scope.',
      'A verified reminder to ask for a missing account.',
    ]
  ),
  'refine-selection': bank(
    [
      'A single high-value request can afford several critique rounds. Which strategy fits?',
      'Runtime refinement of the current result.',
      'A full offline optimizer with no reusable dataset.',
      'A transport reconnect loop.',
    ],
    [
      'What tradeoff does refinement make?',
      'More runtime cost for better quality on the current request.',
      'Less validation in exchange for more secrets.',
      'Permanent tool authorization for lower latency.',
    ],
    [
      'When is offline optimization preferable to refinement?',
      'When improvements should become reusable across many future requests.',
      'When only one current answer matters.',
      'When no metric or examples can be defined.',
    ],
    [
      'A selector cannot distinguish refined candidates. What is missing?',
      'A quality rule or scorer aligned with the request.',
      'A second MCP initialization.',
      'A larger localStorage schema version.',
    ]
  ),
  'mcp-lifecycle-transports': bank(
    [
      'A current remote MCP server is reached over HTTP. Which transport is the normal first choice?',
      'Streamable HTTP.',
      'Legacy SSE without checking current support.',
      'A local stdio pipe across the public internet.',
    ],
    [
      'When does the older SSE path remain useful?',
      'As a compatibility option for servers that still require it.',
      'As the only transport allowed by current MCP.',
      'To replace application authorization.',
    ],
    [
      'What must happen before normal MCP operations?',
      'The client and server complete protocol initialization and capability negotiation.',
      'The model invents tool names from memory.',
      'The app treats any HTTP endpoint as initialized.',
    ],
    [
      'A local MCP child process communicates over standard input and output. Which transport shape is appropriate?',
      'A stdio transport owned by the host process.',
      'A public browser redirect.',
      'A UCP webhook verifier.',
    ]
  ),
  'mcp-catalog': bank(
    [
      'A server renames a tool after deployment. How should the integration learn the current name?',
      'Refresh and inspect the live MCP catalog.',
      'Keep calling the remembered name forever.',
      'Infer the name from the provider model.',
    ],
    [
      'What can a native MCP catalog include besides tools?',
      'Resources, prompts, and other negotiated server capabilities.',
      'Only application user passwords.',
      'The client’s Academy XP history.',
    ],
    [
      'Why should tool selection be grounded in catalog data?',
      'The live server is the source of truth for available capabilities.',
      'Catalogs automatically authorize every operation.',
      'Catalogs make schemas unnecessary.',
    ],
    [
      'A cached catalog conflicts with a fresh server response. Which should drive new calls?',
      'The validated current catalog, with ownership changes handled safely.',
      'The oldest cached name regardless of server state.',
      'A tool name guessed by the UI.',
    ]
  ),
  'mcp-attach': bank(
    [
      'An agent needs remote server tools. What is the safe integration shape?',
      'Attach discovered MCP capabilities through the agent’s controlled function boundary.',
      'Let the model send arbitrary HTTP requests.',
      'Copy the server token into the output signature.',
    ],
    [
      'Why keep MCP progress separate from model-output streaming?',
      'Protocol lifecycle events and generated content are different channels.',
      'Progress events are always model tokens.',
      'Output deltas should initialize the MCP session.',
    ],
    [
      'A flow calls an MCP tool in a fixed phase. Who should own that ordering?',
      'The host flow graph.',
      'An unrelated resource notification.',
      'The remote server’s prompt catalog.',
    ],
    [
      'What should happen to an MCP tool result before it crosses a typed Ax boundary?',
      'Validate and adapt it to the declared capability or program shape.',
      'Treat any bytes as a successful final answer.',
      'Store it as an API key.',
    ]
  ),
  'mcp-auth-security': bank(
    [
      'A server returns an MCP session ID. Can the app use it as the user’s tenant identity?',
      'No; transport session state is not application authorization.',
      'Yes; every session ID proves tenant ownership.',
      'Yes; it also replaces OAuth scopes.',
    ],
    [
      'What should protect outbound MCP endpoint connections?',
      'Explicit endpoint policy, authentication, and SSRF-aware validation.',
      'Trusting any URL supplied by model output.',
      'Disabling TLS verification for compatibility.',
    ],
    [
      'An OAuth token grants read scope only. What should a write tool call do?',
      'Fail authorization without widening scope silently.',
      'Reuse the session ID as write permission.',
      'Ask the model to claim write scope.',
    ],
    [
      'Which identity belongs in application ownership checks?',
      'A verified application principal bound by host policy.',
      'An opaque transport connection identifier alone.',
      'The model’s chosen display name.',
    ]
  ),
  'mcp-tasks-advanced': bank(
    [
      'A long MCP task supports notifications. Why keep polling available?',
      'Notifications can be missed, so polling remains a reliable fallback.',
      'Polling is required to generate model tokens.',
      'Notifications can never carry task state.',
    ],
    [
      'What should cancellation target?',
      'The owned task or request identified by the protocol.',
      'Every task on the remote server.',
      'The application tenant with no task check.',
    ],
    [
      'Why record and replay MCP exchanges?',
      'To test protocol behavior deterministically without a live server.',
      'To reuse production access tokens forever.',
      'To skip schema validation.',
    ],
    [
      'An MCP App requests UI interaction. What remains the host’s responsibility?',
      'Enforce capability, visibility, and authorization boundaries.',
      'Grant every requested action automatically.',
      'Treat rendered content as tenant identity.',
    ]
  ),
  'notifications-vs-subscriptions': bank(
    [
      'A client subscribes to a changing resource. Does each update automatically execute an agent?',
      'No; delivery and model execution are separate boundaries.',
      'Yes; subscription implies unrestricted execution.',
      'Yes; the server owns the client agent loop.',
    ],
    [
      'What does a resource subscription establish?',
      'Intent to receive matching resource change notifications.',
      'Permission to resume any user task.',
      'A final generated answer.',
    ],
    [
      'Why separate notification intake from wake routes?',
      'The host can persist, authorize, and decide which events may invoke a model.',
      'Every event should bypass storage for speed.',
      'Notifications already contain trusted application actions.',
    ],
    [
      'A notification is delivered successfully but no route matches. What is acceptable?',
      'Record or observe it without running an agent.',
      'Run every configured agent.',
      'Treat delivery as authorization failure for the server.',
    ]
  ),
  'subscription-policies': bank(
    [
      'What is the safest default for MCP resource subscriptions?',
      'Require explicit subscription intent.',
      'Subscribe to every resource automatically.',
      'Let the model choose unbounded patterns.',
    ],
    [
      'A selector targets resources under one namespace. What should the policy limit?',
      'Which resource updates the client asks the server to deliver.',
      'The meaning of application tenant identity.',
      'The output schema of every agent.',
    ],
    [
      'Why is explicit intent important for subscriptions?',
      'It controls load, privacy exposure, and downstream event volume.',
      'It makes reconnect impossible.',
      'It removes the need for authentication.',
    ],
    [
      'A broad wildcard would expose unrelated resources. What should the host do?',
      'Reject or narrow it according to subscription policy.',
      'Accept it because notifications are always harmless.',
      'Convert it into a tool call.',
    ]
  ),
  'catalog-reconnect-ownership': bank(
    [
      'A catalog selector fails during reconnect. What state should survive?',
      'Known-good ownership and subscription state until a valid replacement exists.',
      'Nothing; delete all state immediately.',
      'A newly guessed selector result.',
    ],
    [
      'Why reconcile catalog changes after reconnect?',
      'Capabilities and resource selections may have changed while disconnected.',
      'Reconnect guarantees the catalog is byte-identical.',
      'The provider model needs a new signature.',
    ],
    [
      'What does failing closed mean for a bad new selection?',
      'Do not adopt the invalid selection or broaden access.',
      'Erase every previously safe ownership record.',
      'Select all resources as a fallback.',
    ],
    [
      'A resource disappears from the refreshed catalog. What should reconciliation avoid?',
      'Continuing to claim new delivery for a capability that no longer exists.',
      'Recording the catalog change.',
      'Preserving unrelated valid selections.',
    ]
  ),
  'event-runtime-core': bank(
    [
      'A protocol callback receives a burst of updates. Where should it put durable work?',
      'Into the event runtime ingress or inbox.',
      'Directly into an unbounded model loop.',
      'Only into browser localStorage.',
    ],
    [
      'What should trust normalization establish at ingress?',
      'A validated event envelope and identity context before routing.',
      'That every external payload is safe code.',
      'That transport session IDs are tenant principals.',
    ],
    [
      'Why separate stores from sinks?',
      'Persistence and external delivery have distinct reliability responsibilities.',
      'A sink should mutate every stored event.',
      'Stores only work when a model is running.',
    ],
    [
      'What protects protocol responsiveness during slow application work?',
      'Durable ingestion followed by asynchronous routed processing.',
      'Running the entire agent inside the notification callback.',
      'Dropping every event after acknowledgment.',
    ]
  ),
  'event-actions': bank(
    [
      'Which actions can remain model-free?',
      'Observe and invalidate actions that only record or expire state.',
      'Every wake and resume action.',
      'Any action that changes user data.',
    ],
    [
      'When may an event invoke a model?',
      'Only through an explicit authorized wake or resume route.',
      'Whenever any notification arrives.',
      'Whenever a selector returns no match.',
    ],
    [
      'A cache entry becomes stale after a resource update. Which action is sufficient?',
      'Invalidate the owned cache state without waking an agent.',
      'Resume an unrelated continuation.',
      'Grant the event broader scopes.',
    ],
    [
      'Why keep event actions explicit?',
      'Operators can reason about which routes observe, mutate, or spend model compute.',
      'Explicit actions eliminate all delivery failures.',
      'They make event identity unnecessary.',
    ]
  ),
  'task-continuation-security': bank(
    [
      'A terminal task notification arrives for tenant A. Which continuation may it resume?',
      'The continuation owned by tenant A and the matching task or run.',
      'Any continuation waiting on the same server.',
      'The newest continuation globally.',
    ],
    [
      'Why bind continuation identity to task metadata?',
      'It prevents cross-run and cross-tenant resume.',
      'It makes polling unnecessary.',
      'It turns the task ID into an OAuth token.',
    ],
    [
      'A duplicate terminal notification is replayed. What should safe handling provide?',
      'Idempotent recognition that avoids completing the continuation twice.',
      'A second unrestricted agent run.',
      'Deletion of the original ownership record before checking it.',
    ],
    [
      'A notification has the right task ID but wrong principal. What is the correct result?',
      'Reject the resume because ownership does not match.',
      'Resume because task IDs are globally authoritative.',
      'Ask the model whether the principal looks similar.',
    ]
  ),
  'production-observability': bank(
    [
      'What should every long-running operation accept?',
      'Cancellation plus explicit time or work bounds.',
      'An unbounded retry promise.',
      'A secret copied into every trace.',
    ],
    [
      'Which signals help explain a slow expensive request?',
      'Trace spans, latency, token usage, cost, cache, and tool activity.',
      'Only the final answer length.',
      'Only the selected language label.',
    ],
    [
      'A cache hit changes model behavior unexpectedly. What should observability record?',
      'Cache participation alongside the request trace and result.',
      'Nothing because cached work is invisible by definition.',
      'The raw API key that created the cache.',
    ],
    [
      'Why bound retries in production?',
      'Failures remain controllable in time, cost, and cancellation behavior.',
      'Bounds guarantee every request succeeds.',
      'Bounds remove the need for error types.',
    ]
  ),
  'media-audio-thinking': bank(
    [
      'An application sends an image and expects text plus audio. Where should those media roles be declared?',
      'In the explicit program input and output contract.',
      'Only in a provider-specific UI comment.',
      'Inside the progress storage key.',
      'audio:audio -> transcript:string, responseAudio:audio',
    ],
    [
      'Before routing an audio request, what should selection verify?',
      'The candidate model supports the required audio direction and format.',
      'The model name is the longest available.',
      'The output validator is disabled.',
    ],
    [
      'What should thinking configuration change?',
      'The model’s reasoning budget or mode without changing application field semantics.',
      'The tenant authorization boundary.',
      'Every media value into plain text.',
    ],
    [
      'Why keep embeddings separate from chat output fields?',
      'They are a distinct model capability with different inputs and result semantics.',
      'Embeddings automatically execute tools.',
      'Chat models cannot share a provider client.',
    ]
  ),
  'routing-fallback': bank(
    [
      'A primary provider is unavailable. What must fallback preserve?',
      'The application’s declared input and output contract.',
      'The primary provider’s raw response envelope.',
      'The exact same latency and price.',
    ],
    [
      'What should disqualify a fallback model?',
      'Missing a capability required by the request.',
      'Having a different provider name.',
      'Being a current smaller model.',
    ],
    [
      'Why validate results after a fallback call?',
      'Routing does not weaken the program’s output guarantees.',
      'Fallback responses are always untyped.',
      'Validation only applies to the primary provider.',
    ],
    [
      'A fallback changes a field from number to prose. What failed?',
      'The stable application contract was not enforced.',
      'The route used too little localStorage.',
      'The daily review interleaving rule.',
    ]
  ),
  'ucp-and-events': bank(
    [
      'A verified UCP webhook arrives. Can the same event runtime ingest it?',
      'Yes; normalize it into the protocol-neutral event envelope.',
      'No; the runtime accepts only MCP messages.',
      'Only after converting it into a model prompt string.',
    ],
    [
      'What belongs before routing a commerce webhook?',
      'Protocol-specific signature verification and identity normalization.',
      'An unrestricted wake action.',
      'A guessed tenant from the payload text.',
    ],
    [
      'Why is protocol-neutral routing valuable?',
      'Common ownership, storage, and action rules apply after trusted ingress.',
      'Every protocol has identical wire authentication.',
      'It removes the need for event types.',
    ],
    [
      'An event source is not MCP. Which runtime feature should still work?',
      'Observe, invalidate, wake, or resume through explicit routes.',
      'MCP catalog discovery against the non-MCP sender.',
      'Using a transport session as tenant identity.',
    ]
  ),
  'security-and-languages': bank(
    [
      'What should generated Python, Java, C++, Go, and Rust packages preserve?',
      'Shared Ax semantics through native language-shaped APIs.',
      'A bundled TypeScript process for every call.',
      'One universal hard-coded credential.',
    ],
    [
      'A generated backend lacks an authorization check present in the reference behavior. What is this?',
      'A conformance and security defect.',
      'An acceptable naming difference.',
      'A provider routing optimization.',
    ],
    [
      'What may vary safely across language packages?',
      'Idiomatic names and builders that preserve the same behavior.',
      'Tenant ownership rules.',
      'The meaning of signature fields.',
    ],
    [
      'Why run cross-language conformance fixtures?',
      'To prove generated surfaces implement the shared semantic contract.',
      'To force every language to use TypeScript syntax.',
      'To remove native error types.',
    ]
  ),
};
