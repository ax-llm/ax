// cspell:ignore noul
import { expectTypeOf } from 'vitest';
import { typesafe } from './client.js';

async function nativeInference() {
  const client = typesafe({ apiKey: 'key' });
  const result = await client.systemOne({
    state: null,
    questions: {
      urgent: { type: 'noul' },
      team: { type: 'choice', criteria: { billing: null, support: 'Help' } },
      severity: { type: 'score', criteria: ['Low', 'High'] },
    },
  });
  expectTypeOf(result.answers.urgent.noul).toEqualTypeOf<number>();
  expectTypeOf(result.answers.team.choice).toEqualTypeOf<
    'billing' | 'support'
  >();
  expectTypeOf(
    result.answers.team.probabilities.billing
  ).toEqualTypeOf<number>();
  expectTypeOf(result.answers.severity.score).toEqualTypeOf<number>();
  // @ts-expect-error Unknown question keys must not be accepted.
  result.answers.missing;
  // @ts-expect-error Noul is a probability, not an Ax boolean.
  const value: boolean = result.answers.urgent.noul;
  // @ts-expect-error Only configured Choice labels are present.
  result.answers.team.probabilities.engineering;
  return value;
}
void nativeInference;
