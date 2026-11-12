import { expectTypeOf } from 'vitest';
import { googleGeminiDecisions } from './client.js';

const client = googleGeminiDecisions({ apiKey: 'test' });
const result = await client.create({
  input: 'A duplicate charge',
  questions: {
    urgent: { type: 'noul', instructions: 'Is it urgent?' },
    team: {
      type: 'choice',
      instructions: 'Which team?',
      criteria: { billing: '', support: '' },
    },
    severity: {
      type: 'score',
      instructions: 'How severe?',
      criteria: ['Minor', 'Blocked'],
    },
  },
});
expectTypeOf(result.answers.urgent.noul).toEqualTypeOf<number>();
expectTypeOf(result.answers.urgent.confidence).toEqualTypeOf<number>();
expectTypeOf(result.answers.team.choice).toEqualTypeOf<'billing' | 'support'>();
expectTypeOf(result.answers.team.probabilities.billing).toEqualTypeOf<number>();
expectTypeOf(result.answers.severity.score).toEqualTypeOf<number>();
// @ts-expect-error Unknown answer key
result.answers.other;
// @ts-expect-error Unknown choice label
result.answers.team.probabilities.engineering;
