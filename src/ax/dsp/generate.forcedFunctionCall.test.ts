import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse, AxFunction } from '../ai/types.js';
import { createFunctionConfig } from './functions.js';
import { ax } from './template.js';

const getWeather: AxFunction = {
  name: 'getWeather',
  description: 'Get the current weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
  func: async () => 'sunny, 21C',
};

const forceGetWeather: AxChatRequest['functionCall'] = {
  type: 'function',
  function: { name: 'getWeather' },
};

const textResponse = (content: string): AxChatResponse => ({
  results: [{ index: 0, content, finishReason: 'stop' }],
});

const callResponse = (name: string, params: unknown): AxChatResponse => ({
  results: [
    {
      index: 0,
      functionCalls: [
        {
          id: `call_${name}`,
          type: 'function',
          function: { name, params: JSON.stringify(params) },
        },
      ],
      finishReason: 'function_call',
    },
  ],
});

type RecordedRequest = {
  functionCall: AxChatRequest['functionCall'];
  functions: string[];
};

/**
 * A mock provider that honors a forced tool choice the way real providers do:
 * a named choice returns a call to that function, 'required' returns a call
 * to the first declared function, and forcing an undeclared function fails.
 * Without forcing it returns the final answer.
 */
const createForcingAwareAI = (
  argsByFunction: Record<string, unknown>,
  finalAnswer = 'Answer: It is sunny in Paris.'
) => {
  const requests: RecordedRequest[] = [];
  const ai = new AxMockAIService<string>({
    features: { functions: true, structuredOutputs: false },
    chatResponse: async (req) => {
      const functions = (req.functions ?? []).map((fn) => fn.name);
      requests.push({ functionCall: req.functionCall, functions });
      const forced =
        typeof req.functionCall === 'object'
          ? req.functionCall.function.name
          : req.functionCall === 'required'
            ? functions[0]
            : undefined;
      if (forced === undefined) {
        return textResponse(finalAnswer);
      }
      if (!functions.includes(forced)) {
        throw new Error(`Forced function '${forced}' is not declared`);
      }
      return callResponse(forced, argsByFunction[forced] ?? {});
    },
  });
  return { ai, requests };
};

describe('createFunctionConfig forced calls', () => {
  it('keeps a named forced call and the tools on the first step', () => {
    const config = createFunctionConfig([getWeather], forceGetWeather, true);
    expect(config.functionCall).toEqual(forceGetWeather);
    expect(config.functions.map((fn) => fn.name)).toEqual(['getWeather']);
  });

  it.each([
    ['a named function', forceGetWeather],
    ['required', 'required' as const],
  ])('drops %s and the tools after the first step', (_label, functionCall) => {
    expect(createFunctionConfig([getWeather], functionCall, false)).toEqual({
      functions: [],
      functionCall: undefined,
    });
  });

  it('keeps only the functions matching keepAfterFirstStep after the first step', () => {
    const output: AxFunction = { ...getWeather, name: 'emitOutput' };
    const config = createFunctionConfig(
      [getWeather, output],
      forceGetWeather,
      false,
      (fn) => fn.name === 'emitOutput'
    );
    expect(config.functionCall).toBeUndefined();
    expect(config.functions.map((fn) => fn.name)).toEqual(['emitOutput']);
  });

  it.each(['auto' as const, 'none' as const, undefined])(
    'keeps the %s choice and the tools after the first step',
    (functionCall) => {
      const config = createFunctionConfig([getWeather], functionCall, false);
      expect(config.functionCall).toBe(functionCall);
      expect(config.functions.map((fn) => fn.name)).toEqual(['getWeather']);
    }
  );
});

describe('AxGen forced function calls', () => {
  it('forces a named call on the first step only, then allows the final answer', async () => {
    const { ai, requests } = createForcingAwareAI({
      getWeather: { city: 'Paris' },
    });
    const gen = ax('city:string -> answer:string', {
      functions: [getWeather],
    });

    const result = await gen.forward(
      ai,
      { city: 'Paris' },
      { functionCall: forceGetWeather }
    );

    expect(result.answer).toBe('It is sunny in Paris.');
    expect(requests).toEqual([
      { functionCall: forceGetWeather, functions: ['getWeather'] },
      { functionCall: undefined, functions: [] },
    ]);
  });

  it('applies the same first-step-only forcing to a generator-level functionCall', async () => {
    const { ai, requests } = createForcingAwareAI({
      getWeather: { city: 'Paris' },
    });
    const gen = ax('city:string -> answer:string', {
      functions: [getWeather],
      functionCall: forceGetWeather,
    });

    const result = await gen.forward(ai, { city: 'Paris' });

    expect(result.answer).toBe('It is sunny in Paris.');
    expect(requests.map((req) => req.functionCall)).toEqual([
      forceGetWeather,
      undefined,
    ]);
  });

  it('forces a required call on the first step only', async () => {
    const { ai, requests } = createForcingAwareAI({
      getWeather: { city: 'Paris' },
    });
    const gen = ax('city:string -> answer:string', {
      functions: [getWeather],
    });

    const result = await gen.forward(
      ai,
      { city: 'Paris' },
      { functionCall: 'required' }
    );

    expect(result.answer).toBe('It is sunny in Paris.');
    expect(requests).toEqual([
      { functionCall: 'required', functions: ['getWeather'] },
      { functionCall: undefined, functions: [] },
    ]);
  });

  it('ends after the forced call when it names a stop function', async () => {
    const { ai, requests } = createForcingAwareAI({
      getWeather: { city: 'Paris' },
    });
    let calls = 0;
    const gen = ax('city:string -> answer:string', {
      functions: [
        {
          ...getWeather,
          func: async () => {
            calls++;
            return 'sunny, 21C';
          },
        },
      ],
    });

    await gen.forward(
      ai,
      { city: 'Paris' },
      { functionCall: forceGetWeather, stopFunction: 'getWeather' }
    );

    expect(calls).toBe(1);
    expect(requests).toHaveLength(1);
  });

  describe('with the structured-output function fallback', () => {
    const report = { city: 'Paris', conditions: 'sunny' };
    const outputForced: AxChatRequest['functionCall'] = {
      type: 'function',
      function: { name: '__axOutput' },
    };

    it.each([
      ['a named function', forceGetWeather],
      ['required', 'required' as const],
    ])(
      'keeps __axOutput declared and forced after the caller forces %s',
      async (_label, functionCall) => {
        const { ai, requests } = createForcingAwareAI({
          getWeather: { city: 'Paris' },
          __axOutput: { report },
        });
        const gen = ax(
          'city:string -> report:object{city:string, conditions:string}',
          { functions: [getWeather], structuredOutputMode: 'function' }
        );

        const result = await gen.forward(
          ai,
          { city: 'Paris' },
          { functionCall }
        );

        expect(result.report).toEqual(report);
        expect(requests).toEqual([
          { functionCall, functions: ['getWeather', '__axOutput'] },
          { functionCall: outputForced, functions: ['__axOutput'] },
        ]);
      }
    );
  });
});
