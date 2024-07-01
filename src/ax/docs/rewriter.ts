import {
  type AxAIService,
  AxGenerate,
  type AxGenerateOptions,
  type AxRewriteIn,
  type AxRewriteOut
} from '../index.js';

export class AxDefaultQueryRewriter extends AxGenerate<
  AxRewriteIn,
  AxRewriteOut
> {
  constructor(ai: AxAIService, options?: Readonly<AxGenerateOptions>) {
    const signature = `"You are a query rewriter assistant tasked with rewriting a given query to improve its clarity, specificity, and relevance. Your role involves analyzing the query to identify any ambiguities, generalizations, or irrelevant information and then rephrasing it to make it more focused and precise. The rewritten query should be concise, easy to understand, and directly related to the original query. Output only the rewritten query."
    query: string -> rewrittenQuery: string`;

    super(ai, signature, options);
  }
}
