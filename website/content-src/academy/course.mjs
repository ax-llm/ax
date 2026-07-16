const choice = (prompt, choices, answer, explanation) => ({
  type: 'choice',
  prompt,
  choices,
  answer,
  explanation,
});

const code = (prompt, answer, explanation, alternatives = []) => ({
  type: 'code',
  prompt,
  answer,
  alternatives,
  explanation,
});

const topic = ({
  id,
  title,
  prerequisites = [],
  minutes = 7,
  summary,
  example,
  check,
  apiSymbols = [],
}) => ({
  id,
  title,
  prerequisites,
  minutes,
  summary,
  example,
  apiSymbols,
  exercises: [
    { ...check, id: `${id}-diagnostic`, roles: ['diagnostic'] },
    { ...check, id: `${id}-practice`, roles: ['practice'] },
    { ...check, id: `${id}-review`, roles: ['review'] },
  ],
});

const units = [
  {
    id: 'dspy',
    number: 1,
    title: 'Build AI features you can measure',
    description:
      'Turn a one-off prompt into a program with clear inputs, outputs, examples, and a definition of success.',
    sourceRefs: [
      'website/content-src/templates/concept-dspy.md',
      'src/ax/skills/ax-signature.md',
    ],
    examplePaths: ['src/examples/typescript/generation/axgen-openai.ts'],
    topics: [
      topic({
        id: 'programs-not-prompts',
        title: 'Programs, not prompt strings',
        summary:
          'DSPy-style programming turns an LLM call into a program with declared inputs, outputs, examples, and measurable behavior. Ax keeps the prompt, but generates it from a contract instead of making the application parse prose.',
        example:
          'const classify = ax(\'review:string -> sentiment:class \\"positive, negative, neutral\\"\');',
        check: choice(
          'What makes an Ax program different from a handwritten prompt?',
          [
            'It declares a typed contract that can be run, validated, traced, and optimized.',
            'It hides the selected model from the application.',
            'It guarantees every model answer is factually correct.',
          ],
          0,
          'The signature is a reusable program contract; Ax can validate, trace, evaluate, and optimize it.'
        ),
        apiSymbols: ['ax'],
      }),
      topic({
        id: 'examples-metrics-loop',
        title: 'Examples, metrics, and the improvement loop',
        prerequisites: ['programs-not-prompts'],
        summary:
          'Examples show successful behavior; metrics determine whether a prediction is better. Together they turn prompt tweaking into an inspectable loop: run, observe, measure, optimize, and re-evaluate.',
        example:
          'const metric = ({ prediction, example }) => prediction.sentiment === example.sentiment ? 1 : 0;',
        check: choice(
          'Which component decides whether a new program version improved?',
          [
            'A metric evaluated on examples',
            'The prompt length',
            'The provider name',
          ],
          0,
          'Improvement is a measured change on evaluation examples, not a subjective prompt edit.'
        ),
      }),
      topic({
        id: 'signature-semantic-contract',
        title: 'The signature as Ax’s semantic contract',
        prerequisites: ['programs-not-prompts'],
        summary:
          'The same signature vocabulary connects generation, validation, tools, agents, flows, traces, examples, and optimizers. Learning signatures first makes every later Ax surface easier to reason about.',
        example:
          'const ticket = s(\'message:string -> category:class \\"billing, technical, other\\", urgency:number\');',
        check: code(
          'Which factory parses a reusable Ax signature? Enter only the factory name.',
          's',
          'Use s() when the signature itself must be inspected, shared, or composed.'
        ),
        apiSymbols: ['s'],
      }),
    ],
  },
  {
    id: 'models-signatures',
    number: 2,
    title: 'Make AI outputs predictable',
    description:
      'Choose a model and define validated data contracts so the rest of your application can trust the result.',
    sourceRefs: ['src/ax/skills/ax-ai.md', 'src/ax/skills/ax-signature.md'],
    examplePaths: ['src/examples/typescript/generation/structured.ts'],
    topics: [
      topic({
        id: 'ai-providers-models',
        title: 'Choose providers, models, and routing',
        prerequisites: ['programs-not-prompts'],
        summary:
          'The provider boundary owns configuration, current model selection, routing, streaming, media, embeddings, thinking, and usage. Keep credentials in the host environment and choose a current-generation model.',
        example:
          "const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY!, config: { model: 'gpt-5.4-mini' } });",
        check: code(
          'Which factory creates an Ax provider client? Enter only the factory name.',
          'ai',
          'ai() is the modern provider factory.'
        ),
        apiSymbols: ['ai'],
      }),
      topic({
        id: 'string-signatures',
        title: 'String and reusable signatures',
        prerequisites: ['signature-semantic-contract'],
        summary:
          'String signatures are the concise default for ordinary contracts. Inputs appear before ->, outputs after it, and field descriptions or class choices make the model boundary explicit.',
        example:
          "const extract = ax('email:string -> sender:string, topics:string[], needsReply:boolean');",
        check: choice(
          'In a string signature, where do output fields appear?',
          ['After ->', 'Before ->', 'Inside ai() configuration'],
          0,
          'The arrow separates inputs on the left from outputs on the right.'
        ),
        apiSymbols: ['ax', 's'],
      }),
      topic({
        id: 'fluent-fields-validation',
        title: 'Fluent fields, objects, and validation',
        prerequisites: ['string-signatures'],
        summary:
          'Use the fluent field builder when a contract needs richer constraints, nested objects, arrays, optionality, descriptions, or Standard Schema interoperability. Validation is part of the program rather than cleanup after the call.',
        example:
          "const signature = f().input('text', f.string().min(1)).output('score', f.number().min(0).max(1)).build();",
        check: code(
          'Which factory starts the native fluent field builder? Enter only the factory name.',
          'f',
          'f() constructs fluent fields and complete signatures.'
        ),
        apiSymbols: ['f'],
      }),
      topic({
        id: 'typed-contracts-everywhere',
        title: 'Typed contracts across Ax',
        prerequisites: ['ai-providers-models', 'fluent-fields-validation'],
        summary:
          'AxGen, AxFlow, AxAgent, tools, event targets, and optimizers share the same typed vocabulary. A field should keep the same meaning as it crosses those surfaces.',
        example:
          "const lookup = fn('lookup').arg('ticketId', f.string()).returns(f.json()).handler(loadTicket).build();",
        check: choice(
          'Why reuse the same field meanings across generators, tools, flows, and agents?',
          [
            'It preserves one semantic contract across composition boundaries.',
            'It disables runtime validation.',
            'It forces every program to use the same provider.',
          ],
          0,
          'Stable field semantics make composition and evaluation reliable.'
        ),
        apiSymbols: ['fn', 'f'],
      }),
    ],
  },
  {
    id: 'axgen',
    number: 3,
    title: 'Build a reliable AI-powered feature',
    description:
      'Generate structured results, stream updates, recover from bad responses, and call your own typed tools.',
    sourceRefs: ['src/ax/skills/ax-gen.md'],
    examplePaths: [
      'src/examples/typescript/generation/axgen-openai.ts',
      'src/examples/streaming-asserts.ts',
    ],
    topics: [
      topic({
        id: 'ax-forward',
        title: 'Run a typed AI program',
        prerequisites: ['typed-contracts-everywhere'],
        summary:
          'A structured generator declares the program, then runs it with a provider and typed inputs. The result is shaped by the output side of the signature.',
        example:
          "const answer = ax('question:string -> answer:string, confidence:number');\nconst result = await answer.forward(llm, { question: 'What is Ax?' });",
        check: choice(
          'What does running a structured Ax program return?',
          [
            'Data matching the output signature',
            'The raw HTTP response only',
            'An unparsed prompt string',
          ],
          0,
          'Ax parses and validates the model response into the declared output shape.'
        ),
        apiSymbols: ['ax'],
      }),
      topic({
        id: 'structured-validation-errors',
        title: 'Structured output, retries, and errors',
        prerequisites: ['ax-forward'],
        summary:
          'Ax validates generated fields and can retry with concrete correction feedback. Applications should distinguish generation failures, provider failures, and cancellation instead of catching everything as an unknown error.',
        example:
          'try { await program.forward(llm, input); } catch (error) { if (error instanceof AxGenerateError) report(error.details); }',
        check: choice(
          'What should validation feedback tell the model on retry?',
          [
            'The concrete field or constraint that failed',
            'Only that something went wrong',
            'The provider API key',
          ],
          0,
          'Specific validation feedback gives the retry a repairable target.'
        ),
        apiSymbols: ['AxGenerateError'],
      }),
      topic({
        id: 'streaming-assertions',
        title: 'Streaming and streaming assertions',
        prerequisites: ['ax-forward'],
        summary:
          'streamingForward() yields typed deltas while the final result remains governed by the signature. Streaming assertions can stop or repair output while it is still arriving.',
        example:
          'for await (const chunk of program.streamingForward(llm, input)) { if (chunk.delta.answer) render(chunk.delta.answer); }',
        check: choice(
          'What is the safe way to consume a streaming Ax result?',
          [
            'Read typed fields from each chunk delta',
            'Parse arbitrary provider text yourself',
            'Wait for a tool notification callback to call the model',
          ],
          0,
          'Ax exposes signature-aware deltas so the caller does not scrape provider text.'
        ),
        apiSymbols: ['ax'],
      }),
      topic({
        id: 'gen-memory-sampling-hooks',
        title: 'Memory, sampling, selection, and hooks',
        prerequisites: ['ax-forward'],
        summary:
          'AxGen can carry chat memory, sample multiple candidates, select a result, cache responses, and expose step hooks. Add these only when the program needs the corresponding state or quality control.',
        example:
          'const result = await program.forward(llm, input, { mem, sampleCount: 3, resultPicker });',
        check: choice(
          'When is sampleCount greater than one useful?',
          [
            'When a picker or scoring rule can choose among candidate outputs',
            'When the input signature is invalid',
            'When no provider client exists',
          ],
          0,
          'Multiple samples help only when the application has a principled selection rule.'
        ),
      }),
      topic({
        id: 'typed-tools',
        title: 'Create typed host tools',
        prerequisites: ['ax-forward', 'fluent-fields-validation'],
        summary:
          'A typed tool gives a host capability a name, purpose, typed arguments, a typed result, and a handler. Good descriptions explain when the model should call the tool; schemas define how.',
        example:
          "const search = fn('search').description('Search product docs').arg('query', f.string()).returns(f.string()).handler(searchDocs).build();",
        check: code(
          'Which factory creates a modern typed Ax tool? Enter only the factory name.',
          'fn',
          'fn() is the preferred native tool builder.'
        ),
        apiSymbols: ['fn', 'f'],
      }),
    ],
  },
  {
    id: 'axflow',
    number: 4,
    title: 'Connect AI steps into a workflow',
    description:
      'Compose repeatable steps with branches, loops, parallel work, and application-owned state.',
    sourceRefs: ['src/ax/skills/ax-flow.md'],
    examplePaths: [
      'src/examples/typescript/flows/branch-flow.ts',
      'src/examples/typescript/flows/composed-flow.ts',
    ],
    topics: [
      topic({
        id: 'flow-state-nodes',
        title: 'Flow state, nodes, mappings, and returns',
        prerequisites: ['ax-forward'],
        summary:
          'flow() defines application-owned state. Nodes run typed programs, execute mappings feed node inputs, and returns selects the final typed output.',
        example:
          "const wf = flow().node('draft', 'topic:string -> text:string').execute('draft', s => ({ topic: s.topic })).returns(s => ({ text: s.draftResult.text }));",
        check: choice(
          'Who owns execution order in an AxFlow?',
          [
            'The application-defined flow graph',
            'The model actor',
            'The MCP server',
          ],
          0,
          'Flows are deterministic application orchestration around model nodes.'
        ),
        apiSymbols: ['flow'],
      }),
      topic({
        id: 'flow-composition',
        title: 'Sequential composition and state transformation',
        prerequisites: ['flow-state-nodes'],
        summary:
          'Sequential nodes make dependencies explicit, while map transforms ordinary state without a model call. Every step should add a useful field or decision.',
        example:
          ".execute('research', s => ({ topic: s.topic })).map(s => ({ ...s, wordLimit: 300 })).execute('write', s => ({ research: s.researchResult, wordLimit: s.wordLimit }));",
        check: choice(
          'When should a flow use map()?',
          [
            'For a deterministic state transformation',
            'To ask a model an open-ended question',
            'To subscribe to every MCP resource',
          ],
          0,
          'map() changes state without creating another model program.'
        ),
        apiSymbols: ['flow'],
      }),
      topic({
        id: 'flow-control',
        title: 'Branches, loops, derive, and parallel work',
        prerequisites: ['flow-composition'],
        summary:
          'Conditional branches, while loops, derive over arrays, and explicit or automatic parallelism let the host own complex control flow without asking the model to improvise an orchestration plan.',
        example:
          ".branch(s => s.score > 0.8, highConfidenceFlow, reviewFlow).derive('items', s => s.documents, summarizeDocument);",
        check: choice(
          'Which Ax surface is the better fit when the application must own a fixed branch?',
          ['AxFlow', 'A larger prompt', 'A resource notification callback'],
          0,
          'Use a flow for explicit, host-owned ordering and branching.'
        ),
        apiSymbols: ['flow'],
      }),
      topic({
        id: 'flow-operations',
        title: 'Functions, tracing, events, and optimization',
        prerequisites: ['flow-control'],
        summary:
          'A flow can become a tool, emit traces, wait on an owned continuation, and expose optimizable components. Use the language optimizer surface to tune it; the flow itself does not own a separate optimizer method.',
        example:
          "const tool = wf.toFunction('researchWorkflow', 'Research and draft a response');",
        check: choice(
          'How should an AxFlow be tuned?',
          [
            'Pass it to the language optimizer surface',
            'Call a made-up flow-only optimizer',
            'Modify generated prompts by hand',
          ],
          0,
          'The shared optimizer surface handles generator and workflow targets.'
        ),
        apiSymbols: ['flow', 'optimize'],
      }),
    ],
  },
  {
    id: 'axagent',
    number: 5,
    title: 'Build an agent that can use tools',
    description:
      'Let AI discover capabilities, ask for missing information, delegate work, and return a dependable result.',
    sourceRefs: [
      'src/ax/skills/ax-agent.md',
      'src/ax/skills/ax-agent-context.md',
      'src/ax/skills/ax-agent-observability.md',
    ],
    examplePaths: [
      'src/examples/typescript/short-agents/agent-openai.ts',
      'src/examples/agent.ts',
    ],
    topics: [
      topic({
        id: 'agent-core',
        title: 'The agent runtime loop',
        prerequisites: ['ax-forward', 'typed-tools'],
        summary:
          'An agent wraps a typed task in a runtime loop. The model can inspect evidence, call host capabilities, delegate, and finish through the declared output contract.',
        example:
          "const helper = agent('request:string -> resolution:string', { functions: [search] });\nconst result = await helper.forward(llm, { request });",
        check: choice(
          'When should you move from AxGen to AxAgent?',
          [
            'When the model needs a runtime loop to inspect, act, and finish',
            'Whenever the output has two fields',
            'Whenever the provider supports streaming',
          ],
          0,
          'Agents are for iterative runtime behavior, not merely structured output.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'agent-discovery',
        title: 'Namespaces, function groups, and discovery',
        prerequisites: ['agent-core'],
        summary:
          'Large tool catalogs should be grouped by namespace and loaded progressively. Discovery lets the actor begin with a compact module index and fetch full tool docs only when needed.',
        example:
          "const assistant = agent('request:string -> answer:string', { functions: groups, functionDiscovery: true });",
        check: choice(
          'What problem does function discovery solve?',
          [
            'It keeps large tool documentation out of the prompt until relevant',
            'It automatically authorizes every tool',
            'It replaces tool handlers',
          ],
          0,
          'Discovery controls prompt size and orientation; host authorization still applies.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'child-agents',
        title: 'Child agents as specialist tools',
        prerequisites: ['agent-core'],
        summary:
          'A child AxAgent can be exposed as a function with its own signature, tools, runtime, and context. Use a child when the delegated task needs an independent agent loop, not for a small semantic sub-question.',
        example:
          "const coordinator = agent('task:string -> answer:string', { functions: [billingAgent, policyAgent] });",
        check: choice(
          'When is a child agent preferable to llmQuery()?',
          [
            'When the subtask needs its own tools and runtime loop',
            'When one sentence needs rephrasing',
            'When a flow map can compute the result',
          ],
          0,
          'Child agents are independent typed specialists; llmQuery() is a focused semantic helper.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'agent-clarification-resume',
        title: 'Clarification, resume, final, and error boundaries',
        prerequisites: ['agent-core'],
        summary:
          'Agents ask instead of guessing when missing information changes an action or output. The host persists clarification state, resumes safely, and distinguishes deliberate final output from tool or child-agent failures.',
        example:
          "await askClarification('Which account should receive the refund?', { fields: ['accountId'] });",
        check: choice(
          'When should an agent ask for clarification?',
          [
            'When a missing fact materially changes the action or result',
            'After every tool call',
            'Only after the provider returns a 500',
          ],
          0,
          'Clarification protects decisions that cannot be safely inferred.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'agent-context-observability',
        title: 'Context objects and observability',
        prerequisites: ['agent-discovery', 'agent-clarification-resume'],
        summary:
          'Task inputs, inline context, persistent orientation, memories, and skills have different lifecycles. Actor-turn, context-event, status, function-call, trace, and usage hooks reveal what the agent actually did.',
        example:
          "const assistant = agent(signature, { contextFields: ['documents'], actorTurnCallback, onFunctionCall, agentStatusCallback });",
        check: choice(
          'Which signal should you inspect to see the actual sequence of agent tool calls?',
          [
            'Function-call and trace observability',
            'The output signature alone',
            'The provider model enum',
          ],
          0,
          'Operational behavior must be observed from runtime events and traces.'
        ),
        apiSymbols: ['agent'],
      }),
    ],
  },
  {
    id: 'rlm',
    number: 6,
    title: 'Solve long and complex tasks',
    description:
      'Investigate large logs or datasets over many steps without stuffing everything into the prompt.',
    sourceRefs: [
      'src/ax/skills/ax-agent-rlm.md',
      'website/content-src/templates/agents-long-horizon.md',
    ],
    examplePaths: ['src/examples/rlm.ts', 'src/examples/rlm-long-task.ts'],
    topics: [
      topic({
        id: 'rlm-pipeline',
        title: 'Runtime-as-REPL and the RLM pipeline',
        prerequisites: ['agent-core'],
        summary:
          'AxAgent is a distiller → executor → responder pipeline. The actor writes one observable runtime step at a time, receives compact evidence, and continues from live state instead of generating a whole script at once.',
        example:
          "const matches = inputs.records.filter(r => r.status === 'failed');\nconsole.log(matches.length);",
        check: choice(
          'What is the correct shape of a non-final RLM actor turn?',
          [
            'One observable runtime step',
            'A complete multi-step application',
            'A hidden chain-of-thought transcript',
          ],
          0,
          'Small observable steps let the runtime preserve state and the next turn react to real evidence.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'persistent-runtime-state',
        title: 'Persistent runtime values and live state',
        prerequisites: ['rlm-pipeline'],
        summary:
          'Successful variables and functions remain available across actor turns. Prompt replay may be summarized, but runtime values survive unless the runtime restarts or the actor overwrites them.',
        example:
          'Turn 1: const customers = await crm.list(); console.log(customers.length);\nTurn 2: const active = customers.filter(c => c.active); console.log(active.length);',
        check: choice(
          'What happens to a successful runtime variable when old prompt turns are checkpointed?',
          [
            'It remains live in the runtime session',
            'It is always deleted',
            'It becomes an MCP resource',
          ],
          0,
          'Context compression changes prompt replay, not live runtime persistence.'
        ),
      }),
      topic({
        id: 'context-fields-auto-upgrade',
        title: 'contextFields, auto-upgrade, and evidence by reference',
        prerequisites: ['persistent-runtime-state'],
        summary:
          'Bulky context belongs in the runtime rather than the prompt. Declared contextFields and default-on auto-upgrade keep full values available as inputs while exposing only a preview and shape metadata to the model.',
        example:
          "const analyst = agent('log:string, question:string -> findings:string', { contextFields: ['log'] });",
        check: choice(
          'Where does a declared large context field live?',
          [
            'In the runtime session, available by reference',
            'Repeated in every actor prompt in full',
            'Inside the provider API key',
          ],
          0,
          'The actor computes on the full value while prompts carry compact orientation metadata.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'context-policies',
        title: 'Full, checkpointed, adaptive, and lean policies',
        prerequisites: ['persistent-runtime-state'],
        summary:
          'Context policy controls how prior actions are replayed, not whether runtime values exist. Checkpointed + balanced is the general default; adaptive summarizes earlier; lean is most aggressive; full is useful for debugging.',
        example:
          "contextPolicy: { preset: 'checkpointed', budget: 'balanced' }",
        check: choice(
          'Which context policy is the normal starting point for real agent work?',
          [
            'checkpointed with a balanced budget',
            'lean with no runtime state',
            'full with every MCP subscription',
          ],
          0,
          'Checkpointed + balanced preserves recent evidence and compresses only when pressure grows.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'rlm-semantic-helpers',
        title: 'llmQuery(), model policies, direct response, and recovery',
        prerequisites: ['context-fields-auto-upgrade', 'context-policies'],
        summary:
          'llmQuery() answers focused semantic questions over narrowed context; child agents own tool-using subtasks. Executor model policy can upgrade exploration, direct response can skip unnecessary execution, and failed code is repaired on the next observable turn.',
        example:
          "const labels = await llmQuery(['Classify these narrowed excerpts'], { context: excerpts });\nconsole.log(labels);",
        check: choice(
          'What is llmQuery() for?',
          [
            'A focused semantic question over narrowed context',
            'Spawning a full tool-using child agent',
            'Persisting an MCP subscription',
          ],
          0,
          'llmQuery() is a bounded semantic helper inside the RLM session.'
        ),
        apiSymbols: ['agent'],
      }),
    ],
  },
  {
    id: 'peek-context',
    number: 7,
    title: 'Give agents memory and orientation',
    description:
      'Help an agent navigate the same codebase or document set repeatedly and recall only what it needs.',
    sourceRefs: ['src/ax/skills/ax-agent-memory-skills.md'],
    examplePaths: [
      'src/examples/typescript/long-agents/codebase-peek-map.ts',
      'src/examples/rlm-memories-and-skills.ts',
    ],
    topics: [
      topic({
        id: 'peek-orientation',
        title: 'PEEK and the orientation problem',
        prerequisites: ['context-fields-auto-upgrade', 'context-policies'],
        summary:
          'PEEK asks how an agent can begin oriented over a large recurring corpus instead of rediscovering structure every run. Ax answers with a compact persistent context map injected into the distiller.',
        example:
          'const map = new AxAgentContextMap(savedSnapshot, { maxChars: 4000 });',
        check: choice(
          'What should a PEEK-style context map store?',
          [
            'Reusable orientation about a recurring corpus',
            'The final answer to one task',
            'Every raw document in full',
          ],
          0,
          'A map is compact orientation knowledge, not a task answer cache or document store.'
        ),
        apiSymbols: ['AxAgentContextMap'],
      }),
      topic({
        id: 'context-map-lifecycle',
        title: 'Context map lifecycle and persistence',
        prerequisites: ['peek-orientation'],
        summary:
          'A context map updates after successful runs, can evolve indefinitely or for a finite warmup, and can be snapshotted through onUpdate. Failed, aborted, or clarification runs do not update it.',
        example:
          'contextMap: { map, onUpdate: ({ map }) => save(map.snapshot()) }',
        check: choice(
          'When does Ax update a configured context map?',
          [
            'After a successful completed forward()',
            'After every failed tool call',
            'Before the first provider client is created',
          ],
          0,
          'Only successful completed runs contribute durable orientation.'
        ),
        apiSymbols: ['AxAgentContextMap', 'agent'],
      }),
      topic({
        id: 'repeated-corpus-exploration',
        title: 'Repeated repository and document exploration',
        prerequisites: ['context-map-lifecycle'],
        summary:
          'The same map can orient many questions over one repository, document set, or system. The agent still inspects current evidence; the map tells it where and how to look.',
        example:
          "await analyst.forward(llm, { repositorySnapshot, question: 'Where is retry policy enforced?' });",
        check: choice(
          'Does a context map replace checking current source?',
          [
            'No; it guides current evidence gathering',
            'Yes; the map is always authoritative',
            'Only when a tool catalog is small',
          ],
          0,
          'Orientation accelerates grounding but never replaces it.'
        ),
        apiSymbols: ['agent', 'AxAgentContextMap'],
      }),
      topic({
        id: 'memory-recall',
        title: 'Memory catalogs and recall()',
        prerequisites: ['agent-core'],
        summary:
          'Memories are task-relevant facts loaded from a static catalog or external search. recall() requests more entries; loaded content becomes available on the next actor turn and usage callbacks record what mattered.',
        example:
          "const assistant = agent(signature, { memoriesCatalog });\n// actor: await recall(['deployment window']);",
        check: choice(
          'What does recall() return directly to the current actor expression?',
          [
            'Nothing; loaded memories appear on the next turn',
            'The final user response',
            'A new child agent',
          ],
          0,
          'Recall schedules memory loading into the agent context for the next turn.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'skill-discovery',
        title: 'Skill discovery and relevance hints',
        prerequisites: ['agent-discovery'],
        summary:
          'Skills are procedural guides loaded with discover({ skills }). Static catalogs provide deterministic local search; callbacks connect external retrieval. Relevance hints guide selection but never replace authorization or evidence.',
        example:
          "const assistant = agent(signature, { skillsCatalog });\n// actor: await discover({ skills: ['incident-triage'] });",
        check: choice(
          'How are skills different from memories?',
          [
            'Skills are procedural guides; memories are reusable facts',
            'Skills are provider credentials',
            'Memories can execute host functions',
          ],
          0,
          'Use skills for how-to procedures and memories for relevant facts.'
        ),
        apiSymbols: ['agent'],
      }),
    ],
  },
  {
    id: 'optimization',
    number: 8,
    title: 'Measure and improve AI quality',
    description:
      'Evaluate real tasks, optimize prompts and tool use, and retain lessons from verified failures.',
    sourceRefs: [
      'src/ax/skills/ax-agent-optimize.md',
      'src/ax/skills/ax-gepa.md',
      'src/ax/skills/ax-playbook.md',
      'src/ax/skills/ax-refine.md',
    ],
    examplePaths: [
      'src/examples/axagent-gepa-optimization.ts',
      'src/examples/refine.ts',
    ],
    topics: [
      topic({
        id: 'evals-metrics-judges',
        title: 'Evaluation datasets, metrics, judges, and replay',
        prerequisites: ['examples-metrics-loop', 'agent-context-observability'],
        summary:
          'A useful evaluation records inputs, criteria, expected or forbidden actions, predictions, and traces. Prefer deterministic metrics when possible; use judges when quality requires holistic review.',
        example:
          "const tasks = [{ input: { request: 'Refund order 42' }, criteria: 'Verify eligibility before refunding', expectedActions: ['orders.lookup'] }];",
        check: choice(
          'When should you prefer a deterministic metric?',
          [
            'When the expected answer or action can be checked directly',
            'Whenever the output is prose',
            'Only for MCP notifications',
          ],
          0,
          'Deterministic metrics are cheaper and more reproducible when the target is explicit.'
        ),
      }),
      topic({
        id: 'optimize-gen-flow',
        title: 'Optimize generators and workflows',
        prerequisites: [
          'evals-metrics-judges',
          'structured-validation-errors',
          'flow-operations',
        ],
        summary:
          'The language optimizer surface tunes ordinary generators and flows from examples and a metric. Bound metric calls, keep validation examples separate, and apply the returned artifact through the program API.',
        example:
          'const result = await optimize(program, train, metric, { studentAI, teacherAI, maxMetricCalls: 40 });',
        check: code(
          'Which top-level factory tunes AxGen and AxFlow? Enter only its name.',
          'optimize',
          'Use optimize() for normal generator and flow tuning.'
        ),
        apiSymbols: ['optimize'],
      }),
      topic({
        id: 'agent-optimize',
        title: 'Optimize agent behavior',
        prerequisites: ['evals-metrics-judges', 'agent-core'],
        summary:
          'Agent optimization evaluates the whole agent pipeline and can tune actor or responder components. Task records should exercise tool selection, clarification, delegation, and final quality.',
        example:
          "const result = await assistant.optimize(tasks, { target: 'actor', maxMetricCalls: 40 });",
        check: choice(
          'Which path should tune tool use and clarification behavior?',
          [
            'The agent optimization API',
            'A manual edit to the final answer',
            'MCP catalog refresh',
          ],
          0,
          'Agent-specific optimization evaluates runtime behavior, not just one generation call.'
        ),
        apiSymbols: ['agent'],
      }),
      topic({
        id: 'gepa-pareto-artifacts',
        title: 'GEPA, Pareto tradeoffs, budgets, and artifacts',
        prerequisites: ['optimize-gen-flow', 'agent-optimize'],
        summary:
          'GEPA reflects on failures and mutates optimizable components. Multi-objective runs can return a Pareto frontier, making tradeoffs such as quality, cost, latency, or brevity visible instead of pretending one candidate wins everything.',
        example:
          "const result = await optimize(program, train, metric, { maxMetricCalls: 80, objectives: ['accuracy', 'brevity'] });",
        check: choice(
          'What does a Pareto frontier preserve?',
          [
            'Candidates representing different non-dominated tradeoffs',
            'Only the longest prompt',
            'Every failed provider request',
          ],
          0,
          'Pareto results expose meaningful tradeoffs between objectives.'
        ),
        apiSymbols: ['optimize', 'AxGEPA'],
      }),
      topic({
        id: 'playbook-learning',
        title: 'Online and verified playbook learning',
        prerequisites: ['agent-optimize', 'peek-orientation'],
        summary:
          'Playbooks accumulate reusable situational guidance. update() trusts one live feedback item; evolve() mines a task set and keeps only grounded bullets that improve held-in performance without unacceptable held-out regression.',
        example:
          "await assistant.playbook().update({ example, prediction, feedback: 'Verify policy before acting.' });",
        check: choice(
          'How is a playbook different from optimize()?',
          [
            'It accumulates reusable situational lessons in runtime context',
            'It replaces the output signature',
            'It subscribes to MCP resources',
          ],
          0,
          'Optimization tunes components; playbooks grow durable task guidance.'
        ),
        apiSymbols: ['playbook', 'agent'],
      }),
      topic({
        id: 'refine-selection',
        title: 'Refine and quality-versus-cost selection',
        prerequisites: ['evals-metrics-judges'],
        summary:
          'refine() is useful when the program should generate, critique, and select or improve candidates at run time. It is distinct from offline GEPA optimization and from long-lived playbook learning.',
        example:
          'const improved = await refine(program, llm, input, { metric, rounds: 2 });',
        check: choice(
          'When is refine() a better fit than a full offline optimization run?',
          [
            'When one runtime request should generate and improve candidates',
            'When you need durable MCP subscription ownership',
            'When no metric or selection rule exists',
          ],
          0,
          'Refinement spends runtime compute on the current request; optimization changes reusable program artifacts.'
        ),
        apiSymbols: ['refine'],
      }),
    ],
  },
  {
    id: 'mcp',
    number: 9,
    title: 'Connect to external tools and data',
    description:
      'Use MCP to discover and safely connect servers, tools, resources, and long-running tasks.',
    sourceRefs: ['src/ax/skills/ax-mcp.md'],
    examplePaths: [
      'src/examples/typescript/mcp/native-mcp-tools.ts',
      'src/examples/mcp-task-resume-flow.ts',
    ],
    topics: [
      topic({
        id: 'mcp-lifecycle-transports',
        title: 'MCP lifecycle and transports',
        prerequisites: ['typed-tools'],
        summary:
          'AxMCPClient initializes one negotiated session over stdio, Streamable HTTP, legacy HTTP/SSE, resumable SSE, or a custom WebSocket transport. Choose the transport that matches deployment and lifecycle needs.',
        example:
          "const client = new AxMCPClient(new AxMCPStreamableHTTPTransport({ url }), { namespace: 'orders' });",
        check: choice(
          'Which transport is the normal remote HTTP choice for current MCP servers?',
          [
            'Streamable HTTP',
            'An implicit global WebSocket',
            'A prompt string',
          ],
          0,
          'Streamable HTTP is the current remote transport; SSE remains a compatibility path.'
        ),
        apiSymbols: ['AxMCPClient', 'AxMCPStreamableHTTPTransport'],
      }),
      topic({
        id: 'mcp-catalog',
        title: 'Catalogs and native capabilities',
        prerequisites: ['mcp-lifecycle-transports'],
        summary:
          'The endpoint owns tool names, prompt names, resources, URI templates, and capabilities. inspectCatalog() discovers those values; applications should not invent identifiers the server can list.',
        example:
          'const catalog = await client.inspectCatalog({ refresh: true });\nconsole.log(catalog.tools, catalog.resources, catalog.capabilities);',
        check: choice(
          'Where should an application learn an MCP server’s tool names?',
          [
            'From the negotiated catalog',
            'From a guessed naming convention',
            'From the Ax output signature',
          ],
          0,
          'Catalog discovery keeps the integration aligned with the live server.'
        ),
        apiSymbols: ['AxMCPClient'],
      }),
      topic({
        id: 'mcp-attach',
        title: 'MCP with AxGen, AxAgent, and AxFlow',
        prerequisites: ['mcp-catalog', 'agent-core', 'flow-state-nodes'],
        summary:
          'Native MCP context can be attached to generators, agents, and flows without flattening every capability into handwritten functions. Tools remain native and task/progress events remain separate from generated output.',
        example:
          "const assistant = agent('request:string -> answer:string', { mcp: client, functionDiscovery: true });",
        check: choice(
          'Why keep MCP progress events separate from Ax output streaming?',
          [
            'They represent protocol task state, not generated output fields',
            'They contain the provider API key',
            'They always wake a model',
          ],
          0,
          'Protocol lifecycle and model output are different channels.'
        ),
        apiSymbols: ['AxMCPClient', 'agent'],
      }),
      topic({
        id: 'mcp-auth-security',
        title: 'OAuth, identity, and endpoint safety',
        prerequisites: ['mcp-lifecycle-transports'],
        summary:
          'MCP can use OAuth, client credentials, and enterprise-managed authorization, but an MCP session ID is not application tenant identity. Remote URL validation and SSRF protections should remain enabled.',
        example:
          "const client = new AxMCPClient(transport, { namespace: 'crm', auth });",
        check: choice(
          'Can an MCP session ID be used as application tenant identity?',
          [
            'No; identity must come from verified application authentication',
            'Yes; session IDs are always user accounts',
            'Only for resource templates',
          ],
          0,
          'Transport session identity and application authorization are separate boundaries.'
        ),
        apiSymbols: ['AxMCPClient'],
      }),
      topic({
        id: 'mcp-tasks-advanced',
        title: 'Tasks, progress, cancellation, Apps, and replay',
        prerequisites: ['mcp-attach', 'mcp-auth-security'],
        summary:
          'MCP tasks can report progress, require input, complete later, or be cancelled. Ax also supports server sampling, elicitation, roots, completions, MCP Apps, recording, and deterministic replay for evaluation.',
        example:
          'const task = await client.callTool({ name, arguments: input, task: { ttl: 60_000 } });',
        check: choice(
          'Why must task polling remain available even when notifications are supported?',
          [
            'Task notifications are optional and may be missed',
            'Polling authorizes every resource',
            'Polling replaces cancellation',
          ],
          0,
          'Notifications improve responsiveness, but polling remains the reliable fallback.'
        ),
        apiSymbols: ['AxMCPClient'],
      }),
    ],
  },
  {
    id: 'notifications',
    number: 10,
    title: 'React safely to live events',
    description:
      'Turn updates and remote task events into durable, authorized agent wake-ups and resumptions.',
    sourceRefs: [
      'src/ax/skills/ax-event-runtime.md',
      'docs/MCP_SUBSCRIPTIONS.md',
      'docs/EVENT_RUNTIME.md',
    ],
    examplePaths: [
      'src/examples/typescript/mcp/resource-wake-agent.ts',
      'src/examples/typescript/mcp/task-resume-flow.ts',
    ],
    topics: [
      topic({
        id: 'notifications-vs-subscriptions',
        title: 'Notifications versus subscriptions',
        prerequisites: ['mcp-tasks-advanced'],
        summary:
          'A server may emit task, progress, logging, catalog, or resource events. Resource notifications require an explicit subscription; a subscription only delivers events and never grants model execution by itself.',
        example:
          'endpoint → catalog → subscription policy → event inbox → explicit route',
        check: choice(
          'Does an MCP resource subscription automatically run an agent?',
          [
            'No; an explicit wake route is still required',
            'Yes; every update invokes the model',
            'Only when progress is zero',
          ],
          0,
          'Delivery and execution are deliberately separate safety boundaries.'
        ),
        apiSymbols: ['AxMCPClient'],
      }),
      topic({
        id: 'subscription-policies',
        title: 'Resource subscription policies',
        prerequisites: ['notifications-vs-subscriptions'],
        summary:
          'Resource subscriptions default to none. Trusted servers may use all; production systems usually use a selector or explicit URI list. Templates are never expanded or authorized automatically.',
        example:
          "resourceSubscriptions: { selector: resource => resource.uri.startsWith('orders://') }",
        check: choice(
          'What is the default resource subscription policy?',
          ['none', 'all', 'every URI template'],
          0,
          'Ax requires explicit resource subscription intent.'
        ),
      }),
      topic({
        id: 'catalog-reconnect-ownership',
        title: 'Catalog changes, reconnect, and ownership',
        prerequisites: ['subscription-policies'],
        summary:
          'List-change notifications refresh the catalog and reconcile selected concrete resources. Logical owners share subscriptions safely, and reconnect restores known intent exactly once without discarding prior good state on partial failure.',
        example:
          'notifications/resources/list_changed → refresh catalog → diff selection → subscribe additions → unsubscribe removals',
        check: choice(
          'What should happen if a selector fails during a catalog change?',
          [
            'Keep the prior known-good selection and retry later',
            'Drop every subscription immediately',
            'Wake every agent',
          ],
          0,
          'Failing closed on the new selection should not destroy known-good ownership state.'
        ),
      }),
      topic({
        id: 'event-runtime-core',
        title: 'AxEventRuntime inbox, trust, stores, and sinks',
        prerequisites: ['notifications-vs-subscriptions', 'flow-operations'],
        summary:
          'Event sources publish normalized envelopes into an inbox. Policies authenticate, authorize, map, retry, dead-letter, and route events; callbacks never call a model directly.',
        example:
          "const runtime = eventRuntime({ store, sink }).route(route('orders').source('mcp.resource').wake(target));",
        check: choice(
          'Where should a notification callback put work?',
          [
            'Into the event inbox for policy-controlled routing',
            'Directly into a model call',
            'Into the provider model enum',
          ],
          0,
          'Durable ingress separates protocol timing from application execution.'
        ),
        apiSymbols: ['eventRuntime', 'AxEventRuntime'],
      }),
      topic({
        id: 'event-actions',
        title: 'observe, invalidate, wake, and resume',
        prerequisites: ['event-runtime-core'],
        summary:
          'observe records progress or logs, invalidate refreshes derived state, wake starts a typed target, and resume consumes an owned continuation. Only wake and resume invoke a model.',
        example:
          "route('resource-updated').source('mcp.resource').identity(requireAccount).wake(target)",
        check: choice(
          'Which event actions may invoke a model?',
          [
            'wake and resume',
            'observe and invalidate',
            'catalog refresh and logging',
          ],
          0,
          'Model execution stays explicit at wake/resume routes.'
        ),
        apiSymbols: ['eventRuntime'],
      }),
      topic({
        id: 'task-continuation-security',
        title: 'Task continuations, identity, and replay safety',
        prerequisites: ['event-actions', 'catalog-reconnect-ownership'],
        summary:
          'Progress and logs remain observational. input_required and terminal task events may resume only the continuation that owns the identity-scoped correlation key. Recorded envelopes make these transitions testable without a live server.',
        example:
          'mcp.task:orders:task-42 → verify identity owner → atomically consume continuation → resume target',
        check: choice(
          'Which continuation may a terminal MCP task notification resume?',
          [
            'Only the identity-scoped owner of its correlation key',
            'Any waiting flow',
            'Every agent sharing the client',
          ],
          0,
          'Ownership prevents cross-tenant or cross-run resume.'
        ),
        apiSymbols: ['eventRuntime', 'AxEventRuntime'],
      }),
    ],
  },
  {
    id: 'production',
    number: 11,
    title: 'Ship AI systems you can operate',
    description:
      'Control cost, latency, fallbacks, security, media, telemetry, and failure handling in production.',
    sourceRefs: [
      'src/ax/skills/ax-ai.md',
      'src/ax/skills/ax-audio.md',
      'src/ax/skills/ax-agent-observability.md',
      'docs/SECURITY.md',
    ],
    examplePaths: [
      'src/examples/telemetry.ts',
      'src/examples/audio-chat.ts',
      'src/examples/ucp-webhook-wake-agent.ts',
    ],
    topics: [
      topic({
        id: 'production-observability',
        title: 'Telemetry, cost, caching, aborts, and debugging',
        prerequisites: [
          'agent-context-observability',
          'structured-validation-errors',
        ],
        summary:
          'Production programs need traces, token and cost accounting, cache policy, cancellation, bounded retries, and logs that explain behavior without exposing secrets. Debug output is evidence, not a substitute for tests.',
        example:
          'await program.forward(llm, input, { tracer, abortSignal, debug: true, contextCache });',
        check: choice(
          'What should every long-running Ax operation accept?',
          [
            'A cancellation path and bounded operational limits',
            'An unbounded retry loop',
            'A browser-stored provider key',
          ],
          0,
          'Cancellation and explicit bounds make failures controllable.'
        ),
      }),
      topic({
        id: 'media-audio-thinking',
        title: 'Embeddings, media, audio, realtime, and thinking',
        prerequisites: ['ai-providers-models'],
        summary:
          'Ax provider clients expose embeddings, image and file inputs, transcription, speech, realtime audio, and model thinking controls. The signature still describes the application contract while provider support determines available media.',
        example:
          "const reply = ax('question:string, image:image -> answer:string, speech:audio');",
        check: choice(
          'Where should media inputs and outputs be declared?',
          [
            'In typed signature fields supported by the provider',
            'Inside a hidden prompt comment',
            'As MCP session identity',
          ],
          0,
          'Media stays part of the explicit program contract.'
        ),
        apiSymbols: ['ai', 'ax'],
      }),
      topic({
        id: 'routing-fallback',
        title: 'Model routing and fallback',
        prerequisites: ['ai-providers-models', 'production-observability'],
        summary:
          'Routers and balancers select models or providers based on capability, health, latency, price, or application policy. Fallback should preserve the contract and remain observable.',
        example:
          'const llm = ai({ name: router, config: { model: preferredModel } });',
        check: choice(
          'What must remain stable across a provider fallback?',
          [
            'The program’s typed contract and observable policy',
            'The provider-specific raw response format',
            'The MCP session ID',
          ],
          0,
          'Routing changes the model boundary, not the application contract.'
        ),
        apiSymbols: ['ai'],
      }),
      topic({
        id: 'ucp-and-events',
        title: 'UCP webhooks and non-MCP events',
        prerequisites: ['event-runtime-core'],
        summary:
          'AxEventRuntime also handles authenticated webhooks, timers, queues, and application events. UCP adapters normalize commerce events into the same explicit wake/resume policy model.',
        example:
          "route('order-updated').source('ucp.webhook').identity(verifyMerchant).wake(orderAgent)",
        check: choice(
          'Does AxEventRuntime require MCP as its source?',
          [
            'No; it also accepts webhooks, timers, queues, and application events',
            'Yes; every event must be MCP',
            'Only when a flow has no nodes',
          ],
          0,
          'The event runtime is protocol-neutral after ingress normalization.'
        ),
        apiSymbols: ['eventRuntime'],
      }),
      topic({
        id: 'security-and-languages',
        title: 'Security and generated language packages',
        prerequisites: [
          'mcp-auth-security',
          'task-continuation-security',
          'production-observability',
        ],
        summary:
          'Treat model output, tool results, resources, notifications, and catalog text as untrusted. TypeScript is the reference runtime; generated Python, Java, C++, Go, and Rust packages expose native surfaces for the shared Ax semantic contract.',
        example:
          'authorize(identity, action, resource); validate(input); run(); verify(output);',
        check: choice(
          'What do generated Ax language packages preserve?',
          [
            'The shared Ax semantic contract through native language surfaces',
            'A transpiled TypeScript runtime in every process',
            'One universal provider API key',
          ],
          0,
          'AxIR-generated packages are native surfaces for shared semantics, not pretend TypeScript transpilation.'
        ),
      }),
    ],
  },
];

const allTopicIds = units.flatMap((unit) => unit.topics.map(({ id }) => id));

export const academyCourse = {
  id: 'ax-foundations',
  version: 1,
  schemaVersion: 1,
  language: 'typescript',
  title: 'Ax Academy',
  courseTitle: 'Build reliable AI workflows and agents',
  description:
    'A hands-on TypeScript course for building dependable AI features, multi-step workflows, tool-using agents, and production automation.',
  dailyGoal: 20,
  units,
  finalCapstone: {
    id: 'production-incident-agent',
    title: 'Build a production incident-response agent',
    prerequisites: [
      'rlm-semantic-helpers',
      'repeated-corpus-exploration',
      'gepa-pareto-artifacts',
      'playbook-learning',
      'mcp-tasks-advanced',
      'task-continuation-security',
      'security-and-languages',
    ],
    summary:
      'Combine everything into an agent that investigates a large incident, uses external tools, waits safely for live updates, and proves its recommendations improved. AxFlow owns the fixed phases, AxAgent handles the investigation, and the runtime keeps long context and resumptions under control.',
    steps: [
      'Create the typed incident and resolution contracts.',
      'Use a Flow for intake, investigation, approval, and response phases.',
      'Keep the incident log runtime-only and add a persisted context map.',
      'Attach recorded MCP tools and an identity-aware event source.',
      'Observe progress, wake on an authorized resource update, and resume only the owned task continuation.',
      'Evaluate the baseline, apply an optimization artifact, and compare held-out results.',
    ],
    command: 'npm run tsx src/examples/mcp-event-demo-server.ts',
    exercises: [
      choice(
        'Which component should own the fixed intake → investigate → approve → respond order?',
        ['AxFlow', 'The MCP notification callback', 'A context map'],
        0,
        'The host-owned workflow belongs in AxFlow.'
      ),
      choice(
        'Which component should preserve orientation across repeated investigations of the same system?',
        [
          'AxAgentContextMap',
          'A progress notification',
          'The final output field',
        ],
        0,
        'A context map holds compact reusable orientation.'
      ),
      choice(
        'What may resume a remote task continuation?',
        [
          'A terminal or input-required event matching its verified owner',
          'Any catalog change',
          'Every logging notification',
        ],
        0,
        'Resume is identity- and correlation-scoped.'
      ),
    ].map((exercise, index) => ({
      ...exercise,
      id: `production-incident-agent-${index + 1}`,
      roles: ['capstone'],
    })),
  },
  coverage: {
    'ax-ai': [
      'ai-providers-models',
      'media-audio-thinking',
      'routing-fallback',
    ],
    'ax-audio': ['media-audio-thinking'],
    'ax-signature': ['signature-semantic-contract', 'fluent-fields-validation'],
    'ax-gen': [
      'ax-forward',
      'structured-validation-errors',
      'streaming-assertions',
    ],
    'ax-flow': ['flow-state-nodes', 'flow-control', 'flow-operations'],
    'ax-agent': ['agent-core', 'agent-discovery', 'child-agents'],
    'ax-agent-rlm': [
      'rlm-pipeline',
      'context-policies',
      'rlm-semantic-helpers',
    ],
    'ax-agent-context': ['agent-context-observability', 'peek-orientation'],
    'ax-agent-memory-skills': [
      'context-map-lifecycle',
      'memory-recall',
      'skill-discovery',
    ],
    'ax-agent-observability': [
      'agent-context-observability',
      'production-observability',
    ],
    'ax-agent-optimize': ['evals-metrics-judges', 'agent-optimize'],
    'ax-gepa': ['optimize-gen-flow', 'gepa-pareto-artifacts'],
    'ax-playbook': ['playbook-learning'],
    'ax-refine': ['refine-selection'],
    'ax-mcp': ['mcp-lifecycle-transports', 'mcp-catalog', 'mcp-tasks-advanced'],
    'ax-event-runtime': [
      'event-runtime-core',
      'event-actions',
      'task-continuation-security',
    ],
  },
  topicOrder: allTopicIds,
};

export const requiredAcademyCoverage = Object.keys(academyCourse.coverage);
