import { choice, topic } from '../helpers.mjs';

export const axagentUnit = {
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
      title: 'Let an agent investigate and act',
      minutes: 8,
      apiLabel: 'agent()',
      prerequisites: ['ax-forward', 'typed-tools'],
      summary:
        'You give a typed task an iterative runtime where the model can inspect evidence, call tools, and delegate. It still finishes through your declared output contract.',
      example:
        "const helper = agent('request:string -> resolution:string', { functions: [search] });\nconst result = await helper.forward(llm, { request });",
      exampleSteps: [
        {
          label: 'Declare the whole task',
          note: 'The signature keeps the request and final resolution typed.',
        },
        {
          label: 'Provide allowed capabilities',
          note: 'functions limits the tools the runtime may choose.',
        },
        {
          label: 'Start one agent run',
          note: 'forward() lets the agent inspect, act, and finish with a resolution.',
        },
      ],
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
      apiSymbols: ['AxAgent', 'AxGen', 'agent'],
    }),
    topic({
      id: 'agent-discovery',
      title: 'Give an agent many tools without overload',
      minutes: 9,
      prerequisites: ['agent-core'],
      summary:
        'You group large tool catalogs and load their details only when relevant. The agent begins with a compact index instead of carrying every tool description.',
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
      title: 'Delegate a job to a specialist agent',
      minutes: 7,
      prerequisites: ['agent-core'],
      summary:
        'You expose a child agent as a typed specialist with its own tools, runtime, and context. Use one when the delegated job needs an independent agent loop.',
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
      title: 'Pause and ask instead of guessing',
      minutes: 8,
      prerequisites: ['agent-core'],
      summary:
        'You make the agent ask when a missing fact would change an action or result. Your host persists that pause, resumes safely, and keeps failures distinct from final output.',
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
      title: 'See what your agent did and why',
      minutes: 8,
      prerequisites: ['agent-discovery', 'agent-clarification-resume'],
      summary:
        'You keep task input, context, orientation, memories, and skills in the right lifecycle. Runtime hooks then show the turns, tool calls, traces, status, and usage behind the answer.',
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
};
