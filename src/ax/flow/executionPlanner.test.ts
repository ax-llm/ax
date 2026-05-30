import { describe, expect, it } from 'vitest';
import { AxFlowExecutionPlanner } from './executionPlanner.js';
import { createFlowStep } from './steps.js';

describe('AxFlowExecutionPlanner', () => {
  it('groups independent execute steps', () => {
    const planner = new AxFlowExecutionPlanner([
      createFlowStep({
        kind: 'execute',
        nodeName: 'a',
        reads: ['input'],
        writes: ['aResult'],
        run: (state) => state,
      }),
      createFlowStep({
        kind: 'execute',
        nodeName: 'b',
        reads: ['input'],
        writes: ['bResult'],
        run: (state) => state,
      }),
    ]);

    const plan = planner.getExecutionPlan();
    expect(plan.totalSteps).toBe(2);
    expect(plan.parallelGroups).toBe(1);
    expect(plan.maxParallelism).toBe(2);
  });

  it('uses maps and control-flow steps as barriers', () => {
    const planner = new AxFlowExecutionPlanner([
      createFlowStep({
        kind: 'execute',
        nodeName: 'a',
        reads: ['input'],
        writes: ['aResult'],
        run: (state) => state,
      }),
      createFlowStep({
        kind: 'map',
        isBarrier: true,
        run: (state) => state,
      }),
      createFlowStep({
        kind: 'execute',
        nodeName: 'b',
        reads: ['input'],
        writes: ['bResult'],
        run: (state) => state,
      }),
    ]);

    const plan = planner.getExecutionPlan();
    expect(plan.parallelGroups).toBe(3);
    expect(plan.groups.map((group) => group.steps.map((s) => s.type))).toEqual([
      ['execute'],
      ['map'],
      ['execute'],
    ]);
  });

  it('does not parallelize read/write dependencies', () => {
    const planner = new AxFlowExecutionPlanner([
      createFlowStep({
        kind: 'execute',
        nodeName: 'a',
        reads: ['input'],
        writes: ['aResult'],
        run: (state) => state,
      }),
      createFlowStep({
        kind: 'execute',
        nodeName: 'b',
        reads: ['aResult'],
        writes: ['bResult'],
        run: (state) => state,
      }),
    ]);

    const plan = planner.getExecutionPlan();
    expect(plan.parallelGroups).toBe(2);
    expect(plan.maxParallelism).toBe(1);
  });

  it('does not parallelize write conflicts', () => {
    const planner = new AxFlowExecutionPlanner([
      createFlowStep({
        kind: 'derive',
        reads: ['items'],
        writes: ['result'],
        run: (state) => state,
      }),
      createFlowStep({
        kind: 'derive',
        reads: ['otherItems'],
        writes: ['result'],
        run: (state) => state,
      }),
    ]);

    const plan = planner.getExecutionPlan();
    expect(plan.parallelGroups).toBe(2);
    expect(plan.maxParallelism).toBe(1);
  });
});
