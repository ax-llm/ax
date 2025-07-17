/* eslint-disable @typescript-eslint/no-explicit-any, functional/prefer-immutable-types */
import type { AxAIService } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import { AxProgram } from '../dsp/program.js';
import { type AxField, AxSignature } from '../dsp/sig.js';
import type {
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramDemos,
  AxProgramExamples,
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramStreamingForwardOptions,
  AxProgramTrace,
  AxProgramUsage,
  AxSetExamplesOptions,
} from '../dsp/types.js';
import { processBatches } from './batchUtil.js';
import { AxFlowExecutionPlanner } from './executionPlanner.js';
import { AxFlowSubContextImpl } from './subContext.js';
import { mergeProgramUsage } from '../dsp/util.js';
import type {
  AddNodeResult,
  AxFlowAutoParallelConfig,
  AxFlowable,
  AxFlowBranchContext,
  AxFlowDynamicContext,
  AxFlowExecutionStep,
  AxFlowNodeDefinition,
  AxFlowParallelBranch,
  AxFlowParallelGroup,
  AxFlowState,
  AxFlowStepFunction,
  AxFlowSubContext,
  AxFlowTypedParallelBranch,
  AxFlowTypedSubContext,
  GetGenIn,
  GetGenOut,
  InferAxGen,
} from './types.js';

