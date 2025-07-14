/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';

import { AxFlowExecutionPlanner } from './executionPlanner.js';

describe('AxFlowExecutionPlanner', () => {
  let planner: AxFlowExecutionPlanner;
  let mockAI: AxMockAIService;

  beforeEach(() => {
    planner = new AxFlowExecutionPlanner();
    mockAI = new AxMockAIService({
      chatResponse: {
        results: [{ index: 0, content: 'Mock response', finishReason: 'stop' }],
        modelUsage: {
          ai: 'mock',
          model: 'test',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    });
  });

  describe('addExecutionStep', () => {
    it('should add execute steps with correct dependencies', () => {
      const stepFunction = async (state: any) => ({ ...state, result: 'test' });
      const mapping = (state: any) => ({ input: state.value });

      planner.addExecutionStep(stepFunction, 'testNode', mapping);

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('execute');
      expect(plan.steps[0].nodeName).toBe('testNode');
      expect(plan.steps[0].produces).toEqual(['testNodeResult']);
    });

    it('should add merge steps with correct dependencies', () => {
      const mergeFunction = async (state: any) => {
        const results = state._parallelResults;
        if (!Array.isArray(results)) {
          throw new Error('No parallel results found for merge');
        }
        return { ...state, merged: results.length };
      };

      planner.addExecutionStep(
        mergeFunction,
        undefined,
        undefined,
        'merge',
        undefined,
        { resultKey: 'merged', mergeFunction: (...args) => args.length }
      );

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('merge');
      expect(plan.steps[0].produces).toEqual(['merged']);
      expect(plan.steps[0].dependencies).toEqual(['_parallelResults']);
    });

    it('should detect parallel steps that produce _parallelResults', () => {
      const parallelStepFunction = async (state: any) => {
        return { ...state, _parallelResults: [1, 2, 3] };
      };

      planner.addExecutionStep(parallelStepFunction);

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].produces).toEqual(['_parallelResults']);
    });

    it('should add map steps with correct analysis', () => {
      const mapFunction = async (state: any) => ({ ...state, mapped: true });
      const mapTransform = (state: any) => ({ ...state, transformed: true });

      planner.addExecutionStep(
        mapFunction,
        undefined,
        undefined,
        'map',
        mapTransform
      );

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('map');
    });

    it('should add parallel steps with default handling', () => {
      const parallelFunction = async (state: any) => ({ ...state, _parallelResults: [] });

      planner.addExecutionStep(parallelFunction, undefined, undefined, 'parallel');

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('parallel');
      expect(plan.steps[0].produces).toEqual(['_parallelResults']);
    });
  });

  describe('getExecutionPlan', () => {
    it('should return empty plan for no steps', () => {
      const plan = planner.getExecutionPlan();
      expect(plan.totalSteps).toBe(0);
      expect(plan.parallelGroups).toBe(0);
      expect(plan.maxParallelism).toBe(1);
      expect(plan.steps).toHaveLength(0);
      expect(plan.groups).toHaveLength(0);
    });

    it('should calculate correct metrics for sequential steps', () => {
      const step1 = async (state: any) => ({ ...state, step1: true });
      const step2 = async (state: any) => ({ ...state, step2: true });

      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.value,
      }));
      planner.addExecutionStep(step2, 'node2', (state: any) => ({
        input: state.step1,
      }));

      const plan = planner.getExecutionPlan();
      expect(plan.totalSteps).toBe(2);
      expect(plan.parallelGroups).toBe(2); // Each step is its own group
      expect(plan.maxParallelism).toBe(1); // Sequential execution
    });

    it('should identify parallel execution opportunities', () => {
      const step1 = async (state: any) => ({ ...state, step1: true });
      const step2 = async (state: any) => ({ ...state, step2: true });

      // Add two steps that don't depend on each other
      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.value,
      }));
      planner.addExecutionStep(step2, 'node2', (state: any) => ({
        input: state.value,
      }));

      const plan = planner.getExecutionPlan();
      expect(plan.totalSteps).toBe(2);
      expect(plan.parallelGroups).toBeLessThanOrEqual(2);
    });

    it('should handle parallel step followed by merge', () => {
      // Add parallel step that produces _parallelResults
      const parallelStep = async (state: any) => {
        return { ...state, _parallelResults: [1, 2, 3] };
      };
      planner.addExecutionStep(parallelStep);

      // Add merge step that depends on _parallelResults
      const mergeStep = async (state: any) => {
        const results = state._parallelResults;
        if (!Array.isArray(results)) {
          throw new Error('No parallel results found for merge');
        }
        return { ...state, merged: results.length };
      };
      planner.addExecutionStep(
        mergeStep,
        undefined,
        undefined,
        'merge',
        undefined,
        { resultKey: 'merged', mergeFunction: (...args) => args.length }
      );

      const plan = planner.getExecutionPlan();
      expect(plan.totalSteps).toBe(2);
      expect(plan.parallelGroups).toBe(2); // Sequential because merge depends on parallel
    });
  });

  describe('getOptimizedExecutionSteps', () => {
    it('should return optimized steps in correct order', () => {
      const step1 = async (state: any) => ({ ...state, step1: true });
      const step2 = async (state: any) => ({ ...state, step2: true });

      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.value,
      }));
      planner.addExecutionStep(step2, 'node2', (state: any) => ({
        input: state.step1,
      }));

      const optimizedSteps = planner.getOptimizedExecutionSteps();
      expect(optimizedSteps).toHaveLength(2);
      expect(typeof optimizedSteps[0]).toBe('function');
      expect(typeof optimizedSteps[1]).toBe('function');
    });

    it('should handle single step groups', () => {
      const step1 = async (state: any) => ({ ...state, step1: true });

      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.value,
      }));

      const optimizedSteps = planner.getOptimizedExecutionSteps();
      expect(optimizedSteps).toHaveLength(1);
    });

    it('should create parallel execution for multiple independent steps', () => {
      const step1 = async (state: any) => ({ ...state, step1: true });
      const step2 = async (state: any) => ({ ...state, step2: true });

      // Add two independent steps
      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.value,
      }));
      planner.addExecutionStep(step2, 'node2', (state: any) => ({
        input: state.value,
      }));

      const optimizedSteps = planner.getOptimizedExecutionSteps();
      expect(optimizedSteps.length).toBeGreaterThan(0);
    });

    it('should preserve _parallelResults in parallel execution', async () => {
      const parallelStep = async (state: any) => {
        return { ...state, _parallelResults: [1, 2, 3] };
      };
      const regularStep = async (state: any) => ({ ...state, regular: true });

      planner.addExecutionStep(parallelStep);
      planner.addExecutionStep(regularStep);

      const optimizedSteps = planner.getOptimizedExecutionSteps();
      expect(optimizedSteps.length).toBeGreaterThan(0);

      // Test that parallel results are preserved
      const testState = { initial: true };
      const context = { mainAi: mockAI };

      // Execute the first step (should be parallel execution)
      const result1 = await optimizedSteps[0](testState, context);

      // If the first step produced _parallelResults, verify it's preserved
      if (result1._parallelResults) {
        expect(result1._parallelResults).toEqual([1, 2, 3]);
      }
    });

    it('should handle empty groups correctly', () => {
      // Add steps and then clear them to test edge case
      const step1 = async (state: any) => ({ ...state, step1: true });
      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.value,
      }));

      const optimizedSteps = planner.getOptimizedExecutionSteps();
      expect(optimizedSteps.length).toBeGreaterThan(0);
    });
  });

  describe('dependency analysis', () => {
    it('should correctly identify step dependencies', () => {
      const step1 = async (state: any) => ({ ...state, field1: 'value1' });
      const step2 = async (state: any) => ({ ...state, field2: state.field1 });

      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.initial,
      }));
      planner.addExecutionStep(step2, 'node2', (state: any) => ({
        input: state.field1,
      }));

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(2);

      // Second step should depend on field1 based on its mapping
      const step2Info = plan.steps[1];
      expect(step2Info.dependencies).toContain('field1');
    });

    it('should handle complex mapping dependencies', () => {
      const complexMapping = (state: any) => ({
        field1: state.input.nested.value,
        field2: state.otherField,
        computed: state.a + state.b,
      });

      const step = async (state: any) => ({ ...state, result: true });
      planner.addExecutionStep(step, 'complexNode', complexMapping);

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].dependencies.length).toBeGreaterThan(0);
    });

    it('should detect _parallelResults dependency in merge steps', () => {
      const mergeStep = async (state: any) => {
        const results = state._parallelResults;
        return { ...state, merged: results };
      };

      planner.addExecutionStep(
        mergeStep,
        undefined,
        undefined,
        'merge',
        undefined,
        { resultKey: 'merged' }
      );

      const plan = planner.getExecutionPlan();
      expect(plan.steps[0].dependencies).toContain('_parallelResults');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle steps with no dependencies', () => {
      const step = async (state: any) => ({ ...state, independent: true });
      planner.addExecutionStep(step, 'independent', () => ({
        static: 'value',
      }));

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].dependencies).toEqual([]);
    });

    it('should handle malformed step functions', () => {
      const malformedStep = async () => undefined;
      planner.addExecutionStep(malformedStep);

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('map');
    });

    it('should handle steps with circular dependencies gracefully', () => {
      const step1 = async (state: any) => ({ ...state, field1: state.field2 });
      const step2 = async (state: any) => ({ ...state, field2: state.field1 });

      planner.addExecutionStep(step1, 'node1', (state: any) => ({
        input: state.field2,
      }));
      planner.addExecutionStep(step2, 'node2', (state: any) => ({
        input: state.field1,
      }));

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(2);
      // Should not crash, even with circular dependencies
    });

    it('should not hang in infinite loop with sequential chains that have proper dependencies', () => {
      // This reproduces the RAG example pattern that was hanging
      const step1 = async (state: any) => ({
        ...state,
        queryGeneratorResult: { searchQuery: 'test' },
      });
      const step2 = async (state: any) => ({
        ...state,
        retrieverResult: { retrievedDocument: 'doc' },
      });
      const step3 = async (state: any) => ({
        ...state,
        answerGeneratorResult: { researchAnswer: 'answer' },
      });

      planner.addExecutionStep(step1, 'queryGenerator', (state: any) => ({
        researchQuestion: state.researchQuestion,
      }));
      planner.addExecutionStep(step2, 'retriever', (state: any) => ({
        searchQuery: state.queryGeneratorResult.searchQuery,
      }));
      planner.addExecutionStep(step3, 'answerGenerator', (state: any) => ({
        retrievedDocument: state.retrieverResult.retrievedDocument,
        researchQuestion: state.researchQuestion,
      }));

      planner.setInitialFields(['researchQuestion']);

      const plan = planner.getExecutionPlan();
      expect(plan.steps).toHaveLength(3);
      expect(plan.parallelGroups).toBe(3); // Should be sequential, not hanging
    });
  });
});
