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
      title: 'Run a typed AI program',
      prerequisites: ['typed-contracts-everywhere'],
      summary:
        'A structured generator declares the program, then runs it with a provider and typed inputs. The result is shaped by the output side of the signature.',
      example:
        "const answer = ax('question:string -> answer:string, confidence:number');\nconst result = await answer.forward(llm, { question: 'What is Ax?' });",
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
      title: 'Structured output, retries, and errors',
      prerequisites: ['ax-forward'],
      summary:
        'Ax validates generated fields and can retry with concrete correction feedback. Applications should distinguish generation failures, provider failures, and cancellation instead of catching everything as an unknown error.',
      example:
        'try { await program.forward(llm, input); } catch (error) { if (error instanceof AxGenerateError) report(error.details); }',
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
      title: 'Streaming and streaming assertions',
      prerequisites: ['ax-forward'],
      summary:
        'streamingForward() yields typed deltas while the final result remains governed by the signature. Streaming assertions can stop or repair output while it is still arriving.',
      example:
        'for await (const chunk of program.streamingForward(llm, input)) { if (chunk.delta.answer) render(chunk.delta.answer); }',
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
      title: 'Memory, sampling, selection, and hooks',
      prerequisites: ['ax-forward'],
      summary:
        'AxGen can carry chat memory, sample multiple candidates, select a result, cache responses, and expose step hooks. Add these only when the program needs the corresponding state or quality control.',
      example:
        'const result = await program.forward(llm, input, { mem, sampleCount: 3, resultPicker });',
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
      title: 'Create typed host tools',
      prerequisites: ['ax-forward', 'fluent-fields-validation'],
      summary:
        'A typed tool gives a host capability a name, purpose, typed arguments, a typed result, and a handler. Good descriptions explain when the model should call the tool; schemas define how.',
      example:
        "const search = fn('search').description('Search product docs').arg('query', f.string()).returns(f.string()).handler(searchDocs).build();",
      check: code(
        'Which factory creates a modern typed Ax tool? Enter only the factory name.',
        'fn',
        'fn() is the preferred native tool builder.'
      ),
      apiSymbols: ['fn', 'f'],
    }),
  ],
};
