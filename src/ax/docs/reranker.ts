import type { AxAIService } from '../ai/types.js';
import {
  AxGenerate,
  type AxGenerateOptions,
  type AxProgramForwardOptions,
  axStringUtil
} from '../dsp/index.js';

import type { AxRerankerIn, AxRerankerOut } from './manager.js';

export class AxDefaultResultReranker extends AxGenerate<
  AxRerankerIn,
  AxRerankerOut
> {
  constructor(ai: AxAIService, options?: Readonly<AxGenerateOptions>) {
    const signature = `"You are a re-ranker assistant tasked with evaluating a set of content items in relation to a specific question. Your role involves critically analyzing each content item to determine its relevance to the question and re-ranking them accordingly. This process includes assigning a relevance score from 0 to 10 to each content item based on how well it answers the question, its coverage of the topic, and the reliability of its information. This re-ranked list should start with the content item that is most relevant to the question and end with the least relevant. Output only the list."
    query: string, items: string[] -> rankedItems: string[] "list of id, 5-words Rationale, relevance score"`;

    super(ai, signature, options);
  }

  public override forward = async (
    input: Readonly<AxRerankerIn>,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<AxRerankerOut> => {
    const { rankedItems } = await super.forward(input, options);

    const sortedIndexes: number[] = rankedItems.map((item) => {
      const { id: index } = axStringUtil.extractIdAndText(item);
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

    return { rankedItems: sortedItems };
  };
}
