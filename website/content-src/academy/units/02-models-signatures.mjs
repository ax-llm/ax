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
      title: 'Choose providers, models, and routing',
      prerequisites: ['programs-not-prompts'],
      summary:
        'The provider boundary owns configuration, current model selection, routing, streaming, media, embeddings, thinking, and usage. Keep credentials in the host environment and choose a current-generation model.',
      example:
        "const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY!, config: { model: 'gpt-5.4-mini' } });",
      check: code(
        'Which factory creates an Ax provider client? Enter only the factory name.',
        'ai',
        'ai() is the modern provider factory.'
      ),
      apiSymbols: ['ai'],
    }),
    topic({
      id: 'string-signatures',
      title: 'String and reusable signatures',
      prerequisites: ['signature-semantic-contract'],
      summary:
        'String signatures are the concise default for ordinary contracts. Inputs appear before ->, outputs after it, and field descriptions or class choices make the model boundary explicit.',
      example:
        "const extract = ax('email:string -> sender:string, topics:string[], needsReply:boolean');",
      check: choice(
        'In a string signature, where do output fields appear?',
        ['After ->', 'Before ->', 'Inside ai() configuration'],
        0,
        'The arrow separates inputs on the left from outputs on the right.'
      ),
      apiSymbols: ['ax', 's'],
    }),
    topic({
      id: 'fluent-fields-validation',
      title: 'Fluent fields, objects, and validation',
      prerequisites: ['string-signatures'],
      summary:
        'Use the fluent field builder when a contract needs richer constraints, nested objects, arrays, optionality, descriptions, or Standard Schema interoperability. Validation is part of the program rather than cleanup after the call.',
      example:
        "const signature = f().input('text', f.string().min(1)).output('score', f.number().min(0).max(1)).build();",
      check: code(
        'Which factory starts the native fluent field builder? Enter only the factory name.',
        'f',
        'f() constructs fluent fields and complete signatures.'
      ),
      apiSymbols: ['f'],
    }),
    topic({
      id: 'typed-contracts-everywhere',
      title: 'Typed contracts across Ax',
      prerequisites: ['ai-providers-models', 'fluent-fields-validation'],
      summary:
        'AxGen, AxFlow, AxAgent, tools, event targets, and optimizers share the same typed vocabulary. A field should keep the same meaning as it crosses those surfaces.',
      example:
        "const lookup = fn('lookup').arg('ticketId', f.string()).returns(f.json()).handler(loadTicket).build();",
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
