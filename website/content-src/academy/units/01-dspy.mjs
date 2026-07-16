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
};
