import { expectTypeOf } from 'vitest';
import type {
  AxBooleanEvidence,
  AxClassEvidence,
  AxDecisionResult,
  AxScoreEvidence,
} from './decision.js';
import { f } from './sig.js';
import { ax } from './template.js';

const strings = ax(
  'query:string -> relevant:boolean(evidence), category:class "a, b"(evidence), relevance:score "No, Yes"(evidence), optional?:boolean(evidence, refusal return), categories:class[] "a, b"(evidence), scores:score[] "No, Yes"(evidence), nested:object{ flag:boolean(evidence) }[]'
);
type Out = Awaited<ReturnType<typeof strings.forward>>;
expectTypeOf<Out['relevant']>().toEqualTypeOf<AxBooleanEvidence>();
expectTypeOf<Out['category']>().toEqualTypeOf<AxClassEvidence<'a' | 'b'>>();
expectTypeOf<Out['relevance']>().toEqualTypeOf<AxScoreEvidence>();
expectTypeOf<Out['optional']>().toEqualTypeOf<
  AxDecisionResult<AxBooleanEvidence> | undefined
>();
expectTypeOf<Out['categories']>().toEqualTypeOf<AxClassEvidence<'a' | 'b'>[]>();
expectTypeOf<Out['scores']>().toEqualTypeOf<AxScoreEvidence[]>();
expectTypeOf<Out['nested']>().toEqualTypeOf<{ flag: AxBooleanEvidence }[]>();

const fluent = ax(
  f()
    .input('query', f.string())
    .output('relevant', f.boolean().withEvidence().optional().array())
    .output('category', f.class(['a', 'b']).withEvidence())
    .output(
      'relevance',
      f.score(['No', 'Yes']).withEvidence({ onRefusal: 'return' })
    )
    .build()
);
type FluentOut = Awaited<ReturnType<typeof fluent.forward>>;
expectTypeOf<FluentOut['relevant']>().toEqualTypeOf<
  AxBooleanEvidence[] | undefined
>();
expectTypeOf<FluentOut['category']>().toEqualTypeOf<
  AxClassEvidence<'a' | 'b'>
>();
expectTypeOf<FluentOut['relevance']>().toEqualTypeOf<
  AxDecisionResult<AxScoreEvidence>
>();

// @ts-expect-error evidence is only available on decision fields
f.string().withEvidence();
// @ts-expect-error threshold is exclusive to boolean fields
f.class(['a', 'b']).withEvidence({ threshold: 0.5 });

const arrays = ax(
  'query:string -> classes:class "a, b"(evidence, refusal return)[], flags:boolean(evidence, refusal return)[]'
);
type Arrays = Awaited<ReturnType<typeof arrays.forward>>;
expectTypeOf<Arrays['classes']>().toEqualTypeOf<
  AxDecisionResult<AxClassEvidence<'a' | 'b'>>[]
>();
expectTypeOf<Arrays['flags']>().toEqualTypeOf<
  AxDecisionResult<AxBooleanEvidence>[]
>();

const scoreArray = ax('query:string -> scores:score "No, Yes"[]');
type ScoreArrayOutput = Awaited<ReturnType<typeof scoreArray.forward>>;
expectTypeOf<ScoreArrayOutput['scores']>().toEqualTypeOf<number[]>();

const labels = ax(
  'query:string -> relevant:boolean(evidence), category:class "a, b"(evidence), relevance:score "No, Yes"(evidence)'
);
labels.setExamples([
  { query: 'x', relevant: true, category: 'a', relevance: 1 },
]);
labels.setDemos([
  {
    programId: labels.getId(),
    traces: [{ relevant: false, category: 'b', relevance: 0 }],
  },
]);
// @ts-expect-error labels still must match the declared choices
labels.setExamples([{ relevant: true, category: 'unknown', relevance: 1 }]);
arrays.setExamples([{ classes: ['a', 'b'], flags: [true, false] }]);
strings.setExamples([
  {
    query: 'x',
    relevant: true,
    category: 'a',
    relevance: 1,
    categories: ['b'],
    scores: [0, 1],
    nested: [{ flag: false }],
  },
]);
