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
};
