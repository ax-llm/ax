import {
  dedup,
  Generate,
  type GenerateOptions,
  Signature
} from '../dsp/index.js';
import { Program, ProgramForwardOptions } from '../dsp/program.js';
import type { AIService } from '../text/types.js';

import { ChainOfThought } from './cot.js';

export class RAG extends Program<{ question: string }, { answer: string }> {
  private genQuery: Generate<
    { context: string[]; question: string },
    { query: string }
  >;
  private genAnswer: Generate<
    { context: string[]; question: string },
    { answer: string }
  >;
  private queryFn: (query: string) => Promise<string>;
  private maxHops: number;

  constructor(
    ai: AIService,
    queryFn: (query: string) => Promise<string>,
    options: Readonly<GenerateOptions & { maxHops?: number }>
  ) {
    super();
    this.maxHops = options?.maxHops ?? 3;

    const qsig = new Signature(
      '"Write a simple search query that will help answer a complex question." context?:string[] "may contain relevant facts", question -> query "question to further our understanding"'
    );
    this.genQuery = new Generate(ai, qsig);

    const asig = new Signature(
      '"Answer questions with short factoid answers." context:string[] "may contain relevant facts", question -> answer'
    );
    this.genAnswer = new ChainOfThought(ai, asig);
    this.queryFn = queryFn;

    this.register(this.genQuery);
    this.register(this.genAnswer);
  }

  public forward = async (
    { question }: Readonly<{ question: string }>,
    options?: Readonly<ProgramForwardOptions>
  ): Promise<{ answer: string }> => {
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
      context = dedup([...context, val]);
    }

    return this.genAnswer.forward({ context, question }, options);
  };
}
