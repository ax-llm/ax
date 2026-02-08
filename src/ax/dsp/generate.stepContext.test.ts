import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { AxGen } from './generate.js';
import type { AxStepContext, AxStepHooks } from './types.js';

/**
 * Helper: create a non-streaming AxChatResponse with content.
 */
function textResponse(content: string): AxChatResponse {
  return {
    results: [{ index: 0, content, finishReason: 'stop' as const }],
    modelUsage: {
      ai: 'mock',
      model: 'mock-model',
      tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
  };
}

/**
 * Helper: create a non-streaming AxChatResponse with a function call.
 */
function functionCallResponse(
  funcName: string,
  params: Record<string, unknown> = {}
): AxChatResponse {
  return {
    results: [
      {
        index: 0,
        functionCalls: [
          {
            id: '1',
            type: 'function' as const,
            function: { name: funcName, params: JSON.stringify(params) },
          },
        ],
        finishReason: 'stop' as const,
      },
    ],
    modelUsage: {
      ai: 'mock',
      model: 'mock-model',
      tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
  };
}

describe('AxGen step context integration', () => {
  describe('step hooks — beforeStep', () => {
    it('is called with correct stepIndex and isFirstStep values', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return functionCallResponse('doWork');
          }
          return textResponse('Answer: done');
        },
      });

      const stepRecords: { stepIndex: number; isFirstStep: boolean }[] = [];
      const stepHooks: AxStepHooks = {
        beforeStep: (ctx) => {
          stepRecords.push({
            stepIndex: ctx.stepIndex,
            isFirstStep: ctx.isFirstStep,
          });
        },
      };

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'done',
          },
        ],
      });

      await gen.forward(ai as any, { question: 'test' }, { stepHooks });

      expect(stepRecords.length).toBe(2);
      expect(stepRecords[0]).toEqual({ stepIndex: 0, isFirstStep: true });
      expect(stepRecords[1]).toEqual({ stepIndex: 1, isFirstStep: false });
    });
  });

  describe('step hooks — beforeStep can change model', () => {
    it('applies model mutation to the next AI chat call', async () => {
      let callCount = 0;
      const capturedModels: (string | undefined)[] = [];

      const ai = new AxMockAIService({
        features: { functions: true },
      });

      // Override chat to capture model from request
      ai.chat = async (req: Readonly<AxChatRequest<unknown>>) => {
        callCount++;
        capturedModels.push(req.model as string | undefined);
        if (callCount === 1) {
          return functionCallResponse('doWork');
        }
        return textResponse('Answer: done');
      };

      const stepHooks: AxStepHooks = {
        beforeStep: (ctx) => {
          if (ctx.stepIndex === 1) {
            ctx.setModel('upgraded-model');
          }
        },
      };

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'done',
          },
        ],
      });

      await gen.forward(ai as any, { question: 'test' }, { stepHooks });

      expect(capturedModels.length).toBe(2);
      // Step 0: no model mutation
      expect(capturedModels[0]).toBeUndefined();
      // Step 1: model should have been changed
      expect(capturedModels[1]).toBe('upgraded-model');
    });
  });

  describe('step hooks — afterStep', () => {
    it('fires after each step with correct stepIndex', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return functionCallResponse('doWork');
          }
          return textResponse('Answer: done');
        },
      });

      const afterStepIndices: number[] = [];
      const stepHooks: AxStepHooks = {
        afterStep: (ctx) => {
          afterStepIndices.push(ctx.stepIndex);
        },
      };

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'done',
          },
        ],
      });

      await gen.forward(ai as any, { question: 'test' }, { stepHooks });

      expect(afterStepIndices).toEqual([0, 1]);
    });
  });

  describe('step hooks — afterFunctionExecution', () => {
    it('fires when functions were executed', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return functionCallResponse('doWork');
          }
          return textResponse('Answer: done');
        },
      });

      const afterFuncSteps: number[] = [];
      const stepHooks: AxStepHooks = {
        afterFunctionExecution: (ctx) => {
          afterFuncSteps.push(ctx.stepIndex);
        },
      };

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'done',
          },
        ],
      });

      await gen.forward(ai as any, { question: 'test' }, { stepHooks });

      // afterFunctionExecution fires on step 0 (where doWork was called)
      // but NOT on step 1 (where only text was returned)
      expect(afterFuncSteps).toEqual([0]);
    });

    it('does NOT fire when no functions were executed', async () => {
      const ai = new AxMockAIService({
        features: { functions: false },
        chatResponse: textResponse('Answer: done'),
      });

      const afterFuncSteps: number[] = [];
      const stepHooks: AxStepHooks = {
        afterFunctionExecution: (ctx) => {
          afterFuncSteps.push(ctx.stepIndex);
        },
      };

      const gen = new AxGen('question:string -> answer:string');
      await gen.forward(ai as any, { question: 'test' }, { stepHooks });

      expect(afterFuncSteps).toEqual([]);
    });
  });

  describe('function receives step context in extra.step', () => {
    it('provides step context to user functions', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return functionCallResponse('myFunc');
          }
          return textResponse('Answer: done');
        },
      });

      let receivedStepIndex: number | undefined;
      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'myFunc',
            description: 'test func',
            parameters: {
              type: 'object',
              properties: {},
            },
            func: (_args: unknown, extra?: { step?: AxStepContext }) => {
              receivedStepIndex = extra?.step?.stepIndex;
              extra?.step?.setThinkingBudget('high');
              return 'ok';
            },
          },
        ],
      });

      await gen.forward(ai as any, { question: 'test' });

      expect(receivedStepIndex).toBe(0);
    });
  });

  describe('self-tuning — adjustGeneration function is injected', () => {
    it('adds adjustGeneration to the functions list', async () => {
      let capturedFunctions: string[] = [];

      const ai = new AxMockAIService({
        features: { functions: true },
        models: [{ key: 'fast', model: 'gpt-4o-mini', description: 'Quick' }],
      });

      ai.chat = async (req: Readonly<AxChatRequest<unknown>>) => {
        capturedFunctions = req.functions?.map((f) => f.name) ?? [];
        return textResponse('Answer: done');
      };

      const gen = new AxGen('question:string -> answer:string');
      await gen.forward(ai as any, { question: 'test' }, { selfTuning: true });

      expect(capturedFunctions).toContain('adjustGeneration');
    });
  });

  describe('self-tuning — LLM calls adjustGeneration to change model', () => {
    it('applies model change from adjustGeneration call in next step', async () => {
      let callCount = 0;
      const capturedModels: (string | undefined)[] = [];

      const ai = new AxMockAIService({
        features: { functions: true },
        models: [
          { key: 'fast', model: 'gpt-4o-mini', description: 'Quick' },
          { key: 'smart', model: 'claude-sonnet', description: 'Balanced' },
        ],
      });

      ai.chat = async (req: Readonly<AxChatRequest<unknown>>) => {
        callCount++;
        capturedModels.push(req.model as string | undefined);
        if (callCount === 1) {
          // LLM calls adjustGeneration + doWork
          return {
            results: [
              {
                index: 0,
                functionCalls: [
                  {
                    id: '1',
                    type: 'function' as const,
                    function: {
                      name: 'adjustGeneration',
                      params: JSON.stringify({ model: 'smart' }),
                    },
                  },
                  {
                    id: '2',
                    type: 'function' as const,
                    function: {
                      name: 'doWork',
                      params: '{}',
                    },
                  },
                ],
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'mock',
              model: 'mock-model',
              tokens: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            },
          };
        }
        return textResponse('Answer: result');
      };

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'done',
          },
        ],
      });

      const result = await gen.forward(
        ai as any,
        { question: 'test' },
        { selfTuning: true }
      );

      expect(result.answer).toBe('result');
      expect(capturedModels.length).toBe(2);
      // Step 1: model should have been changed to 'smart'
      expect(capturedModels[1]).toBe('smart');
    });
  });

  describe('stop() terminates the loop', () => {
    it('stops generation when a function calls stop()', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          // Always return function call — without stop(), this would loop forever
          return functionCallResponse('stopper');
        },
      });

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'stopper',
            description: 'stops execution',
            parameters: {
              type: 'object',
              properties: {},
            },
            func: (_args: unknown, extra?: { step?: AxStepContext }) => {
              extra?.step?.stop({ answer: 'early exit' });
              return 'stopping';
            },
          },
        ],
      });

      const result = await gen.forward(ai as any, { question: 'test' });

      // Loop should have terminated after 1 step
      expect(callCount).toBe(1);
      // The result will contain the stop values merged in if the loop supports it,
      // or the function result. The key thing is it terminated.
      expect(result).toBeDefined();
    });
  });

  describe('usage tracking accumulates across steps', () => {
    it('reports accumulated usage in afterStep hook', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return functionCallResponse('doWork');
          }
          return textResponse('Answer: done');
        },
      });

      const usageRecords: { promptTokens: number; totalTokens: number }[] = [];
      const stepHooks: AxStepHooks = {
        afterStep: (ctx) => {
          usageRecords.push({
            promptTokens: ctx.usage.promptTokens,
            totalTokens: ctx.usage.totalTokens,
          });
        },
      };

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'done',
          },
        ],
      });

      await gen.forward(ai as any, { question: 'test' }, { stepHooks });

      expect(usageRecords.length).toBe(2);
      // After step 0, some usage accumulated
      expect(usageRecords[0]!.promptTokens).toBeGreaterThan(0);
      // After step 1, usage should have increased further
      expect(usageRecords[1]!.promptTokens).toBeGreaterThanOrEqual(
        usageRecords[0]!.promptTokens
      );
      expect(usageRecords[1]!.totalTokens).toBeGreaterThan(
        usageRecords[0]!.totalTokens
      );
    });
  });

  describe('backwards compatibility — no new options', () => {
    it('works correctly without stepHooks or selfTuning', async () => {
      const ai = new AxMockAIService({
        features: { functions: false },
        chatResponse: textResponse('Answer: works fine'),
      });

      const gen = new AxGen('question:string -> answer:string');
      const result = await gen.forward(ai as any, { question: 'test' });

      expect(result.answer).toBe('works fine');
    });

    it('works with function calling without new options', async () => {
      let callCount = 0;
      const ai = new AxMockAIService({
        features: { functions: true },
        chatResponse: async () => {
          callCount++;
          if (callCount === 1) {
            return functionCallResponse('doWork');
          }
          return textResponse('Answer: done');
        },
      });

      const gen = new AxGen('question:string -> answer:string', {
        functions: [
          {
            name: 'doWork',
            description: 'do work',
            func: () => 'result',
          },
        ],
      });

      const result = await gen.forward(ai as any, { question: 'test' });
      expect(result.answer).toBe('done');
    });
  });
});
