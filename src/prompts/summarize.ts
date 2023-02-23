import { AIService, AIPrompt, PromptMetadata } from '../text';

/**
 * A prompt to summarize a block of text
 * @export
 */
export class SummarizePrompt implements AIPrompt {
  private _metadata: PromptMetadata = {
    stopSequences: ['---'],
  };

  metadata(): Readonly<PromptMetadata> {
    return this._metadata;
  }

  create(query: string, _history: () => string, _ai: AIService): string {
    return `
The killer whale or orca (Orcinus orca) is a toothed whale belonging to the oceanic dolphin family, of which it is the largest member"

In summary:The killer whale or orca is the largest type of dolphin.
----
"It is recognizable by its black-and-white patterned body"

In summary:Its body has a black and white pattern.
----
"${query}"

In summary:`;
  }
}
