// cspell:ignore Streamable

import {
  type ReadableStream,
  TransformStream,
  TransformStreamDefaultController,
} from 'stream/web'

import {
  type LanguageModelV1,
  type LanguageModelV1CallWarning,
  type LanguageModelV1FinishReason,
  type LanguageModelV1FunctionTool,
  type LanguageModelV1FunctionToolCall,
  type LanguageModelV1Prompt,
  type LanguageModelV1StreamPart,
} from '@ai-sdk/provider'
import type {
  AxAgentic,
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxFunctionJSONSchema,
  AxGenIn,
  AxGenOut,
} from '@ax-llm/ax/index.js'
import type { CoreMessage } from 'ai'
import { customAlphabet } from 'nanoid'
import type { ReactNode } from 'react'
import { z } from 'zod'

type Writeable<T> = { -readonly [P in keyof T]: T[P] }
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>

type AxConfig = {
  fetch?: typeof fetch
}

type Streamable = ReactNode | Promise<ReactNode>
type Renderer<T> = (
  args: T
) =>
  | Streamable
  | Generator<Streamable, Streamable, void>
  | AsyncGenerator<Streamable, Streamable, void>

const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
)

export class AxAgentProvider<IN extends AxGenIn, OUT extends AxGenOut> {
  private readonly config?: AxConfig
  private readonly funcInfo: AxFunction
  private generateFunction: Renderer<OUT>
  private updateState: (msgs: readonly CoreMessage[]) => void

  constructor({
    agent,
    updateState,
    generate,
    config,
  }: Readonly<{
    agent: AxAgentic
    updateState: (msgs: readonly CoreMessage[]) => void
    generate: Renderer<OUT>
    config?: Readonly<AxConfig>
  }>) {
    this.funcInfo = agent.getFunction()
    this.generateFunction = generate
    this.updateState = updateState
    this.config = config
  }

  get description() {
    return this.funcInfo.description
  }

  get parameters(): z.ZodTypeAny {
    const schema = this.funcInfo.parameters ?? {
      type: 'object',
      properties: {},
    }

    return convertToZodSchema(schema)
  }

  get generate(): Renderer<IN> {
    const fn = async (input: IN) => {
      const res = (await this.funcInfo.func(input)) as OUT
      const toolCallId = nanoid()

      this.updateState([
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolName: this.funcInfo.name,
              toolCallId,
              args: input,
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: this.funcInfo.name,
              toolCallId,
              result: res,
            },
          ],
        },
      ])

      return this.generateFunction(res)
    }
    return fn as Renderer<IN>
  }
}

export class AxAIProvider implements LanguageModelV1 {
  readonly specificationVersion = 'v1'
  readonly defaultObjectGenerationMode = 'json'

  private readonly ai: AxAIService
  private readonly config?: AxConfig

  public modelId: string

  constructor(ai: AxAIService, config?: Readonly<AxConfig>) {
    this.ai = ai
    this.config = config
    this.modelId = this.ai.getName()
  }

  get provider(): string {
    return this.ai.getName()
  }

  async doGenerate(
    options: Readonly<Parameters<LanguageModelV1['doGenerate']>[0]>
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    const { req, warnings } = createChatRequest(options)
    const res = (await this.ai.chat(req)) as AxChatResponse
    const choice = res.results.at(0)

    if (!choice) {
      throw new Error('No choice returned')
    }

    return {
      text: choice.content ?? undefined,
      toolCalls: choice.functionCalls?.map((tc) => ({
        toolCallType: 'function',
        toolCallId: tc.id,
        toolName: tc.function.name,
        args:
          typeof tc.function.params === 'string'
            ? tc.function.params
            : JSON.stringify(tc.function.params),
      })),
      finishReason: mapAxFinishReason(choice.finishReason),
      usage: {
        promptTokens: res.modelUsage?.tokens?.promptTokens ?? 0,
        completionTokens: res.modelUsage?.tokens?.completionTokens ?? 0,
      },
      rawCall: { rawPrompt: '', rawSettings: req.modelConfig ?? {} },
      warnings,
    }
  }

  async doStream(
    options: Readonly<Parameters<LanguageModelV1['doStream']>[0]>
  ): Promise<Awaited<ReturnType<LanguageModelV1['doStream']>>> {
    const { req, warnings } = createChatRequest(options)

    const res = (await this.ai.chat(req, {
      stream: true,
    })) as ReadableStream<AxChatResponse>

    return {
      stream: res.pipeThrough(new AxToSDKTransformer()),
      rawCall: { rawPrompt: '', rawSettings: req.modelConfig ?? {} },
      warnings,
    }
  }
}

