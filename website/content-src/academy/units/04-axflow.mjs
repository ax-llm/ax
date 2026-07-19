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
      title: 'Build a workflow with explicit steps',
      minutes: 8,
      apiLabel: 'flow()',
      prerequisites: ['ax-forward'],
      summary:
        'You define application-owned state and a visible sequence of typed nodes. Input mappings feed each node, and the return mapping selects the final result.',
      example:
        "const wf = flow().node('draft', 'topic:string -> text:string').execute('draft', s => ({ topic: s.topic })).returns(s => ({ text: s.draftResult.text }));",
      exampleSteps: [
        {
          label: 'Declare a typed node',
          note: 'draft states exactly what the AI step receives and returns.',
        },
        {
          label: 'Map state into the node',
          note: 'execute() passes the workflow topic into the draft program.',
        },
        {
          label: 'Choose the public result',
          note: 'returns() exposes only the final text to the caller.',
        },
      ],
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
      title: 'Pass useful state from step to step',
      minutes: 6,
      prerequisites: ['flow-state-nodes'],
      summary:
        'You make dependencies visible by passing state between sequential nodes. Use map() for ordinary transformations that do not need another model call.',
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
      title: 'Branch, loop, and run work in parallel',
      minutes: 9,
      prerequisites: ['flow-composition'],
      summary:
        'You keep important branches, loops, and parallel work under application control. The model handles typed steps instead of improvising the orchestration plan.',
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
      title: 'Turn a workflow into a reusable tool',
      minutes: 8,
      prerequisites: ['flow-control'],
      summary:
        'You can expose a flow as a tool, trace it, wait on an owned continuation, and optimize its components. The shared optimizer tunes the flow without a separate flow-only API.',
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
    topic({
      id: 'flow-mermaid',
      title: 'Author or serialize a flow as a diagram',
      minutes: 7,
      apiLabel: 'flow(mermaid)',
      prerequisites: ['flow-control'],
      summary:
        'You can write a whole flow as a mermaid flowchart and compile it by passing the string to flow(). Any flow renders back with String(flow), so the diagram and the program stay in sync.',
      example:
        'const wf = flow(diagramText); const back = flow(String(wf)); // flow(text) compiles mermaid; String(wf) renders it; fromMermaid is the alias',
      exampleSteps: [
        {
          label: 'Write the diagram',
          note: 'Node contracts live in %%ax directives; labeled edges become branches and loops.',
        },
        {
          label: 'Compile with flow()',
          note: 'A string argument to flow() compiles the dialect into a runnable flow.',
        },
        {
          label: 'Render it back',
          note: 'String(wf) returns the diagram, so flow(String(wf)) round-trips the program.',
        },
      ],
      check: choice(
        'You have a finished flow and want the exact diagram it represents. Which call returns the mermaid source?',
        [
          'String(the flow); toString()/toMermaid() render the dialect',
          'None; a compiled flow cannot be turned back into a diagram',
          'Only the provider can export it after forward() runs',
        ],
        0,
        'AxFlow.toString() and toMermaid() render the flow back to the dialect, so String(flow) round-trips into flow().'
      ),
      apiSymbols: ['AxFlow', 'flow'],
    }),
  ],
};
