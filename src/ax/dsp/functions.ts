import type {
  AxAIService,
  AxAIServiceActionOptions,
  AxChatRequest,
  AxChatResponseResult,
  AxFunction,
} from '../ai/types.js'
import type { AxMemory } from '../mem/memory.js'

import { validateJSONSchema } from './jsonschema.js'

export class AxFunctionError extends Error {
  constructor(
    private fields: {
      field: string
      message: string
    }[]
  ) {
    super()
    this.name = this.constructor.name
  }

  getFields = () => this.fields

  override toString(): string {
    return [
      `${this.name}: Function validation error`,
      ...this.fields.map((field) => `  - ${field.field}: ${field.message}`),
    ].join('\n')
  }

  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString()
  }
}

type FunctionFieldErrors = ConstructorParameters<typeof AxFunctionError>[0]

export class FunctionError extends Error {
  constructor(
    private readonly fields: FunctionFieldErrors,
    private readonly func: Readonly<AxFunction>,
    private readonly funcId?: string
  ) {
    super()
  }

  getFunctionId = () => this.funcId

  private getFieldDescription(fieldName: string): string {
    if (!this.func.parameters?.properties?.[fieldName]) {
      return ''
    }

    const fieldSchema = this.func.parameters.properties[fieldName]
    let description = fieldSchema.description

    if (fieldSchema.enum?.length) {
      description += ` Allowed values are: ${fieldSchema.enum.join(', ')}`
    }

    return description
  }

  public getFixingInstructions = () => {
    const bulletPoints = this.fields.map((fieldError) => {
      const schemaDescription = this.getFieldDescription(fieldError.field) || ''
      return `- \`${fieldError.field}\` - ${fieldError.message} (${schemaDescription}).`
    })

    return `Errors In Function Arguments: Fix the following invalid arguments to '${this.func.name}'\n${bulletPoints.join('\n')}`
  }

  override toString(): string {
    return [
      `${this.name}: Function execution error in '${this.func.name}'`,
      ...this.fields.map((field) => {
        const description = this.getFieldDescription(field.field)
        return `  - ${field.field}: ${field.message}${description ? ` (${description})` : ''}`
      }),
      this.funcId ? `  Function ID: ${this.funcId}` : '',
    ].join('\n')
  }

  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString()
  }
}

export type AxChatResponseFunctionCall = {
  id: string
  name: string
  args: string
}

export class AxFunctionProcessor {
  private funcList: Readonly<AxFunction[]> = []

  constructor(funcList: Readonly<AxFunction[]>) {
    this.funcList = funcList
  }

  private executeFunction = async (
    fnSpec: Readonly<AxFunction>,
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<AxAIServiceActionOptions>
  ) => {
    let args: unknown

    if (typeof func.args === 'string' && func.args.length > 0) {
      args = JSON.parse(func.args)
    } else {
      args = func.args
    }

    const opt = options
      ? {
          sessionId: options.sessionId,
          traceId: options.traceId,
          ai: options.ai,
        }
      : undefined

    if (!fnSpec.parameters) {
      const res =
        fnSpec.func.length === 1 ? await fnSpec.func(opt) : await fnSpec.func()

      return typeof res === 'string' ? res : JSON.stringify(res, null, 2)
    }

    const res =
      fnSpec.func.length === 2
        ? await fnSpec.func(args, opt)
        : await fnSpec.func(args)

    return typeof res === 'string' ? res : JSON.stringify(res, null, 2)
  }

  public execute = async (
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<AxAIServiceActionOptions>
  ) => {
    const fnSpec = this.funcList.find(
      (v) => v.name.localeCompare(func.name) === 0
    )
    if (!fnSpec) {
      throw new Error(`Function not found: ${func.name}`)
    }
    if (!fnSpec.func) {
      throw new Error(`No handler for function: ${func.name}`)
    }

    // execute value function calls
    try {
      return await this.executeFunction(fnSpec, func, options)
    } catch (e) {
      if (e instanceof AxFunctionError) {
        throw new FunctionError(e.getFields(), fnSpec, func.id)
      }
      throw e
    }
  }
}

export type AxInputFunctionType = (
  | AxFunction
  | {
      toFunction: () => AxFunction | AxFunction[]
    }
)[]

