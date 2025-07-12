/* eslint-disable @typescript-eslint/no-explicit-any, functional/prefer-immutable-types */
import type { AxAIService } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import { AxProgram, type AxProgramForwardOptions } from '../dsp/program.js';
import { type AxField, AxSignature } from '../dsp/sig.js';
import type { AxFieldValue, AxGenIn, AxGenOut } from '../dsp/types.js';

// Type for state object that flows through the pipeline
type AxFlowState = Record<string, unknown>;

// Type for node definitions in the flow
interface AxFlowNodeDefinition {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

// Type for flow step functions
type AxFlowStepFunction = (
  state: AxFlowState,
  context: Readonly<{
    mainAi: AxAIService;
    mainOptions?: AxProgramForwardOptions;
  }>
) => Promise<AxFlowState> | AxFlowState;

// Type for dynamic context overrides
interface AxFlowDynamicContext {
  ai?: AxAIService;
  options?: AxProgramForwardOptions;
}

// =============================================================================
// ADVANCED TYPE SYSTEM FOR TYPE-SAFE CHAINING
// =============================================================================

// Helper type to extract input type from an AxGen instance
type GetGenIn<T extends AxGen<AxGenIn, AxGenOut>> = T extends AxGen<
  infer IN,
  AxGenOut
>
  ? IN
  : never;

// Helper type to extract output type from an AxGen instance
type GetGenOut<T extends AxGen<AxGenIn, AxGenOut>> = T extends AxGen<
  AxGenIn,
  infer OUT
>
  ? OUT
  : never;

// Helper type to create an AxGen type from a signature string
// This is a simplified version - in practice, you'd need more sophisticated parsing
type InferAxGen<TSig extends string> = TSig extends string
  ? AxGen<AxGenIn, AxGenOut>
  : never;

// Helper type to create result key name from node name
type NodeResultKey<TNodeName extends string> = `${TNodeName}Result`;

// Helper type to add node result to state
type AddNodeResult<
  TState extends AxFlowState,
  TNodeName extends string,
  TNodeOut extends AxGenOut,
> = TState & { [K in NodeResultKey<TNodeName>]: TNodeOut };

// =============================================================================
// TYPED SUB-CONTEXT INTERFACES
// =============================================================================

// Type for parallel branch functions with typed context
// NOTE: The `any` here is necessary because we need to support AxGen with any input/output types
type AxFlowTypedParallelBranch<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> = (
  subFlow: AxFlowTypedSubContext<TNodes, TState>
) => AxFlowTypedSubContext<TNodes, AxFlowState>;

// Type for typed sub-flow context used in parallel execution
// NOTE: The `any` here is necessary for the same reason as above
interface AxFlowTypedSubContext<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> {
  execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlowTypedSubContext<
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  >;

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState>;

  executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState>;
}

// Legacy untyped interfaces for backward compatibility
type AxFlowParallelBranch = (subFlow: AxFlowSubContext) => AxFlowSubContext;

interface AxFlowSubContext {
  execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this;
  map(transform: (state: AxFlowState) => AxFlowState): this;
  executeSteps(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState>;
}

// Type for branch context
interface AxFlowBranchContext {
  predicate: (state: AxFlowState) => unknown;
  branches: Map<unknown, AxFlowStepFunction[]>;
  currentBranchValue?: unknown;
}

// =============================================================================
// AUTOMATIC DEPENDENCY ANALYSIS AND PARALLELIZATION
// =============================================================================

// Type for execution step metadata
interface AxFlowExecutionStep {
  type: 'execute' | 'map' | 'merge' | 'other';
  nodeName?: string;
  dependencies: string[];
  produces: string[];
  stepFunction: AxFlowStepFunction;
  stepIndex: number;
}

// Type for parallel execution groups
interface AxFlowParallelGroup {
  level: number;
  steps: AxFlowExecutionStep[];
}

// Configuration for automatic parallelization
interface AxFlowAutoParallelConfig {
  enabled: boolean;
}

/**
 * Analyzes mapping functions to extract state dependencies
 */
class AxFlowDependencyAnalyzer {
  /**
   * Analyzes a mapping function to determine which state fields it depends on
   */
  analyzeMappingDependencies(
    mapping: (state: any) => any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _nodeName: string
  ): string[] {
    const dependencies: string[] = [];

    // Method 1: Static analysis of function source
    const source = mapping.toString();
    const stateAccessMatches = Array.from(source.matchAll(/state\.(\w+)/g));
    for (const match of stateAccessMatches) {
      if (match[1] && !dependencies.includes(match[1])) {
        dependencies.push(match[1]);
      }
    }

    // Method 2: Proxy-based tracking (fallback for complex cases)
    if (dependencies.length === 0) {
      try {
        const tracker = this.createDependencyTracker(dependencies);
        mapping(tracker);
      } catch {
        // Expected - we're just tracking access patterns
      }
    }

    return dependencies;
  }

  private createDependencyTracker(dependencies: string[]): any {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'string' && !dependencies.includes(prop)) {
            dependencies.push(prop);
          }
          // Return another proxy for nested access
          return new Proxy(
            {},
            {
              get: () => undefined,
            }
          );
        },
      }
    );
  }
}

/**
 * Builds and manages the execution plan with automatic parallelization
 */
class AxFlowExecutionPlanner {
  private steps: AxFlowExecutionStep[] = [];
  private parallelGroups: AxFlowParallelGroup[] = [];
  private readonly analyzer = new AxFlowDependencyAnalyzer();
  private initialFields: Set<string> = new Set();

