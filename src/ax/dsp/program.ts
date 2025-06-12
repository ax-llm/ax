import type { Tracer } from '@opentelemetry/api'

import type {
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxLoggerFunction,
  AxModelConfig,
  AxRateLimiterFunction,
} from '../ai/types.js'
import type { AxAIMemory } from '../mem/types.js'

import type { AxAssertion, AxStreamingAssertion } from './asserts.js'
import type { AxInputFunctionType } from './functions.js'
import { AxPromptTemplate } from './prompt.js'
import { AxInstanceRegistry } from './registry.js'
import { AxSignature } from './sig.js'
import type { AxFieldValue, AxGenIn, AxGenOut, AxMessage } from './types.js'
import { mergeProgramUsage, validateValue } from './util.js'

export type AxProgramTrace = {
  //   examples: Record<string, Value>[];
  trace: Record<string, AxFieldValue>
  programId: string
}

export type AxProgramDemos = {
  //   examples: Record<string, Value>[];
  traces: Record<string, AxFieldValue>[]
  programId: string
}

export type AxProgramExamples = AxProgramDemos | AxProgramDemos['traces']

export type AxProgramForwardOptions = {
  // Execution control
  maxRetries?: number
  maxSteps?: number
  mem?: AxAIMemory

  // AI service and model configuration
  ai?: AxAIService
  modelConfig?: AxModelConfig
  model?: string

  // Session and tracing
  sessionId?: string
  traceId?: string | undefined
  tracer?: Tracer
  rateLimiter?: AxRateLimiterFunction

  // Streaming and output
  stream?: boolean

  // Functions and calls
  functions?: AxInputFunctionType
  functionCall?: AxChatRequest['functionCall']
  stopFunction?: string

  // Behavior control
  fastFail?: boolean
  debug?: boolean
  debugHideSystemPrompt?: boolean

  // Thinking model controls
  thinkingTokenBudget?:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'highest'
    | 'none'
  showThoughts?: boolean

  // Tracing and logging
  traceLabel?: string
  abortSignal?: AbortSignal
  logger?: AxLoggerFunction

  // AxGen-specific options (previously in AxGenOptions)
  description?: string
  thoughtFieldName?: string
  promptTemplate?: typeof AxPromptTemplate
  asserts?: AxAssertion[]
  streamingAsserts?: AxStreamingAssertion[]
  excludeContentFromTrace?: boolean
}

export type AxProgramStreamingForwardOptions = Omit<
  AxProgramForwardOptions,
  'stream'
>

export type AxGenDeltaOut<OUT extends AxGenOut> = {
  version: number
  delta: Partial<OUT>
}

export type AxGenStreamingOut<OUT extends AxGenOut> = AsyncGenerator<
  AxGenDeltaOut<OUT>,
  // biome-ignore lint/suspicious/noConfusingVoidType: just cause
  void | OUT,
  unknown
>

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AxSetExamplesOptions = {
  // No options needed - all fields can be missing in examples
}

export interface AxTunable {
  setExamples: (
    examples: Readonly<AxProgramExamples>,
    options?: Readonly<AxSetExamplesOptions>
  ) => void
  setId: (id: string) => void
  setParentId: (parentId: string) => void
  getTraces: () => AxProgramTrace[]
  setDemos: (demos: readonly AxProgramDemos[]) => void
}

export interface AxUsable {
  getUsage: () => AxProgramUsage[]
  resetUsage: () => void
}

export type AxProgramUsage = AxChatResponse['modelUsage'] & {
  ai: string
  model: string
}

export interface AxProgramWithSignatureOptions {
  description?: string
}

export class AxProgramWithSignature<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxTunable, AxUsable
{
  protected signature: AxSignature
  protected sigHash: string

  protected examples?: Record<string, AxFieldValue>[]
  protected examplesOptions?: AxSetExamplesOptions
  protected demos?: Record<string, AxFieldValue>[]
  protected trace?: Record<string, AxFieldValue>
  protected usage: AxProgramUsage[] = []

  private key: { id: string; custom?: boolean }
  private children: AxInstanceRegistry<Readonly<AxTunable & AxUsable>>

  constructor(
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxProgramWithSignatureOptions>
  ) {
    this.signature = new AxSignature(signature)
    this.sigHash = this.signature?.hash()
    this.children = new AxInstanceRegistry()
    this.key = { id: this.constructor.name }

    if (options?.description) {
      this.signature.setDescription(options.description)
    }
  }

  public getSignature() {
    return this.signature
  }

  public register(prog: Readonly<AxTunable & AxUsable>) {
    if (this.key) {
      prog.setParentId(this.key.id)
    }
    this.children.register(prog)
  }

