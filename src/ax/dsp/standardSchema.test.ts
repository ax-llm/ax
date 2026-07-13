import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from './errors.js';
import { f, fn } from './sig.js';
import {
  AX_VENDOR,
  isExternalStandardSchema,
  isStandardObjectSchema,
  isStandardSchema,
  standardSchemaToAxField,
  standardSchemaToAxFields,
  standardSchemaToJsonSchema,
  validateWithStandardSchema,
} from './standardSchema.js';

describe('Standard Schema detection helpers', () => {
  it('recognises zod schemas as Standard Schema values', () => {
    expect(isStandardSchema(z.object({ a: z.string() }))).toBe(true);
    expect(isStandardSchema({})).toBe(false);
    expect(isStandardSchema(null)).toBe(false);
  });

  it('distinguishes external vendors from ax native fields', () => {
    expect(isExternalStandardSchema(z.string())).toBe(true);
    expect(isExternalStandardSchema(f.string())).toBe(false);
    expect(f.string()['~standard'].vendor).toBe(AX_VENDOR);
  });

  it('isStandardObjectSchema returns true only for z.object at top level', () => {
    expect(isStandardObjectSchema(z.object({ a: z.string() }))).toBe(true);
    expect(isStandardObjectSchema(z.string())).toBe(false);
    expect(isStandardObjectSchema(z.array(z.string()))).toBe(false);
  });
});

describe('standardSchemaToAxFields', () => {
  it('decomposes a zod object in declaration order', () => {
    const schema = z.object({
      topic: z.string().describe('Topic keyword'),
      limit: z.number().int().positive().optional(),
    });
    const fields = standardSchemaToAxFields(schema);
    expect(fields.map((f) => f.name)).toEqual(['topic', 'limit']);
    expect(fields[0]?.type?.name).toBe('string');
    expect(fields[0]?.description).toBe('Topic keyword');
    expect(fields[1]?.type?.name).toBe('number');
    expect(fields[1]?.isOptional).toBe(true);
  });

  it('carries string validation constraints (min/max/format/pattern)', () => {
    const schema = z.object({
      email: z.string().email(),
      handle: z.string().min(2).max(32),
      slug: z.string().regex(/^[a-z-]+$/),
    });
    const [emailField, handleField, slugField] =
      standardSchemaToAxFields(schema);
    expect(emailField?.type?.format).toBe('email');
    expect(handleField?.type?.minLength).toBe(2);
    expect(handleField?.type?.maxLength).toBe(32);
    expect(slugField?.type?.pattern).toBe('^[a-z-]+$');
  });

  it('carries number min/max', () => {
    const schema = z.object({ n: z.number().min(1).max(10) });
    const [n] = standardSchemaToAxFields(schema);
    expect(n?.type?.minimum).toBe(1);
    expect(n?.type?.maximum).toBe(10);
  });

  it('treats enums as class options', () => {
    const schema = z.object({ tone: z.enum(['formal', 'casual']) });
    const [tone] = standardSchemaToAxFields(schema);
    expect(tone?.type?.name).toBe('class');
    expect(tone?.type?.options).toEqual(['formal', 'casual']);
  });

  it('handles arrays by lifting isArray', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const [tags] = standardSchemaToAxFields(schema);
    expect(tags?.type?.name).toBe('string');
    expect(tags?.type?.isArray).toBe(true);
  });

  it('applies companion field options (cache / internal)', () => {
    const schema = z.object({
      context: z.string(),
      reasoning: z.string(),
      answer: z.string(),
    });
    const fields = standardSchemaToAxFields(schema, {
      fields: {
        context: { cache: true },
        reasoning: { internal: true },
      },
    });
    expect(fields.find((f) => f.name === 'context')?.isCached).toBe(true);
    expect(fields.find((f) => f.name === 'reasoning')?.isInternal).toBe(true);
    expect(fields.find((f) => f.name === 'answer')?.isCached).toBeUndefined();
    expect(fields.find((f) => f.name === 'answer')?.isInternal).toBeUndefined();
  });

  it('throws on non-object top-level schema with actionable guidance', () => {
    expect(() =>
      standardSchemaToAxFields(z.string() as unknown as z.ZodObject<any>)
    ).toThrow(/object schema/i);
  });
});

describe('standardSchemaToAxField (per-field)', () => {
  it('converts a single zod schema to an AxField', () => {
    const field = standardSchemaToAxField(
      'age',
      z.number().min(0).max(120).describe('User age')
    );
    expect(field.name).toBe('age');
    expect(field.type?.name).toBe('number');
    expect(field.type?.minimum).toBe(0);
    expect(field.type?.maximum).toBe(120);
    expect(field.description).toBe('User age');
  });

  it('applies per-field options (cache / internal)', () => {
    const cached = standardSchemaToAxField('ctx', z.string(), { cache: true });
    expect(cached.isCached).toBe(true);
    const internal = standardSchemaToAxField('scratch', z.string(), {
      internal: true,
    });
    expect(internal.isInternal).toBe(true);
  });
});

describe('standardSchemaToJsonSchema', () => {
  it('produces JSON Schema for a zod object', () => {
    const schema = z.object({
      topic: z.string().describe('Topic keyword'),
      limit: z.number().optional(),
    });
    const json = standardSchemaToJsonSchema(schema, 'Args');
    expect(json.type).toBe('object');
    expect(Object.keys(json.properties ?? {})).toEqual(['topic', 'limit']);
    expect(json.required).toContain('topic');
    expect(json.required ?? []).not.toContain('limit');
  });

  it('rejects unsupported vendors with actionable error', () => {
    const fake = {
      '~standard': {
        version: 1,
        vendor: 'mystery',
        validate: () => ({ value: null }),
      },
    } as any;
    expect(() => standardSchemaToJsonSchema(fake)).toThrow(/Unsupported/);
  });
});

