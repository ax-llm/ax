import { choice, topic } from '../helpers.mjs';

export const axflowUnit = {
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
      apiSymbols: ['AxFlow', 'flow'],
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
      apiSymbols: ['AxFlow', 'flow'],
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
      apiSymbols: ['AxFlow', 'flow', 'optimize'],
    }),
  ],
};
