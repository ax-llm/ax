import type { AxAIService } from '../ai/types.js'
import { AxDBMemory, type AxDBState } from '../db/memory.js'
import { ColorLog } from '../util/log.js'

const colorLog = new ColorLog()

export interface AxSimpleClassifierForwardOptions {
  cutoff?: number
  abortSignal?: AbortSignal
}

export class AxSimpleClassifierClass {
  private readonly name: string
  private readonly context: readonly string[]

  constructor(name: string, context: readonly string[]) {
    this.name = name
    this.context = context
  }

  public getName(): string {
    return this.name
  }

  public getContext(): readonly string[] {
    return this.context
  }
}

export class AxSimpleClassifier {
  private readonly ai: AxAIService

  private db: AxDBMemory
  private debug?: boolean

  public constructor(ai: AxAIService) {
    this.db = new AxDBMemory()
    this.ai = ai
  }

  public getState(): AxDBState | undefined {
    return this.db.getDB()
  }

  public setState(state: AxDBState) {
    this.db.setDB(state)
  }

  public setClasses = async (
    classes: readonly AxSimpleClassifierClass[],
    options?: Readonly<{ abortSignal?: AbortSignal }>
  ): Promise<void> => {
    for (const c of classes) {
      const ret = await this.ai.embed(
        { texts: c.getContext() },
        {
          abortSignal: options?.abortSignal,
        }
      )
      await this.db.upsert({
        id: c.getName(),
        table: 'classes',
        values: ret.embeddings[0],
      })
    }
  }

  public async forward(
    text: string,
    options?: Readonly<AxSimpleClassifierForwardOptions>
  ): Promise<string> {
    const { embeddings } = await this.ai.embed(
      { texts: [text] },
      {
        abortSignal: options?.abortSignal,
      }
    )

    const matches = await this.db.query({
      table: 'classes',
      values: embeddings[0],
    })

    let m = matches.matches
    if (typeof options?.cutoff === 'number') {
      const { cutoff } = options
      m = m.filter((m) => m.score <= cutoff)
    }

    if (this.debug) {
      console.log(
        colorLog.whiteBright(`query: ${text}`) +
          '\n' +
          colorLog.greenBright(
            JSON.stringify(m.map((m) => `${m.id}, ${m.score}`))
          )
      )
    }

    const matchedClass = m.at(0)
    if (!matchedClass) {
      return ''
    }

    return matchedClass.id
  }

  public setOptions(options: Readonly<{ debug?: boolean }>): void {
    if (typeof options.debug === 'boolean') {
      this.debug = options.debug
    }
  }
}
