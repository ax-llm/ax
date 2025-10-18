import { z } from 'zod';

import { AxSignature } from '../ax/dsp/sig.js';
import { createFinalZodAssertion } from '../ax/zod/assertion.js';
import { getZodMetadata } from '../ax/zod/metadata.js';

async function main() {
  const schema = z.object({
    status: z.enum(['ok', 'warn', 'error']).catch('error'),
    attempts: z.number().int().min(1).max(5).default(1),
    notes: z.string().min(5).optional(),
  });

  const signature = AxSignature.fromZod(schema, {
    mode: 'safeParse',
  });

  const metadata = getZodMetadata(signature);
  if (!metadata) {
    throw new Error('Expected metadata for Zod signature.');
  }

  const assertion = createFinalZodAssertion(metadata);

  const parsedValues = { status: 'unexpected' } as Record<string, unknown>;
  console.log('Before validation:', parsedValues);
  await assertion.fn(parsedValues);
  console.log('After validation (defaults + catch applied):', parsedValues);

  const invalid = { status: 'ok', attempts: 10 };
  const failure = await assertion.fn(invalid);
  console.log('Invalid parse result:', failure);
}

void main();
