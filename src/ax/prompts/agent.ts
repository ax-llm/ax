import type {
  AxAIModelList,
  AxAIService,
  AxFunction,
  AxFunctionJSONSchema,
} from '../ai/types.js'
import { AxGen, type AxGenOptions } from '../dsp/generate.js'
import {
  type AxGenIn,
  type AxGenOut,
  type AxGenStreamingOut,
  type AxProgramDemos,
  type AxProgramExamples,
  type AxProgramForwardOptions,
  type AxProgramStreamingForwardOptions,
  AxProgramWithSignature,
  type AxTunable,
  type AxUsable,
} from '../dsp/program.js'
import { AxSignature } from '../dsp/sig.js'

export interface AxAgentic extends AxTunable, AxUsable {
  getFunction(): AxFunction
  getFeatures(): AxAgentFeatures
}

export type AxAgentOptions = Omit<AxGenOptions, 'functions'> & {
  disableSmartModelRouting?: boolean
}

export interface AxAgentFeatures {
  canConfigureSmartModelRouting: boolean
}

export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut = AxGenOut>
  implements AxAgentic
{
  private ai?: AxAIService
  private signature: AxSignature
  private program: AxProgramWithSignature<IN, OUT>
  private functions?: AxFunction[]
  private agents?: AxAgentic[]
  private disableSmartModelRouting?: boolean

  private name: string
  private description: string
  private subAgentList?: string
  private func: AxFunction

  constructor(
    {
      ai,
      name,
      description,
      signature,
      agents,
      functions,
    }: Readonly<{
      ai?: Readonly<AxAIService>
      name: string
      description: string
      signature: AxSignature | string
      agents?: AxAgentic[]
      functions?: AxFunction[]
    }>,
    options?: Readonly<AxAgentOptions>
  ) {
    this.ai = ai
    this.agents = agents
    this.functions = functions
    this.disableSmartModelRouting = options?.disableSmartModelRouting

    this.signature = new AxSignature(signature)
    this.signature.setDescription(description)

    if (!name || name.length < 5) {
      throw new Error(
        `Agent name must be at least 10 characters (more descriptive): ${name}`
      )
    }

    if (!description || description.length < 20) {
      throw new Error(
        `Agent description must be at least 20 characters (explain in detail what the agent does): ${description}`
      )
    }

    this.program = new AxGen<IN, OUT>(this.signature, options)

    for (const agent of agents ?? []) {
      this.program.register(agent)
    }

    this.name = name
    this.description = description
    this.subAgentList = agents?.map((a) => a.getFunction().name).join(', ')

    this.func = {
      name: toCamelCase(this.name),
      description: this.description,
      parameters: this.signature.toJSONSchema(),
      func: () => this.forward,
    }

    const mm = ai?.getModelList()
    // Only add model parameter if smart routing is enabled and model list exists
    if (mm && !this.disableSmartModelRouting) {
      this.func.parameters = addModelParameter(this.func.parameters, mm)
    }
  }

  public setExamples(examples: Readonly<AxProgramExamples>) {
    this.program.setExamples(examples)
  }

  public setId(id: string) {
    this.program.setId(id)
  }

  public setParentId(parentId: string) {
    this.program.setParentId(parentId)
  }

  public getTraces() {
    return this.program.getTraces()
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    this.program.setDemos(demos)
  }

  public getUsage() {
    return this.program.getUsage()
  }

  public resetUsage() {
    this.program.resetUsage()
  }

  public getFunction(): AxFunction {
    const boundFunc = this.forward.bind(this)

    // Create a wrapper function that excludes the 'ai' parameter
    const wrappedFunc = (
      valuesAndModel: IN & { model: string },
      options?: Readonly<AxProgramForwardOptions>
    ) => {
      const { model, ...values } = valuesAndModel
      const ai = this.ai ?? options?.ai
      if (!ai) {
        throw new Error('AI service is required to run the agent')
      }
      return boundFunc(ai, values as unknown as IN, { ...options, model })
    }

    return {
      ...this.func,
      func: wrappedFunc,
    }
  }

  public getFeatures(): AxAgentFeatures {
    return {
      canConfigureSmartModelRouting: this.ai !== undefined,
    }
  }

  private init(
    parentAi: Readonly<AxAIService>,
    options: Readonly<AxProgramForwardOptions> | undefined
  ) {
    const ai = this.ai ?? parentAi
    const mm = ai?.getModelList()

    const agentFuncs = this.agents
      ?.map((a) => a.getFunction())
      ?.map((f) =>
        mm &&
        !this.disableSmartModelRouting &&
        this.agents?.find((a) => a.getFunction().name === f.name)?.getFeatures()
          .canConfigureSmartModelRouting
          ? { ...f, parameters: addModelParameter(f.parameters, mm) }
          : f
      )
    const functions: AxFunction[] = [
      ...(options?.functions ?? this.functions ?? []),
      ...(agentFuncs ?? []),
    ]

    return { ai, functions }
  }

  public async forward(
    parentAi: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    const { ai, functions } = this.init(parentAi, options)
    return await this.program.forward(ai, values, { ...options, functions })
  }

  public async *streamingForward(
    parentAi: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramStreamingForwardOptions>
  ): AxGenStreamingOut<OUT> {
    const { ai, functions } = this.init(parentAi, options)
    return yield* this.program.streamingForward(ai, values, {
      ...options,
      functions,
    })
  }
}

function toCamelCase(inputString: string): string {
  // Split the string by any non-alphanumeric character (including underscores, spaces, hyphens)
  const words = inputString.split(/[^a-zA-Z0-9]/)

  // Map through each word, capitalize the first letter of each word except the first word
  const camelCaseString = words
    .map((word, index) => {
      // Lowercase the word to handle cases like uppercase letters in input
      const lowerWord = word.toLowerCase()

      // Capitalize the first letter of each word except the first one
      if (index > 0 && lowerWord && lowerWord[0]) {
        return lowerWord[0].toUpperCase() + lowerWord.slice(1)
      }

      return lowerWord
    })
    .join('')

  return camelCaseString
}

/**
 * Adds a required model parameter to a JSON Schema definition based on provided model mappings.
 * The model parameter will be an enum with values from the model map keys.
 *
 * @param parameters - The original JSON Schema parameters definition (optional)
 * @param models - Array of model mappings containing keys, model names and descriptions
 * @returns Updated JSON Schema with added model parameter
 */
export function addModelParameter(
  parameters: AxFunctionJSONSchema | undefined,
  models: AxAIModelList
): AxFunctionJSONSchema {
  // If parameters is undefined, create a base schema
  const baseSchema: AxFunctionJSONSchema = parameters
    ? structuredClone(parameters)
    : {
        type: 'object',
        properties: {},
        required: [],
      }

  // Check if model parameter already exists
  if (baseSchema.properties?.model) {
    return baseSchema
  }

  // Create the model property schema
  const modelProperty: AxFunctionJSONSchema & {
    enum: string[]
    description: string
  } = {
    type: 'string',
    enum: models.map((m) => m.key),
    description: `The AI model to use for this function call. Available options: ${models
      .map((m) => `${m.key}: ${m.description}`)
      .join(' | ')}`,
  }

  // Create new properties object with model parameter
  const newProperties = {
    ...(baseSchema.properties ?? {}),
    model: modelProperty,
  }

  // Add model to required fields
  const newRequired = [...(baseSchema.required ?? []), 'model']

  // Return updated schema
  return {
    ...baseSchema,
    properties: newProperties,
    required: newRequired,
  }
}
