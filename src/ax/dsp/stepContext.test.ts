import { describe, expect, it } from 'vitest';

import { AxStepContextImpl } from './stepContext.js';

describe('AxStepContextImpl', () => {
  describe('initial state', () => {
    it('has stepIndex 0, isFirstStep true, and correct maxSteps', () => {
      const ctx = new AxStepContextImpl(10);
      expect(ctx.stepIndex).toBe(0);
      expect(ctx.isFirstStep).toBe(true);
      expect(ctx.maxSteps).toBe(10);
    });

    it('has empty functionsExecuted and lastFunctionCalls', () => {
      const ctx = new AxStepContextImpl(5);
      expect(ctx.functionsExecuted.size).toBe(0);
      expect(ctx.lastFunctionCalls).toEqual([]);
    });

    it('has all-zero usage', () => {
      const ctx = new AxStepContextImpl(5);
      expect(ctx.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it('has empty state Map', () => {
      const ctx = new AxStepContextImpl(5);
      expect(ctx.state.size).toBe(0);
    });
  });

  describe('_beginStep resets per-step state', () => {
    it('updates stepIndex and isFirstStep', () => {
      const ctx = new AxStepContextImpl(10);
      ctx._beginStep(1);
      expect(ctx.stepIndex).toBe(1);
      expect(ctx.isFirstStep).toBe(false);
    });

    it('resets functionsExecuted and lastFunctionCalls', () => {
      const ctx = new AxStepContextImpl(10);
      ctx._recordFunctionCall('myFunc', { a: 1 }, 'ok');
      expect(ctx.functionsExecuted.size).toBe(1);
      expect(ctx.lastFunctionCalls.length).toBe(1);

      ctx._beginStep(1);
      expect(ctx.functionsExecuted.size).toBe(0);
      expect(ctx.lastFunctionCalls).toEqual([]);
    });

    it('preserves state Map across steps', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.state.set('counter', 42);

      ctx._beginStep(1);
      expect(ctx.state.get('counter')).toBe(42);
    });

    it('preserves accumulated usage across steps', () => {
      const ctx = new AxStepContextImpl(10);
      ctx._addUsage(10, 5, 15);

      ctx._beginStep(1);
      expect(ctx.usage.promptTokens).toBe(10);
      expect(ctx.usage.completionTokens).toBe(5);
      expect(ctx.usage.totalTokens).toBe(15);
    });
  });

  describe('_recordFunctionCall', () => {
    it('adds to functionsExecuted (lowercased) and lastFunctionCalls', () => {
      const ctx = new AxStepContextImpl(10);
      ctx._recordFunctionCall('SearchWeb', { query: 'test' }, 'results');

      expect(ctx.functionsExecuted.has('searchweb')).toBe(true);
      expect(ctx.lastFunctionCalls).toEqual([
        { name: 'SearchWeb', args: { query: 'test' }, result: 'results' },
      ]);
    });

    it('accumulates multiple calls within a step', () => {
      const ctx = new AxStepContextImpl(10);
      ctx._recordFunctionCall('funcA', {}, 'a');
      ctx._recordFunctionCall('funcB', {}, 'b');

      expect(ctx.functionsExecuted.size).toBe(2);
      expect(ctx.functionsExecuted.has('funca')).toBe(true);
      expect(ctx.functionsExecuted.has('funcb')).toBe(true);
      expect(ctx.lastFunctionCalls.length).toBe(2);
    });
  });

  describe('_addUsage accumulates', () => {
    it('sums token counts across multiple calls', () => {
      const ctx = new AxStepContextImpl(10);
      ctx._addUsage(10, 5, 15);
      ctx._addUsage(20, 10, 30);

      expect(ctx.usage).toEqual({
        promptTokens: 30,
        completionTokens: 15,
        totalTokens: 45,
      });
    });
  });

  describe('pending mutations: setModel, setThinkingBudget, setTemperature, setMaxTokens', () => {
    it('setModel sets pending model option', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setModel('gpt-4');
      const opts = ctx._consumePendingOptions();
      expect(opts?.model).toBe('gpt-4');
    });

    it('setThinkingBudget sets pending thinkingTokenBudget', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setThinkingBudget('high');
      const opts = ctx._consumePendingOptions();
      expect(opts?.thinkingTokenBudget).toBe('high');
    });

    it('setTemperature sets pending modelConfig.temperature', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setTemperature(0.5);
      const opts = ctx._consumePendingOptions();
      expect(opts?.modelConfig?.temperature).toBe(0.5);
    });

    it('setMaxTokens sets pending modelConfig.maxTokens', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setMaxTokens(2000);
      const opts = ctx._consumePendingOptions();
      expect(opts?.modelConfig?.maxTokens).toBe(2000);
    });

    it('_consumePendingOptions returns options and clears them', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setModel('gpt-4');

      const first = ctx._consumePendingOptions();
      expect(first).toBeDefined();
      expect(first?.model).toBe('gpt-4');

      const second = ctx._consumePendingOptions();
      expect(second).toBeUndefined();
    });
  });

  describe('setOptions merges', () => {
    it('merges multiple setOptions calls into pending options', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setOptions({ sessionId: 'abc' });
      ctx.setOptions({ debug: true });

      const opts = ctx._consumePendingOptions();
      expect(opts?.sessionId).toBe('abc');
      expect(opts?.debug).toBe(true);
    });

    it('later values overwrite earlier ones for same key', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setOptions({ sessionId: 'first' });
      ctx.setOptions({ sessionId: 'second' });

      const opts = ctx._consumePendingOptions();
      expect(opts?.sessionId).toBe('second');
    });
  });

  describe('addFunctions / removeFunctions', () => {
    it('_consumeFunctionsToAdd returns and clears pending functions', () => {
      const ctx = new AxStepContextImpl(10);
      const fn = {
        name: 'searchWeb',
        description: 'Search the web',
        func: () => 'result',
      };
      ctx.addFunctions([fn]);

      const fns = ctx._consumeFunctionsToAdd();
      expect(fns).toBeDefined();
      expect(fns!.length).toBe(1);

      const second = ctx._consumeFunctionsToAdd();
      expect(second).toBeUndefined();
    });

    it('_consumeFunctionsToRemove returns and clears pending names', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.removeFunctions('searchWeb', 'calculate');

      const names = ctx._consumeFunctionsToRemove();
      expect(names).toBeDefined();
      expect(names).toEqual(['searchWeb', 'calculate']);

      const second = ctx._consumeFunctionsToRemove();
      expect(second).toBeUndefined();
    });

    it('returns undefined when nothing pending', () => {
      const ctx = new AxStepContextImpl(10);
      expect(ctx._consumeFunctionsToAdd()).toBeUndefined();
      expect(ctx._consumeFunctionsToRemove()).toBeUndefined();
    });
  });

  describe('stop() and _isStopRequested', () => {
    it('initially false', () => {
      const ctx = new AxStepContextImpl(10);
      expect(ctx._isStopRequested).toBe(false);
    });

    it('becomes true after stop()', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.stop();
      expect(ctx._isStopRequested).toBe(true);
    });

    it('captures optional result values via _stopValues', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.stop({ answer: 'early exit' });
      expect(ctx._isStopRequested).toBe(true);
      expect(ctx._stopValues).toEqual({ answer: 'early exit' });
    });

    it('_stopValues is undefined when stop called without args', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.stop();
      expect(ctx._stopValues).toBeUndefined();
    });
  });

  describe('last-write-wins for same property', () => {
    it('setModel overwrites previous setModel', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setModel('model-a');
      ctx.setModel('model-b');
      const opts = ctx._consumePendingOptions();
      expect(opts?.model).toBe('model-b');
    });

    it('setTemperature overwrites previous setTemperature', () => {
      const ctx = new AxStepContextImpl(10);
      ctx.setTemperature(0.3);
      ctx.setTemperature(0.9);
      const opts = ctx._consumePendingOptions();
      expect(opts?.modelConfig?.temperature).toBe(0.9);
    });
  });
});
