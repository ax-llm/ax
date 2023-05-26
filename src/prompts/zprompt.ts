import { z } from 'zod';
import { AIService, AIPrompt, PromptAction } from '../text/index.js';

/**
 * A prompt that uses zod defintions to define the expected output
 * @export
 */
export class ZPrompt<Z> extends AIPrompt<Z> {
  constructor(schema: z.ZodType<Z>, actions: PromptAction[] = []) {
    super({
      actions,
      stopSequences: [],
      responseConfig: { schema },
    });
  }

  create(
    query: string,
    system: string,
    history: () => string,
    _ai: AIService
  ): string {
    return `
    ${system}
    ${query}
    ${history()}
`;
  }
}
