import { choice, code, topic } from '../helpers.mjs';

export const modelsSignaturesUnit = {
  id: 'models-signatures',
  number: 2,
  title: 'Make AI outputs predictable',
  description:
    'Choose a model and define validated data contracts so the rest of your application can trust the result.',
  sourceRefs: ['src/ax/skills/ax-ai.md', 'src/ax/skills/ax-signature.md'],
  examplePaths: ['src/examples/typescript/generation/structured.ts'],
  topics: [
    topic({
      id: 'ai-providers-models',
      title: 'Connect Ax to the right model',
      minutes: 8,
      apiLabel: 'ai()',
      prerequisites: ['programs-not-prompts'],
      summary:
        'You configure the provider, current model, credentials, and runtime options in one place. Your program contract stays separate from that choice.',
      example:
        "const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY!, config: { model: 'gpt-5.4-mini' } });",
      examplePath: 'src/examples/typescript/generation/axgen-openai.ts',
      exampleSteps: [
        {
          label: 'Choose the provider',
          note: 'name selects the provider adapter used by this client.',
        },
        {
          label: 'Read credentials from the host',
          note: 'The API key stays in the process environment instead of browser storage or source code.',
        },
        {
          label: 'Pick a current model',
          note: 'Model selection belongs in provider configuration, not in the program signature.',
        },
      ],
      check: code(
        'Which factory creates an Ax provider client? Enter only the factory name.',
        'ai',
        'ai() is the modern provider factory.'
      ),
      apiSymbols: ['ai'],
    }),
    topic({
      id: 'string-signatures',
      title: 'Describe inputs and outputs in one line',
      minutes: 5,
      apiLabel: 'ax()',
      prerequisites: ['signature-semantic-contract'],
      summary:
        'You can describe an ordinary typed contract in one readable line. Inputs go before the arrow and outputs go after it.',
      example:
        "const extract = ax('email:string -> sender:string, topics:string[], needsReply:boolean');",
      exampleSteps: [
        {
          label: 'Declare the source value',
          note: 'email is the string your application passes in.',
        },
        {
          label: 'List the result fields',
          note: 'The output side combines a string, an array, and a boolean.',
        },
        {
          label: 'Call it like a typed program',
          note: 'Ax uses this declaration to prompt, parse, and validate the response.',
        },
      ],
      check: choice(
        'In a string signature, where do output fields appear?',
        ['After ->', 'Before ->', 'Inside ai() configuration'],
        0,
        'The arrow separates inputs on the left from outputs on the right.'
      ),
      apiSymbols: ['ai', 'ax', 's'],
    }),
    topic({
      id: 'fluent-fields-validation',
      title: 'Add richer validation to your fields',
      minutes: 8,
      apiLabel: 'f()',
      prerequisites: ['string-signatures'],
      summary:
        'You use the fluent builder for limits, nested objects, arrays, optional fields, and richer descriptions. Validation becomes part of the program instead of cleanup after it.',
      example:
        "const signature = f().input('text', f.string().min(1)).output('score', f.number().min(0).max(1)).build();",
      exampleSteps: [
        {
          label: 'Reject empty input',
          note: 'min(1) makes the text requirement executable.',
        },
        {
          label: 'Bound the score',
          note: 'The output must stay between zero and one.',
        },
        {
          label: 'Build one signature',
          note: 'build() finishes the reusable input and output contract.',
        },
      ],
      check: code(
        'Which factory starts the native fluent field builder? Enter only the factory name.',
        'f',
        'f() constructs fluent fields and complete signatures.'
      ),
      apiSymbols: ['f'],
    }),
    topic({
      id: 'typed-contracts-everywhere',
      title: 'Reuse the same contract everywhere',
      minutes: 6,
      prerequisites: ['ai-providers-models', 'fluent-fields-validation'],
      summary:
        'You keep a field’s meaning stable as it moves through generators, tools, flows, agents, and events. That makes composed systems easier to validate and evaluate.',
      example:
        "const lookup = fn('lookup').arg('ticketId', f.string()).returns(f.json()).handler(loadTicket).build();",
      examplePath: 'src/examples/typescript/short-agents/tools-agent.ts',
      exampleSteps: [
        {
          label: 'Name the capability',
          note: 'lookup gives the model and traces a stable tool name.',
        },
        {
          label: 'Type the boundary',
          note: 'ticketId and the JSON result use the same field vocabulary as Ax programs.',
        },
        {
          label: 'Keep execution in your app',
          note: 'The handler owns the real lookup and returns the declared result.',
        },
      ],
      check: choice(
        'Why reuse the same field meanings across generators, tools, flows, and agents?',
        [
          'It preserves one semantic contract across composition boundaries.',
          'It disables runtime validation.',
          'It forces every program to use the same provider.',
        ],
        0,
        'Stable field semantics make composition and evaluation reliable.'
      ),
      apiSymbols: ['fn', 'f'],
    }),
  ],
};
