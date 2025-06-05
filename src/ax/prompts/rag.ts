import { type AxProgramForwardOptions } from '../dsp/program.js'
import { AxStringUtil } from '../dsp/strutil.js'
import {
  type AxAIService,
  AxGen,
  type AxGenOptions,
  AxSignature,
} from '../index.js'

import { AxChainOfThought } from './cot.js'

export class AxRAG extends AxChainOfThought<
  { context: string[]; question: string },
  { answer: string }
> {
  private genQuery: AxGen<
    { context: string[]; question: string },
    { query: string }
  >
  private queryFn: (query: string) => Promise<string>
  private maxHops: number

  constructor(
    queryFn: (query: string) => Promise<string>,
    options: Readonly<AxGenOptions & { maxHops?: number }>
  ) {
    const sig =
      '"Answer questions with short factoid answers." context:string[] "may contain relevant facts", question -> answer'
    super(sig, options)

    this.maxHops = options?.maxHops ?? 3

    const qsig = new AxSignature(
      '"Write a simple search query that will help answer a complex question." context?:string[] "may contain relevant facts", question -> query "question to further our understanding"'
    )
    this.genQuery = new AxGen<
      { context: string[]; question: string },
      { query: string }
    >(qsig)
    this.queryFn = queryFn
    this.register(this.genQuery)
  }

  public override async forward(
    ai: Readonly<AxAIService>,
    { question }: Readonly<{ question: string }>,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<{ answer: string }> {
    let context: string[] = []

    for (let i = 0; i < this.maxHops; i++) {
      const { query } = await this.genQuery.forward(
        ai,
        {
          context,
          question,
        },
        options
      )
      const val = await this.queryFn(query)
      context = AxStringUtil.dedup([...context, val])
    }

    return super.forward(ai, { context, question }, options)
  }
}
