/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
import { AIPrompt } from '../text/text.js';
import { PromptConfig } from '../text/types.js';

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
export class MessagePrompt extends AIPrompt<string> {
  private messageInfo: MessageInfo;
  private receiver = '';
  private product = '';

  constructor(mi: MessageInfo, pi: ProductInfo, ri: MessageReceiver) {
    super({ stopSequences: ['Text:'] } as PromptConfig<string>);

    let k1: keyof MessageReceiver;
    for (k1 in ri) {
      this.receiver += `${k1}: ${ri[k1]}\n`;
    }

    let k2: keyof ProductInfo;
    for (k2 in pi) {
      this.product += `${k2}: ${pi[k2]}\n`;
    }

    this.messageInfo = mi;
  }

  override create(query: string, system: string): string {
    return `
${system}
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
