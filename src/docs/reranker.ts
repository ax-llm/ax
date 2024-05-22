import {
  extractIdAndText,
  Generate,
  type GenerateOptions,
  Program,
  type ProgramForwardOptions
} from '../dsp/index.js';
import type { AIService } from '../text/index.js';

import type { RerankerIn, RerankerOut } from './manager.js';

export class DefaultResultReranker extends Program<RerankerIn, RerankerOut> {
  private reranker: Generate<RerankerIn, { rankedItems: string[] }>;

  constructor(ai: AIService, options?: Readonly<GenerateOptions>) {
    const signature = `"You are a re-ranker assistant tasked with evaluating a set of content items in relation to a specific question. Your role involves critically analyzing each content item to determine its relevance to the question and re-ranking them accordingly. This process includes assigning a relevance score from 0 to 10 to each content item based on how well it answers the question, its coverage of the topic, and the reliability of its information. This re-ranked list should start with the content item that is most relevant to the question and end with the least relevant. Output only the list."
    query: string, items: string[] -> rankedItems: string[] "list of id, 5-words Rationale, relevance score"`;

    super();
    this.reranker = new Generate<RerankerIn, { rankedItems: string[] }>(
      ai,
      signature,
      options
    );
    this.register(this.reranker);
  }

  public override forward = async (
    input: Readonly<RerankerIn>,
    options?: Readonly<ProgramForwardOptions>
  ): Promise<{ items: string[] }> => {
    const { rankedItems } = await this.reranker.forward(input, options);

    const sortedIndexes: number[] = rankedItems.map((item) => {
      const { id: index } = extractIdAndText(item);
      return index;
    });

    // Ensure all elements are strings and filter out null or undefined
    const sortedItems = input.items
      .map((_, index) => {
        const originalIndex = sortedIndexes[index];
        return originalIndex !== undefined
          ? input.items[originalIndex]
          : undefined;
      })
      .filter((item): item is string => item !== undefined);

    return { items: sortedItems };
  };
}
