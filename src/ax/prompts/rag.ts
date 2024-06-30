import type { AxAIService } from '../ai/types.js';
import {
  AxGenerate,
  type AxGenerateOptions,
  AxSignature,
  axStringUtil
} from '../dsp/index.js';
import { type AxProgramForwardOptions } from '../dsp/program.js';

import { AxChainOfThought } from './cot.js';

export class AxRAG extends AxChainOfThought<
  { context: string[]; question: string },
  { answer: string }
> {
  private genQuery: AxGenerate<
    { context: string[]; question: string },
    { query: string }
  >;
  private queryFn: (query: string) => Promise<string>;
  private maxHops: number;

  constructor(
    ai: AxAIService,
    queryFn: (query: string) => Promise<string>,
    options: Readonly<AxGenerateOptions & { maxHops?: number }>
  ) {
    const sig =
      '"Answer questions with short factoid answers." context:string[] "may contain relevant facts", question -> answer';
    super(ai, sig, options);

    this.maxHops = options?.maxHops ?? 3;

    const qsig = new AxSignature(
      '"Write a simple search query that will help answer a complex question." context?:string[] "may contain relevant facts", question -> query "question to further our understanding"'
    );
    this.genQuery = new AxGenerate<
      { context: string[]; question: string },
      { query: string }
    >(ai, qsig);
    this.queryFn = queryFn;
    this.register(this.genQuery);
  }

  public override async forward(
    { question }: Readonly<{ question: string }>,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<{ answer: string; reason: string }> {
    let context: string[] = [];

    for (let i = 0; i < this.maxHops; i++) {
      const { query } = await this.genQuery.forward(
        {
          context,
          question
        },
        options
      );
      const val = await this.queryFn(query);
      context = axStringUtil.dedup([...context, val]);
    }

    return super.forward({ context, question }, options);
  }
}
