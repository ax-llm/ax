import { choice, topic } from '../helpers.mjs';

export const peekContextUnit = {
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
      title: 'Stop re-exploring the same codebase',
      minutes: 8,
      apiLabel: 'AxAgentContextMap',
      prerequisites: ['context-fields-auto-upgrade', 'context-policies'],
      summary:
        'You give an agent a compact, persistent map of a recurring corpus. It begins oriented while still checking current evidence for each task.',
      example:
        'const map = new AxAgentContextMap(savedSnapshot, { maxChars: 4000 });',
      exampleSteps: [
        {
          label: 'Load prior orientation',
          note: 'savedSnapshot carries useful structure learned on earlier successful runs.',
        },
        {
          label: 'Keep the map compact',
          note: 'maxChars bounds what is injected into the agent context.',
        },
        {
          label: 'Use it as a guide',
          note: 'The map points the agent toward evidence but never replaces current source.',
        },
      ],
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
      title: 'Keep an orientation map up to date',
      minutes: 7,
      prerequisites: ['peek-orientation'],
      summary:
        'You update and snapshot the map after successful runs, either indefinitely or during a warmup. Failed, aborted, and clarification runs leave it unchanged.',
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
      title: 'Reuse orientation across many questions',
      minutes: 6,
      prerequisites: ['context-map-lifecycle'],
      summary:
        'You reuse one map across many questions about a repository, document set, or system. The agent still inspects current evidence, but it knows where to begin.',
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
      title: 'Recall the right facts when needed',
      minutes: 8,
      apiLabel: 'recall()',
      prerequisites: ['agent-core'],
      summary:
        'You load task-relevant facts from a local catalog or external search only when needed. recall() makes the selected memories available on the next actor turn.',
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
      title: 'Load the right procedure for the job',
      minutes: 8,
      apiLabel: 'discover()',
      prerequisites: ['agent-discovery'],
      summary:
        'You load procedural guides with discover() from a local catalog or external retrieval. Relevance hints guide selection without replacing authorization or evidence.',
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
};
