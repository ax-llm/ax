import type { AxAIService } from '../ai/types.js'
import { AxGen } from '../dsp/generate.js'
import {
  type AxProgramForwardOptions,
  AxProgramWithSignature,
} from '../dsp/program.js'
import { AxSignature } from '../dsp/sig.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from '../dsp/types.js'

// Type for state object that flows through the pipeline
// Using any here because the flow system needs dynamic typing for composed state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AxFlowState = Record<string, any>

// Type for node definitions in the flow
interface AxFlowNodeDefinition {
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
}

// Type for flow step functions
type AxFlowStepFunction = (
  state: AxFlowState,
  context: Readonly<{
    mainAi: AxAIService
    mainOptions?: AxProgramForwardOptions
  }>
) => Promise<AxFlowState> | AxFlowState

// Type for dynamic context overrides
interface AxFlowDynamicContext {
  ai?: AxAIService
  options?: AxProgramForwardOptions
}

// Type for field type definition
interface AxFlowFieldType {
  type: string
  description?: string
  isOptional?: boolean
  isInternal?: boolean
  isArray?: boolean
  options?: string[]
}

/**
 * AxFlow - A fluent, chainable API for building and orchestrating complex, stateful AI programs.
 *
 * Allows developers to define computational nodes declaratively and then compose them
 * imperatively using loops, conditionals, and dynamic context.
 *
 * @example
 * ```typescript
 * const flow = new AxFlow<{ topic: string }, { summary: string; analysis: string }>()
 *   .node('summarizer', { 'text:string': { summary: f.string() } })
 *   .node('analyzer', { 'text:string': { analysis: f.string() } })
 *   .map(input => ({ originalText: `Some long text about ${input.topic}` }))
 *   .execute('summarizer', state => ({ text: state.originalText }), { ai: cheapAI })
 *   .execute('analyzer', state => ({ text: state.originalText }), { ai: powerfulAI })
 *   .map(state => ({
 *     summary: state.summarizerResult.summary,
 *     analysis: state.analyzerResult.analysis
 *   }))
 *
 * const result = await flow.forward(ai, { topic: "the future of AI" })
 * ```
 */
export class AxFlow<
  IN extends AxGenIn,
  OUT extends AxGenOut,
