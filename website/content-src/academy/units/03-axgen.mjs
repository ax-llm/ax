import { choice, code, topic } from '../helpers.mjs';

export const axgenUnit = {
  id: 'axgen',
  number: 3,
  title: 'Build a reliable AI-powered feature',
  description:
    'Generate structured results, stream updates, recover from bad responses, and call your own typed tools.',
  sourceRefs: ['src/ax/skills/ax-gen.md'],
  examplePaths: [
    'src/examples/typescript/generation/axgen-openai.ts',
    'src/examples/streaming-asserts.ts',
  ],
  topics: [
    topic({
      id: 'ax-forward',
      title: 'Run your first typed AI call',
      minutes: 6,
      apiLabel: 'forward()',
      prerequisites: ['typed-contracts-everywhere'],
      summary:
        'You run a declared program with a provider and typed input. The returned object follows the output side of your signature.',
      example:
        "const answer = ax('question:string -> answer:string, confidence:number');\nconst result = await answer.forward(llm, { question: 'What is Ax?' });",
      exampleSteps: [
        {
          label: 'Create the program',
          note: 'The signature asks for an answer and a numeric confidence.',
        },
        {
          label: 'Pass a provider and input',
          note: 'forward() runs the program with llm and the required question.',
        },
        {
          label: 'Use the typed result',
          note: 'result exposes the declared output fields instead of raw model text.',
        },
      ],
      check: choice(
        'What does running a structured Ax program return?',
        [
          'Data matching the output signature',
          'The raw HTTP response only',
          'An unparsed prompt string',
        ],
        0,
        'Ax parses and validates the model response into the declared output shape.'
      ),
      apiSymbols: ['ax'],
    }),
    topic({
      id: 'structured-validation-errors',
      title: 'Recover from invalid model output',
      minutes: 8,
      prerequisites: ['ax-forward'],
      summary:
        'You let Ax validate fields and retry with specific correction feedback. Your app can still distinguish generation errors, provider failures, and cancellation.',
      example:
        'try { await program.forward(llm, input); } catch (error) { if (error instanceof AxGenerateError) report(error.details); }',
      exampleSteps: [
        {
          label: 'Run the program normally',
          note: 'Most valid responses return through the usual typed path.',
        },
        {
          label: 'Catch the specific failure',
          note: 'AxGenerateError identifies a generation or validation failure you can report deliberately.',
        },
        {
          label: 'Preserve useful details',
          note: 'error.details gives logs and UI a concrete repair target.',
        },
      ],
      check: choice(
        'What should validation feedback tell the model on retry?',
        [
          'The concrete field or constraint that failed',
          'Only that something went wrong',
          'The provider API key',
        ],
        0,
        'Specific validation feedback gives the retry a repairable target.'
      ),
      apiSymbols: ['AxGenerateError'],
    }),
    topic({
      id: 'streaming-assertions',
      title: 'Show typed results as they arrive',
      minutes: 7,
      apiLabel: 'streamingForward()',
      prerequisites: ['ax-forward'],
      summary:
        'You can render typed deltas while the answer is still arriving. The final result remains governed by the same signature and assertions.',
      example:
        'for await (const chunk of program.streamingForward(llm, input)) { if (chunk.delta.answer) render(chunk.delta.answer); }',
      exampleSteps: [
        {
          label: 'Open a typed stream',
          note: 'streamingForward() uses the same provider, input, and contract as forward().',
        },
        {
          label: 'Read only present fields',
          note: 'A chunk may contain an answer delta while other fields are still incomplete.',
        },
        {
          label: 'Render without reparsing',
          note: 'The UI consumes signature-aware deltas instead of scraping provider text.',
        },
      ],
      check: choice(
        'What is the safe way to consume a streaming Ax result?',
        [
          'Read typed fields from each chunk delta',
          'Parse arbitrary provider text yourself',
          'Wait for a tool notification callback to call the model',
        ],
        0,
        'Ax exposes signature-aware deltas so the caller does not scrape provider text.'
      ),
      apiSymbols: ['ax'],
    }),
    topic({
      id: 'gen-memory-sampling-hooks',
      title: 'Choose better results and keep context',
      minutes: 9,
      prerequisites: ['ax-forward'],
      summary:
        'You can keep chat context, sample several candidates, select one result, cache responses, and observe steps. Add each option only when your feature needs that control.',
      example:
        'const result = await program.forward(llm, input, { mem, sampleCount: 3, resultPicker });',
      exampleSteps: [
        {
          label: 'Carry relevant memory',
          note: 'mem supplies conversation context owned by your application.',
        },
        {
          label: 'Request candidates',
          note: 'sampleCount asks for three possible results instead of one.',
        },
        {
          label: 'Select with a rule',
          note: 'resultPicker turns extra samples into a deliberate quality choice.',
        },
      ],
      check: choice(
        'When is sampleCount greater than one useful?',
        [
          'When a picker or scoring rule can choose among candidate outputs',
          'When the input signature is invalid',
          'When no provider client exists',
        ],
        0,
        'Multiple samples help only when the application has a principled selection rule.'
      ),
    }),
    topic({
      id: 'typed-tools',
      title: 'Let the model call your code safely',
      minutes: 8,
      apiLabel: 'fn()',
      prerequisites: ['ax-forward', 'fluent-fields-validation'],
      summary:
        'You wrap a host capability with a name, purpose, typed arguments, result, and handler. The model sees when and how to call it while your app keeps control of execution.',
      example:
        "const search = fn('search').description('Search product docs').arg('query', f.string()).returns(f.string()).handler(searchDocs).build();",
      exampleSteps: [
        {
          label: 'Explain when to call it',
          note: 'The name and description orient the model toward product documentation searches.',
        },
        {
          label: 'Constrain the call',
          note: 'query must be a string and the result is declared as a string.',
        },
        {
          label: 'Bind trusted code',
          note: 'searchDocs runs in your host environment when the tool is selected.',
        },
      ],
      check: code(
        'Which factory creates a modern typed Ax tool? Enter only the factory name.',
        'fn',
        'fn() is the preferred native tool builder.'
      ),
      apiSymbols: ['fn', 'f'],
    }),
  ],
};
