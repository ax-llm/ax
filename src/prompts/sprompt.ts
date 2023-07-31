import { JSONSchemaType } from 'ajv';

import { AIPrompt } from '../text/text.js';
import { AIService, PromptFunction } from '../text/types.js';

/**
 * A prompt that uses json schema defintions to define the expected output
 * @export
 */

export class SPrompt<S> extends AIPrompt<S> {
  constructor(
    resultSchema: Readonly<JSONSchemaType<S>>,
    functions: PromptFunction[] = []
  ) {
    super({
      functions,
      stopSequences: [],
      responseConfig: { schema: resultSchema },
    });
  }

  override create(
    query: string,
    system: string,
    history: () => string,
    _ai?: AIService,
    suffix?: string
  ): string {
    return `
    ${system}
    ${query}
    ${history()}
    ${suffix || ''}
`;
  }
}

export { PromptFunction };
