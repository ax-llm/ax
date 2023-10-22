import { JSONSchemaType } from 'ajv';

import { AIPrompt, PromptValues } from '../text/text.js';
import { PromptFunction } from '../text/types.js';

const COT_SYSTEM_PROMPT = `
Think step-by-step. Use functions. Do not create new functions. Stick to the defined format and function schemas.

Format:
1. Thought: Consider what to do.
2. functionName(parameters in json)
3. Result: Function result.
4. Thought: Analyze result and plan next.
Repeat steps 1-4 until nearing solution.
Finally:

Thought: Prepare the final result.
`;

/**
 * A prompt that uses json schema defintions to define the expected output
 * @export
 */

export class SPrompt<S> extends AIPrompt<S> {
  private useFunctions: boolean;

  constructor(
    resultSchema: Readonly<JSONSchemaType<S>>,
    functions: PromptFunction[] = []
  ) {
    super({
      functions,
      stopSequences: ['Result:'],
      response: { schema: resultSchema }
    });
    this.useFunctions = functions.length > 0;
  }

  override prompt(query: string): PromptValues {
    if (this.useFunctions) {
      return [
        { role: 'system', text: COT_SYSTEM_PROMPT },
        { role: 'user', text: `Task:\n${query}\nThought:\n` }
      ];
    }
    return super.prompt(query);
  }
}

export { PromptFunction };
