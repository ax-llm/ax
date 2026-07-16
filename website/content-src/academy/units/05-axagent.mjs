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
      apiSymbols: ['AxAgent', 'AxGen', 'agent'],
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
};
