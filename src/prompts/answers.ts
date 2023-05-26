import { AIPrompt, PromptAction } from '../text/index.js';

/**
 * A prompt used for question answering
 *
 * - This prompt is based off the famous RaAct paper.
 * - https://arxiv.org/abs/2210.03629
 * @export
 */
export class QuestionAnswerPrompt extends AIPrompt<string> {
  private context?: string;

  constructor(actions: PromptAction[] = [], context: string = '') {
    super({
      stopSequences: [],
      actions: [...actions],
    });
    this.context = context;
  }

  create(query: string, system: string, history: () => string): string {
    return `
${system}
${this.context}

Question: ${query}
${history()}
`;
  }
}
