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

// Type for parallel branch functions
type AxFlowParallelBranch = (
    subFlow: AxFlowSubContext
) => AxFlowSubContext

// Type for sub-flow context used in parallel execution
interface AxFlowSubContext {
    execute(
        nodeName: string,
        mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
        dynamicContext?: AxFlowDynamicContext
    ): this
    map(transform: (state: AxFlowState) => AxFlowState): this
    executeSteps(
        initialState: AxFlowState,
        context: Readonly<{ mainAi: AxAIService; mainOptions?: AxProgramForwardOptions }>
    ): Promise<AxFlowState>
}

// Type for branch context
interface AxFlowBranchContext {
    predicate: (state: AxFlowState) => unknown
    branches: Map<unknown, AxFlowStepFunction[]>
    currentBranchValue?: unknown
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
    private readonly stepLabels: Map<string, number> = new Map()
    private branchContext: AxFlowBranchContext | null = null

    constructor(
        signature: NonNullable<
            ConstructorParameters<typeof AxSignature>[0]
        > = 'userInput:string -> flowOutput:string'
    ) {
        super(signature)
    }

    /**
     * Declares a reusable computational node and its input/output signature.
     * Arguments match AxGen constructor for consistency.
     *
     * @param name - The name of the node
     * @param signature - Signature string in the same format as AxSignature
     * @param options - Optional program forward options (same as AxGen)
     * @returns this (for chaining)
     *
     * @example
     * ```typescript
     * flow.node('summarizer', 'text:string -> summary:string')
     * flow.node('analyzer', 'text:string -> analysis:string, confidence:number', { debug: true })
     * ```
     */
    public node(
        name: string,
        signature: ConstructorParameters<typeof AxSignature>[0],
        options?: Readonly<AxProgramForwardOptions>
    ): this {
        // Validate that signature is provided
        if (!signature) {
            throw new Error(
                `Invalid signature for node '${name}': signature cannot be empty`
            )
        }

        // Store node definition (simplified since we're using standard signatures)
        this.nodes.set(name, {
            inputs: {},
            outputs: {},
        })

        // Create and store the AxGen instance for this node with the same arguments as AxGen
        this.nodeGenerators.set(name, new AxGen(signature, options))

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
        const step = (state: AxFlowState) => {
            return transform(state)
        }

        if (this.branchContext?.currentBranchValue !== undefined) {
            // We're inside a branch - add to current branch
            const currentBranch = this.branchContext.branches.get(this.branchContext.currentBranchValue) || []
            currentBranch.push(step)
            this.branchContext.branches.set(this.branchContext.currentBranchValue, currentBranch)
        } else {
            // Normal execution - add to main flow
            this.flowDefinition.push(step)
        }

        return this
    }

