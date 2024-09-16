import { AxGen } from '@ax-llm/ax';

export const chatAgent = new AxGen<
  { agentDescription: string; chatHistory?: string[]; queryOrTask: string },
  { markdownResponse: string }
>(
  '"You are an AI chat agent. Use the provided agent description to guide your behavior. The context of the chat is provided in the chat history use it when responding to your query or performing a task. Respond in markdown. Use markdown codeblocks only for code." agentDescription, chatHistory?:string[], queryOrTask -> markdownResponse'
);

export const genTitle = new AxGen<
  { firstChatMessage: string },
  { chatTitle: string }
>('firstChatMessage -> chatTitle');
