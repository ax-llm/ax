import { AIService, AIPrompt, PromptMetadata } from '../text';

/**
 * A prompt for conversational chat based assistant
 * @export
 */
export class AssistantPrompt implements AIPrompt {
  private context?: string;

  private _metadata: PromptMetadata = {
    stopSequences: ['Human:', 'AI:'],
    queryPrefix: '\nHuman: ',
    responsePrefix: '\nAI: ',
  };

  constructor(context?: string) {
    this.context = context;
  }

  metadata(): Readonly<PromptMetadata> {
    return this._metadata;
  }

  create(query: string, history: () => string, _ai: AIService): string {
    return `
The following is a conversation with an AI assistant. The assistant is helpful, creative, clever, and very friendly.
${this.context ? `\nUse the following context:\n${this.context}` : ''}

${history()}
Human: ${query}
${this._metadata.responsePrefix}
`;
  }
}
