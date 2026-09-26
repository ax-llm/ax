import { describe, expect, it, vi } from 'vitest';

import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import type { AxFunction } from '../types.js';
import { AxAIGoogleGemini } from './api.js';
import { AxAIGoogleGeminiModel } from './types.js';

// Replies with each canned Gemini response in turn and records request bodies.
// Extra requests get a non-retryable 400 so a looping program fails fast.
const createSequenceFetch = (responses: readonly unknown[], bodies: any[]) =>
  vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const response = responses[bodies.length - 1];
      return new Response(
        JSON.stringify(
          response ?? { error: { code: 400, message: 'unexpected request' } }
        ),
        {
          status: response ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

const functionCallResponse = (name: string, args: Record<string, unknown>) => ({
  candidates: [
    {
      content: { role: 'model', parts: [{ functionCall: { name, args } }] },
      finishReason: 'STOP',
    },
  ],
});

const createSig = () =>
  f()
    .input('question', f.string())
    .output(
      'user',
      f.object({
        name: f.string(),
        age: f.number(),
      })
    )
    .build();

const lookupUser: AxFunction = {
  name: 'lookupUser',
  description: 'Look up a user by name',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'User name' } },
    required: ['name'],
  },
  func: async ({ name }: { name: string }) => ({ name, age: 30 }),
};

const createAI = () =>
  new AxAIGoogleGemini({
    apiKey: 'test-key',
    config: { model: AxAIGoogleGeminiModel.Gemini38Flash },
  });

describe('Gemini structured output beside function declarations', () => {
  it('advertises native JSON Schema and the function rung', () => {
    const features = createAI().getFeatures(
      AxAIGoogleGeminiModel.Gemini38Flash
    );

    expect(features.structuredOutputModes).toEqual(['native', 'function']);
  });

  it('keeps JSON Schema response mode beside declared tools in auto', async () => {
    const llm = createAI();
    const bodies: any[] = [];
    llm.setOptions({
      fetch: createSequenceFetch(
        [
          functionCallResponse('lookupUser', { name: 'Alice' }),
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      text: JSON.stringify({
                        user: { name: 'Alice', age: 30 },
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          },
        ],
        bodies
      ),
    });
    const gen = ax(createSig(), { functions: [lookupUser] });

    const result = await gen.forward(
      llm,
      { question: 'How old is Alice?' },
      { stream: false }
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseJsonSchema).toBeDefined();
      expect(
        body.tools[0].function_declarations.map(
          (declaration: { name: string }) => declaration.name
        )
      ).toEqual(['lookupUser']);
    }
  });

  it("answers through __axOutput with structuredOutputMode 'function'", async () => {
    const llm = createAI();
    const bodies: any[] = [];
    llm.setOptions({
      fetch: createSequenceFetch(
        [
          functionCallResponse('lookupUser', { name: 'Alice' }),
          functionCallResponse('__axOutput', {
            user: { name: 'Alice', age: 30 },
          }),
        ],
        bodies
      ),
    });
    const gen = ax(createSig(), { functions: [lookupUser] });

    const result = await gen.forward(
      llm,
      { question: 'How old is Alice?' },
      { stream: false, structuredOutputMode: 'function' }
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.generationConfig.responseMimeType).toBe('text/plain');
      expect(body.generationConfig.responseJsonSchema).toBeUndefined();
      expect(
        body.tools[0].function_declarations.map(
          (declaration: { name: string }) => declaration.name
        )
      ).toEqual(['lookupUser', '__axOutput']);
    }
  });

  it('keeps JSON Schema response mode without functions', async () => {
    const llm = createAI();
    const bodies: any[] = [];
    llm.setOptions({
      fetch: createSequenceFetch(
        [
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    { text: JSON.stringify({ user: { name: 'Bo', age: 7 } }) },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          },
        ],
        bodies
      ),
    });

    const result = await ax(createSig()).forward(
      llm,
      { question: 'Who is Bo?' },
      { stream: false }
    );

    expect(result.user).toEqual({ name: 'Bo', age: 7 });
    expect(bodies[0].generationConfig.responseMimeType).toBe(
      'application/json'
    );
    expect(bodies[0].generationConfig.responseJsonSchema).toBeDefined();
    expect(bodies[0].tools).toBeUndefined();
  });
});
