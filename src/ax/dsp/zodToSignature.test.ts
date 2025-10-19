import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AxSignature } from './sig.js';

describe('AxSignature.fromZod', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates signature from basic zod schemas', () => {
    const signature = AxSignature.fromZod(
      {
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
      },
      { warnOnFallback: false }
    );

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

    const collected: Array<{ path: readonly string[]; reason: string }> = [];
    const nativeEnumSchema = z.nativeEnum(Status);
    const enumSchema = z.enum(['bug', 'feature', 'question']);
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          tone: z.union([
            z.literal('formal'),
            z.literal('casual'),
            z.literal('excited'),
          ]),
          state: nativeEnumSchema,
          tags: z.array(enumSchema),
        }),
        output: z.object({
          status: z.enum(['success', 'failure']),
          followup: z.nativeEnum(Status),
        }),
      },
      {
        warnOnFallback: false,
        onIssues: (issues) => {
          for (const issue of issues) {
            collected.push({ path: issue.path, reason: issue.reason });
          }
        },
      }
    );

    const inputFields = signature.getInputFields();

    if (process.env.DEBUG_ZOD_TRANSFORMS) {
      // eslint-disable-next-line no-console
      console.log('nullable/default input', inputFields);
      // eslint-disable-next-line no-console
      console.log('nullable/default output', outputFields);
      // eslint-disable-next-line no-console
      console.log(
        'nullable/default issues',
        signature.getZodConversionIssues()
      );
    }

    expect(inputFields).toEqual([
      {
        name: 'tone',
        title: 'Tone',
        type: { name: 'string', options: ['formal', 'casual', 'excited'] },
      },
      {
        name: 'state',
        title: 'State',
        type: { name: 'string', options: ['OPEN', 'CLOSED'] },
      },
      {
        name: 'tags',
        title: 'Tags',
        type: {
          name: 'string',
          isArray: true,
          options: ['bug', 'feature', 'question'],
        },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'status',
        title: 'Status',
        type: { name: 'class', options: ['success', 'failure'] },
      },
      {
        name: 'followup',
        title: 'Followup',
        type: { name: 'class', options: ['OPEN', 'CLOSED'] },
      },
    ]);

    expect(collected).toMatchObject([
      {
        path: ['input', 'tone'],
        reason: expect.stringContaining(
          'Ax inputs do not support class fields'
        ),
      },
    ]);
    expect(signature.getZodConversionIssues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['input', 'tone'],
        }),
      ])
    );
  });

  it('downgrades literal inputs to string metadata and records issues', () => {
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          state: z.literal('ready'),
          attempts: z.literal(3),
        }),
        output: z.object({
          outcome: z.literal('success'),
        }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'state',
        title: 'State',
        type: { name: 'string', options: ['ready'] },
      },
      {
        name: 'attempts',
        title: 'Attempts',
        type: { name: 'string', options: ['3'] },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'outcome',
        title: 'Outcome',
        type: { name: 'class', options: ['success'] },
      },
    ]);

    expect(signature.getZodConversionIssues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['input', 'state'],
          fallbackType: 'string',
          severity: 'downgraded',
          reason: expect.stringContaining('downgraded to string'),
        }),
        expect.objectContaining({
          path: ['input', 'attempts'],
          fallbackType: 'string',
          severity: 'downgraded',
          reason: expect.stringContaining('downgraded to string'),
        }),
      ])
    );
  });

  it('marks nullable, default, and catch wrappers as optional', () => {
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          nullable: z.string().nullable(),
          withDefault: z.number().default(5),
          withCatch: z.string().catch('fallback'),
          pipeline: z.string().transform((value) => value.trim()),
        }),
        output: z.object({
          normalized: z.string().trim(),
        }),
      },
      { warnOnFallback: false }
    );

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

    expect(signature.getZodConversionIssues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['input', 'pipeline'],
          fallbackType: 'json',
          severity: 'downgraded',
        }),
      ])
    );
  });

  it('downgrades Zod transforms to json fields with issues', () => {
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          transformed: z.string().transform((value) => value.length),
        }),
        output: z.object({
          converted: z
            .string()
            .transform((value) => ({ length: value.length })),
        }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'transformed',
        title: 'Transformed',
        type: { name: 'json' },
      },
    ]);

    expect(signature.getOutputFields()).toEqual([
      {
        name: 'converted',
        title: 'Converted',
        type: { name: 'json' },
      },
    ]);

    expect(signature.getZodConversionIssues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['input', 'transformed'],
          fallbackType: 'json',
          severity: 'downgraded',
        }),
        expect.objectContaining({
          path: ['output', 'converted'],
          fallbackType: 'json',
          severity: 'downgraded',
          schemaType: expect.any(String),
        }),
      ])
    );
  });

  it('handles arrays and nested objects by falling back to json where needed', () => {
    const signature = AxSignature.fromZod(
      {
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
      },
      { warnOnFallback: false }
    );

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

  it('keeps array fields required when only the elements are optional', () => {
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          tags: z.array(z.string().optional()),
        }),
        output: z.object({
          ok: z.boolean(),
        }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'tags',
        title: 'Tags',
        type: { name: 'string', isArray: true },
      },
    ]);

    expect(signature.getZodConversionIssues()).toEqual([]);
  });

  it('falls back to json for unsupported schema constructions', () => {
    const signature = AxSignature.fromZod(
      {
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
      },
      { warnOnFallback: false }
    );

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

  it('maps string refinements to url and datetime field types', () => {
    const linkSchema = z.string().url();
    const datetimeSchema = z.string().datetime();

    const signature = AxSignature.fromZod(
      {
        input: z.object({
          link: linkSchema,
          scheduledFor: datetimeSchema,
          createdAt: z.date(),
        }),
        output: z.object({
          accepted: z.boolean(),
        }),
      },
      { warnOnFallback: false }
    );

    const inputFields = signature.getInputFields();

    expect(inputFields).toEqual([
      {
        name: 'link',
        title: 'Link',
        type: { name: 'url' },
      },
      {
        name: 'scheduledFor',
        title: 'Scheduled For',
        type: { name: 'datetime' },
      },
      {
        name: 'createdAt',
        title: 'Created At',
        type: { name: 'date' },
      },
    ]);
  });

  it('warns on fallback by default and throws in strict mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const loose = AxSignature.fromZod({
      input: z.object({
        nested: z.object({ id: z.string() }),
      }),
      output: z.object({
        ok: z.boolean(),
      }),
    });

    expect(loose.getInputFields()).toEqual([
      { name: 'nested', title: 'Nested', type: { name: 'json' } },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    expect(() =>
      AxSignature.fromZod(
        {
          input: z.object({
            nested: z.object({ id: z.string() }),
          }),
          output: z.object({
            ok: z.boolean(),
          }),
        },
        { strict: true }
      )
    ).toThrowError(
      /Unsupported Zod schema elements encountered during conversion/
    );
  });

  it('exposes conversion issues and debug helper output', () => {
    const logger = vi.fn();
    const { signature, issues } = AxSignature.debugZodConversion(
      {
        input: z.object({
          nested: z.object({ id: z.string() }),
        }),
        output: z.object({
          ok: z.boolean(),
        }),
      },
      { logger }
    );

    expect(issues).toHaveLength(1);
    expect(logger).toHaveBeenCalledWith(issues);
    expect(signature.getZodConversionIssues()).toEqual(issues);
  });

  it('reports stored conversion issues via helper', () => {
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          metadata: z.record(z.string(), z.string()),
        }),
        output: z.object({ ok: z.boolean() }),
      },
      { warnOnFallback: false }
    );

    const logger = vi.fn();
    signature.reportZodConversionIssues(logger);

    expect(logger).toHaveBeenCalledWith(signature.getZodConversionIssues());
  });

  it('flags record structures as downgraded json', () => {
    const { signature, issues } = AxSignature.debugZodConversion(
      {
        input: z.object({
          metadata: z.record(z.string(), z.number()),
        }),
        output: z.object({ ok: z.boolean() }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'metadata',
        title: 'Metadata',
        type: { name: 'json' },
      },
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        path: ['input', 'metadata'],
        severity: 'downgraded',
      }),
    ]);
  });

  it('flags discriminated unions as downgraded json', () => {
    const { signature, issues } = AxSignature.debugZodConversion(
      {
        input: z.object({
          payload: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('text'), value: z.string() }),
            z.object({ kind: z.literal('count'), value: z.number() }),
          ]),
        }),
        output: z.object({ ok: z.boolean() }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'payload',
        title: 'Payload',
        type: { name: 'json' },
      },
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        path: ['input', 'payload'],
        severity: 'downgraded',
      }),
    ]);
  });

  it('unwraps branded schemas to their base types', () => {
    const signature = AxSignature.fromZod(
      {
        input: z.object({
          userId: z.string().brand<'userId'>(),
          tagIds: z.array(z.string().brand<'tagId'>()),
        }),
        output: z.object({ ok: z.boolean() }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'userId',
        title: 'User Id',
        type: { name: 'string' },
      },
      {
        name: 'tagIds',
        title: 'Tag Ids',
        type: { name: 'string', isArray: true },
      },
    ]);

    expect(signature.getZodConversionIssues()).toEqual([]);
  });

  it('treats deeply nested arrays as downgraded json', () => {
    const { signature, issues } = AxSignature.debugZodConversion(
      {
        input: z.object({
          matrix: z.array(z.array(z.number())),
        }),
        output: z.object({ ok: z.boolean() }),
      },
      { warnOnFallback: false }
    );

    expect(signature.getInputFields()).toEqual([
      {
        name: 'matrix',
        title: 'Matrix',
        type: { name: 'json', isArray: true },
      },
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        path: ['input', 'matrix'],
        severity: 'downgraded',
      }),
    ]);
  });
});
