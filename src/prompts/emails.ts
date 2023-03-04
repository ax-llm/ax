import { AIService, AIPrompt, PromptMetadata } from '../text';

export enum MessageType {
  Email = 'promotion email',
  Text = 'SMS promotion',
}

export type MessageReceiver = {
  name: string;
  title: string;
  company: string;
  history: string;
};

export type MessageInfo = {
  type: MessageType | string;
};

export type ProductInfo = {
  name: string;
  description: string;
};

/**
 * A prompt used for extracting information from customer support interactions
 * @export
 */
export class EmailPrompt implements AIPrompt {
  private messageInfo: MessageInfo;
  private receiver: string = '';
  private product: string = '';

  constructor(mi: MessageInfo, pi: ProductInfo, ri: MessageReceiver) {
    for (var k in ri) {
      this.receiver += `${k}: ${ri[k]}\n`;
    }

    for (var k in pi) {
      this.product += `${k}: ${pi[k]}\n`;
    }

    this.messageInfo = mi;
  }

  metadata(): Readonly<PromptMetadata> {
    return {
      stopSequences: ['Text:'],
    };
  }

  create(query: string, _history: () => string, _ai: AIService): string {
    return `
Using the below information to write an effective ${this.messageInfo.type}.

Product information:
${this.product}

Receiver Information:
${this.receiver}

Context:
${query}
`;
  }
}
