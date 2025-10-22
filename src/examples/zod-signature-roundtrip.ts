import { z } from 'zod';

import { AxSignature } from '../ax/dsp/sig.js';
import { getZodMetadata } from '../ax/zod/metadata.js';

const ticketSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(['low', 'medium', 'high']).catch('low'),
  summary: z.string().min(10),
  tags: z.array(z.string()).default([]),
});

const ticketSignature = AxSignature.fromZod(ticketSchema, {
  mode: 'safeParse',
});

console.log('Ticket outputs:', ticketSignature.getOutputFields());

const ticketMetadata = getZodMetadata(ticketSignature);
if (ticketMetadata) {
  console.log('Ticket conversion issues:', ticketMetadata.issues);
  console.log(
    'Round-trip preserves schema reference:',
    ticketSignature.toZod() === ticketSchema
  );
}

const unionSchema = z.object({
  payload: z.union([z.string(), z.number()]),
});

const unionSignature = AxSignature.fromZod(unionSchema);
console.log('Union outputs:', unionSignature.getOutputFields());

const unionMetadata = getZodMetadata(unionSignature);
if (unionMetadata) {
  console.log('Union conversion issues:', unionMetadata.issues);
}
