import { JSONSchemaType } from 'ajv';

import { AIPrompt } from '../text/text.js';
import { PromptFunction } from '../text/types.js';

/**
 * A prompt that uses json schema defintions to define the expected output
 * @export
 */
// eslint-disable-next-line functional/no-classes
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
    history: () => string
  ): string {
    return `
    ${system}
    ${query}
    ${history()}
`;
  }
}

export { PromptFunction };
