import { choice, code, topic } from '../helpers.mjs';

export const dspyUnit = {
  id: 'dspy',
  number: 1,
  title: 'Build AI features you can measure',
  description:
    'Turn a one-off prompt into a program with clear inputs, outputs, examples, and a definition of success.',
  sourceRefs: [
    'website/content-src/templates/concept-dspy.md',
    'src/ax/skills/ax-signature.md',
  ],
  examplePaths: ['src/examples/typescript/generation/structured.ts'],
  topics: [
    topic({
      id: 'programs-not-prompts',
      title: 'Turn a prompt into a reliable program',
      minutes: 6,
      apiLabel: 'ax()',
      summary:
        'You describe what goes in and what must come out, so your app stops parsing model prose. Ax turns that contract into the prompt and validation loop.',
      example:
        'const classify = ax(\'review:string -> sentiment:class \\"positive, negative, neutral\\"\');',
      exampleSteps: [
        {
          label: 'Name the input',
          note: 'review is the value your application supplies.',
        },
        {
          label: 'Constrain the output',
          note: 'sentiment can only be one of the three declared classes.',
        },
        {
          label: 'Keep the contract reusable',
          note: 'The same program can be tested, traced, and improved without changing its call site.',
        },
      ],
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
      title: 'Measure whether your AI feature improved',
      minutes: 7,
      prerequisites: ['programs-not-prompts'],
      summary:
        'You pair realistic examples with a metric, then compare versions on the same evidence. This turns prompt tweaking into a repeatable improvement loop.',
      example:
        'const metric = ({ prediction, example }) => prediction.sentiment === example.sentiment ? 1 : 0;',
      examplePath: 'src/examples/typescript/optimization/axgen-optimization.ts',
      exampleSteps: [
        {
          label: 'Keep a known answer',
          note: 'Each example records the behavior you want the program to reproduce.',
        },
        {
          label: 'Score one prediction',
          note: 'The metric returns 1 only when the predicted sentiment matches the example.',
        },
        {
          label: 'Compare on the same set',
          note: 'Reusing the dataset makes a new score meaningful instead of anecdotal.',
        },
      ],
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
      title: 'Give every AI call a clear contract',
      minutes: 6,
      apiLabel: 's()',
      prerequisites: ['programs-not-prompts'],
      summary:
        'You use one signature vocabulary across generation, tools, agents, flows, and optimization. That shared meaning makes later Ax features easier to combine.',
      example:
        'const ticket = s(\'message:string -> category:class \\"billing, technical, other\\", urgency:number\');',
      exampleSteps: [
        {
          label: 'Separate input from output',
          note: 'The arrow puts message on the input side and the generated fields on the output side.',
        },
        {
          label: 'Use a class for fixed choices',
          note: 'category cannot drift beyond billing, technical, or other.',
        },
        {
          label: 'Reuse the parsed signature',
          note: 's() creates a contract you can inspect, share, and compose.',
        },
      ],
      check: code(
        'Which factory parses a reusable Ax signature? Enter only the factory name.',
        's',
        'Use s() when the signature itself must be inspected, shared, or composed.'
      ),
      apiSymbols: ['s'],
    }),
  ],
};
