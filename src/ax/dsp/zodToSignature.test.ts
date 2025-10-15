import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AxSignature } from './sig.js';

describe('AxSignature.fromZod', () => {
  it('creates signature from basic zod schemas', () => {
    const signature = AxSignature.fromZod({
      description: 'Search documents',
      input: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional(),
        tags: z.array(z.string()),
        includeArchived: z.boolean().optional(),
      }),
      output: z.object({
        results: z.array(z.object({ title: z.string() })),
      }),
    });

    expect(signature.getDescription()).toBe('Search documents');

    expect(signature.getInputFields()).toEqual([
      {
        name: 'query',
        title: 'Query',
        description: 'Search query',
        type: { name: 'string' },
      },
      {
        name: 'limit',
        title: 'Limit',
        type: { name: 'number' },
        isOptional: true,
      },
      {
        name: 'tags',
        title: 'Tags',
        type: { name: 'string', isArray: true },
      },
      {
        name: 'includeArchived',
        title: 'Include Archived',
        type: { name: 'boolean' },
        isOptional: true,
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'results',
        title: 'Results',
        type: { name: 'json', isArray: true },
      },
    ]);
  });

  it('maps literal unions to class field options', () => {
    const signature = AxSignature.fromZod({
      input: z.object({
        tone: z.union([
          z.literal('formal'),
          z.literal('casual'),
          z.literal('excited'),
        ]),
      }),
      output: z.object({
        status: z.union([z.literal('success'), z.literal('failure')]),
      }),
    });

    expect(signature.getInputFields()).toEqual([
      {
        name: 'tone',
        title: 'Tone',
        type: { name: 'string', options: ['formal', 'casual', 'excited'] },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'status',
        title: 'Status',
        type: { name: 'class', options: ['success', 'failure'] },
      },
    ]);
  });

  it('marks nullable/undefined branches as optional', () => {
    const signature = AxSignature.fromZod({
      input: z.object({
        metadata: z
          .union([z.literal('basic'), z.literal('extended'), z.undefined()])
          .describe('Optional metadata mode'),
      }),
      output: z.object({
        ok: z.boolean(),
      }),
    });

    expect(signature.getInputFields()).toEqual([
      {
        name: 'metadata',
        title: 'Metadata',
        description: 'Optional metadata mode',
        type: { name: 'string', options: ['basic', 'extended'] },
        isOptional: true,
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'ok',
        title: 'Ok',
        type: { name: 'boolean' },
      },
    ]);
  });
});
