import type { AxFlowStep } from './steps.js';
import { toPlanStep } from './steps.js';
import type {
  AxFlowExecutionPlan,
  AxFlowExecutionPlanGroup,
  AxFlowExecutionPlanStep,
} from './types.js';

function intersects(a: readonly string[], b: readonly string[]): boolean {
  return a.some((value) => b.includes(value));
}

function canShareGroup(
  currentGroup: readonly AxFlowExecutionPlanStep[],
  candidate: AxFlowExecutionPlanStep
): boolean {
  if (candidate.isBarrier) return false;
  if (candidate.produces.length === 0) return false;

  for (const step of currentGroup) {
    if (step.isBarrier) return false;
    if (intersects(candidate.dependencies, step.produces)) return false;
    if (intersects(step.dependencies, candidate.produces)) return false;
    if (intersects(step.produces, candidate.produces)) return false;
  }

  return true;
}

export class AxFlowExecutionPlanner {
  private readonly planSteps: AxFlowExecutionPlanStep[];

  constructor(steps: readonly AxFlowStep[] = []) {
    this.planSteps = steps.map((step, index) => toPlanStep(step, index));
  }

  getExecutionPlan(): AxFlowExecutionPlan {
    const groups: AxFlowExecutionPlanGroup[] = [];
    let currentGroup: AxFlowExecutionPlanStep[] = [];

    const flushGroup = () => {
      if (currentGroup.length === 0) return;
      groups.push({
        level: groups.length,
        steps: currentGroup,
      });
      currentGroup = [];
    };

    for (const step of this.planSteps) {
      if (step.isBarrier) {
        flushGroup();
        groups.push({
          level: groups.length,
          steps: [step],
        });
        continue;
      }

      if (currentGroup.length === 0 || canShareGroup(currentGroup, step)) {
        currentGroup.push(step);
        continue;
      }

      flushGroup();
      currentGroup.push(step);
    }

    flushGroup();

    return {
      totalSteps: this.planSteps.length,
      parallelGroups: groups.length,
      maxParallelism:
        groups.length === 0
          ? 1
          : Math.max(...groups.map((group) => group.steps.length), 1),
      steps: this.planSteps,
      groups,
    };
  }
}