    /**
     * Labels a step for later reference (useful for feedback loops).
     *
     * @param label - The label to assign to the current step position
     * @returns this (for chaining)
     *
     * @example
     * ```typescript
     * flow.label('retry-point')
     *   .execute('queryGen', ...)
     * ```
     */
    public label(label: string): this {
        if (this.branchContext?.currentBranchValue !== undefined) {
            throw new Error('Cannot create labels inside branch blocks')
        }
        this.stepLabels.set(label, this.flowDefinition.length)
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

        const step = async (state: AxFlowState, context: Readonly<{ mainAi: AxAIService; mainOptions?: AxProgramForwardOptions }>) => {
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
        }

        if (this.branchContext?.currentBranchValue !== undefined) {
            // We're inside a branch - add to current branch
            const currentBranch = this.branchContext.branches.get(this.branchContext.currentBranchValue) || []
            currentBranch.push(step)
            this.branchContext.branches.set(this.branchContext.currentBranchValue, currentBranch)
        } else {
            // Normal execution - add to main flow
            this.flowDefinition.push(step)
        }

        return this
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
    public branch(predicate: (state: AxFlowState) => unknown): this {
        if (this.branchContext) {
            throw new Error('Nested branches are not supported')
        }

        this.branchContext = {
            predicate,
            branches: new Map(),
            currentBranchValue: undefined
        }

        return this
    }

    /**
     * Defines a branch case for the current branch context.
     *
     * @param value - The value to match against the branch predicate result
     * @returns this (for chaining)
     */
    public when(value: unknown): this {
        if (!this.branchContext) {
            throw new Error('when() called without matching branch()')
        }

        this.branchContext.currentBranchValue = value
        this.branchContext.branches.set(value, [])

        return this
    }

    /**
     * Ends the current branch and merges all branch paths back into the main flow.
     *
     * @returns this (for chaining)
     */
    public merge(): this {
        if (!this.branchContext) {
            throw new Error('merge() called without matching branch()')
        }

        const branchContext = this.branchContext
        this.branchContext = null

        // Add the branch execution step to main flow
        this.flowDefinition.push(async (state, context) => {
            const branchValue = branchContext.predicate(state)
            const branchSteps = branchContext.branches.get(branchValue)

            if (!branchSteps) {
                // No matching branch - return state unchanged
                return state
            }

            // Execute all steps in the matched branch
            let currentState = state
            for (const step of branchSteps) {
                currentState = await step(currentState, context)
            }

            return currentState
        })

        return this
    }

    /**
     * Executes multiple operations in parallel and merges their results.
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
    public parallel(branches: AxFlowParallelBranch[]): {
        merge<T>(
            resultKey: string,
            mergeFunction: (...results: unknown[]) => T
        ): AxFlow<IN, OUT>
    } {
        const parallelStep = async (state: AxFlowState, context: Readonly<{ mainAi: AxAIService; mainOptions?: AxProgramForwardOptions }>) => {
            // Execute all branches in parallel
            const promises = branches.map(async (branchFn) => {
                // Create a sub-context for this branch
                const subContext = new AxFlowSubContextImpl(this.nodeGenerators)
                const populatedSubContext = branchFn(subContext)

                // Execute the sub-context steps
                return await populatedSubContext.executeSteps(state, context)
            })

            const results = await Promise.all(promises)

            // Store results for merging
            return {
                ...state,
                _parallelResults: results
            }
        }

        this.flowDefinition.push(parallelStep)

        return {
            merge: <T>(resultKey: string, mergeFunction: (...results: unknown[]) => T) => {
                this.flowDefinition.push((state) => {
                    const results = state._parallelResults
                    if (!Array.isArray(results)) {
                        throw new Error('No parallel results found for merge')
                    }

                    const mergedValue = mergeFunction(...results)
                    const newState = { ...state }
                    delete newState._parallelResults
                    newState[resultKey] = mergedValue

                    return newState
                })

                return this
            }
        }
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
        condition: (state: AxFlowState) => boolean,
        targetLabel: string,
        maxIterations: number = 10
    ): this {
        if (!this.stepLabels.has(targetLabel)) {
            throw new Error(`Label '${targetLabel}' not found. Make sure to define it with .label() before the feedback point.`)
        }

        const targetIndex = this.stepLabels.get(targetLabel)!

        this.flowDefinition.push(async (state, context) => {
            let currentState = state
            let iterations = 0

            // Add iteration tracking to state if not present
            const iterationKey = `_feedback_${targetLabel}_iterations`
            if (typeof currentState[iterationKey] !== 'number') {
                currentState = { ...currentState, [iterationKey]: 0 }
            }

            // Check if we should loop back
            while (condition(currentState) && iterations < maxIterations) {
                iterations++
                currentState = { ...currentState, [iterationKey]: iterations }

                // Execute steps from target index to current index
                for (let i = targetIndex; i < this.flowDefinition.length - 1; i++) {
                    const step = this.flowDefinition[i]
                    if (step) {
                        currentState = await step(currentState, context)
                    }
                }
            }

            return currentState
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

/**
 * Implementation of the sub-context for parallel execution
 */
class AxFlowSubContextImpl implements AxFlowSubContext {
    private readonly steps: AxFlowStepFunction[] = []

    constructor(
        private readonly nodeGenerators: Map<string, AxGen<AxGenIn, AxGenOut>>
    ) { }

    execute(
        nodeName: string,
        mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
        dynamicContext?: AxFlowDynamicContext
    ): this {
        const nodeGenerator = this.nodeGenerators.get(nodeName)
        if (!nodeGenerator) {
            throw new Error(`Node generator for '${nodeName}' not found.`)
        }

        this.steps.push(async (state, context) => {
            const ai = dynamicContext?.ai ?? context.mainAi
            const options = dynamicContext?.options ?? context.mainOptions
            const nodeInputs = mapping(state)
            const result = await nodeGenerator.forward(ai, nodeInputs, options)

            return {
                ...state,
                [`${nodeName}Result`]: result,
            }
        })

        return this
    }

    map(transform: (state: AxFlowState) => AxFlowState): this {
        this.steps.push((state) => transform(state))
        return this
    }

    async executeSteps(
        initialState: AxFlowState,
        context: Readonly<{ mainAi: AxAIService; mainOptions?: AxProgramForwardOptions }>
    ): Promise<AxFlowState> {
        let currentState = initialState

        for (const step of this.steps) {
            currentState = await step(currentState, context)
        }

        return currentState
    }
}
