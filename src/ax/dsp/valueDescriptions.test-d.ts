import { expectTypeOf } from 'vitest';
import { f } from './sig.js';
import type { ParseSignature } from './sigtypes.js';
import { ax } from './template.js';

type Parsed = ParseSignature<`ticket:string -> urgent:boolean(
  true "Customers cannot complete a core task (checkout), now",
  false "A routine request"
) "Does this need immediate attention?", team:class "support, urgent billing"(support "Help", "urgent billing" "Invoice (past due)")`>;
expectTypeOf<Parsed['inputs']['ticket']>().toEqualTypeOf<string>();
expectTypeOf<Parsed['outputs']['urgent']>().toEqualTypeOf<boolean>();
expectTypeOf<Parsed['outputs']['team']>().toEqualTypeOf<
  'support' | 'urgent billing'
>();

type Escaped =
  ParseSignature<'ticket:string -> urgent:boolean(true "Customer said \\"urgent\\", cannot pay)", false "Routine"), team:class "support, billing"(billing "Invoice")'>;
expectTypeOf<Escaped['outputs']['urgent']>().toEqualTypeOf<boolean>();
expectTypeOf<Escaped['outputs']['team']>().toEqualTypeOf<
  'support' | 'billing'
>();

type Nested =
  ParseSignature<'ticket:string -> profile:object{ urgent:boolean(true "A \\"}\\" in the ticket", false "Routine"), team:class "support, billing"(billing "Invoice") }'>;
expectTypeOf<Nested['outputs']['profile']['urgent']>().toEqualTypeOf<boolean>();
expectTypeOf<Nested['outputs']['profile']['team']>().toEqualTypeOf<
  'support' | 'billing'
>();

const fluent = ax(
  f()
    .input('ticket', f.string())
    .output(
      'urgent',
      f.boolean().describeValues({ true: 'Blocked', false: 'Routine' })
    )
    .output(
      'team',
      f.class(['support', 'billing']).describeValues({ billing: 'Invoice' })
    )
    .build()
);
type Result = Awaited<ReturnType<typeof fluent.forward>>;
expectTypeOf<Result['urgent']>().toEqualTypeOf<boolean>();
expectTypeOf<Result['team']>().toEqualTypeOf<'support' | 'billing'>();
// @ts-expect-error Boolean annotations only accept boolean outcome keys.
f.boolean().describeValues({ maybe: 'Unknown' });
// @ts-expect-error Class annotations only accept declared labels.
f.class(['support', 'billing']).describeValues({ engineering: 'Broken' });
// @ts-expect-error Value descriptions do not turn numbers into rubrics.
f.number().describeValues({ '0': 'Low' });