/**
 * AxFlow - A fluent, chainable API for building and orchestrating complex, stateful AI programs.
 *
 * Now with advanced type-safe chaining where each method call evolves the type information,
 * providing compile-time type safety and superior IntelliSense.
 *
 * @example
 * ```
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
  // NOTE: The `any` here is necessary because TNodes must accommodate AxProgrammable instances with various input/output types
  TNodes extends Record<string, AxProgrammable<any, any>> = Record<
    string,
    never
  >, // Node registry for type tracking
  TState extends AxFlowState = IN, // Current evolving state type
> implements AxFlowable<IN, OUT>
{
  private readonly nodes: Map<string, AxFlowNodeDefinition> = new Map();
  private readonly flowDefinition: AxFlowStepFunction[] = [];
  private readonly nodeGenerators: Map<
    string,
    AxProgrammable<AxGenIn, AxGenOut, unknown>
  > = new Map();
  private readonly loopStack: number[] = [];
  private readonly stepLabels: Map<string, number> = new Map();
  private branchContext: AxFlowBranchContext | null = null;

  // Automatic parallelization components
  private readonly autoParallelConfig: AxFlowAutoParallelConfig;
  private readonly executionPlanner = new AxFlowExecutionPlanner();

  // Program field that gets initialized when something is added to the graph
  private program?: AxProgram<IN, OUT>;

  // Node-level usage tracking
  private nodeUsage: Map<string, AxProgramUsage[]> = new Map();

  // Node-level trace tracking
  private nodeTraces: Map<string, AxProgramTrace<any, any>[]> = new Map();

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
    // Get execution plan to identify dependencies and field flow
    const executionPlan = this.executionPlanner.getExecutionPlan();

    // If no nodes are defined AND no execution steps, return a default signature
    if (this.nodeGenerators.size === 0 && executionPlan.steps.length === 0) {
      // Create a default signature for flows without nodes or steps
      const defaultSignature = new AxSignature();
      defaultSignature.addInputField({
        name: 'userInput',
        type: { name: 'string' },
        description: 'User input to the flow',
      });
      defaultSignature.addOutputField({
        name: 'flowOutput',
        type: { name: 'string' },
        description: 'Output from the flow',
      });
      return defaultSignature;
    }

    // This gives us a structured view of what each step consumes and produces
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
    // Note: For derive operations, use standard logic to handle multiple derives properly
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
          // If this is a node result field (ends with "Result"), extract the actual output field names
          if (produced.endsWith('Result')) {
            const nodeName = produced.replace('Result', '');
            const nodeGen = this.nodeGenerators.get(nodeName);
            if (nodeGen) {
              const nodeSignature = nodeGen.getSignature();
              const sig = new AxSignature(nodeSignature);
              const outputFields = sig.getOutputFields();

              // Add the actual output field names from the node signature
              for (const field of outputFields) {
                outputFieldNames.add(field.name);
              }
            } else {
              // Fallback to the original field name if node not found
              outputFieldNames.add(produced);
            }
          } else {
            outputFieldNames.add(produced);
          }
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
      // Skip internal fields that start with underscore
      if (fieldName.startsWith('_')) {
        continue;
      }
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
    batchSize?: number;
  }) {
    // Initialize configuration with defaults
    this.autoParallelConfig = {
      enabled: options?.autoParallel !== false, // Default to true
      batchSize: options?.batchSize || 10, // Default batch size of 10
    };
  }

  /**
   * Initializes the program field every time something is  added to the graph
   */
  private ensureProgram(): void {
    // Create program with inferred signature
    const signature = this.inferSignatureFromFlow();
    this.program = new AxProgram<IN, OUT>(signature);
  }

  public setExamples(
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ): void {
    this.ensureProgram();
    this.program!.setExamples(examples, options);
  }

  public setId(id: string): void {
    this.ensureProgram();
    this.program!.setId(id);
  }

  public setParentId(parentId: string): void {
    this.ensureProgram();
    this.program!.setParentId(parentId);
  }

  public getTraces(): AxProgramTrace<IN, OUT>[] {
    // Collect traces from all nodes
    const allTraces: AxProgramTrace<IN, OUT>[] = [];

    for (const [_nodeName, nodeTraces] of this.nodeTraces) {
      // Cast the traces to the expected type since they should be compatible
      allTraces.push(...(nodeTraces as AxProgramTrace<IN, OUT>[]));
    }

    return allTraces;
  }

  public setDemos(demos: readonly AxProgramDemos<IN, OUT>[]): void {
    this.ensureProgram();
    this.program!.setDemos(demos);
  }

  public getUsage(): AxProgramUsage[] {
    // Collect usage from all nodes and merge
    const allUsage: AxProgramUsage[] = [];

    for (const [_nodeName, nodeUsage] of this.nodeUsage) {
      allUsage.push(...nodeUsage);
    }

    return mergeProgramUsage(allUsage);
  }

  public resetUsage(): void {
    // Clear node-level usage tracking
    this.nodeUsage.clear();

    // Also reset usage on all node generators
    for (const [_nodeName, nodeProgram] of this.nodeGenerators) {
      if (nodeProgram && 'resetUsage' in nodeProgram) {
        nodeProgram.resetUsage();
      }
    }
  }

  /**
   * Resets trace tracking for the flow.
   * This is called automatically on each forward/streamingForward call.
   */
  public resetTraces(): void {
    // Clear node-level trace tracking
    this.nodeTraces.clear();

    // Note: Individual node programs don't have resetTraces method,
    // so we only clear the flow-level trace collection
  }

  /**
   * Gets a detailed usage report broken down by node name.
   * This provides visibility into which nodes are consuming the most tokens.
   *
   * @returns Object mapping node names to their usage statistics
   */
  public getUsageReport(): Record<string, AxProgramUsage[]> {
    const report: Record<string, AxProgramUsage[]> = {};

    for (const [nodeName, nodeUsage] of this.nodeUsage) {
      report[nodeName] = mergeProgramUsage(nodeUsage);
    }

    return report;
  }

  /**
   * Gets a detailed trace report broken down by node name.
   * This provides visibility into the execution traces for each node.
   *
   * @returns Object mapping node names to their trace data
   */
  public getTracesReport(): Record<string, AxProgramTrace<any, any>[]> {
    const report: Record<string, AxProgramTrace<any, any>[]> = {};

    for (const [nodeName, nodeTraces] of this.nodeTraces) {
      report[nodeName] = nodeTraces;
    }

    return report;
  }

  public async *streamingForward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<
      AxProgramStreamingForwardOptions<
        NonNullable<ReturnType<T['getModelList']>>[number]['key']
      >
    >
  ): AxGenStreamingOut<OUT> {
    // For now, we'll implement streaming by converting the regular forward result
    // This is a simplified implementation - full streaming would require more work
    // Note: forward() will handle the resetUsage() call
    const result = await this.forward(ai, values, options);

    // Yield the final result with correct AxGenDeltaOut structure
    yield {
      version: 1,
      index: 0,
      delta: result,
    };
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
  public async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<
      AxProgramForwardOptions<
        NonNullable<ReturnType<T['getModelList']>>[number]['key']
      > & { autoParallel?: boolean }
    >
  ): Promise<OUT> {
    // Reset usage and trace tracking at the start of each forward call
    this.resetUsage();
    this.resetTraces();

    // Extract values from input - handle both IN and AxMessage<IN>[] cases
    let inputValues: IN;
    if (Array.isArray(values)) {
      // If values is an array of messages, find the most recent user message
      const lastUserMessage = values.filter((msg) => msg.role === 'user').pop();
      if (!lastUserMessage) {
        throw new Error('No user message found in values array');
      }
      inputValues = lastUserMessage.values;
    } else {
      // If values is a single IN object
      inputValues = values;
    }

    // Dynamic signature inference - only if using default signature and have nodes
    // This allows flows to be created with a simple signature and then have it
    // automatically refined based on the actual nodes and operations defined
    if (this.nodeGenerators.size > 0) {
      // Initialize program with inferred signature
      this.ensureProgram();
    }

    // Initialize state with input values
    // This creates the initial state object that will flow through all steps
    let state: AxFlowState = { ...inputValues };

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
      this.executionPlanner.setInitialFields(Object.keys(inputValues));

      // Get optimized execution plan with parallel groups and batch size control
      const optimizedSteps = this.executionPlanner.createOptimizedExecution(
        this.autoParallelConfig.batchSize
      );

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
   * Declares a reusable computational node using a signature string.
   * Returns a new AxFlow type that tracks this node in the TNodes registry.
   *
   * @param name - The name of the node
   * @param signature - Signature string in the same format as AxSignature
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```
   * flow.node('summarizer', 'text:string -> summary:string')
   * flow.node('analyzer', 'text:string -> analysis:string, confidence:number', { debug: true })
   * ```
   */
  public node<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig
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
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```
   * const sig = new AxSignature('text:string -> summary:string')
   * flow.node('summarizer', sig, { temperature: 0.1 })
   * ```
   */
  public node<TName extends string>(
    name: TName,
    signature: AxSignature
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> }, // Add new node to registry
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
   * ```
   * class CustomProgram extends AxProgram<{ input: string }, { output: string }> {
   *   async forward(ai, values) { return { output: values.input.toUpperCase() } }
   * }
   * flow.node('custom', CustomProgram)
   * ```
   */
  public node<
    TName extends string,
    TProgram extends new () => AxProgrammable<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: InstanceType<TProgram> }, // Add new node to registry with exact type
    TState // State unchanged
  >;

  /**
   * Declares a reusable computational node using an AxProgrammable instance.
   * This allows using pre-configured AxGen instances or other programmable objects in the flow.
   *
   * @param name - The name of the node
   * @param programInstance - The AxProgrammable instance to use for this node
   * @returns New AxFlow instance with updated TNodes type
   */
  public node<TName extends string, TProgram extends AxProgrammable<any, any>>(
    name: TName,
    programInstance: TProgram
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: TProgram }, // Add new node to registry with exact type
    TState // State unchanged
  >;

  // Implementation
  public node<TName extends string>(
    name: TName,
    nodeValue:
      | string
      | AxSignature
      | AxProgrammable<any, any>
      | (new () => AxProgrammable<any, any>)
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: any }, // Using any here as the implementation handles all cases
    TState
  > {
    if (typeof nodeValue === 'string' || nodeValue instanceof AxSignature) {
      // Using signature string (original behavior)
      const signature = nodeValue;

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
      const nodeGenerator = new AxGen(signature);
      this.nodeGenerators.set(name, nodeGenerator);

      // Register the node with the program after program is initialized
      this.ensureProgram();
      this.program!.register(nodeGenerator as any);
    } else if (typeof nodeValue === 'function') {
      // Using program class
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      });

      // Create an instance of the program class and store it directly
      const programInstance = new nodeValue() as AxProgrammable<
        AxGenIn,
        AxGenOut
      >;
      this.nodeGenerators.set(name, programInstance);

      // Register the node with the program after program is initialized
      this.ensureProgram();
      this.program!.register(programInstance as any);
    } else if (
      nodeValue &&
      typeof nodeValue === 'object' &&
      'forward' in nodeValue
    ) {
      // Using existing AxGen instance or AxProgrammable instance
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      });

      // Store the existing AxGen instance
      const nodeGenerator = nodeValue as AxProgrammable<AxGenIn, AxGenOut>;
      this.nodeGenerators.set(name, nodeGenerator);

      // Register the node with the program after program is initialized
      this.ensureProgram();
      this.program!.register(nodeGenerator as any);
    } else {
      // Invalid argument type
      throw new Error(
        `Invalid second argument for node '${name}': expected string, AxSignature, AxProgrammable instance, or constructor function`
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
    signature: TSig
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InferAxGen<TSig> }, TState>;

  public n<TName extends string>(
    name: TName,
    signature: AxSignature
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  >;

  public n<
    TName extends string,
    TProgram extends new () => AxProgrammable<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InstanceType<TProgram> }, TState>;

  public n<TName extends string, TProgram extends AxProgrammable<any, any>>(
    name: TName,
    programInstance: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: TProgram }, TState>;

  public n<TName extends string>(
    name: TName,
    signatureOrAxGenOrClass:
      | string
      | AxSignature
      | AxProgrammable<any, any>
      | (new () => AxProgrammable<any, any>)
  ): any {
    return this.node(name, signatureOrAxGenOrClass as any);
  }

  /**
   * Applies a synchronous transformation to the state object.
   * Returns a new AxFlow type with the evolved state.
   *
   * @param transform - Function that takes the current state and returns a new state
   * @returns New AxFlow instance with updated TState type
   *
   * @example
   * ```
   * flow.map(state => ({ ...state, processedText: state.text.toLowerCase() }))
   * ```
   */
  public map<TNewState extends AxFlowState>(
    transform: (_state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState>;

  /**
   * Applies a transformation to the state object with optional parallel execution.
   * When parallel is enabled, the transform function should prepare data for parallel processing.
   * The actual parallel processing happens with the array of transforms provided.
   *
   * @param transforms - Array of transformation functions to apply in parallel
   * @param options - Options including parallel execution configuration
   * @returns New AxFlow instance with updated TState type
   *
   * @example
   * ```
   * // Parallel map with multiple transforms
   * flow.map([
   *   state => ({ ...state, result1: processA(state.data) }),
   *   state => ({ ...state, result2: processB(state.data) }),
   *   state => ({ ...state, result3: processC(state.data) })
   * ], { parallel: true })
   * ```
   */
  public map<TNewState extends AxFlowState>(
    transforms: Array<(_state: TState) => TNewState>,
    options: { parallel: true }
  ): AxFlow<IN, OUT, TNodes, TNewState>;

  public map<TNewState extends AxFlowState>(
    transform: (_state: TState) => TNewState,
    options?: { parallel?: boolean }
  ): AxFlow<IN, OUT, TNodes, TNewState>;

  public map<TNewState extends AxFlowState>(
    transformOrTransforms: any,
    options?: { parallel?: boolean }
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    // Check if parallel processing is requested
    if (options?.parallel) {
      // Determine if we have an array of transforms or a single transform
      const transforms = Array.isArray(transformOrTransforms)
        ? transformOrTransforms
        : [transformOrTransforms];

      // Create a parallel map step using the existing parallel infrastructure pattern
      const parallelMapStep = async (state: AxFlowState) => {
        // Execute transforms with batch size control
        const orderedResults = await processBatches(
          transforms,
          async (transform, _index) => {
            // Apply each transform to the state
            return transform(state as TState);
          },
          this.autoParallelConfig.batchSize
        );

        // For parallel map, merge results by taking the last one (most recent state)
        // or if only one transform, return that result
        return orderedResults[orderedResults.length - 1];
      };

      // Add the parallel step to the flow
      if (this.branchContext?.currentBranchValue !== undefined) {
        const currentBranch =
          this.branchContext.branches.get(
            this.branchContext.currentBranchValue
          ) || [];
        currentBranch.push(parallelMapStep);
        this.branchContext.branches.set(
          this.branchContext.currentBranchValue,
          currentBranch
        );
      } else {
        this.flowDefinition.push(parallelMapStep);

        // Register with execution planner as parallel operation
        if (this.autoParallelConfig.enabled) {
          this.executionPlanner.addExecutionStep(
            parallelMapStep,
            undefined,
            undefined,
            'parallel-map'
          );
        }
      }
    } else {
      // Regular synchronous map operation
      const step = (state: AxFlowState) => {
        // For non-parallel mode, only single transforms are supported
        if (Array.isArray(transformOrTransforms)) {
          throw new Error('Array of transforms requires parallel: true option');
        }
        return transformOrTransforms(state as TState);
      };

      if (this.branchContext?.currentBranchValue !== undefined) {
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
        this.flowDefinition.push(step);

        // Add to execution planner for automatic parallelization
        if (this.autoParallelConfig.enabled) {
          this.executionPlanner.addExecutionStep(
            step,
            undefined,
            undefined,
            'map',
            transformOrTransforms
          );
        }
      }
    }

    // Initialize program when flow structure is updated (only if we have nodes)
    if (this.nodeGenerators.size > 0) {
      this.ensureProgram();
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as unknown as AxFlow<IN, OUT, TNodes, TNewState>;
  }

  /**
   * Short alias for map() - supports parallel option
   */
  public m<TNewState extends AxFlowState>(
    transform: (_state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState>;

  public m<TNewState extends AxFlowState>(
    transforms: Array<(_state: TState) => TNewState>,
    options: { parallel: true }
  ): AxFlow<IN, OUT, TNodes, TNewState>;

  public m<TNewState extends AxFlowState>(
    transformOrTransforms:
      | ((_state: TState) => TNewState)
      | Array<(_state: TState) => TNewState>,
    options?: { parallel?: boolean }
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    return this.map(transformOrTransforms as any, options);
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
  public execute<
    TNodeName extends keyof TNodes & string,
    TAI extends Readonly<AxAIService>,
  >(
    nodeName: TNodeName,
    mapping: (_state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext<TAI>
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
        mainOptions?: AxProgramForwardOptions<string>;
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
      // Handle both AxGen and AxProgram types
      let result: any;
      if (
        'forward' in nodeProgram &&
        typeof nodeProgram.forward === 'function'
      ) {
        result = await nodeProgram.forward(ai, nodeInputs, {
          ...options,
          traceLabel,
        });

        // Collect usage from the node after execution
        if (
          'getUsage' in nodeProgram &&
          typeof nodeProgram.getUsage === 'function'
        ) {
          const nodeUsage = nodeProgram.getUsage();
          if (nodeUsage && nodeUsage.length > 0) {
            // Store usage for this node
            const existingUsage = this.nodeUsage.get(nodeName) || [];
            this.nodeUsage.set(nodeName, [...existingUsage, ...nodeUsage]);
          }
        }

        // Collect traces from the node after execution
        if (
          'getTraces' in nodeProgram &&
          typeof nodeProgram.getTraces === 'function'
        ) {
          const nodeTraces = nodeProgram.getTraces();
          if (nodeTraces && nodeTraces.length > 0) {
            // Store traces for this node
            const existingTraces = this.nodeTraces.get(nodeName) || [];
            this.nodeTraces.set(nodeName, [...existingTraces, ...nodeTraces]);
          }
        }
      } else {
        throw new Error(
          `Node program for '${nodeName}' does not have a forward method`
        );
      }

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

    // Initialize program when flow structure is updated
    this.ensureProgram();

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
  public e<
    TNodeName extends keyof TNodes & string,
    TAI extends Readonly<AxAIService>,
  >(
    nodeName: TNodeName,
    mapping: (_state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext<TAI>
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
  public branch(predicate: (_state: TState) => unknown): this {
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
  public b(predicate: (_state: TState) => unknown): this {
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

    // Initialize program when flow structure is updated
    this.ensureProgram();

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
      mergeFunction: (..._results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>;
  } {
    // Create the parallel execution step
    const parallelStep = async (
      state: AxFlowState,
      context: Readonly<{
        mainAi: AxAIService;
        mainOptions?: AxProgramForwardOptions<string>;
      }>
    ) => {
      // Execute branches with batch size control
      const results = await processBatches(
        branches,
        async (branchFn, _index) => {
          // Create a sub-context for this branch
          // This isolates each branch's operations from the others
          const subContext = new AxFlowSubContextImpl(this.nodeGenerators);

          // Type assertion needed because we support both typed and untyped branch functions
          // The runtime behavior is the same, but TypeScript needs this for type checking
          const populatedSubContext = branchFn(
            subContext as AxFlowSubContext &
              AxFlowTypedSubContext<TNodes, TState>
          );

          // Execute the sub-context steps and return the result
          return await populatedSubContext.executeSteps(state, context);
        },
        this.autoParallelConfig.batchSize
      );

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
        'parallel',
        undefined,
        undefined
      );
    }

    // Initialize program when flow structure is updated
    this.ensureProgram();

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
          delete newState._parallelResults; // Properly delete temporary field
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

        // Initialize program when flow structure is updated
        this.ensureProgram();

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
      mergeFunction: (..._results: unknown[]) => T
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
    condition: (_state: TState) => boolean,
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

    // Initialize program when flow structure is updated (only if we have nodes)
    if (this.nodeGenerators.size > 0) {
      this.ensureProgram();
    }

    return this;
  }

  /**
   * Short alias for feedback()
   */
  public fb(
    condition: (_state: TState) => boolean,
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

    // Initialize program when flow structure is updated (only if we have nodes)
    if (this.nodeGenerators.size > 0) {
      this.ensureProgram();
    }

    return this;
  }

  /**
   * Short alias for while()
   */
  public wh(condition: (_state: TState) => boolean, maxIterations = 100): this {
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

    // Initialize program when flow structure is updated (only if we have nodes)
    if (this.nodeGenerators.size > 0) {
      this.ensureProgram();
    }

    return this;
  }

  /**
   * Short alias for endWhile()
   */
  public end(): this {
    return this.endWhile();
  }

  /**
   * Derives a new field from an existing field by applying a transform function.
   *
   * If the input field contains an array, the transform function is applied to each
   * array element in parallel with batch size control. If the input field contains
   * a scalar value, the transform function is applied directly.
   *
   * @param outputFieldName - Name of the field to store the result
   * @param inputFieldName - Name of the existing field to transform
   * @param transformFn - Function to apply to each element (for arrays) or the value directly (for scalars)
   * @param options - Options including batch size for parallel processing
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * // Parallel processing of array items
   * flow.derive('processedItems', 'items', (item, index) => processItem(item), { batchSize: 5 })
   *
   * // Direct transformation of scalar value
   * flow.derive('upperText', 'text', (text) => text.toUpperCase())
   * ```
   */
  public derive<T>(
    outputFieldName: string,
    inputFieldName: string,
    transformFn: (value: any, index?: number, state?: TState) => T,
    options?: { batchSize?: number }
  ): this {
    const step = async (state: AxFlowState) => {
      const inputValue = state[inputFieldName];

      if (inputValue === undefined) {
        throw new Error(`Input field '${inputFieldName}' not found in state`);
      }

      let result: T | T[];

      if (Array.isArray(inputValue)) {
        // Array input - use parallel processing with batch control
        if (this.autoParallelConfig.enabled) {
          const batchSize =
            options?.batchSize || this.autoParallelConfig.batchSize;
          result = await processBatches(
            inputValue,
            async (item, index) => {
              return transformFn(item, index, state as TState);
            },
            batchSize
          );
        } else {
          // Sequential processing when parallel is disabled
          result = inputValue.map((item: any, index: number) =>
            transformFn(item, index, state as TState)
          );
        }
      } else {
        // Scalar input - apply transform directly
        result = transformFn(inputValue, undefined, state as TState);
      }

      return {
        ...state,
        [outputFieldName]: result,
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

      // Register with execution planner for signature inference and automatic parallelization
      if (this.autoParallelConfig.enabled) {
        this.executionPlanner.addExecutionStep(
          step,
          undefined,
          undefined,
          'derive',
          transformFn as any,
          undefined,
          {
            inputFieldName,
            outputFieldName,
            batchSize: options?.batchSize,
          }
        );
      }
    }

    // Initialize program when flow structure is updated
    this.ensureProgram();

    return this;
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

  public getSignature(): AxSignature {
    this.ensureProgram();
    return this.program!.getSignature();
  }
}