describe('validateWithStandardSchema', () => {
  it('throws ValidationError with path info on failure', () => {
    const schema = z.object({ name: z.string().min(3) });
    expect(() =>
      validateWithStandardSchema(schema, 'args', { name: 'hi' })
    ).toThrow(ValidationError);
  });

  it('accepts valid input silently', () => {
    const schema = z.object({ name: z.string() });
    expect(() =>
      validateWithStandardSchema(schema, 'args', { name: 'ok' })
    ).not.toThrow();
  });
});

describe('AxSignatureBuilder.input / .output — unified overloads', () => {
  it('fluent per-field still works (existing path, unchanged)', () => {
    const sig = f()
      .input('topic', f.string('Topic keyword'))
      .output('answer', f.string())
      .build();
    expect(sig.getInputFields().map((f) => f.name)).toEqual(['topic']);
    expect(sig.getInputFields()[0]?.description).toBe('Topic keyword');
  });

  it('accepts a whole-object zod schema for input + output', () => {
    const sig = f()
      .description('Answer from context')
      .input(
        z.object({
          context: z.string().describe('context doc'),
          question: z.string(),
        })
      )
      .output(z.object({ answer: z.string() }))
      .build();
    expect(sig.getInputFields().map((f) => f.name)).toEqual([
      'context',
      'question',
    ]);
    expect(sig.getOutputFields().map((f) => f.name)).toEqual(['answer']);
  });

  it('accepts per-field zod with companion options', () => {
    const sig = f()
      .input('context', z.string().describe('Retrieved doc'), { cache: true })
      .input('question', z.string())
      .output('reasoning', z.string(), { internal: true })
      .output('answer', z.string())
      .build();
    const ins = sig.getInputFields();
    const outs = sig.getOutputFields();
    expect(ins.find((f) => f.name === 'context')?.isCached).toBe(true);
    expect(ins.find((f) => f.name === 'context')?.description).toBe(
      'Retrieved doc'
    );
    expect(ins.find((f) => f.name === 'question')?.isCached).toBeUndefined();
    expect(outs.find((f) => f.name === 'reasoning')?.isInternal).toBe(true);
    expect(outs.find((f) => f.name === 'answer')?.isInternal).toBeUndefined();
  });

  it('whole-object form takes companion options map', () => {
    const sig = f()
      .input(
        z.object({
          context: z.string(),
          question: z.string(),
        }),
        { fields: { context: { cache: true } } }
      )
      .output(z.object({ answer: z.string() }))
      .build();
    const ins = sig.getInputFields();
    expect(ins.find((f) => f.name === 'context')?.isCached).toBe(true);
    expect(ins.find((f) => f.name === 'question')?.isCached).toBeUndefined();
  });

  it('produces the same isCached shape as f.string().cache()', () => {
    const nativeSig = f()
      .input('context', f.string('Context').cache())
      .output('answer', f.string())
      .build();

    const zodSig = f()
      .input('context', z.string().describe('Context'), { cache: true })
      .output('answer', f.string())
      .build();

    const nativeCtx = nativeSig
      .getInputFields()
      .find((f) => f.name === 'context');
    const zodCtx = zodSig.getInputFields().find((f) => f.name === 'context');

    expect(nativeCtx?.isCached).toBe(true);
    expect(zodCtx?.isCached).toBe(true);
    expect(nativeCtx?.type?.name).toBe(zodCtx?.type?.name);
    expect(nativeCtx?.description).toBe(zodCtx?.description);
  });

  it('throws a helpful error when a non-object non-schema first arg is passed', () => {
    expect(() => (f() as any).input(42)).toThrow(/field name/i);
  });
});

describe('AxFunctionBuilder — unified arg/returns overloads', () => {
  it('fluent per-arg still works', () => {
    const tool = fn('lookup')
      .description('Look up a topic')
      .arg('topic', f.string('Topic keyword'))
      .returns(f.string())
      .handler(async ({ topic }) => topic)
      .build();
    expect(tool.name).toBe('lookup');
    expect(
      Object.keys((tool.parameters?.properties ?? {}) as Record<string, any>)
    ).toEqual(['topic']);
  });

  it('whole-object zod input', () => {
    const tool = fn('findSnippets')
      .description('Find handbook snippets by topic')
      .arg(
        z.object({
          topic: z.string().describe('Topic keyword'),
          limit: z.number().int().positive().optional(),
        })
      )
      .handler(async ({ topic }) => [topic])
      .build();
    expect(
      Object.keys((tool.parameters?.properties ?? {}) as Record<string, any>)
    ).toEqual(['topic', 'limit']);
    expect(tool.parameters?.required).toContain('topic');
  });

  it('per-arg zod with companion options', () => {
    const tool = fn('cachedLookup')
      .description('Cached lookup by topic')
      .arg('topic', z.string(), { cache: true })
      .returns(f.string())
      .handler(async ({ topic }) => topic)
      .build();
    expect(tool.name).toBe('cachedLookup');
  });

  it('returns() accepts a zod object and decomposes into return fields', () => {
    const tool = fn('analyze')
      .description('Analyze sentiment and produce score + label')
      .arg(z.object({ text: z.string() }))
      .returns(z.object({ score: z.number(), label: z.string() }))
      .handler(async ({ text: _text }) => ({ score: 0, label: 'x' }))
      .build();
    expect(tool.name).toBe('analyze');
  });

  it('returnsField accepts a single zod field', () => {
    const tool = fn('summarize')
      .description('Summarize the input text')
      .arg('text', f.string())
      .returnsField('summary', z.string(), { internal: false })
      .handler(async () => ({ summary: 'x' }))
      .build();
    expect(tool.name).toBe('summarize');
  });
});