> extends AxProgramWithSignature<IN, OUT> {
  private readonly nodes: Map<string, AxFlowNodeDefinition> = new Map()
  private readonly flowDefinition: AxFlowStepFunction[] = []
  private readonly nodeGenerators: Map<string, AxGen<AxGenIn, AxGenOut>> =
    new Map()
  private readonly loopStack: number[] = []

  constructor(
    signature: NonNullable<
      ConstructorParameters<typeof AxSignature>[0]
    > = 'userInput:string -> flowOutput:string'
  ) {
    super(signature)
  }

  /**
   * Declares a reusable computational node and its input/output signature.
   *
   * @param name - The name of the node
   * @param signature - An object where the key is a string representation of inputs
   *                   and the value is an object representing outputs
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.node('summarizer', { 'text:string': { summary: f.string() } })
   * ```
   */
  public node(
    name: string,
    signature: Record<string, Record<string, unknown>>
  ): this {
    // Convert the signature object to a string format for AxGen
    const [inputSignature, outputSignature] = Object.entries(signature)[0] ?? [
      '',
      {},
    ]

    if (!inputSignature || !outputSignature) {
      throw new Error(
        `Invalid signature for node '${name}': signature must have at least one input->output mapping`
      )
    }

    // Create signature string for AxGen
    const outputFields = Object.entries(outputSignature)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'type' in value) {
          const fieldType = value as AxFlowFieldType
          let fieldString = `${key}:`

          // Handle optional fields
          if (fieldType.isOptional) {
            const colonIndex = fieldString.lastIndexOf(':')
            fieldString =
              fieldString.slice(0, colonIndex) +
              '?' +
              fieldString.slice(colonIndex)
          }

          // Handle internal fields
          if (fieldType.isInternal) {
            const colonIndex = fieldString.lastIndexOf(':')
            fieldString =
              fieldString.slice(0, colonIndex) +
              '!' +
              fieldString.slice(colonIndex)
          }

          // Add the type
          fieldString += fieldType.type

          // Handle arrays
          if (fieldType.isArray) {
            fieldString += '[]'
          }

          // Handle class options
          if (fieldType.type === 'class' && fieldType.options) {
            fieldString += ` "${fieldType.options.join(', ')}"`
          }

          // Handle description (only if not class type or no options)
          if (
            fieldType.description &&
            (fieldType.type !== 'class' || !fieldType.options)
          ) {
            fieldString += ` "${fieldType.description}"`
          }

          return fieldString
        }
        return `${key}:string`
      })
      .join(', ')

    const signatureString = `${inputSignature} -> ${outputFields}`

    // Store node definition
    this.nodes.set(name, {
      inputs: { [inputSignature]: true },
      outputs: outputSignature,
    })

    // Create and store the AxGen instance for this node
    this.nodeGenerators.set(name, new AxGen(signatureString))

    return this
  }

  /**
   * Applies a synchronous transformation to the state object.
   *
   * @param transform - Function that takes the current state and returns a new state
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.map(state => ({ ...state, processedText: state.text.toLowerCase() }))
   * ```
   */
  public map(transform: (state: AxFlowState) => AxFlowState): this {
    this.flowDefinition.push((state) => {
      return transform(state)
    })
    return this
  }

  /**
   * Executes a previously defined node.
   *
   * @param nodeName - The name of the node to execute (must exist in the nodes map)
   * @param mapping - Function that takes the current state and returns the input object required by the node
   * @param dynamicContext - Optional object to override the AI service or options for this specific step
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.execute('summarizer', state => ({ text: state.originalText }), { ai: cheapAI })
   * ```
   */
  public execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this {
    if (!this.nodes.has(nodeName)) {
      throw new Error(
        `Node '${nodeName}' not found. Make sure to define it with .node() first.`
      )
    }

    const nodeGenerator = this.nodeGenerators.get(nodeName)
    if (!nodeGenerator) {
      throw new Error(`Node generator for '${nodeName}' not found.`)
    }

    this.flowDefinition.push(async (state, context) => {
      // Determine AI service and options using fallback logic
      const ai = dynamicContext?.ai ?? context.mainAi
      const options = dynamicContext?.options ?? context.mainOptions

      // Map the state to node inputs
      const nodeInputs = mapping(state)

      // Execute the node
      const result = await nodeGenerator.forward(ai, nodeInputs, options)

      // Merge result back into state under a key like `${nodeName}Result`
      return {
        ...state,
        [`${nodeName}Result`]: result,
      }
    })

    return this
  }

  /**
   * Marks the beginning of a loop block.
   *
   * @param condition - Function that takes the current state and returns a boolean
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.while(state => state.iterations < 3)
   *   .map(state => ({ ...state, iterations: (state.iterations || 0) + 1 }))
   *   .endWhile()
   * ```
   */
  public while(condition: (state: AxFlowState) => boolean): this {
    // Store the condition and mark the start of the loop
    const loopStartIndex = this.flowDefinition.length
    this.loopStack.push(loopStartIndex)

    // Add a placeholder step that will be replaced in endWhile()
    // We store the condition in the placeholder for later use
    interface LoopPlaceholder extends AxFlowStepFunction {
      _condition: (state: AxFlowState) => boolean
      _isLoopStart: boolean
    }

    const placeholderStep: LoopPlaceholder = Object.assign(
      (state: AxFlowState) => state,
      {
        _condition: condition,
        _isLoopStart: true,
      }
    )

    this.flowDefinition.push(placeholderStep)

    return this
  }

  /**
   * Marks the end of a loop block.
   *
   * @returns this (for chaining)
   */
  public endWhile(): this {
    if (this.loopStack.length === 0) {
      throw new Error('endWhile() called without matching while()')
    }

    const loopStartIndex = this.loopStack.pop()!

    // Get the condition from the placeholder step
    const placeholderStep = this.flowDefinition[loopStartIndex]
    if (!placeholderStep || !('_isLoopStart' in placeholderStep)) {
      throw new Error('Loop start step not found or invalid')
    }

    const condition = (
      placeholderStep as unknown as {
        _condition: (state: AxFlowState) => boolean
      }
    )._condition

    // Extract the loop body steps (everything between while and endWhile)
    const loopBodySteps = this.flowDefinition.splice(loopStartIndex + 1)

    // Replace the placeholder with the actual loop implementation
    this.flowDefinition[loopStartIndex] = async (state, context) => {
      let currentState = state

      // Execute the loop while condition is true
      while (condition(currentState)) {
        // Execute all steps in the loop body
        for (const step of loopBodySteps) {
          currentState = await step(currentState, context)
        }
      }

      return currentState
    }

    return this
  }

  /**
   * Executes the flow with the given AI service and input values.
   *
   * @param ai - The AI service to use as the default for all steps
   * @param values - The input values for the flow
   * @param options - Optional forward options to use as defaults
   * @returns Promise that resolves to the final output
   */
  public override async forward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    // Initialize state with input values
    let state: AxFlowState = { ...values }

    // Create context object
    const context = {
      mainAi: ai,
      mainOptions: options,
    } as const

    // Execute each step in the flow definition
    for (const step of this.flowDefinition) {
      state = await step(state, context)
    }

    // Return the final state cast to OUT type
    return state as unknown as OUT
  }
}