function prepareToolsAndToolChoice(
  mode: Readonly<
    Parameters<LanguageModelV1['doGenerate']>[0]['mode'] & { type: 'regular' }
  >
): Pick<AxChatRequest, 'functions' | 'functionCall'> {
  // when the tools array is empty, change it to undefined to prevent errors:
  if (!mode.tools || mode.tools.length === 0) {
    return {}
  }

  const tools = mode.tools as Array<LanguageModelV1FunctionTool>
  const functions = tools.map((f) => ({
    name: f.name,
    description: 'description' in f ? (f.description ?? '') : '',
    parameters: f.parameters as AxFunctionJSONSchema,
  }))

  const toolChoice = mode.toolChoice
  if (!toolChoice) {
    return { functions }
  }

  const type = toolChoice.type

  switch (type) {
    case 'auto':
      return { functions, functionCall: 'auto' }
    case 'none':
      return { functions, functionCall: 'none' }
    case 'required':
      return { functions, functionCall: 'required' }
    case 'tool':
      return {
        functions,
        functionCall: {
          type: 'function',
          function: { name: toolChoice.toolName },
        },
      }
    default: {
      const _exhaustiveCheck: never = type
      throw new Error(`Unsupported tool choice type: ${_exhaustiveCheck}`)
    }
  }
}

function convertToAxChatPrompt(
  prompt: Readonly<LanguageModelV1Prompt>
): AxChatRequest['chatPrompt'] {
  const messages: AxChatRequest['chatPrompt'] = []

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system': {
        messages.push({ role: 'system', content })
        break
      }

      case 'user': {
        messages.push({
          role: 'user',
          content: content.map((part) => {
            switch (part.type) {
              case 'text': {
                return { type: 'text', text: part.text }
              }
              case 'image': {
                if (!part.mimeType) {
                  throw new Error('Image part must have a mimeType')
                }
                if (!ArrayBuffer.isView(part.image)) {
                  throw new Error('Image part must have an ArrayBuffer')
                }
                const image = Buffer.from(part.image).toString('base64')
                return {
                  type: 'image',
                  mimeType: part.mimeType,
                  image,
                }
              }
              default:
                throw new Error(`Unsupported part: ${part}`)
              //   case 'audio': {
              //     if (!part.data) {
              //       throw new Error('Audio part must have a audio');
              //     }
              //     if (!ArrayBuffer.isView(part.data)) {
              //       throw new Error('Audio part must have an ArrayBuffer');
              //     }
              //     const data = Buffer.from(part.data).toString('base64');
              //     return {
              //       type: 'audio',
              //       format: 'wav',
              //       data
              //     };
              //   }
            }
          }),
        })
        break
      }

      case 'assistant': {
        let text = ''
        const toolCalls: Extract<
          AxChatRequestChatPrompt,
          { role: 'assistant' }
        >['functionCalls'] = []

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              text += part.text
              break
            }
            case 'tool-call': {
              toolCalls.push({
                id: part.toolCallId,
                type: 'function',
                function: {
                  name: part.toolName,
                  params: part.args as Record<string, unknown>,
                },
              })
              break
            }

            default: {
              const _exhaustiveCheck = part
              throw new Error(`Unsupported part: ${_exhaustiveCheck}`)
            }
          }
        }

        const functionCalls = toolCalls.length === 0 ? undefined : toolCalls

        if (functionCalls || text.length > 0) {
          messages.push({
            role: 'assistant',
            content: text,
            functionCalls,
          })
        }

        break
      }
      case 'tool': {
        for (const part of content) {
          messages.push({
            role: 'function' as const,
            functionId: part.toolCallId,
            result: JSON.stringify(part.result, null, 2),
          })
        }
        break
      }
      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return messages
}

function mapAxFinishReason(
  finishReason: AxChatResponseResult['finishReason']
): LanguageModelV1FinishReason {
  switch (finishReason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'function_call':
      return 'tool-calls'
    default:
      return 'other'
  }
}

