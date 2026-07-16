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
};
