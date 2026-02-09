import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction } from '../ai/types.js';
import { createSelfTuningFunction } from './selfTuning.js';
import type { AxStepContext } from './types.js';

describe('createSelfTuningFunction', () => {
  describe('schema generation — model property', () => {
    it('includes model enum when models are configured', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
        models: [
          { key: 'fast', model: 'gpt-4o-mini', description: 'Quick' },
          { key: 'smart', model: 'claude-sonnet', description: 'Balanced' },
        ],
      });

      const func = createSelfTuningFunction(ai, {
        model: true,
        thinkingBudget: false,
      });

      expect(func.name).toBe('adjustGeneration');
      expect(func.parameters).toBeDefined();

      const modelProp = func.parameters!.properties!.model as {
        type: string;
        enum?: string[];
        description: string;
      };
      expect(modelProp).toBeDefined();
      expect(modelProp.type).toBe('string');
      expect(modelProp.enum).toEqual(['fast', 'smart']);
      expect(modelProp.description).toContain('fast');
      expect(modelProp.description).toContain('Quick');

      // No thinkingBudget
      expect(func.parameters!.properties!.thinkingBudget).toBeUndefined();
    });
  });

  describe('schema generation — thinkingBudget property', () => {
    it('includes thinkingBudget enum when enabled', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        thinkingBudget: true,
        model: false,
      });

      const budgetProp = func.parameters!.properties!.thinkingBudget as {
        type: string;
        enum?: string[];
      };
      expect(budgetProp).toBeDefined();
      expect(budgetProp.type).toBe('string');
      expect(budgetProp.enum).toEqual([
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'highest',
      ]);

      // No model property
      expect(func.parameters!.properties!.model).toBeUndefined();
    });
  });

  describe('schema generation — temperature opt-in', () => {
    it('includes temperature as number type when enabled', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        temperature: true,
        model: false,
        thinkingBudget: false,
      });

      const tempProp = func.parameters!.properties!.temperature as {
        type: string;
      };
      expect(tempProp).toBeDefined();
      expect(tempProp.type).toBe('number');
    });

    it('excludes temperature by default', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
        models: [{ key: 'fast', model: 'gpt-4o-mini', description: 'Quick' }],
      });

      const func = createSelfTuningFunction(ai, { model: true });

      expect(func.parameters!.properties!.temperature).toBeUndefined();
    });
  });

  describe('schema generation — function pool', () => {
    it('includes addFunctions and removeFunctions with enum of function names', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const poolFunc: AxFunction = {
        name: 'searchWeb',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
        },
        func: () => 'result',
      };

      const func = createSelfTuningFunction(ai, {
        model: false,
        thinkingBudget: false,
        functions: [poolFunc],
      });

      const addProp = func.parameters!.properties!.addFunctions as {
        type: string;
        items: { type: string; enum?: string[] };
      };
      expect(addProp).toBeDefined();
      expect(addProp.type).toBe('array');
      expect(addProp.items.enum).toEqual(['searchWeb']);

      const removeProp = func.parameters!.properties!.removeFunctions as {
        type: string;
        items: { type: string; enum?: string[] };
      };
      expect(removeProp).toBeDefined();
      expect(removeProp.type).toBe('array');
      expect(removeProp.items.enum).toEqual(['searchWeb']);
    });
  });

  describe('schema generation — all disabled', () => {
    it('has undefined parameters when no properties are generated', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        model: false,
        thinkingBudget: false,
      });

      expect(func.parameters).toBeUndefined();
    });
  });

  describe('schema generation — empty model list', () => {
    it('omits model property when AI has no models configured', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        model: true,
        thinkingBudget: true,
      });

      // No models → no model property, but thinkingBudget should still be there
      expect(func.parameters!.properties!.model).toBeUndefined();
      expect(func.parameters!.properties!.thinkingBudget).toBeDefined();
    });
  });

  describe('handler — calls step context mutators', () => {
    it('calls setModel, setThinkingBudget, and setTemperature on step context', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
        models: [{ key: 'fast', model: 'gpt-4o-mini', description: 'Quick' }],
      });

      const func = createSelfTuningFunction(ai, {
        model: true,
        thinkingBudget: true,
      });

      const mockStep: AxStepContext = {
        stepIndex: 0,
        maxSteps: 10,
        isFirstStep: true,
        functionsExecuted: new Set(),
        lastFunctionCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        state: new Map(),
        setModel: vi.fn(),
        setThinkingBudget: vi.fn(),
        setTemperature: vi.fn(),
        setMaxTokens: vi.fn(),
        setOptions: vi.fn(),
        addFunctions: vi.fn(),
        removeFunctions: vi.fn(),
        stop: vi.fn(),
      };

      const result = func.func(
        { model: 'fast', thinkingBudget: 'high', temperature: 0.5 },
        { step: mockStep }
      );

      expect(result).toBe('Generation parameters adjusted for next response.');
      expect(mockStep.setModel).toHaveBeenCalledWith('fast');
      expect(mockStep.setThinkingBudget).toHaveBeenCalledWith('high');
      expect(mockStep.setTemperature).toHaveBeenCalledWith(0.5);
    });
  });

  describe('handler — addFunctions looks up from pool', () => {
    it('calls step.addFunctions with matching function objects from pool', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const poolFunc: AxFunction = {
        name: 'searchWeb',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
        },
        func: () => 'result',
      };

      const func = createSelfTuningFunction(ai, {
        model: false,
        thinkingBudget: false,
        functions: [poolFunc],
      });

      const mockStep: AxStepContext = {
        stepIndex: 0,
        maxSteps: 10,
        isFirstStep: true,
        functionsExecuted: new Set(),
        lastFunctionCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        state: new Map(),
        setModel: vi.fn(),
        setThinkingBudget: vi.fn(),
        setTemperature: vi.fn(),
        setMaxTokens: vi.fn(),
        setOptions: vi.fn(),
        addFunctions: vi.fn(),
        removeFunctions: vi.fn(),
        stop: vi.fn(),
      };

      func.func({ addFunctions: ['searchWeb'] }, { step: mockStep });

      expect(mockStep.addFunctions).toHaveBeenCalledTimes(1);
      const addedFns = (mockStep.addFunctions as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as AxFunction[];
      expect(addedFns.length).toBe(1);
      expect(addedFns[0]!.name).toBe('searchWeb');
    });
  });

  describe('handler — removeFunctions', () => {
    it('calls step.removeFunctions with the provided names', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        model: false,
        thinkingBudget: false,
      });

      const mockStep: AxStepContext = {
        stepIndex: 0,
        maxSteps: 10,
        isFirstStep: true,
        functionsExecuted: new Set(),
        lastFunctionCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        state: new Map(),
        setModel: vi.fn(),
        setThinkingBudget: vi.fn(),
        setTemperature: vi.fn(),
        setMaxTokens: vi.fn(),
        setOptions: vi.fn(),
        addFunctions: vi.fn(),
        removeFunctions: vi.fn(),
        stop: vi.fn(),
      };

      func.func({ removeFunctions: ['searchWeb'] }, { step: mockStep });

      expect(mockStep.removeFunctions).toHaveBeenCalledWith('searchWeb');
    });
  });

  describe('handler — no step context', () => {
    it('returns success string without error when step is not provided', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        model: false,
        thinkingBudget: false,
      });

      const result = func.func({ model: 'fast' }, {});
      expect(result).toBe('Generation parameters adjusted for next response.');
    });

    it('returns success string when called with no extra arg', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
      });

      const func = createSelfTuningFunction(ai, {
        model: false,
        thinkingBudget: false,
      });

      const result = func.func();
      expect(result).toBe('Generation parameters adjusted for next response.');
    });
  });

  describe('default config (selfTuning: true equivalent)', () => {
    it('has both model and thinkingBudget, no temperature, no function pool', () => {
      const ai = new AxMockAIService({
        features: { functions: true },
        models: [{ key: 'fast', model: 'gpt-4o-mini', description: 'Quick' }],
      });

      const func = createSelfTuningFunction(ai, {
        model: true,
        thinkingBudget: true,
      });

      expect(func.parameters).toBeDefined();
      expect(func.parameters!.properties!.model).toBeDefined();
      expect(func.parameters!.properties!.thinkingBudget).toBeDefined();
      expect(func.parameters!.properties!.temperature).toBeUndefined();
      expect(func.parameters!.properties!.addFunctions).toBeUndefined();
      expect(func.parameters!.properties!.removeFunctions).toBeUndefined();
    });
  });
});
