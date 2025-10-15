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
        requestedOn: z.date(),
      }),
      output: z.object({
        results: z.array(z.object({ title: z.string() })),
        tookMs: z.number(),
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
      {
        name: 'requestedOn',
        title: 'Requested On',
        type: { name: 'date' },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'results',
        title: 'Results',
        type: { name: 'json', isArray: true },
      },
      {
        name: 'tookMs',
        title: 'Took Ms',
        type: { name: 'number' },
      },
    ]);
  });

  it('maps literal unions and enums to class metadata where allowed', () => {
    const Status = {
      OPEN: 'OPEN',
      CLOSED: 'CLOSED',
    } as const;

    const signature = AxSignature.fromZod({
      input: z.object({
        tone: z.union([
          z.literal('formal'),
          z.literal('casual'),
          z.literal('excited'),
        ]),
        state: z.nativeEnum(Status),
        tags: z.array(z.enum(['bug', 'feature', 'question'])),
      }),
      output: z.object({
        status: z.enum(['success', 'failure']),
        followup: z.nativeEnum(Status),
      }),
    });

    expect(signature.getInputFields()).toEqual([
      {
        name: 'tone',
        title: 'Tone',
        type: { name: 'string', options: ['formal', 'casual', 'excited'] },
      },
      {
        name: 'state',
        title: 'State',
        type: { name: 'json' },
      },
      {
        name: 'tags',
        title: 'Tags',
        type: { name: 'json', isArray: true },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'status',
        title: 'Status',
        type: { name: 'json' },
      },
      {
        name: 'followup',
        title: 'Followup',
        type: { name: 'json' },
      },
    ]);
  });

  it('marks nullable, default, and catch wrappers as optional', () => {
    const signature = AxSignature.fromZod({
      input: z.object({
        nullable: z.string().nullable(),
        withDefault: z.number().default(5),
        withCatch: z.string().catch('fallback'),
        pipeline: z.string().transform((value) => value.trim()),
      }),
      output: z.object({
        normalized: z.string().trim(),
      }),
    });

    expect(signature.getInputFields()).toEqual([
      {
        name: 'nullable',
        title: 'Nullable',
        type: { name: 'string' },
        isOptional: true,
      },
      {
        name: 'withDefault',
        title: 'With Default',
        type: { name: 'number' },
        isOptional: true,
      },
      {
        name: 'withCatch',
        title: 'With Catch',
        type: { name: 'string' },
        isOptional: true,
      },
      {
        name: 'pipeline',
        title: 'Pipeline',
        type: { name: 'json' },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'normalized',
        title: 'Normalized',
        type: { name: 'string' },
      },
    ]);
  });

  it('handles arrays and nested objects by falling back to json where needed', () => {
    const signature = AxSignature.fromZod({
      input: z.object({
        nestedObject: z.object({
          name: z.string(),
        }),
        arrayOfObjects: z.array(
          z.object({
            id: z.string(),
            value: z.number(),
          })
        ),
      }),
      output: z.object({
        summary: z.string(),
      }),
    });

    expect(signature.getInputFields()).toEqual([
      {
        name: 'nestedObject',
        title: 'Nested Object',
        type: { name: 'json' },
      },
      {
        name: 'arrayOfObjects',
        title: 'Array Of Objects',
        type: { name: 'json', isArray: true },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'summary',
        title: 'Summary',
        type: { name: 'string' },
      },
    ]);
  });

  it('falls back to json for unsupported schema constructions', () => {
    const signature = AxSignature.fromZod({
      input: z.object({
        unionOfPrimitives: z.union([z.string(), z.number()]),
        record: z.record(z.string(), z.number()),
        map: z.map(z.string(), z.number()),
        tuple: z.tuple([z.string(), z.boolean()]),
        func: z.function(z.tuple([z.string()]), z.string()),
      }),
      output: z.object({
        ok: z.boolean(),
      }),
    });

    expect(signature.getInputFields()).toEqual([
      {
        name: 'unionOfPrimitives',
        title: 'Union Of Primitives',
        type: { name: 'json' },
      },
      {
        name: 'record',
        title: 'Record',
        type: { name: 'json' },
      },
      {
        name: 'map',
        title: 'Map',
        type: { name: 'json' },
      },
      {
        name: 'tuple',
        title: 'Tuple',
        type: { name: 'json' },
      },
      {
        name: 'func',
        title: 'Func',
        type: { name: 'json' },
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
