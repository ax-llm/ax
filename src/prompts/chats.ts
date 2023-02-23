import { AIService, AIPrompt, PromptMetadata } from '../text';

/**
 * A prompt for conversational chat based assistant
 * @export
 */
export class AssistantPrompt implements AIPrompt {
  private _metadata: PromptMetadata = {
    stopSequences: ['Human:', 'Assistant:'],
    queryPrefix: '\nHuman: ',
    responsePrefix: '\nAssistant: ',
  };

  metadata(): Readonly<PromptMetadata> {
    return this._metadata;
  }

  create(query: string, history: () => string, ai: AIService): string {
    return `Assistant is an AI tool designed by ${ai.name()} to assist with a wide range of tasks. I generates human-like text, providing coherent and relevant responses to your queries. It can understand and process large amounts of text, and constantly evolves to improve its capabilities. Assistant can answer questions, explain concepts and engage in discussions on various topics. Whether you need help with a specific question or want to chat about a topic, Assistant is here to assist you.

${history()}
Human: ${query}
Assistant:`;
  }
}
