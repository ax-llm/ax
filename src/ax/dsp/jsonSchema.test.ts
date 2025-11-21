import { describe, expect, it } from 'vitest';

import type { AxFunction } from '../ai/types.js';
import { parseFunctions } from './functions.js';
import { validateJSONSchema } from './jsonSchema.js';
import { f } from './sig.js';

describe('validateJSONSchema - arrays must define items', () => {
  it('throws with a clear message when an array is missing items', () => {
    const schema = {
      type: 'object',
      properties: {
        potentialSteps: {
          type: 'array',
          description:
            'a set of potential steps to be executed by the execution agent including names of relevant people.',
        },
      },
      required: ['potentialSteps'],
    } as const;

    try {
      validateJSONSchema(schema);
      throw new Error('Expected validateJSONSchema to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain(
        'Array schema is missing an "items" definition (required by JSON Schema and all LLM providers for function tools)'
      );
    }
  });
});

describe('parseFunctions - wraps schema errors with function context', () => {
  it("prepends function name and includes tip for arrays missing 'items'", () => {
    const badFn: AxFunction = {
      name: 'searchStepExamplesAndUserMemories',
      description:
        'Search for user/assistant profiles, current date/time, memories about people mentioned, and examples of communication with the execution agent to help with craft steps.',
      parameters: {
        type: 'object',
        properties: {
          potentialSteps: {
            type: 'array',
            description:
              'a set of potential steps to be executed by the execution agent including names of relevant people.',
          },
        },
        required: ['potentialSteps'],
      },
      func: async () => null,
    };

    try {
      parseFunctions([badFn]);
      throw new Error('Expected parseFunctions to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain(
        "Function 'searchStepExamplesAndUserMemories' parameters schema is invalid."
      );
      expect(message).toContain(
        'Array schema is missing an "items" definition'
      );
      expect(message).toContain('Arrays must include an "items" schema');
    }
  });
});

describe('jsonSchema - validation constraints', () => {
  it('should include string length constraints in schema', () => {
    const sig = f()
      .input('query', f.string())
      .output('username', f.string().min(3).max(20))
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.username?.minLength).toBe(3);
    expect(schema.properties?.username?.maxLength).toBe(20);
  });

  it('should include number range constraints in schema', () => {
    const sig = f()
      .input('query', f.string())
      .output('age', f.number().min(18).max(120))
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.age?.minimum).toBe(18);
    expect(schema.properties?.age?.maximum).toBe(120);
  });

  it('should include email format in schema', () => {
    const sig = f()
      .input('query', f.string())
      .output('email', f.string().email())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.email?.format).toBe('email');
  });

  it('should include url format in schema', () => {
    const sig = f()
      .input('query', f.string())
      .output('website', f.string().url())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.website?.format).toBe('uri');
  });

  it('should include regex pattern in schema', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'code',
        f
          .string()
          .regex(
            '^[A-Z0-9]+$',
            'Must contain only uppercase letters and numbers'
          )
      )
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.code?.pattern).toBe('^[A-Z0-9]+$');
  });

  it('should include multiple constraints in schema', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'password',
        f
          .string()
          .min(8)
          .max(128)
          .regex(
            '^(?=.*[A-Za-z])(?=.*\\d)',
            'Must contain at least one letter and one digit'
          )
      )
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.password?.minLength).toBe(8);
    expect(schema.properties?.password?.maxLength).toBe(128);
    expect(schema.properties?.password?.pattern).toBe(
      '^(?=.*[A-Za-z])(?=.*\\d)'
    );
  });

  it('should add default format hints for special types', () => {
    // Test url format in input field (url types only allowed in input)
    const sigUrl = f()
      .input('link', f.url())
      .output('resultText', f.string())
      .build();
    const schemaUrl = sigUrl.toJSONSchema();
    expect(schemaUrl.properties?.link?.format).toBe('uri');

    // Test date/datetime formats in output fields
    const sigDate = f()
      .input('query', f.string())
      .output('birthDate', f.date())
      .build();
    const schemaDate = sigDate.toJSONSchema();
    expect(schemaDate.properties?.birthDate?.format).toBe('date');

    const sigDateTime = f()
      .input('query', f.string())
      .output('timestamp', f.datetime())
      .build();
    const schemaDateTime = sigDateTime.toJSONSchema();
    expect(schemaDateTime.properties?.timestamp?.format).toBe('date-time');
  });

  it('should include constraints in nested objects', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'user',
        f.object({
          username: f.string().min(3).max(20),
          email: f.string().email(),
          age: f.number().min(18).max(120),
        })
      )
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.user?.properties?.username?.minLength).toBe(3);
    expect(schema.properties?.user?.properties?.username?.maxLength).toBe(20);
    expect(schema.properties?.user?.properties?.email?.format).toBe('email');
    expect(schema.properties?.user?.properties?.age?.minimum).toBe(18);
    expect(schema.properties?.user?.properties?.age?.maximum).toBe(120);
  });

  it('should include constraints in arrays', () => {
    const sig = f()
      .input('query', f.string())
      .output('tags', f.string().min(2).max(30).array())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.tags?.type).toBe('array');
    expect(schema.properties?.tags?.items?.minLength).toBe(2);
    expect(schema.properties?.tags?.items?.maxLength).toBe(30);
  });

  it('should include constraints in nested array objects', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'reviews',
        f
          .object({
            rating: f.number().min(1).max(5),
            comment: f.string().min(10).max(1000),
          })
          .array()
      )
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.reviews?.type).toBe('array');
    expect(schema.properties?.reviews?.items?.properties?.rating?.minimum).toBe(
      1
    );
    expect(schema.properties?.reviews?.items?.properties?.rating?.maximum).toBe(
      5
    );
    expect(
      schema.properties?.reviews?.items?.properties?.comment?.minLength
    ).toBe(10);
    expect(
      schema.properties?.reviews?.items?.properties?.comment?.maxLength
    ).toBe(1000);
  });
});