  public async forward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ai: Readonly<AxAIService>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _values: IN | AxMessage<IN>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    throw new Error('forward() not implemented')
  }

  // biome-ignore lint/correctness/useYield: just a placeholder
  public async *streamingForward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ai: Readonly<AxAIService>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _values: IN | AxMessage<IN>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramStreamingForwardOptions>
  ): AxGenStreamingOut<OUT> {
    throw new Error('streamingForward() not implemented')
  }

  public setId(id: string) {
    this.key = { id, custom: true }
    for (const child of this.children) {
      child.setParentId(id)
    }
  }

  public setParentId(parentId: string) {
    if (!this.key.custom) {
      this.key.id = [parentId, this.key.id].join('/')
    }
  }

  public setExamples(
    examples: Readonly<AxProgramExamples>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    this._setExamples(examples, options)

    if (!('programId' in examples)) {
      return
    }

    for (const child of this.children) {
      child.setExamples(examples, options)
    }
  }

  private _setExamples(
    examples: Readonly<AxProgramExamples>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    let traces: Record<string, AxFieldValue>[] = []

    if ('programId' in examples && examples.programId === this.key.id) {
      traces = examples.traces
    }

    if (Array.isArray(examples)) {
      traces = examples
    }

    if (traces) {
      this.examplesOptions = options
      const sig = this.signature
      const fields = [...sig.getInputFields(), ...sig.getOutputFields()]

      this.examples = traces.map((e) => {
        const res: Record<string, AxFieldValue> = {}
        for (const f of fields) {
          const value = e[f.name]
          if (value !== undefined) {
            // Only validate the type of fields that are actually set
            // Allow any field to be missing regardless of whether it's required
            validateValue(f, value)
            res[f.name] = value
          }
        }
        return res
      })
    }
  }

  public getTraces(): AxProgramTrace[] {
    let traces: AxProgramTrace[] = []

    if (this.trace) {
      traces.push({ trace: this.trace, programId: this.key.id })
    }

    for (const child of this.children) {
      const _traces = child.getTraces()
      traces = [...traces, ..._traces]
    }
    return traces
  }

  public getUsage(): AxProgramUsage[] {
    let usage: AxProgramUsage[] = [...(this.usage ?? [])]

    for (const child of this.children) {
      const cu = child.getUsage()
      usage = [...usage, ...cu]
    }
    return mergeProgramUsage(usage)
  }

  public resetUsage() {
    this.usage = []
    for (const child of this.children) {
      child.resetUsage()
    }
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    // biome-ignore lint/complexity/useFlatMap: it can't
    this.demos = demos
      .filter((v) => v.programId === this.key.id)
      .map((v) => v.traces)
      .flat()

    for (const child of this.children) {
      child.setDemos(demos)
    }
  }
}

export class AxProgram<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxTunable, AxUsable
{
  protected trace?: Record<string, AxFieldValue>
  protected usage: AxProgramUsage[] = []

  private key: { id: string; custom?: boolean }
  private children: AxInstanceRegistry<Readonly<AxTunable & AxUsable>>

  constructor() {
    this.children = new AxInstanceRegistry()
    this.key = { id: this.constructor.name }
  }

  public register(prog: Readonly<AxTunable & AxUsable>) {
    if (this.key) {
      prog.setParentId(this.key.id)
    }
    this.children.register(prog)
  }

  public async forward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ai: Readonly<AxAIService>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _values: IN | AxMessage<IN>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    throw new Error('forward() not implemented')
  }

  // biome-ignore lint/correctness/useYield: just a placeholder
  public async *streamingForward(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ai: Readonly<AxAIService>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _values: IN | AxMessage<IN>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxProgramStreamingForwardOptions>
  ): AxGenStreamingOut<OUT> {
    throw new Error('streamingForward() not implemented')
  }

  public setId(id: string) {
    this.key = { id, custom: true }
    for (const child of this.children) {
      child.setParentId(id)
    }
  }

  public setParentId(parentId: string) {
    if (!this.key.custom) {
      this.key.id = [parentId, this.key.id].join('/')
    }
  }

  public setExamples(
    examples: Readonly<AxProgramExamples>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    if (!('programId' in examples)) {
      return
    }

    for (const child of this.children) {
      child.setExamples(examples, options)
    }
  }

  public getTraces(): AxProgramTrace[] {
    let traces: AxProgramTrace[] = []

    if (this.trace) {
      traces.push({ trace: this.trace, programId: this.key.id })
    }

    for (const child of this.children) {
      const _traces = child.getTraces()
      traces = [...traces, ..._traces]
    }
    return traces
  }

  public getUsage(): AxProgramUsage[] {
    let usage: AxProgramUsage[] = [...(this.usage ?? [])]

    for (const child of this.children) {
      const cu = child.getUsage()
      usage = [...usage, ...cu]
    }
    return mergeProgramUsage(usage)
  }

  public resetUsage() {
    this.usage = []
    for (const child of this.children) {
      child.resetUsage()
    }
  }

  public setDemos(demos: readonly AxProgramDemos[]) {
    for (const child of this.children) {
      child.setDemos(demos)
    }
  }
}