  /**
   * Adds an execution step to the planner for dependency analysis and parallel optimization.
   * This method analyzes different types of steps (execute, map, merge, other) and determines
   * what fields they depend on and what fields they produce.
   *
   * The analysis is critical for:
   * - Automatic parallelization of independent steps
   * - Signature inference to determine flow inputs/outputs
   * - Dependency tracking to ensure correct execution order
   *
   * Step type analysis:
   * - 'execute': Node execution steps that run LLM operations
   * - 'map': Transformation steps that modify the state object
   * - 'merge': Branch merge operations that combine results from conditional branches
   * - 'other': Generic steps that don't fit other categories
   *
   * @param stepFunction - The actual function to execute for this step
   * @param nodeName - Name of the node (for execute steps)
   * @param mapping - Function that maps state to node inputs (for execute steps)
   * @param stepType - Type of step for specialized analysis
   * @param mapTransform - Transformation function (for map steps)
   * @param mergeOptions - Options for merge operations (result key, merge function)
   */
  addExecutionStep(
    stepFunction: AxFlowStepFunction,
    nodeName?: string,
    mapping?: (state: any) => any,
    stepType?: 'execute' | 'map' | 'merge' | 'other',
    mapTransform?: (state: any) => any,
    mergeOptions?: {
      resultKey?: string;
      mergeFunction?: (...args: any[]) => any;
    }
  ): void {
    let dependencies: string[] = [];
    let produces: string[] = [];
    let type: 'execute' | 'map' | 'merge' | 'other' = stepType || 'other';

    // Analyze execute steps (node operations)
    // These are the core LLM operations that process data through defined nodes
    if (nodeName && mapping) {
      type = 'execute';
      // Analyze the mapping function to determine what fields it accesses
      dependencies = this.analyzer.analyzeMappingDependencies(
        mapping,
        nodeName
      );
      // Execute steps produce a result field named after the node
      produces = [`${nodeName}Result`];
    } else if (type === 'map' && mapTransform) {
      // Analyze map transformation steps
      // These modify the state object and can produce new fields

      // Try to determine what fields the map transformation produces
      // by running it on a mock state and seeing what keys are in the result
      const mapOutputFields = this.analyzeMapTransformation(mapTransform);
      produces = mapOutputFields;

      // Map steps typically depend on all previously produced fields
      // since they have access to the entire state object
      dependencies = this.getAllProducedFields();
    } else if (type === 'merge') {
      // Analyze merge operations (branch merging)
      // These combine results from conditional branches or parallel operations

      if (mergeOptions?.resultKey) {
        // Parallel merge with explicit result key
        // Produces a single field with the merged result
        produces = [mergeOptions.resultKey];
      } else {
        // Conditional branch merge
        // Analyze what fields the branches actually produce
        const branchFields = this.analyzeBranchMergeFields();
        produces = branchFields.length > 0 ? branchFields : ['_mergedResult'];
      }

      // Merge steps depend on all previously produced fields
      // since they need to access branch results
      dependencies = this.getAllProducedFields();
    } else if (stepFunction.toString().includes('transform(')) {
      // Fallback detection for map-like steps
      // This catches transformation steps that weren't explicitly marked as 'map'
      type = 'map';

      // Map steps are harder to analyze statically, assume they depend on all previous steps
      dependencies = this.getAllProducedFields();
      produces = ['_mapResult'];
    }

    // Create the execution step record
    const step: AxFlowExecutionStep = {
      type,
      nodeName,
      dependencies,
      produces,
      stepFunction,
      stepIndex: this.steps.length,
    };

    this.steps.push(step);
    // Note: Don't rebuild parallel groups during construction - only after initial fields are set
    // This optimization prevents unnecessary rebuilds during flow construction
    // this.rebuildParallelGroups()
  }

  /**
   * Analyzes a map transformation function to determine what fields it produces
   */
  private analyzeMapTransformation(
    mapTransform: (state: any) => any
  ): string[] {
    try {
      // Create a mock state with sample data to analyze the transformation
      const mockState = this.createMockState();
      const result = mapTransform(mockState);

      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return Object.keys(result);
      }
    } catch (error) {
      // If analysis fails, return a generic field name
      console.debug('Map transformation analysis failed:', error);
    }

