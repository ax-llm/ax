import { choice, topic } from '../helpers.mjs';

export const rlmUnit = {
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
      title: 'Work through large tasks one step at a time',
      minutes: 9,
      apiLabel: 'agent()',
      prerequisites: ['agent-core'],
      summary:
        'You let the actor run one observable step, inspect compact evidence, and continue from live state. This avoids stuffing a large task into one prompt or generated script.',
      example:
        "const matches = inputs.records.filter(r => r.status === 'failed');\nconsole.log(matches.length);",
      exampleSteps: [
        {
          label: 'Filter inside the runtime',
          note: 'The full records stay available to code instead of being repeated in a prompt.',
        },
        {
          label: 'Expose compact evidence',
          note: 'Logging only the count gives the next turn a useful observation.',
        },
        {
          label: 'Continue from live values',
          note: 'Later turns can reuse matches without recomputing or replaying the dataset.',
        },
      ],
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
      title: 'Keep useful values across agent turns',
      minutes: 7,
      prerequisites: ['rlm-pipeline'],
      summary:
        'You can reuse successful variables and functions across actor turns. Prompt history may be summarized while live runtime values remain available.',
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
      title: 'Keep bulky evidence out of the prompt',
      minutes: 9,
      apiLabel: 'contextFields',
      prerequisites: ['persistent-runtime-state'],
      summary:
        'You place large inputs in the runtime and expose only a preview and shape to the model. Declared contextFields keep the full value available by reference.',
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
      title: 'Control how much history the model sees',
      minutes: 8,
      apiLabel: 'contextPolicy',
      prerequisites: ['persistent-runtime-state'],
      summary:
        'You choose how aggressively earlier actions are summarized without deleting live runtime values. Checkpointed with a balanced budget is the practical starting point.',
      example: "contextPolicy: { preset: 'checkpointed', budget: 'balanced' }",
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
      title: 'Ask small questions mid-investigation',
      minutes: 9,
      apiLabel: 'llmQuery()',
      prerequisites: ['context-fields-auto-upgrade', 'context-policies'],
      summary:
        'You use llmQuery() for a focused semantic question over narrowed context and child agents for tool-using subtasks. The runtime can also upgrade exploration, answer directly, or repair failed code.',
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
};
