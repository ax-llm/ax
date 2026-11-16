// Capture the TypeScript validator's behavior for untyped event ingress.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { axValidateEventEnvelope } from '../../../src/ax/event/util.js';

const valid = {
  specversion: '1.0',
  id: 'event-1',
  source: 'test://events',
  type: 'test.event',
};
const cases: {
  event: Record<string, unknown>;
  expected_error: string | null;
}[] = [];
const capture = (event: Record<string, unknown>) => {
  let expected_error: string | null = null;
  try {
    axValidateEventEnvelope(
      event as unknown as Parameters<typeof axValidateEventEnvelope>[0]
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    expected_error = error.message;
  }
  cases.push({ event, expected_error });
};
capture(valid);
for (const field of ['id', 'source', 'type']) {
  for (const value of [
    42,
    {},
    [],
    true,
    null,
    '',
    ' \t\r\n',
    '\u00a0\uFEFF\u2028',
    ' padded ',
    '\u0085',
  ]) {
    capture({ ...valid, [field]: value });
  }
  const missing: Record<string, unknown> = { ...valid };
  delete missing[field];
  capture(missing);
}
const dir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axevent'
);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'identity-validation.json'),
  `${JSON.stringify(
    {
      name: 'event identity validation matches TypeScript before routing',
      kind: 'event',
      operation: 'identity_validation',
      cases,
    },
    null,
    2
  )}\n`
);