function createChatRequest({
  mode,
  prompt,
  maxTokens,
  temperature,
  topP,
  frequencyPenalty,
  presencePenalty,
  //seed,
}: Readonly<Parameters<LanguageModelV1['doGenerate']>[0]>): {
  req: AxChatRequest
  warnings: LanguageModelV1CallWarning[]
} {
  const req: AxChatRequest = {
    chatPrompt: convertToAxChatPrompt(prompt),
    ...(frequencyPenalty != null ? { frequencyPenalty } : {}),
    ...(presencePenalty != null ? { presencePenalty } : {}),
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {}),
  }

  const warnings: LanguageModelV1CallWarning[] = []

  switch (mode.type) {
    case 'regular': {
      return {
        req: { ...req, ...prepareToolsAndToolChoice(mode) },
        warnings,
      }
    }

    case 'object-json': {
      return {
        req,
        warnings,
      }
    }

    case 'object-tool': {
      const tool = {
        type: 'function',
        function: {
          name: mode.tool.name,
          params: mode.tool.parameters,
        },
      }
      return {
        req: { ...req, ...tool },
        warnings,
      }
    }

    default: {
      throw new Error('Unsupported type')
    }
  }
}

class AxToSDKTransformer extends TransformStream<
  AxChatResponse,
  LanguageModelV1StreamPart
> {
  private usage: Extract<
    LanguageModelV1StreamPart,
    { type: 'finish' }
  >['usage'] = {
    promptTokens: 0,
    completionTokens: 0,
  }

  private finishReason: Extract<
    LanguageModelV1StreamPart,
    { type: 'finish' }
  >['finishReason'] = 'other'

  private functionCalls: LanguageModelV1FunctionToolCall[] = []

  constructor() {
    const transformer = {
      transform: (
        chunk: Readonly<AxChatResponse>,
        controller: TransformStreamDefaultController<LanguageModelV1StreamPart>
      ) => {
        const choice = chunk.results.at(0)
        if (!choice) {
          const val = {
            type: 'finish' as const,
            finishReason: this.finishReason,
            usage: this.usage,
          }
          controller.enqueue(val)
          return
        }

        if (chunk.modelUsage) {
          this.usage = {
            promptTokens:
              this.usage.promptTokens +
              (chunk.modelUsage?.tokens?.promptTokens ?? 0),
            completionTokens:
              this.usage.completionTokens +
              (chunk.modelUsage.tokens?.completionTokens ?? 0),
          }
        }

        if (choice.functionCalls) {
          for (const fc of choice.functionCalls) {
            const index = this.functionCalls.findIndex(
              (f) => f.toolCallId === fc.id
            )
            if (index === -1) {
              this.functionCalls.push({
                toolCallType: 'function' as const,
                toolCallId: fc.id,
                toolName: fc.function.name,
                args:
                  typeof fc.function.params === 'string'
                    ? fc.function.params
                    : JSON.stringify(fc.function.params),
              })
            } else {
              const obj = this.functionCalls[index]
              if (!obj) {
                continue
              }
              if (typeof fc.function.params === 'string') {
                obj.args = (obj.args ?? '') + fc.function.params
              } else {
                obj.args = JSON.stringify(fc.function.params)
              }
            }
            this.finishReason = 'tool-calls'
          }
        }

        if (choice.content && choice.content.length > 0) {
          controller.enqueue({
            type: 'text-delta',
            textDelta: choice.content ?? '',
          })
          this.finishReason = mapAxFinishReason(choice.finishReason)
        }
      },
      flush: (
        controller: TransformStreamDefaultController<LanguageModelV1StreamPart>
      ) => {
        for (const fc of this.functionCalls) {
          const tc = {
            type: 'tool-call' as const,
            ...fc,
          }
          controller.enqueue(tc)
        }

        const val = {
          type: 'finish' as const,
          finishReason: this.finishReason,
          usage: this.usage,
        }
        controller.enqueue(val)
        controller.terminate()
      },
    }

    super(transformer)
  }
}

type AnyZod =
  | z.AnyZodObject
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodArray<AnyZod>
  | z.ZodOptional<AnyZod>

function convertToZodSchema(
  jsonSchema: Readonly<AxFunctionJSONSchema>
): AnyZod {
  const { type, properties, required, items } = jsonSchema

  switch (type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      if (!items) {
        throw new Error("Array type must have 'items' property.")
      }
      return z.array(convertToZodSchema(items))
    case 'object': {
      if (!properties) {
        throw new Error("Object type must have 'properties' property.")
      }
      const shape: Record<string, AnyZod> = {}

      for (const [key, value] of Object.entries(properties)) {
        const schema = convertToZodSchema(value)
        let val = required?.includes(key) ? schema : schema.optional()
        val = value.description ? val.describe(value.description) : val
        shape[key] = val
      }
      return z.object(shape)
    }
    default:
      throw new Error(`Unsupported type: ${type}`)
  }
}
