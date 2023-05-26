import { AIPrompt } from '../text/index.js';

/**
 * A prompt to summarize a block of text
 * @export
 */
export class SummarizePrompt extends AIPrompt<string> {
  constructor() {
    super({ stopSequences: ['---'] });
  }

  create(query: string, system: string): string {
    return `
${system}
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
