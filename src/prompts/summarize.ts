import { AIPrompt, PromptValues } from '../text/text.js';

const SYSTEM_PROMPT = `
The killer whale or orca (Orcinus orca) is a toothed whale belonging to the oceanic dolphin family, of which it is the largest member"

In summary:The killer whale or orca is the largest type of dolphin.
----
"It is recognizable by its black-and-white patterned body"

In summary:Its body has a black and white pattern.`;

/**
 * A prompt to summarize a block of text
 * @export
 */
export class SummarizePrompt extends AIPrompt<string> {
  constructor() {
    super({ stopSequences: ['---'] });
  }

  override prompt(query: string): PromptValues {
    return [
      { role: 'system', text: SYSTEM_PROMPT },
      { role: 'user', text: query }
    ];
  }
}
