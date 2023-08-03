import { AIPrompt } from '../text/text.js';
import { PromptConfig } from '../text/types.js';

/**
 * A prompt for conversational chat based assistant
 * @export
 */
export class AssistantPrompt extends AIPrompt<string> {
  private context?: string;

  constructor(context?: string) {
    super({
      stopSequences: ['Human:', 'AI:'],
      queryPrefix: '\nHuman: ',
      responsePrefix: '\nAI: ',
    } as PromptConfig<string>);
    this.context = context;
  }

  override prompt(query: string, history: () => string): string {
    return `
The following is a conversation with an AI assistant. The assistant is helpful, creative, clever, and very friendly.

${this.context ? `\nUse the following context:\n${this.context}` : ''}

${history()}

Human: ${query}
AI:
`;
  }
}
