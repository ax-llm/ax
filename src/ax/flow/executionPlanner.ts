import { AxFlowDependencyAnalyzer } from './dependencyAnalyzer.js';
import type {
  AxFlowExecutionStep,
  AxFlowParallelGroup,
  AxFlowStepFunction,
} from './types.js';

/**
 * Builds and manages the execution plan with automatic parallelization
 */
export class AxFlowExecutionPlanner {
  private steps: AxFlowExecutionStep[] = [];
  private parallelGroups: AxFlowParallelGroup[] = [];
  private readonly analyzer = new AxFlowDependencyAnalyzer();
  private initialFields: Set<string> = new Set();

  /**
   * Adds an execution step to the plan
   */
  addExecutionStep(
    stepFunction: AxFlowStepFunction,
    nodeName?: string,
    mapping?: (state: any) => any
  ): void {
    let dependencies: string[] = [];
    let produces: string[] = [];
    let type: 'execute' | 'map' | 'other' = 'other';

    if (nodeName && mapping) {
      type = 'execute';
      dependencies = this.analyzer.analyzeMappingDependencies(
        mapping,
        nodeName
      );
      produces = [`${nodeName}Result`];
    } else if (stepFunction.toString().includes('transform(')) {
      type = 'map';
      // Map steps are harder to analyze statically, assume they depend on all previous steps
      dependencies = this.getAllProducedFields();
    }

    const step: AxFlowExecutionStep = {
      type,
      nodeName,
      dependencies,
      produces,
      stepFunction,
      stepIndex: this.steps.length,
    };

    this.steps.push(step);
    // Don't rebuild parallel groups during construction - only after initial fields are set
    // this.rebuildParallelGroups()
  }

  /**
   * Sets the initial fields and rebuilds parallel groups
   */
  setInitialFields(fields: string[]): void {
    this.initialFields = new Set(fields);
    this.rebuildParallelGroups();
  }

  /**
   * Rebuilds the parallel execution groups based on dependencies
   */
  private rebuildParallelGroups(): void {
    this.parallelGroups = [];
    const processedSteps = new Set<number>();
    const availableFields = new Set<string>(this.initialFields);
    let currentLevel = 0;

    while (processedSteps.size < this.steps.length) {
      const currentLevelSteps: AxFlowExecutionStep[] = [];

      // Find all steps that can run at this level
      for (const step of this.steps) {
        if (processedSteps.has(step.stepIndex)) continue;

        // Check if all dependencies are available
        const canRun =
          step.dependencies.length === 0 ||
          step.dependencies.every((dep) => availableFields.has(dep));

        if (canRun) {
          currentLevelSteps.push(step);
          processedSteps.add(step.stepIndex);
        }
      }

      if (currentLevelSteps.length > 0) {
        // Add all produced fields from this level to available fields
        for (const step of currentLevelSteps) {
          step.produces.forEach((field) => availableFields.add(field));
        }

        this.parallelGroups.push({
          level: currentLevel,
          steps: currentLevelSteps,
        });
        currentLevel++;
      } else {
        // No progress made - break to avoid infinite loop
        break;
      }
    }
  }

  /**
   * Gets all fields produced by previous steps
   */
  private getAllProducedFields(): string[] {
    const fields: string[] = [];
    for (const step of this.steps) {
      fields.push(...step.produces);
    }
    return fields;
  }

  /**
   * Creates optimized execution function
   */
  createOptimizedExecution(): AxFlowStepFunction[] {
    const optimizedSteps: AxFlowStepFunction[] = [];

    for (const group of this.parallelGroups) {
      if (group.steps.length === 1) {
        // Single step - execute directly
        const step = group.steps[0];
        if (step) {
          optimizedSteps.push(step.stepFunction);
        }
      } else if (group.steps.length > 1) {
        // Multiple steps - execute in parallel
        const parallelStep: AxFlowStepFunction = async (state, context) => {
          const promises = group.steps.map((step) =>
            step.stepFunction(state, context)
          );

          const results = await Promise.all(promises);

          // Merge all results
          let mergedState = state;
          for (const result of results) {
            mergedState = { ...mergedState, ...result };
          }

          return mergedState;
        };

        optimizedSteps.push(parallelStep);
      }
    }

    return optimizedSteps;
  }

  /**
   * Gets execution plan info for debugging
   */
  getExecutionPlan(): {
    totalSteps: number;
    parallelGroups: number;
    maxParallelism: number;
    steps: AxFlowExecutionStep[];
    groups: AxFlowParallelGroup[];
  } {
    return {
      totalSteps: this.steps.length,
      parallelGroups: this.parallelGroups.length,
      maxParallelism: Math.max(
        ...this.parallelGroups.map((g) => g.steps.length),
        0
      ),
      steps: this.steps,
      groups: this.parallelGroups,
    };
  }
}
