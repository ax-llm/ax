import type { AxAIService } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import { AxSignature } from '../dsp/sig.js';
import { AxStringUtil } from '../dsp/strutil.js';
import type { AxMessage, AxProgramForwardOptions } from '../dsp/types.js';

import { AxChainOfThought } from './cot.js';

export class AxRAG extends AxChainOfThought<
  { context: string[]; question: string },
  { answer: string }
> {
  private genQuery: AxGen<
    { context: string[]; question: string },
    { query: string }
  >;
  private queryFn: (query: string) => Promise<string>;
  private maxHops: number;

  constructor(
    queryFn: (query: string) => Promise<string>,
    options: Readonly<AxProgramForwardOptions<string> & { maxHops?: number }>
  ) {
    const sig =
      '"Answer questions with short factoid answers." context:string[] "may contain relevant facts", question -> answer';
    super(sig, options);

    this.maxHops = options?.maxHops ?? 3;

    const qsig = new AxSignature(
      '"Write a simple search query that will help answer a complex question." context?:string[] "may contain relevant facts", question -> query "question to further our understanding"'
    );
    this.genQuery = new AxGen<
      { context: string[]; question: string },
      { query: string }
    >(qsig);
    this.queryFn = queryFn;
    // Note: genQuery is not registered as it has a different output signature than the parent
  }

  public override async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values:
      | { context: string[]; question: string }
      | AxMessage<{ context: string[]; question: string }>[],
    options?: Readonly<
      AxProgramForwardOptions<
        NonNullable<ReturnType<T['getModelList']>>[number]['key']
      >
    >
  ): Promise<{ answer: string }> {
    // Extract question from values - handle both cases
    let question: string;
    if (Array.isArray(values)) {
      // If values is an array of messages, find the most recent user message
      const lastUserMessage = values.filter((msg) => msg.role === 'user').pop();
      if (!lastUserMessage) {
        throw new Error('No user message found in values array');
      }
      question = lastUserMessage.values.question;
    } else {
      // If values is a single object
      question = values.question;
    }

    let hop = 0;
    let context: string[] = [];

    while (hop < this.maxHops) {
      const query = await this.genQuery.forward(ai, { context, question });
      const queryResult = await this.queryFn(query.query);
      context = AxStringUtil.dedup([...context, queryResult]);

      hop++;
    }

    const res = await super.forward(ai, { context, question }, options);
    return res;
  }
}