describe('jsonSchema - description enhancement with validation', () => {
  it('should enhance description with email format validation info', () => {
    const sig = f()
      .input('query', f.string())
      .output('email', f.string().email())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.email?.description).toContain(
      'Must be a valid email address format'
    );
  });

  it('should enhance description with URL format validation info', () => {
    const sig = f()
      .input('query', f.string())
      .output('website', f.string().url())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.website?.description).toContain(
      'Must be a valid URL format'
    );
  });

  it('should enhance description with string length constraints', () => {
    const sig = f()
      .input('query', f.string())
      .output('username', f.string().min(3).max(20))
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.username?.description).toContain(
      'Minimum length: 3 characters'
    );
    expect(schema.properties?.username?.description).toContain(
      'maximum length: 20 characters'
    );
  });

  it('should enhance description with number range constraints', () => {
    const sig = f()
      .input('query', f.string())
      .output('age', f.number().min(18).max(120))
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.age?.description).toContain('Minimum value: 18');
    expect(schema.properties?.age?.description).toContain('maximum value: 120');
  });

  it('should use custom pattern description when provided', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'username',
        f
          .string()
          .regex(
            '^[a-z0-9_]+$',
            'Must contain only lowercase letters, numbers, and underscores'
          )
      )
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.username?.description).toContain(
      'Must contain only lowercase letters, numbers, and underscores'
    );
  });

  it('should auto-generate pattern description for common patterns', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'language',
        f.string().regex('^[a-z]{2}$', 'Must be a 2-letter language code')
      )
      .build();

    const schema = sig.toJSONSchema();

    // Should use custom description
    expect(schema.properties?.language?.description).toContain(
      'Must be a 2-letter language code'
    );
  });

  it('should combine base description with validation constraints', () => {
    const sig = f()
      .input('query', f.string())
      .output('email', f.string('User email address').email())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.email?.description).toContain(
      'User email address'
    );
    expect(schema.properties?.email?.description).toContain(
      'Must be a valid email address format'
    );
  });

  it('should enhance descriptions in nested objects', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'user',
        f.object({
          email: f.string().email(),
          age: f.number().min(18).max(120),
        })
      )
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.user?.properties?.email?.description).toContain(
      'Must be a valid email address format'
    );
    expect(schema.properties?.user?.properties?.age?.description).toContain(
      'Minimum value: 18'
    );
  });

  it('should enhance descriptions in array items', () => {
    const sig = f()
      .input('query', f.string())
      .output('emails', f.string().email().array())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.emails?.items?.description).toContain(
      'Must be a valid email address format'
    );
  });

  it('should handle multiple validation constraints in description', () => {
    const sig = f()
      .input('query', f.string())
      .output(
        'password',
        f
          .string('User password')
          .min(8)
          .max(128)
          .regex(
            '^(?=.*[A-Za-z])(?=.*\\d)',
            'Must contain at least one letter and one digit'
          )
      )
      .build();

    const schema = sig.toJSONSchema();

    const desc = schema.properties?.password?.description;
    expect(desc).toContain('User password');
    expect(desc).toContain('Minimum length: 8 characters');
    expect(desc).toContain('maximum length: 128 characters');
    expect(desc).toContain('Must contain at least one letter and one digit');
  });

  it('should auto-generate description from validation rules when no description provided', () => {
    const sig = f()
      .input('query', f.string())
      .output('email', f.string().email())
      .build();

    const schema = sig.toJSONSchema();

    // Should have description even without base description
    expect(schema.properties?.email?.description).toBe(
      'Must be a valid email address format'
    );
  });

  it('should add date format hints', () => {
    const sig = f()
      .input('query', f.string())
      .output('birthDate', f.date())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.birthDate?.description).toContain(
      'Format: YYYY-MM-DD'
    );
  });

  it('should add datetime format hints', () => {
    const sig = f()
      .input('query', f.string())
      .output('createdAt', f.datetime())
      .build();

    const schema = sig.toJSONSchema();

    expect(schema.properties?.createdAt?.description).toContain(
      'Format: ISO 8601 date-time'
    );
  });
});