    return ['_mapResult'];
  }

  /**
   * Analyzes what fields are produced by conditional merge operations.
   *
   * Conditional merges are complex because they don't transform data like map operations,
   * but instead select which branch's results to use based on a condition.
   * The challenge is determining what fields will be available after the merge
   * without knowing which branch will be taken at runtime.
   *
   * This method uses heuristics to determine the likely output fields:
   * 1. Look at recent execute steps (likely branch operations)
   * 2. If found, use their output fields as potential merge results
   * 3. Fallback to all execute step fields if no recent pattern is found
   *
   * The analysis assumes that branches in a conditional merge will produce
   * similar types of fields, so we can use any branch's fields as representative
   * of what the merge might produce.
   *
   * @returns string[] - Array of field names that the merge operation might produce
   */
  private analyzeBranchMergeFields(): string[] {
    // Look at the last few steps to find execute steps that would be merged
    // We focus on recent steps because they're more likely to be part of the
    // current branch structure being merged
    const recentExecuteSteps = this.steps
      .slice(-5) // Look at last 5 steps
      .filter((step) => step.type === 'execute' && step.nodeName)
      .flatMap((step) => step.produces);

    if (recentExecuteSteps.length > 0) {
      return recentExecuteSteps;
    }

    // Fallback: return all execute step fields
    // This is a broader approach when we can't identify recent branch patterns
    // It includes all possible fields that could be produced by any node
    return this.steps
      .filter((step) => step.type === 'execute' && step.nodeName)
      .flatMap((step) => step.produces);
  }

  /**
   * Creates a mock state with sample data for analysis
   */
  private createMockState(): any {
    const mockState: any = {};

    // Add initial fields
    for (const field of this.initialFields) {
      mockState[field] = 'mockValue';
    }

    // Add produced fields from previous steps
    for (const step of this.steps) {
      for (const field of step.produces) {
        if (field.endsWith('Result')) {
          mockState[field] = {
            // Add common result field patterns
            text: 'mockText',
            value: 'mockValue',
            result: 'mockResult',
            data: 'mockData',
            processedData: 'mockProcessedData',
          };
        } else {
          mockState[field] = 'mockValue';
        }
      }
    }

    return mockState;
  }

  /**
   * Sets the initial fields and rebuilds parallel groups
   */
  setInitialFields(fields: string[]): void {
    this.initialFields = new Set(fields);
    this.rebuildParallelGroups();
  }

  /**
   * Rebuilds the parallel execution groups based on step dependencies.
   *
   * This is a critical optimization method that analyzes the dependency graph
   * of all execution steps and groups them into parallel execution levels.
   * Steps that don't depend on each other can be executed simultaneously,
   * significantly improving performance for complex flows.
   *
   * The algorithm works as follows:
   * 1. Start with initial fields (flow inputs) as available
   * 2. For each level, find all steps whose dependencies are satisfied
   * 3. Group these independent steps together for parallel execution
   * 4. Add their produced fields to the available fields set
   * 5. Repeat until all steps are processed
   *
   * Example:
   * - Level 0: Steps A, B, C (no dependencies) -> run in parallel
   * - Level 1: Step D (depends on A), Step E (depends on B) -> run in parallel
   * - Level 2: Step F (depends on D and E) -> run alone
   *
   * This creates a DAG (Directed Acyclic Graph) execution plan that maximizes
   * parallelism while respecting data dependencies.
   */
  private rebuildParallelGroups(): void {
    this.parallelGroups = [];
    const processedSteps = new Set<number>();
    const availableFields = new Set<string>(this.initialFields);
    let currentLevel = 0;

    // Continue until all steps are processed
    while (processedSteps.size < this.steps.length) {
      const currentLevelSteps: AxFlowExecutionStep[] = [];

      // Find all steps that can run at this level
      // A step can run if all its dependencies are satisfied by available fields
      for (const step of this.steps) {
        if (processedSteps.has(step.stepIndex)) continue;

        // Check if all dependencies are available
        // Steps with no dependencies can always run
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
        // This makes them available for steps in the next level
        for (const step of currentLevelSteps) {
          step.produces.forEach((field) => availableFields.add(field));
        }

        // Create a parallel group for this level
        this.parallelGroups.push({
          level: currentLevel,
          steps: currentLevelSteps,
        });
        currentLevel++;
      } else {
        // No progress made - this indicates a circular dependency or bug
        // Break to avoid infinite loop
        console.warn(
          'No progress made in parallel group building - possible circular dependency'
        );
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
   * Creates optimized execution functions that implement the parallel execution plan.
   *
   * This method converts the parallel groups into actual executable functions.
   * It creates a series of steps where:
   * - Single-step groups execute directly
   * - Multi-step groups execute in parallel using Promise.all()
   * - Results are properly merged to maintain state consistency
   *
   * The optimized execution can significantly improve performance for flows
   * with independent operations, especially I/O-bound operations like LLM calls.
   *
   * Performance benefits:
   * - Reduces total execution time for independent operations
   * - Maximizes CPU and I/O utilization
   * - Maintains correctness through dependency management
   *
   * @returns Array of optimized step functions ready for execution
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
   * Gets detailed execution plan information for debugging and analysis.
   *
   * This method provides comprehensive information about the execution plan,
   * including step counts, parallel grouping details, and the complete
   * dependency structure. It's particularly useful for:
   * - Debugging execution flow issues
   * - Performance analysis and optimization
   * - Understanding parallelization effectiveness
   * - Monitoring execution plan complexity
   *
   * @returns Object containing detailed execution plan metrics and data
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

/**
 * AxFlow - A fluent, chainable API for building and orchestrating complex, stateful AI programs.
 *
 * Now with advanced type-safe chaining where each method call evolves the type information,
 * providing compile-time type safety and superior IntelliSense.
 *
 * @example
 * ```typescript
 * const flow = new AxFlow<{ topic: string }, { finalAnswer: string }>()
 *   .node('summarizer', 'text:string -> summary:string')
 *   .node('critic', 'summary:string -> critique:string')
 *   .execute('summarizer', state => ({ text: `About ${state.topic}` })) // state is { topic: string }
 *   .execute('critic', state => ({ summary: state.summarizerResult.summary })) // state evolves!
 *   .map(state => ({ finalAnswer: state.criticResult.critique })) // fully typed!
 *
 * const result = await flow.forward(ai, { topic: "AI safety" })
 * ```
 */
export class AxFlow<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  // NOTE: The `any` here is necessary because TNodes must accommodate AxGen instances with various input/output types
  TNodes extends Record<string, AxGen<any, any>> = Record<string, never>, // Node registry for type tracking
  TState extends AxFlowState = IN, // Current evolving state type
> extends AxProgram<IN, OUT> {
  private readonly nodes: Map<string, AxFlowNodeDefinition> = new Map();
  private readonly flowDefinition: AxFlowStepFunction[] = [];
  private readonly nodeGenerators: Map<
    string,
    AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
  > = new Map();
  private readonly loopStack: number[] = [];
  private readonly stepLabels: Map<string, number> = new Map();
  private branchContext: AxFlowBranchContext | null = null;

  // Automatic parallelization components
  private readonly autoParallelConfig: AxFlowAutoParallelConfig;
  private readonly executionPlanner = new AxFlowExecutionPlanner();

  /**
   * Converts a string to camelCase for valid field names
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Infers the signature of the flow based on the execution plan and node definitions.
   * This is the core method that determines what input/output fields the flow should have
   * based on the nodes and operations defined in the flow.
   *
   * The inference process follows these steps:
   * 1. If no nodes are defined, return a default signature
   * 2. Analyze the execution plan to find all produced and consumed fields
   * 3. Determine input fields (consumed but not produced by any step)
   * 4. Determine output fields with special handling for final map/merge operations
   * 5. If no clear pattern is found, create a comprehensive signature from all nodes
   *
   * Special handling for final operations:
   * - Map operations: Use the fields produced by the map transformation
   * - Merge operations: Use fields from the merged branches or merge result
   * - Conditional merges: Analyze what fields the branches actually produce
   *
   * @returns AxSignature - The inferred signature for this flow
   */
  private inferSignatureFromFlow(): AxSignature {
    // If no nodes are defined, use a default signature
    if (this.nodeGenerators.size === 0) {
      return new AxSignature('userInput:string -> flowOutput:string');
    }

    // Get execution plan to identify dependencies and field flow
    // This gives us a structured view of what each step consumes and produces
    const executionPlan = this.executionPlanner.getExecutionPlan();
    const allProducedFields = new Set<string>();
    const allConsumedFields = new Set<string>();

    // Collect all produced and consumed fields from the execution plan
    // This helps us understand the data flow through the entire workflow
    for (const step of executionPlan.steps) {
      step.produces.forEach((field) => allProducedFields.add(field));
      step.dependencies.forEach((field) => allConsumedFields.add(field));
    }

    // Find input fields (consumed but not produced by any step)
    // These are fields that the flow needs from external input
    const inputFieldNames = new Set<string>();
    for (const consumed of allConsumedFields) {
      if (!allProducedFields.has(consumed)) {
        inputFieldNames.add(consumed);
      }
    }

    // Find output fields (produced but not consumed by subsequent steps)
    // These are the final results that the flow produces
    const outputFieldNames = new Set<string>();

    // Special handling for final map/merge operations
    // When a flow ends with a transformation or merge, we want to use those results
    // as the output rather than intermediate node results
    const lastStep = executionPlan.steps[executionPlan.steps.length - 1];
    if (lastStep && (lastStep.type === 'map' || lastStep.type === 'merge')) {
      // If the last step is a map/merge, use its produced fields as outputs
      lastStep.produces.forEach((field) => {
        // Skip internal fields like _mapResult, _mergedResult
        if (!field.startsWith('_')) {
          outputFieldNames.add(field);
        }
      });

      // For conditional merges that produce _mergedResult,
      // use all fields from previous steps as potential outputs
      // This handles cases where the merge doesn't transform the data
      // but just selects which branch's results to use
      if (
        lastStep.type === 'merge' &&
        lastStep.produces.includes('_mergedResult')
      ) {
        // Find all node result fields from previous steps
        for (const step of executionPlan.steps) {
          if (step.type === 'execute' && step.produces.length > 0) {
            step.produces.forEach((field) => outputFieldNames.add(field));
          }
        }
      }
    } else {
      // Standard logic: fields produced but not consumed by subsequent steps
      // This finds the "leaf" fields that aren't used by any other step
      for (const produced of allProducedFields) {
        // Check if this field is consumed by any step
        let isConsumed = false;
        for (const step of executionPlan.steps) {
          if (step.dependencies.includes(produced)) {
            isConsumed = true;
            break;
          }
        }
        if (!isConsumed) {
          outputFieldNames.add(produced);
        }
      }
    }

    // If no clear input/output pattern, create a comprehensive signature
    // This is a fallback that includes all possible fields from all nodes
    // It's used when the execution plan analysis doesn't give clear results
    if (inputFieldNames.size === 0 && outputFieldNames.size === 0) {
      // Extract fields from node signatures
      const inputFields: AxField[] = [];
      const outputFields: AxField[] = [];

      // Go through each node and extract its input/output fields
      for (const [nodeName, nodeGen] of this.nodeGenerators) {
        const nodeSignature = nodeGen.getSignature();
        const sig = new AxSignature(nodeSignature);

        // Add node's input fields as potential flow inputs
        // These are prefixed with the node name to avoid conflicts
        for (const field of sig.getInputFields()) {
          // Convert to camelCase to avoid validation issues
          const camelCaseName = this.toCamelCase(`${nodeName}_${field.name}`);
          inputFields.push({
            name: camelCaseName,
            type: field.type,
            description: field.description,
            isOptional: field.isOptional,
            isInternal: field.isInternal,
          });
        }

        // Add node's output fields as potential flow outputs
        // These are also prefixed with the node name
        for (const field of sig.getOutputFields()) {
          // Convert to camelCase to avoid validation issues
          const camelCaseName = this.toCamelCase(`${nodeName}_${field.name}`);
          outputFields.push({
            name: camelCaseName,
            type: field.type,
            description: field.description,
            isOptional: field.isOptional,
            isInternal: field.isInternal,
          });
        }
      }

      // Create signature from collected fields
      const inferredSignature = new AxSignature();

      // Add input fields or default
      if (inputFields.length > 0) {
        inferredSignature.setInputFields(inputFields);
      } else {
        inferredSignature.addInputField({
          name: 'userInput',
          type: { name: 'string' },
          description: 'User input to the flow',
        });
      }

      // Add output fields or default
      if (outputFields.length > 0) {
        inferredSignature.setOutputFields(outputFields);
      } else {
        inferredSignature.addOutputField({
          name: 'flowOutput',
          type: { name: 'string' },
          description: 'Output from the flow',
        });
      }

      return inferredSignature;
    }

    // Build signature from identified input/output fields
    // This is the main path when we have clear input/output patterns
    const inferredSignature = new AxSignature();

    // Add input fields
    const inputFields: AxField[] = [];
    for (const fieldName of inputFieldNames) {
      inputFields.push({
        name: fieldName,
        type: { name: 'string' },
        description: `Input field: ${fieldName}`,
      });
    }

    // Add default input if none found
    if (inputFields.length === 0) {
      inputFields.push({
        name: 'userInput',
        type: { name: 'string' },
        description: 'User input to the flow',
      });
    }

    // Add output fields
    const outputFields: AxField[] = [];
    for (const fieldName of outputFieldNames) {
      outputFields.push({
        name: fieldName,
        type: { name: 'string' },
        description: `Output field: ${fieldName}`,
      });
    }

    // Add default output if none found
    if (outputFields.length === 0) {
      outputFields.push({
        name: 'flowOutput',
        type: { name: 'string' },
        description: 'Output from the flow',
      });
    }

    inferredSignature.setInputFields(inputFields);
    inferredSignature.setOutputFields(outputFields);

    return inferredSignature;
  }

  constructor(options?: {
    autoParallel?: boolean;
  }) {
    // No signature provided - will be inferred from flow structure
    super();

    this.autoParallelConfig = {
      enabled: options?.autoParallel !== false, // Default to true
    };
  }

  /**
   * Declares a reusable computational node using a signature string.
   * Returns a new AxFlow type that tracks this node in the TNodes registry.
   *
   * @param name - The name of the node
   * @param signature - Signature string in the same format as AxSignature
   * @param options - Optional program forward options (same as AxGen)
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * flow.node('summarizer', 'text:string -> summary:string')
   * flow.node('analyzer', 'text:string -> analysis:string, confidence:number', { debug: true })
   * ```
   */
  public node<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: InferAxGen<TSig> }, // Add new node to registry
    TState // State unchanged
  >;

  /**
   * Declares a reusable computational node using an AxSignature instance.
   * This allows using pre-configured signatures in the flow.
   *
   * @param name - The name of the node
   * @param signature - AxSignature instance to use for this node
   * @param options - Optional program forward options (same as AxGen)
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * const sig = new AxSignature('text:string -> summary:string')
   * flow.node('summarizer', sig, { temperature: 0.1 })
   * ```
   */
  public node<TName extends string>(
    name: TName,
    signature: AxSignature,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> }, // Add new node to registry
    TState // State unchanged
  >;

  /**
   * Declares a reusable computational node using an existing AxGen instance.
   * This allows reusing pre-configured generators in the flow.
   *
   * @param name - The name of the node
   * @param axgenInstance - Existing AxGen instance to use for this node
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * const summarizer = new AxGen('text:string -> summary:string', { temperature: 0.1 })
   * flow.node('summarizer', summarizer)
   * ```
   */
  public node<TName extends string, TGen extends AxGen<any, any>>(
    name: TName,
    axgenInstance: TGen
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: TGen }, // Add new node to registry with exact type
    TState // State unchanged
  >;

  /**
   * Declares a reusable computational node using a class that extends AxProgram.
   * This allows using custom program classes in the flow.
   *
   * @param name - The name of the node
   * @param programClass - Class that extends AxProgram to use for this node
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * class CustomProgram extends AxProgram<{ input: string }, { output: string }> {
   *   async forward(ai, values) { return { output: values.input.toUpperCase() } }
   * }
   * flow.node('custom', CustomProgram)
   * ```
   */
  public node<
    TName extends string,
    TProgram extends new () => AxProgram<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: InstanceType<TProgram> }, // Add new node to registry with exact type
    TState // State unchanged
  >;

  // Implementation
  public node<TName extends string>(
    name: TName,
    signatureOrAxGenOrClass:
      | string
      | AxSignature
      | AxGen<any, any>
      | (new () => AxProgram<any, any>),
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: any }, // Using any here as the implementation handles all cases
    TState
  > {
    if (signatureOrAxGenOrClass instanceof AxGen) {
      // Using existing AxGen instance
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      });

      // Store the existing AxGen instance
      this.nodeGenerators.set(
        name,
        signatureOrAxGenOrClass as AxGen<AxGenIn, AxGenOut>
      );
    } else if (signatureOrAxGenOrClass instanceof AxSignature) {
      // Using AxSignature instance
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      });

      // Create and store the AxGen instance for this node using the signature
      this.nodeGenerators.set(
        name,
        new AxGen(signatureOrAxGenOrClass, options)
      );
    } else if (
      typeof signatureOrAxGenOrClass === 'function' &&
      signatureOrAxGenOrClass.prototype instanceof AxProgram
    ) {
      // Using a class that extends AxProgram
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      });

      // Create an instance of the program class and store it directly
      const programInstance = new signatureOrAxGenOrClass();
      this.nodeGenerators.set(name, programInstance);
    } else if (typeof signatureOrAxGenOrClass === 'string') {
      // Using signature string (original behavior)
      const signature = signatureOrAxGenOrClass;

      // Validate that signature is provided
      if (!signature) {
        throw new Error(
          `Invalid signature for node '${name}': signature cannot be empty`
        );
      }

      // Store node definition (simplified since we're using standard signatures)
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      });

      // Create and store the AxGen instance for this node with the same arguments as AxGen
      this.nodeGenerators.set(name, new AxGen(signature, options));
    } else {
      throw new Error(
        `Invalid second argument for node '${name}': expected string, AxSignature, AxGen instance, or class extending AxProgram`
      );
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    // The runtime value is the same object, but TypeScript can't track the evolving generic types
    return this as any;
  }

  /**
   * Short alias for node() - supports signature strings, AxSignature instances, AxGen instances, and program classes
   */
  public n<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InferAxGen<TSig> }, TState>;

  public n<TName extends string>(
    name: TName,
    signature: AxSignature,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  >;

  public n<TName extends string, TGen extends AxGen<any, any>>(
    name: TName,
    axgenInstance: TGen
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: TGen }, TState>;

  public n<
    TName extends string,
    TProgram extends new () => AxProgram<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InstanceType<TProgram> }, TState>;

  public n<TName extends string>(
    name: TName,
    signatureOrAxGenOrClass:
      | string
      | AxSignature
      | AxGen<any, any>
      | (new () => AxProgram<any, any>),
    options?: Readonly<AxProgramForwardOptions>
  ): any {
    return this.node(name, signatureOrAxGenOrClass as any, options);
  }

  /**
   * Applies a synchronous transformation to the state object.
   * Returns a new AxFlow type with the evolved state.
   *
   * @param transform - Function that takes the current state and returns a new state
   * @returns New AxFlow instance with updated TState type
   *
   * @example
   * ```typescript
   * flow.map(state => ({ ...state, processedText: state.text.toLowerCase() }))
   * ```
   */
  public map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    const step = (state: AxFlowState) => {
      return transform(state as TState);
    };

    if (this.branchContext?.currentBranchValue !== undefined) {
      // We're inside a branch - add to current branch
      const currentBranch =
        this.branchContext.branches.get(
          this.branchContext.currentBranchValue
        ) || [];
      currentBranch.push(step);
      this.branchContext.branches.set(
        this.branchContext.currentBranchValue,
        currentBranch
      );
    } else {
      // Normal execution - add to main flow
      this.flowDefinition.push(step);

      // Add to execution planner for automatic parallelization
      if (this.autoParallelConfig.enabled) {
        this.executionPlanner.addExecutionStep(
          step,
          undefined,
          undefined,
          'map',
          transform
        );
      }
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as unknown as AxFlow<IN, OUT, TNodes, TNewState>;
  }

  /**
   * Short alias for map()
   */
  public m<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    return this.map(transform);
  }

  /**
   * Labels a step for later reference (useful for feedback loops).
   *
   * @param label - The label to assign to the current step position
   * @returns this (for chaining, no type change)
   *
   * @example
   * ```typescript
   * flow.label('retry-point')
   *   .execute('queryGen', ...)
   * ```
   */
  public label(label: string): this {
    if (this.branchContext?.currentBranchValue !== undefined) {
      throw new Error('Cannot create labels inside branch blocks');
    }
    this.stepLabels.set(label, this.flowDefinition.length);
    return this;
  }

  /**
   * Short alias for label()
   */
  public l(label: string): this {
    return this.label(label);
  }

  /**
   * Executes a previously defined node with full type safety.
   * The node name must exist in TNodes, and the mapping function is typed based on the node's signature.
   *
   * @param nodeName - The name of the node to execute (must exist in TNodes)
   * @param mapping - Typed function that takes the current state and returns the input for the node
   * @param dynamicContext - Optional object to override the AI service or options for this specific step
   * @returns New AxFlow instance with TState augmented with the node's result
   *
   * @example
   * ```typescript
   * flow.execute('summarizer', state => ({ text: state.originalText }), { ai: cheapAI })
   * ```
   */
  public execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlow<
    IN,
    OUT,
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    if (!this.nodes.has(nodeName)) {
      throw new Error(
        `Node '${nodeName}' not found. Make sure to define it with .node() first.`
      );
    }

    const nodeProgram = this.nodeGenerators.get(nodeName);
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`);
    }

    const step = async (
      state: AxFlowState,
      context: Readonly<{
        mainAi: AxAIService;
        mainOptions?: AxProgramForwardOptions;
      }>
    ) => {
      // Determine AI service and options using fallback logic
      const ai = dynamicContext?.ai ?? context.mainAi;
      const options = dynamicContext?.options ?? context.mainOptions;

      // Map the state to node inputs (with type safety)
      const nodeInputs = mapping(state as TState);

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`;

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      });

      // Merge result back into state under a key like `${nodeName}Result`
      return {
        ...state,
        [`${nodeName}Result`]: result,
      };
    };

    if (this.branchContext?.currentBranchValue !== undefined) {
      // We're inside a branch - add to current branch
      const currentBranch =
        this.branchContext.branches.get(
          this.branchContext.currentBranchValue
        ) || [];
      currentBranch.push(step);
      this.branchContext.branches.set(
        this.branchContext.currentBranchValue,
        currentBranch
      );
    } else {
      // Normal execution - add to main flow
      this.flowDefinition.push(step);

      // Add to execution planner for automatic parallelization
      if (this.autoParallelConfig.enabled) {
        this.executionPlanner.addExecutionStep(step, nodeName, mapping);
      }
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as AxFlow<
      IN,
      OUT,
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >;
  }

  /**
   * Short alias for execute()
   */
  public e<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlow<
    IN,
    OUT,
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    return this.execute(nodeName, mapping, dynamicContext);
  }

  /**
   * Starts a conditional branch based on a predicate function.
   *
   * @param predicate - Function that takes state and returns a value to branch on
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.branch(state => state.qualityResult.needsMoreInfo)
   *   .when(true)
   *     .execute('queryGen', ...)
   *   .when(false)
   *     .execute('answer', ...)
   *   .merge()
   * ```
   */
  public branch(predicate: (state: TState) => unknown): this {
    if (this.branchContext) {
      throw new Error('Nested branches are not supported');
    }

    this.branchContext = {
      predicate: (state: AxFlowState) => predicate(state as TState),
      branches: new Map(),
      currentBranchValue: undefined,
    };

    return this;
  }

  /**
   * Short alias for branch()
   */
  public b(predicate: (state: TState) => unknown): this {
    return this.branch(predicate);
  }

  /**
   * Defines a branch case for the current branch context.
   *
   * @param value - The value to match against the branch predicate result
   * @returns this (for chaining)
   */
  public when(value: unknown): this {
    if (!this.branchContext) {
      throw new Error('when() called without matching branch()');
    }

    this.branchContext.currentBranchValue = value;
    this.branchContext.branches.set(value, []);

    return this;
  }

  /**
   * Short alias for when()
   */
  public w(value: unknown): this {
    return this.when(value);
  }

  /**
   * Merges the results of conditional branches into a single execution path.
   *
   * This method is called after defining conditional branches with branch() and when() methods.
   * It creates a merge point where the flow continues with the results from whichever
   * branch was executed based on the branch condition.
   *
   * How conditional merging works:
   * 1. The branch predicate is evaluated against the current state
   * 2. The matching branch's steps are executed sequentially
   * 3. If no branch matches, the state is returned unchanged
   * 4. The merged result becomes the new state for subsequent steps
   *
   * Type safety note:
   * The TMergedState generic allows for type-level tracking of what fields
   * will be available after the merge, though runtime behavior depends on
   * which branch actually executes.
   *
   * @returns AxFlow with updated state type reflecting the merged result
   *
   * @example
   * ```typescript
   * flow
   *   .branch(state => state.complexity > 0.5)
   *   .when(true)
   *     .execute('complexProcessor', state => ({ input: state.text }))
   *   .when(false)
   *     .execute('simpleProcessor', state => ({ input: state.text }))
   *   .merge() // Combines results from either branch
   * ```
   */
  public merge<TMergedState extends AxFlowState = TState>(): AxFlow<
    IN,
    OUT,
    TNodes,
    TMergedState
  > {
    if (!this.branchContext) {
      throw new Error('merge() called without matching branch()');
    }

    // Capture the branch context before clearing it
    const branchContext = this.branchContext;
    this.branchContext = null;

    // Create the merge step that will execute at runtime
    const mergeStep = async (state: AxFlowState, context: any) => {
      // Evaluate the branch predicate to determine which branch to execute
      const branchValue = branchContext.predicate(state);
      const branchSteps = branchContext.branches.get(branchValue);

      if (!branchSteps) {
        // No matching branch found - return state unchanged
        // This can happen if the predicate returns a value that wasn't
        // defined with a when() clause
        return state;
      }

      // Execute all steps in the matched branch sequentially
      // Each step receives the output of the previous step as input
      let currentState = state;
      for (const step of branchSteps) {
        currentState = await step(currentState, context);
      }

      return currentState;
    };

    // Add the merge step to the main flow execution
    this.flowDefinition.push(mergeStep);

    // Register with execution planner for automatic parallelization
    // This helps with signature inference and dependency analysis
    if (this.autoParallelConfig.enabled) {
      this.executionPlanner.addExecutionStep(
        mergeStep,
        undefined,
        undefined,
        'merge'
      );
    }

    // Type-level cast to update the state type while preserving the runtime object
    // This allows TypeScript to track what fields should be available after the merge
    return this as unknown as AxFlow<IN, OUT, TNodes, TMergedState>;
  }

  /**
   * Short alias for merge()
   */
  public mg<TMergedState extends AxFlowState = TState>(): AxFlow<
    IN,
    OUT,
    TNodes,
    TMergedState
  > {
    return this.merge<TMergedState>();
  }

  /**
   * Executes multiple operations in parallel and provides a merge method for combining results.
   *
   * This method enables true parallel execution of independent operations, which is particularly
   * useful for operations like:
   * - Multiple document retrievals
   * - Parallel processing of different data sources
   * - Independent LLM calls that can run simultaneously
   *
   * How parallel execution works:
   * 1. Each branch function receives a sub-context for defining operations
   * 2. All branches are executed simultaneously using Promise.all()
   * 3. Results are stored in _parallelResults for the merge operation
   * 4. The merge function combines the results into a single field
   *
   * Performance benefits:
   * - Reduces total execution time for independent operations
   * - Maximizes throughput for I/O-bound operations (like LLM calls)
   * - Maintains type safety through the merge operation
   *
   * @param branches - Array of functions that define parallel operations
   * @returns Object with merge method for combining results
   *
   * @example
   * ```typescript
   * flow.parallel([
   *   subFlow => subFlow.execute('retrieve1', state => ({ query: state.query1 })),
   *   subFlow => subFlow.execute('retrieve2', state => ({ query: state.query2 })),
   *   subFlow => subFlow.execute('retrieve3', state => ({ query: state.query3 }))
   * ]).merge('documents', (docs1, docs2, docs3) => [...docs1, ...docs2, ...docs3])
   * ```
   */
  public parallel(
    branches: (
      | AxFlowParallelBranch
      | AxFlowTypedParallelBranch<TNodes, TState>
    )[]
  ): {
    merge<T, TResultKey extends string>(
      resultKey: TResultKey,
      mergeFunction: (...results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>;
  } {
    // Create the parallel execution step
    const parallelStep = async (
      state: AxFlowState,
      context: Readonly<{
        mainAi: AxAIService;
        mainOptions?: AxProgramForwardOptions;
      }>
    ) => {
      // Execute all branches in parallel using Promise.all for maximum performance
      const promises = branches.map(async (branchFn) => {
        // Create a sub-context for this branch
        // This isolates each branch's operations from the others
        const subContext = new AxFlowSubContextImpl(this.nodeGenerators);

        // Type assertion needed because we support both typed and untyped branch functions
        // The runtime behavior is the same, but TypeScript needs this for type checking
        const populatedSubContext = branchFn(
          subContext as AxFlowSubContext & AxFlowTypedSubContext<TNodes, TState>
        );

        // Execute the sub-context steps and return the result
        return await populatedSubContext.executeSteps(state, context);
      });

      // Wait for all parallel operations to complete
      const results = await Promise.all(promises);

      // Store results in a special field for the merge operation
      // This is a temporary storage that will be cleaned up by the merge
      return {
        ...state,
        _parallelResults: results,
      };
    };

    // Add the parallel step to the main flow execution
    this.flowDefinition.push(parallelStep);

    // Register with execution planner (marked as 'other' since it's a special case)
    if (this.autoParallelConfig.enabled) {
      this.executionPlanner.addExecutionStep(
        parallelStep,
        undefined,
        undefined,
        'other',
        undefined,
        undefined
      );
    }

    // Return an object with the merge method for combining parallel results
    return {
      /**
       * Merges the results of parallel operations into a single field.
       *
       * @param resultKey - Name of the field to store the merged result
       * @param mergeFunction - Function that combines the parallel results
       * @returns AxFlow with the merged result added to the state
       */
      merge: <T, TResultKey extends string>(
        resultKey: TResultKey,
        mergeFunction: (...results: unknown[]) => T
      ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }> => {
        // Create the merge step that combines parallel results
        const parallelMergeStep = (state: AxFlowState) => {
          const results = state._parallelResults;
          if (!Array.isArray(results)) {
            throw new Error('No parallel results found for merge');
          }

          // Apply the merge function to combine all parallel results
          const mergedValue = mergeFunction(...results);

          // Create new state with the merged result and clean up temporary storage
          const newState = { ...state };
          newState._parallelResults = undefined; // Clean up temporary field
          newState[resultKey] = mergedValue;

          return newState;
        };

        // Add the merge step to the main flow execution
        this.flowDefinition.push(parallelMergeStep);

        // Register with execution planner for signature inference
        if (this.autoParallelConfig.enabled) {
          this.executionPlanner.addExecutionStep(
            parallelMergeStep,
            undefined,
            undefined,
            'merge',
            undefined,
            { resultKey, mergeFunction }
          );
        }

        // Type-level cast to include the new merged field in the state type
        return this as AxFlow<
          IN,
          OUT,
          TNodes,
          TState & { [K in TResultKey]: T }
        >;
      },
    };
  }

  /**
   * Short alias for parallel()
   */
  public p(
    branches: (
      | AxFlowParallelBranch
      | AxFlowTypedParallelBranch<TNodes, TState>
    )[]
  ): {
    merge<T, TResultKey extends string>(
      resultKey: TResultKey,
      mergeFunction: (...results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>;
  } {
    return this.parallel(branches);
  }

  /**
   * Creates a feedback loop that jumps back to a labeled step if a condition is met.
   *
   * @param condition - Function that returns true to trigger the feedback loop
   * @param targetLabel - The label to jump back to
   * @param maxIterations - Maximum number of iterations to prevent infinite loops (default: 10)
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.label('retry-point')
   *   .execute('answer', ...)
   *   .execute('qualityCheck', ...)
   *   .feedback(state => state.qualityCheckResult.confidence < 0.7, 'retry-point')
   * ```
   */
  public feedback(
    condition: (state: TState) => boolean,
    targetLabel: string,
    maxIterations = 10
  ): this {
    if (!this.stepLabels.has(targetLabel)) {
      throw new Error(
        `Label '${targetLabel}' not found. Make sure to define it with .label() before the feedback point.`
      );
    }

    const targetIndex = this.stepLabels.get(targetLabel)!;

    // Capture the current flow definition length before adding the feedback step
    // This prevents the feedback step from executing itself recursively
    const feedbackStepIndex = this.flowDefinition.length;

    this.flowDefinition.push(async (state, context) => {
      let currentState = state;
      let iterations = 1; // Start at 1 since we've already executed once before reaching feedback

      // Add iteration tracking to state if not present
      const iterationKey = `_feedback_${targetLabel}_iterations`;
      if (typeof currentState[iterationKey] !== 'number') {
        currentState = { ...currentState, [iterationKey]: 1 }; // Initial execution counts as iteration 1
      }

      // Check if we should loop back (iterations < maxIterations since initial execution counts as 1)
      while (condition(currentState as TState) && iterations < maxIterations) {
        iterations++;
        currentState = { ...currentState, [iterationKey]: iterations };

        // Execute steps from target index to just before the feedback step
        // Use feedbackStepIndex to avoid including the feedback step itself
        for (let i = targetIndex; i < feedbackStepIndex; i++) {
          const step = this.flowDefinition[i];
          if (step) {
            currentState = await step(currentState, context);
          }
        }
      }

      return currentState;
    });

    return this;
  }

  /**
   * Short alias for feedback()
   */
  public fb(
    condition: (state: TState) => boolean,
    targetLabel: string,
    maxIterations = 10
  ): this {
    return this.feedback(condition, targetLabel, maxIterations);
  }

  /**
   * Marks the beginning of a loop block.
   *
   * @param condition - Function that takes the current state and returns a boolean
   * @param maxIterations - Maximum number of iterations to prevent infinite loops (default: 100)
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.while(state => state.iterations < 3, 10)
   *   .map(state => ({ ...state, iterations: (state.iterations || 0) + 1 }))
   *   .endWhile()
   * ```
   */
  public while(
    condition: (state: TState) => boolean,
    maxIterations = 100
  ): this {
    // Store the condition and mark the start of the loop
    const loopStartIndex = this.flowDefinition.length;
    this.loopStack.push(loopStartIndex);

    // Add a placeholder step that will be replaced in endWhile()
    // We store the condition and maxIterations in the placeholder for later use
    interface LoopPlaceholder extends AxFlowStepFunction {
      _condition: (state: TState) => boolean;
      _maxIterations: number;
      _isLoopStart: boolean;
    }

    const placeholderStep: LoopPlaceholder = Object.assign(
      (state: AxFlowState) => state,
      {
        _condition: condition,
        _maxIterations: maxIterations,
        _isLoopStart: true,
      }
    );

    this.flowDefinition.push(placeholderStep);

    return this;
  }

  /**
   * Short alias for while()
   */
  public wh(condition: (state: TState) => boolean, maxIterations = 100): this {
    return this.while(condition, maxIterations);
  }

  /**
   * Marks the end of a loop block.
   *
   * @returns this (for chaining)
   */
  public endWhile(): this {
    if (this.loopStack.length === 0) {
      throw new Error('endWhile() called without matching while()');
    }

    const loopStartIndex = this.loopStack.pop()!;

    // Get the condition from the placeholder step
    const placeholderStep = this.flowDefinition[loopStartIndex];
    if (!placeholderStep || !('_isLoopStart' in placeholderStep)) {
      throw new Error('Loop start step not found or invalid');
    }

    const condition = (
      placeholderStep as unknown as {
        _condition: (state: TState) => boolean;
        _maxIterations: number;
      }
    )._condition;

    const maxIterations = (
      placeholderStep as unknown as {
        _condition: (state: TState) => boolean;
        _maxIterations: number;
      }
    )._maxIterations;

    // Extract the loop body steps (everything between while and endWhile)
    const loopBodySteps = this.flowDefinition.splice(loopStartIndex + 1);

    // Replace the placeholder with the actual loop implementation
    this.flowDefinition[loopStartIndex] = async (state, context) => {
      let currentState = state;
      let iterations = 0;

      // Execute the loop while condition is true and within iteration limit
      while (condition(currentState as TState) && iterations < maxIterations) {
        iterations++;

        // Execute all steps in the loop body
        for (const step of loopBodySteps) {
          currentState = await step(currentState, context);
        }
      }

      // Check if we exceeded the maximum iterations
      if (iterations >= maxIterations && condition(currentState as TState)) {
        throw new Error(
          `While loop exceeded maximum iterations (${maxIterations}). Consider increasing maxIterations or ensuring the loop condition eventually becomes false.`
        );
      }

      return currentState;
    };

    return this;
  }

  /**
   * Short alias for endWhile()
   */
  public end(): this {
    return this.endWhile();
  }

  /**
   * Executes the flow with the given AI service and input values.
   *
   * This is the main execution method that orchestrates the entire flow execution.
   * It handles several complex aspects:
   *
   * 1. **Dynamic Signature Inference**: If the flow was created with a default signature
   *    but has nodes defined, it will infer the actual signature from the flow structure.
   *
   * 2. **Execution Mode Selection**: Chooses between optimized parallel execution
   *    (when auto-parallel is enabled) or sequential execution based on configuration.
   *
   * 3. **State Management**: Maintains the evolving state object as it flows through
   *    each step, accumulating results and transformations.
   *
   * 4. **Performance Optimization**: Uses the execution planner to identify
   *    independent operations that can run in parallel, reducing total execution time.
   *
   * Execution Flow:
   * - Initialize state with input values
   * - Infer signature if needed (based on nodes and current signature)
   * - Choose execution strategy (parallel vs sequential)
   * - Execute all steps while maintaining state consistency
   * - Return final state cast to expected output type
   *
   * @param ai - The AI service to use as the default for all steps
   * @param values - The input values for the flow
   * @param options - Optional forward options to use as defaults (includes autoParallel override)
   * @returns Promise that resolves to the final output
   */
  public override async forward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions & { autoParallel?: boolean }>
  ): Promise<OUT> {
    // Dynamic signature inference - only if using default signature and have nodes
    // This allows flows to be created with a simple signature and then have it
    // automatically refined based on the actual nodes and operations defined
    if (
      this.nodeGenerators.size > 0 &&
      this.signature.toString() === 'userInput:string -> flowOutput:string'
    ) {
      const inferredSignature = this.inferSignatureFromFlow();
      this.signature = inferredSignature;
      this.sigHash = inferredSignature.hash();
    }

    // Initialize state with input values
    // This creates the initial state object that will flow through all steps
    let state: AxFlowState = { ...values };

    // Create execution context object
    // This provides consistent access to AI service and options for all steps
    const context = {
      mainAi: ai,
      mainOptions: options,
    } as const;

    // Determine execution strategy based on configuration
    // Auto-parallel can be disabled globally or overridden per execution
    const useAutoParallel =
      options?.autoParallel !== false && this.autoParallelConfig.enabled;

    if (useAutoParallel) {
      // OPTIMIZED PARALLEL EXECUTION PATH
      // This path uses the execution planner to identify independent operations
      // and execute them in parallel for better performance

      // Set initial fields for dependency analysis
      // This tells the planner what fields are available at the start
      this.executionPlanner.setInitialFields(Object.keys(values));

      // Get optimized execution plan with parallel groups
      const optimizedSteps = this.executionPlanner.createOptimizedExecution();

      // Execute optimized steps sequentially (parallel groups are handled internally)
      for (const step of optimizedSteps) {
        state = await step(state, context);
      }
    } else {
      // SEQUENTIAL EXECUTION PATH
      // This path executes all steps in the order they were defined
      // It's simpler but potentially slower for independent operations

      // Execute all steps sequentially
      for (const step of this.flowDefinition) {
        state = await step(state, context);
      }
    }

    // Return the final state cast to the expected output type
    // The type system ensures this is safe based on the signature inference
    return state as OUT;
  }

  /**
   * Gets execution plan information for debugging automatic parallelization
   *
   * @returns Object with execution plan details
   */
  public getExecutionPlan(): {
    totalSteps: number;
    parallelGroups: number;
    maxParallelism: number;
    autoParallelEnabled: boolean;
    steps?: AxFlowExecutionStep[];
    groups?: AxFlowParallelGroup[];
  } {
    const planInfo = this.executionPlanner.getExecutionPlan();
    return {
      totalSteps: planInfo.totalSteps,
      parallelGroups: planInfo.parallelGroups,
      maxParallelism: planInfo.maxParallelism,
      autoParallelEnabled: this.autoParallelConfig.enabled,
      steps: planInfo.steps,
      groups: planInfo.groups,
    };
  }
}

/**
 * Implementation of the sub-context for parallel execution
 */
class AxFlowSubContextImpl implements AxFlowSubContext {
  private readonly steps: AxFlowStepFunction[] = [];

  constructor(
    private readonly nodeGenerators: Map<
      string,
      AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
    >
  ) {}

  execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this {
    const nodeProgram = this.nodeGenerators.get(nodeName);
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`);
    }

    this.steps.push(async (state, context) => {
      const ai = dynamicContext?.ai ?? context.mainAi;
      const options = dynamicContext?.options ?? context.mainOptions;
      const nodeInputs = mapping(state);

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`;

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      });

      return {
        ...state,
        [`${nodeName}Result`]: result,
      };
    });

    return this;
  }

  map(transform: (state: AxFlowState) => AxFlowState): this {
    this.steps.push((state) => transform(state));
    return this;
  }

  async executeSteps(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState> {
    let currentState = initialState;

    for (const step of this.steps) {
      currentState = await step(currentState, context);
    }

    return currentState;
  }
}

