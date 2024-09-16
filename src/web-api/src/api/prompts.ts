import { AxGen } from '@ax-llm/ax';

export const chatAgent = new AxGen<
  { chatHistory?: string[]; query: string },
  { markdownResponse: string }
>(
  '"You are a helpful chat bot. Respond in markdown. Use markdown codeblocks only for code." query, chatHistory?:string[] -> markdownResponse'
);

export const genTitle = new AxGen<
  { firstChatMessage: string },
  { chatTitle: string }
>('firstChatMessage -> chatTitle');
