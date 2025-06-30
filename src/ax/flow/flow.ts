import {
  AxProgram,
  AxProgramForwardOptions,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxProgramStreamingForwardOptions
} from '../dsp/program';
import { AxSignature } from '../dsp/sig';
import type { AxAIService } from '../ai/types';
import { AxGen } from '../dsp/generate';

// Represents a node in the flow. Could be an AxProgram or a simple function.
export interface AxFlowNode<IN extends AxGenIn, OUT extends AxGenOut> {
  // Option 1: If we want to enforce AxProgram compatibility strictly
  // program: AxProgram<IN, OUT>;

  // Option 2: A more generic execute method
  execute(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT>;

  getSignature?(): AxSignature | undefined;
}

// A wrapper for AxProgram to be used as an AxFlowNode
class AxProgramNode<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxFlowNode<IN, OUT>
{
  constructor(public program: AxProgram<IN, OUT>) {}

  async execute(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    return this.program.forward(ai, values, options);
  }

  getSignature(): AxSignature | undefined {
    if ('getSignature' in this.program) {
      return (this.program as any).getSignature();
    }
    return undefined;
  }
}

// Type for functions that map the flow's state to a node's input
export type InputMapper<FlowState, NodeIN extends AxGenIn> = (
  state: Readonly<FlowState>
) => NodeIN;

// Type for functions that update the flow's state from a node's output
export type OutputAccumulator<FlowState, NodeOUT extends AxGenOut> = (
  state: FlowState,
  output: Readonly<NodeOUT>
) => void; // Modifies state directly or returns new state

// Type for functions that update the flow's state (general map operation)
export type StateMapper<FlowState> = (state: FlowState) => FlowState | void; // Can return new state or modify in place

// Type for predicates used in while loops or conditional branches
export type Predicate<FlowState> = (state: Readonly<FlowState>) => boolean;

// Represents an operation in the flow
interface AxFlowOperation<FlowState> {
  type: string;
  execute(
    state: FlowState,
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<FlowState>; // Each operation can modify the state
}

// Concrete operation types
class ExecuteNodeOperation<
  FlowState,
  NodeIN extends AxGenIn,
  NodeOUT extends AxGenOut,
> implements AxFlowOperation<FlowState>
{
  type = 'executeNode';
  constructor(
    private nodeName: string,
    private inputMapper: InputMapper<FlowState, NodeIN>,
    private outputAccumulator?: OutputAccumulator<FlowState, NodeOUT> // Optional: if not provided, output might be stored directly by name or ignored
  ) {}

  async execute(
    state: FlowState,
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<FlowState> {
    const node = (state as any).nodes[this.nodeName] as AxFlowNode<
      NodeIN,
      NodeOUT
    >;
    if (!node) {
      throw new Error(`Node "${this.nodeName}" not found in flow state.`);
    }
    const input = this.inputMapper(state);
    const output = await node.execute(ai, input, options);

    if (this.outputAccumulator) {
      this.outputAccumulator(state, output);
    } else {
      // Default behavior: store output in state under nodeName_output or similar
      (state as any)[`${this.nodeName}_output`] = output;
    }
    return state;
  }
}

class MapOperation<FlowState> implements AxFlowOperation<FlowState> {
  type = 'map';
  constructor(private mapper: StateMapper<FlowState>) {}

  async execute(state: FlowState): Promise<FlowState> {
    const newState = this.mapper(state);
    return newState || state; // If mapper returns void, assume it modified state in place
  }
}

class WhileOperation<FlowState, ParentFlow extends AxFlow<any, any, FlowState>> implements AxFlowOperation<FlowState> {
  type = 'while';
  private loopBody: AxFlowOperation<FlowState>[] = [];

  constructor(
    private predicate: Predicate<FlowState>,
    private flow: ParentFlow // Pass the flow to allow adding operations to this while loop and returning to it
  ) {}

  // Methods to build the while loop body, returning 'this' for chaining within the while block
  addExecuteStep<NodeIN extends AxGenIn, NodeOUT extends AxGenOut>(
    nodeName: string,
    inputMapper: InputMapper<FlowState, NodeIN>,
    outputAccumulator?: OutputAccumulator<FlowState, NodeOUT>
  ): this {
    this.loopBody.push(
      new ExecuteNodeOperation(nodeName, inputMapper, outputAccumulator)
    );
    return this;
  }

  addMapStep(mapper: StateMapper<FlowState>): this {
    this.loopBody.push(new MapOperation(mapper));
    return this;
  }

  endWhile(): ParentFlow {
    return this.flow;
  }

  // TODO: Add breakIf, accumulate, increment etc. specific to while or make them general operations

  async execute(
    state: FlowState,
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<FlowState> {
    let currentState = state;
    while (this.predicate(currentState)) {
      for (const operation of this.loopBody) {
        currentState = await operation.execute(currentState, ai, options);
      }
    }
    return currentState;
  }
}

// The main AxFlow class
export class AxFlow<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  FlowState extends object = IN & { nodes?: Record<string, AxFlowNode<any, any>> } // Ensure FlowState is an object type
> extends AxProgram<IN, OUT> {
  private operations: AxFlowOperation<FlowState>[] = [];
  private nodes: Record<string, AxFlowNode<any, any>> = {};
  private initialStateFactory: (input: IN) => FlowState = (input) =>
    ({ ...input, nodes: this.nodes } as FlowState);
  private outputMapper?: (state: Readonly<FlowState>) => OUT;

  private flowInputSignature?: AxSignature;
  private flowOutputSignature?: AxSignature;

  constructor(nodes?: Record<string, AxProgram<any, any> | AxFlowNode<any, any>>) {
    super();
    if (nodes) {
      for (const name in nodes) {
        const node = nodes[name];
        if (node instanceof AxProgram) {
          this.nodes[name] = new AxProgramNode(node);
        } else {
          // Ensure it's a valid AxFlowNode (basic check)
          if (typeof (node as any)?.execute !== 'function') {
            throw new Error(`Node "${name}" does not implement AxFlowNode interface (missing execute method).`);
          }
          this.nodes[name] = node;
        }
      }
    }
  }

  // --- Methods to define the flow ---

  input(
    signature: string | AxSignature,
    initialStateFactory?: (input: IN) => FlowState
  ): this {
    this.flowInputSignature = new AxSignature(signature);
    if (initialStateFactory) {
      this.initialStateFactory = (input: IN): FlowState => {
        const baseState = initialStateFactory(input);
        // Ensure nodes are part of the state if the factory doesn't add them
        return { ...baseState, nodes: this.nodes, ...(!('nodes' in baseState) && { nodes: this.nodes }) } as FlowState;

      }
    } else {
        // Default factory needs to be redefined to include current nodes
        this.initialStateFactory = (input: IN): FlowState =>
            ({ ...input, nodes: this.nodes } as FlowState);
    }
    // TODO: Potentially set the program's main signature's input fields here
    // This would require AxProgram to allow late binding of its signature
    return this;
  }

  node(
    name: string,
    program: AxProgram<any, any> | AxFlowNode<any, any> | string
  ): this {
    if (typeof program === 'string') {
      const sig = new AxSignature(program);
      this.nodes[name] = new AxProgramNode(new AxGen(sig));
    } else if (program instanceof AxProgram) {
      this.nodes[name] = new AxProgramNode(program);
    } else {
      if (typeof (program as any)?.execute !== 'function') {
        throw new Error(`Invalid object provided for node "${name}". It must be an AxProgram or implement AxFlowNode.`);
      }
      this.nodes[name] = program;
    }
    // If initialStateFactory was already set using the default, update it to include the new node collection
    // This is a bit tricky; ideally, initialStateFactory is set after all nodes are defined, or it's dynamic.
    // For simplicity now, we assume nodes are added before `input` or the factory handles it.
    return this;
  }

  execute<NodeIN extends AxGenIn, NodeOUT extends AxGenOut>(
    nodeName: string,
    inputMapper: InputMapper<FlowState, NodeIN>,
    outputAccumulator?: OutputAccumulator<FlowState, NodeOUT>
  ): this {
    if (!this.nodes[nodeName] && !(('nodes' in {} as FlowState) && ({} as FlowState).nodes?.[nodeName])) {
        // This check is a bit weak if nodes are only dynamically added to state by initialStateFactory
        // A more robust check would be at runtime in ExecuteNodeOperation
        console.warn(`Node "${nodeName}" is being used in an execute operation but has not been explicitly added to the flow via .node(). Ensure it will be available in the FlowState.`);
    }
    this.operations.push(
      new ExecuteNodeOperation(nodeName, inputMapper, outputAccumulator)
    );
    return this;
  }

  map(mapper: StateMapper<FlowState>): this {
    this.operations.push(new MapOperation(mapper));
    return this;
  }

  while(predicate: Predicate<FlowState>): WhileOperation<FlowState, this> {
    const whileOp = new WhileOperation<FlowState, this>(predicate, this);
    this.operations.push(whileOp);
    return whileOp;
  }

  // TODO: Implement accumulate, breakIf, branch, parallel, feedback etc.
  // endWhile is now part of WhileOperation

  output(
    signature: string | AxSignature,
    outputMapper: (state: Readonly<FlowState>) => OUT
  ): this {
    this.flowOutputSignature = new AxSignature(signature);
    this.outputMapper = outputMapper;
    // TODO: Potentially set the program's main signature's output fields here
    return this;
  }

  // --- AxProgram implementation ---

  public override async forward(
    ai: Readonly<AxAIService>,
    values: IN, // These are the initial values for the flow, matching IN
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    if (!this.flowInputSignature) {
      throw new Error(
        'Input signature not defined for the flow. Call .input() to define it.'
      );
    }
    // TODO: Validate `values` against `this.flowInputSignature`

    if (!this.outputMapper || !this.flowOutputSignature) {
      throw new Error(
        'Output signature and mapper not defined for the flow. Call .output() to define them.'
      );
    }

    // Initialize the state for this execution run
    // The initialStateFactory is responsible for setting up the initial FlowState,
    // including making nodes accessible if needed (e.g., by embedding this.nodes).
    let currentState: FlowState = this.initialStateFactory(values);

    // Ensure 'nodes' is part of the state if not already added by a custom factory
    if (!('nodes' in currentState) || currentState.nodes === undefined) {
        (currentState as any).nodes = this.nodes;
    }


    for (const operation of this.operations) {
      currentState = await operation.execute(currentState, ai, options);
    }

    const finalOutput = this.outputMapper(currentState);

    // TODO: Validate `finalOutput` against `this.flowOutputSignature`
    // For example, using something like:
    // validateObjectAgainstSignature(finalOutput, this.flowOutputSignature);
    // This would require a utility function.

    this.trace = { ...(values as any), ...(finalOutput as any) }; // Capture trace
    if (options?.ai) {
        // Assuming AxProgram has a way to record usage, or we add it here.
        // This is a simplified placeholder for usage tracking.
        // this.usage.push({ ai: options.ai.getName(), model: options.model || 'unknown', ...});
    }


    return finalOutput;
  }

  public override async *streamingForward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramStreamingForwardOptions>
  ): AxGenStreamingOut<OUT> {
    // This remains a basic non-streaming version for now.
    // True streaming in a flow is complex and depends on individual nodes/operations supporting it.
    // For now, it will execute the whole flow and then yield the final result.
    const result = await this.forward(ai, values, options);
    yield { index: 0, delta: result as Partial<OUT> }; // Yield the full result as a single delta
  }

  // This method provides the overall signature for the AxFlow program itself.
  // It should be derived from the flow's input and output signatures.
  public override getSignature(): AxSignature {
    if (!this.flowInputSignature || !this.flowOutputSignature) {
      // Fallback or throw error if flow's I/O signatures aren't defined
      // For now, returning an empty signature or a default one.
      // Alternatively, AxProgram's constructor could take the signature,
      // and AxFlow would build it up.
      // throw new Error("Flow input and output signatures must be defined to get a combined signature for the AxFlow program.");

      // Returning a new empty signature for now to avoid breaking AxProgram expectations if it calls this internally.
      // A better approach would be to ensure AxFlow's signature is set up upon construction or when input/output are defined.
      const selfSig = new AxSignature({inputs: [], outputs: []}); // AxProgramWithSignature needs this
      if (this.flowInputSignature) {
        this.flowInputSignature.getInputFields().forEach(f => selfSig.addInputField(f));
      }
      if (this.flowOutputSignature) {
        this.flowOutputSignature.getOutputFields().forEach(f => selfSig.addOutputField(f));
      }
      if (selfSig.getInputFields().length === 0 && selfSig.getOutputFields().length === 0) {
        // If still empty, it means flow I/O not set. This might be an issue for AxProgramWithSignature expectations.
        // For AxProgram base class, this might be fine if it doesn't strictly require a signature.
        // Given AxFlow extends AxProgram, not AxProgramWithSignature, this is less of an issue.
        // However, for composability and optimization, a signature is vital.
      }
      return selfSig;

    }

    const combinedSig = new AxSignature();
    // Clone fields to avoid modifying original signature objects
    this.flowInputSignature.getInputFields().forEach(f => combinedSig.addInputField({ ...f }));
    this.flowOutputSignature.getOutputFields().forEach(f => combinedSig.addOutputField({ ...f }));

    let description = "AxFlow Program";
    if (this.flowInputSignature.getDescription()) {
        description = this.flowInputSignature.getDescription();
    } else if (this.flowOutputSignature.getDescription()) {
        description = this.flowOutputSignature.getDescription();
    }
    combinedSig.setDescription(description);

    try {
        combinedSig.validate(); // Validate the combined signature
    } catch (e) {
        console.warn("Warning: Combined signature for AxFlow program is invalid.", e);
        // Decide if this should throw or just warn. For now, warn.
    }

    return combinedSig;
  }
}