/**
 * Typed implementation of the sub-context for parallel execution with full type safety
 */
// This class is used by the type system but not directly instantiated in this file
// NOTE: The `any` here is necessary for the same reason as in the interfaces above
export class AxFlowTypedSubContextImpl<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> implements AxFlowTypedSubContext<TNodes, TState>
{
  private readonly steps: AxFlowStepFunction[] = [];

  constructor(
    private readonly nodeGenerators: Map<
      string,
      AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
    >
  ) {}

  execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlowTypedSubContext<
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    const nodeProgram = this.nodeGenerators.get(nodeName);
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`);
    }

    this.steps.push(async (state, context) => {
      const ai = dynamicContext?.ai ?? context.mainAi;
      const options = dynamicContext?.options ?? context.mainOptions;
      const nodeInputs = mapping(state as TState);

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`;

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      });

      return {
        ...state,
        [`${nodeName}Result`]: result,
      };
    });

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as AxFlowTypedSubContext<
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >;
  }

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState> {
    this.steps.push((state) => transform(state as TState));
    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as unknown as AxFlowTypedSubContext<TNodes, TNewState>;
  }

  async executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState> {
    let currentState: AxFlowState = initialState;

    for (const step of this.steps) {
      currentState = await step(currentState, context);
    }

    return currentState;
  }
}
