import { AIPrompt, PromptValues } from '../text/text.js';
import { PromptConfig } from '../text/types.js';

export enum MessageType {
  Email = 'promotion email',
  Text = 'SMS promotion'
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

  constructor(
    mi: Readonly<MessageInfo>,
    pi: Readonly<ProductInfo>,
    ri: Readonly<MessageReceiver>
  ) {
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

  override prompt(query: string): PromptValues {
    return {
      systemPrompt: `Using the below information to write an effective ${this.messageInfo.type}.`,
      prompt: `Product information:\n${this.product}\nReceiver Information:\n${this.receiver}\nContext:\n${query}`
    };
  }
}