export const parseFunctions = (
  newFuncs: Readonly<AxInputFunctionType>,
  existingFuncs?: readonly AxFunction[]
): AxFunction[] => {
  if (newFuncs.length === 0) {
    return [...(existingFuncs ?? [])]
  }

  // biome-ignore lint/complexity/useFlatMap: cannot use flatMap here
  const functions = newFuncs
    .map((f) => {
      if ('toFunction' in f) {
        return f.toFunction()
      }
      return f
    })
    .flat()

  for (const fn of functions.filter((v) => v.parameters)) {
    if (fn.parameters) {
      validateJSONSchema(fn.parameters)
    }
  }

  return [...(existingFuncs ?? []), ...functions]
}

type FunctionPromise =
  | undefined
  | Promise<Extract<AxChatRequest['chatPrompt'][number], { role: 'function' }>>

export const processFunctions = async (
  ai: Readonly<AxAIService>,
  functionList: Readonly<AxFunction[]>,
  functionCalls: readonly AxChatResponseFunctionCall[],
  mem: Readonly<AxMemory>,
  sessionId?: string,
  traceId?: string,
  span?: import('@opentelemetry/api').Span,
  excludeContentFromTelemetry?: boolean
) => {
  const funcProc = new AxFunctionProcessor(functionList)
  const functionsExecuted = new Set<string>()

  // Map each function call to a promise that resolves to the function result or null
  const promises = functionCalls.map((func) => {
    if (!func.id) {
      throw new Error(`Function ${func.name} did not return an ID`)
    }

    const promise: FunctionPromise = funcProc
      .execute(func, { sessionId, traceId, ai })
      .then((functionResult) => {
        functionsExecuted.add(func.name.toLowerCase())

        // Add telemetry event for successful function call
        if (span) {
          const eventData: { name: string; args?: string; result?: string } = {
            name: func.name,
          }
          if (!excludeContentFromTelemetry) {
            eventData.args = func.args
            eventData.result = functionResult ?? ''
          }
          span.addEvent('function.call', eventData)
        }

        return {
          role: 'function' as const,
          result: functionResult ?? '',
          functionId: func.id,
        }
      })
      .catch((e) => {
        if (e instanceof FunctionError) {
          const result = e.getFixingInstructions()

          // Add telemetry event for function error
          if (span) {
            const errorEventData: {
              name: string
              args?: string
              message: string
              fixing_instructions?: string
            } = {
              name: func.name,
              message: e.toString(),
            }
            if (!excludeContentFromTelemetry) {
              errorEventData.args = func.args
              errorEventData.fixing_instructions = result
            }
            span.addEvent('function.error', errorEventData)
          }

          mem.add(
            {
              role: 'function' as const,
              functionId: func.id,
              isError: true,
              result,
            },
            sessionId
          )
          mem.addTag('error')

          if (ai.getOptions().debug) {
            const logger = ai.getLogger()
            logger(`❌ Function Error Correction:\n${result}`, {
              tags: ['error'],
            })
          }
        } else {
          throw e
        }
      }) as FunctionPromise

    return promise
  })

  // Wait for all promises to resolve
  const results = await Promise.all(promises)

  for (const result of results) {
    if (result) {
      mem.add(result, sessionId)
    }
  }

  return functionsExecuted
}

export function parseFunctionCalls(
  ai: Readonly<AxAIService>,
  functionCalls: Readonly<AxChatResponseResult['functionCalls']>,
  values: Record<string, unknown>,
  model?: string
): AxChatResponseFunctionCall[] | undefined {
  if (!functionCalls || functionCalls.length === 0) {
    return
  }
  if (!ai.getFeatures(model).functions) {
    throw new Error('Functions are not supported by the AI service')
  }

  const funcs: AxChatResponseFunctionCall[] = functionCalls.map((f) => ({
    id: f.id,
    name: f.function.name,
    args: f.function.params as string,
  }))

  // for (const [i, f] of funcs.entries()) {
  //   values['functionName' + i] = f.name;
  //   values['functionArguments' + i] =
  //     typeof f.args === 'object' ? JSON.stringify(f.args) : f.args;
  // }
  return funcs
}
