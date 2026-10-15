import { expectTypeOf } from 'vitest';
import type { AxBox } from './box.js';
import type { AxBoxEvidence, AxDecisionResult } from './decision.js';
import { f } from './sig.js';
import { ax } from './template.js';

const gen = ax(
  'photo:image -> target:box, evidence:box(evidence), regions:box[], optional?:box(evidence, refusal return), nested:object{ region:box }[]'
);
type Out = Awaited<ReturnType<typeof gen.forward>>;
expectTypeOf<Out['target']>().toEqualTypeOf<AxBox>();
expectTypeOf<Out['evidence']>().toEqualTypeOf<AxBoxEvidence>();
expectTypeOf<Out['regions']>().toEqualTypeOf<AxBox[]>();
expectTypeOf<Out['optional']>().toEqualTypeOf<
  AxDecisionResult<AxBoxEvidence> | undefined
>();
expectTypeOf<Out['nested']>().toEqualTypeOf<{ region: AxBox }[]>();
const fluent = ax(
  f()
    .input('region', f.box())
    .output('target', f.box())
    .output('evidence', f.box().withEvidence())
    .output('regions', f.box().array().optional())
    .build()
);
type Fluent = Awaited<ReturnType<typeof fluent.forward>>;
expectTypeOf<Fluent['target']>().toEqualTypeOf<AxBox>();
expectTypeOf<Fluent['evidence']>().toEqualTypeOf<AxBoxEvidence>();
expectTypeOf<Fluent['regions']>().toEqualTypeOf<AxBox[] | undefined>();
// @ts-expect-error thresholds only apply to boolean evidence
f.box().withEvidence({ threshold: 0.5 });

const arrays = ax('query:string -> regions:box(evidence)[]');
type Arrays = Awaited<ReturnType<typeof arrays.forward>>;
expectTypeOf<Arrays['regions']>().toEqualTypeOf<AxBoxEvidence[]>();
const nested = ax(
  f()
    .input('query', f.string())
    .output(
      'matches',
      f
        .object({
          region: f.box().withEvidence(),
          optional: f.box().optional(),
          label: f.string(),
        })
        .array()
    )
    .build()
);
type Nested = Awaited<ReturnType<typeof nested.forward>>;
expectTypeOf<Nested['matches']>().toEqualTypeOf<
  { region: AxBoxEvidence; optional?: AxBox; label: string }[]
>();
