import type {
  AxAIMemory,
  AxChatRequest,
  AxChatResponseResult,
  AxWritableChatPrompt
} from '@ax-llm/ax';
import type { Db, ObjectId } from 'mongodb';

import type { Message } from './types.js';

type ChatPrompt = AxChatRequest['chatPrompt'];

export class ChatMemory implements AxAIMemory {
  private chatCurrent: AxWritableChatPrompt = [];
  private chatHistory: ChatPrompt = [];

  getCurrentChat = (): ChatPrompt => this.chatCurrent;

  constructor(chatHistory: ChatPrompt) {
    this.chatHistory = chatHistory;
    this.chatCurrent = [];
  }

  add(value: Readonly<ChatPrompt | ChatPrompt[0]>): void {
    if (Array.isArray(value)) {
      this.chatCurrent = [...this.chatCurrent, ...value];
    } else {
      this.chatCurrent = [...this.chatCurrent, value] as ChatPrompt;
    }
  }

  addResult({
    content,
    functionCalls,
    name
  }: Readonly<AxChatResponseResult>): void {
    if (!content && (!functionCalls || functionCalls.length === 0)) {
      return;
    }
    this.add({ content, functionCalls, name, role: 'assistant' });
  }

  getLast(): ChatPrompt[0] | undefined {
    return this.chatCurrent.at(-1);
  }

  history(): ChatPrompt {
    return [...this.chatHistory, ...this.chatCurrent];
  }

  reset() {
    this.chatCurrent = [];
  }

  updateResult({
    content,
    functionCalls,
    name
  }: Readonly<AxChatResponseResult>): void {
    const items = this.chatCurrent;
    const lastItem = items.at(-1);

    if (!lastItem || lastItem.role !== 'assistant') {
      this.addResult({ content, functionCalls, name });
      return;
    }

    if ('content' in lastItem && content) {
      lastItem.content = content;
    }
    if ('name' in lastItem && name) {
      lastItem.name = name;
    }
    if ('functionCalls' in lastItem && functionCalls) {
      lastItem.functionCalls = functionCalls;
    }
  }
}

interface GetChatPromptArgs {
  chatId: ObjectId;
  uptoMessageId?: ObjectId;
}

export const getChatPrompt = async (
  db: Db,
  { chatId, uptoMessageId }: GetChatPromptArgs
): Promise<string[]> => {
  const allMessages = await db
    .collection<Message>('messages')
    .find({ chatId, error: { $exists: false } })
    .toArray();

  const messages = uptoMessageId
    ? allMessages.slice(
        0,
        allMessages.findIndex((m) => m._id.equals(uptoMessageId))
      )
    : allMessages;

  const chatPrompt = [];
  for (const m of messages) {
    if (m.error || !m.text) {
      continue;
    }
    chatPrompt.push(
      m.agentId
        ? `Agent: ${m.text}`
        : `User: ${m.text}
      `
    );
  }
  return chatPrompt;
};
