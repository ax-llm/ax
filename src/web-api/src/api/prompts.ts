import { AxGen } from '@ax-llm/ax';

export const chatAgent = new AxGen<
  { query: string },
  { markdownResponse: string }
>(
  '"You are a helpful chat bot. Respond in markdown. Use codeblocks only for code." query -> markdownResponse'
);

export const genTitle = new AxGen<
  { firstChatMessage: string },
  { chatTitle: string }
>('firstChatMessage -> chatTitle');
