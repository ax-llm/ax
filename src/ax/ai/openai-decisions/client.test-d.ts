import { expectTypeOf } from 'vitest';
import { openaiDecisions } from './client.js';

async function nativeInference() {
  const result = await openaiDecisions({ apiKey: 'key' }).create({
    input: 'Help',
    questions: [
      { type: 'predicate', instructions: 'Urgent?' },
      {
        type: 'choice',
        instructions: 'Which team?',
        choices: [{ value: 'billing' }, { value: 'support' }, { value: true }],
      },
      {
        type: 'score',
        instructions: 'Severity?',
        levels: [{ label: 'Minor' }, { label: 'Blocked' }],
      },
    ],
  });
  const [predicate, choice, score] = result.answers;
  if (predicate.type !== 'refusal')
    expectTypeOf(predicate.probability).toEqualTypeOf<number>();
  if (choice.type !== 'refusal')
    expectTypeOf(choice.choice).toEqualTypeOf<'billing' | 'support' | true>();
  if (score.type !== 'refusal')
    expectTypeOf(score.score).toEqualTypeOf<number>();
  // @ts-expect-error The first answer cannot be a choice.
  predicate.choice;
  // @ts-expect-error Refusals must be narrowed before accessing probabilities.
  predicate.probability;
}
void nativeInference;
