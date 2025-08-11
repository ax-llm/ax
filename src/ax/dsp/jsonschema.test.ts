import { describe, expect, it } from 'vitest';

import type { AxFunction } from '../ai/types.js';
import { parseFunctions } from './functions.js';
import { validateJSONSchema } from './jsonschema.js';

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
      expect(message).toContain('JSON Schema validation failed:');
      expect(message).toContain(
        'Array schema is missing an "items" definition (required by JSON Schema and all LLM providers for function tools)'
      );
      expect(message).toContain('Fix: Add an "items" schema');
      expect(message).toContain('Example:');
      expect(message).toContain('items: { type: "string" }');
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
      expect(message).toContain('JSON Schema validation failed:');
      expect(message).toContain('Arrays must include an "items" schema');
    }
  });
});
